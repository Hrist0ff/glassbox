import { assembleConcept, toConceptContent, type Concept, type ConceptContent } from "@/lib/concept/schema";
import { validateConcept, type ValidationIssue } from "@/lib/concept/validate";
import { MAX_ATTEMPTS, type FailureCode, type GenerationEventInput } from "@/lib/sse/events";
import { BudgetExhaustedError, type Deadline } from "./budget";
import { LlmError, type LlmClient, type PipelineRole, type StructuredResult, type TokenUsage } from "./llm";
import {
  critiqueFromEvaluation,
  evaluateConcept,
  extractPlan,
  generateScenes,
  isAccepted,
  planProblems,
  ROLE_LABEL,
  type TeachingPlan,
} from "./roles";

/**
 * Request-scoped generation pipeline: plan → (generate → validate → evaluate)
 * × at most MAX_ATTEMPTS → persist.
 *
 * - Attempts are content-repair attempts. Provider retries happen inside the
 *   LLM client and do not count as attempts.
 * - Only a candidate that passes deterministic validation *and* evaluation is
 *   persisted. A rejected final candidate is discarded.
 * - The outcome is `ok` only after `persist` has resolved; the caller sends
 *   the `completed` event from that outcome.
 * - Progress events describe operations as they actually start and finish.
 */

export type GenerationMeta = {
  models: { extractor: string; generator: string; evaluator: string };
  attempts: number;
  totalLatencyMs: number;
  usage: TokenUsage;
  calls: Array<{ role: PipelineRole; latencyMs: number; inputTokens: number; outputTokens: number }>;
  evaluatorSummary: string;
};

export type PipelineDeps = {
  llm: LlmClient;
  models: { extractor: string; generator: string; evaluator: string };
  /** Must throw if the write fails. Should stop when `signal` aborts. */
  persist: (concept: Concept, meta: GenerationMeta, signal: AbortSignal) => Promise<{ id: string }>;
  /** Progress text for the persist stage, when `persist` does not save to the library. */
  persistMessages?: { running: string; done: string };
  newId: () => string;
  emit: (event: GenerationEventInput) => void;
  /** Aborted on client disconnect or when the server deadline passes. */
  signal: AbortSignal;
  deadline: Deadline;
  maxAttempts?: number;
};

export type PipelineOutcome =
  | { ok: true; conceptId: string; attempts: number; meta: GenerationMeta }
  | {
      ok: false;
      code: FailureCode;
      message: string;
      retryable: boolean;
      reasons?: string[];
      attempts: number;
      usage: TokenUsage;
    };

const MAX_REASONS = 5;

export async function runGenerationPipeline(topic: string, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { llm, models, emit, signal, deadline } = deps;
  const maxAttempts = Math.min(deps.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);
  const calls: GenerationMeta["calls"] = [];
  let attempts = 0;

  const record = (role: PipelineRole, result: Pick<StructuredResult<unknown>, "latencyMs" | "usage">) =>
    calls.push({ role, latencyMs: result.latencyMs, ...result.usage });
  const recordFailedCall = (role: PipelineRole, error: unknown) => {
    if (error instanceof LlmError && error.usage) calls.push({ role, latencyMs: 0, ...error.usage });
  };
  const totalUsage = (): TokenUsage =>
    calls.reduce(
      (sum, c) => ({ inputTokens: sum.inputTokens + c.inputTokens, outputTokens: sum.outputTokens + c.outputTokens }),
      { inputTokens: 0, outputTokens: 0 },
    );
  const fail = (code: FailureCode, message: string, retryable: boolean, reasons?: string[]): PipelineOutcome => ({
    ok: false,
    code,
    message,
    retryable,
    ...(reasons && reasons.length ? { reasons: reasons.slice(0, MAX_REASONS) } : {}),
    attempts,
    usage: totalUsage(),
  });
  const callFor = (role: PipelineRole) => ({ model: models[role], signal, timeoutMs: deadline.callTimeout(role) });

  let role: PipelineRole = "extractor";
  try {
    // ---- Plan -------------------------------------------------------------
    emit({ type: "progress", stage: "plan", state: "running", message: "Planning the explanation: central mechanism, entities, and storyboard" });
    let plan: TeachingPlan;
    try {
      const result = await extractPlan(llm, topic, callFor("extractor"));
      record("extractor", result);
      plan = result.data;
    } catch (error) {
      recordFailedCall("extractor", error);
      throw error;
    }

    if (plan.status !== "ok") {
      emit({ type: "progress", stage: "plan", state: "failed", message: "This topic does not fit the visual format" });
      return fail(
        "unsupported_topic",
        plan.limitation?.trim() ||
          "This topic can't be explained well with nodes, connections, and messages. Try a narrower, more concrete topic.",
        false,
      );
    }
    const problems = planProblems(plan);
    if (problems.length > 0) {
      emit({ type: "progress", stage: "plan", state: "failed", message: "The plan was incomplete" });
      return fail("rejected", "The planner returned an incomplete plan, so no scenes were drafted. Please try again.", true, problems);
    }
    emit({
      type: "progress",
      stage: "plan",
      state: "done",
      message: `Plan ready: ${plan.storyboard.length} beats with ${plan.entities.length} entities. Scope: ${plan.scope}`,
    });

    // ---- Generate → validate → evaluate, with bounded repair --------------
    let previous: { candidate: ConceptContent | null; critique: string[] } | undefined;
    let lastReasons: string[] = [];
    // The latest reviewer critique, so a later review checks those fixes first.
    let lastReviewIssues: string[] | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!deadline.canStartAttempt()) {
        return fail(
          "timeout",
          attempt === 1
            ? "Planning used up the time budget before scenes could be drafted. Please try again."
            : `Stopped after ${attempt - 1} attempt${attempt - 1 === 1 ? "" : "s"}: not enough time remained for another revision. Nothing was saved.`,
          true,
          lastReasons,
        );
      }
      attempts = attempt;
      emit({ type: "attempt", attempt, maxAttempts, outcome: "started" });

      role = "generator";
      emit({
        type: "progress",
        stage: "generate",
        state: "running",
        attempt,
        message:
          attempt === 1
            ? "Drafting scenes from the plan"
            : `Revising the draft to address ${previous?.critique.length ?? 0} issue${previous?.critique.length === 1 ? "" : "s"}`,
      });

      let content: ConceptContent;
      try {
        const result = await generateScenes(llm, { plan, previous }, callFor("generator"));
        record("generator", result);
        content = toConceptContent(result.data);
      } catch (error) {
        recordFailedCall("generator", error);
        if (error instanceof LlmError && (error.kind === "invalid_output" || error.kind === "incomplete")) {
          const reason =
            error.kind === "incomplete"
              ? "The draft was cut off before it was complete; it needs to be shorter."
              : "The draft did not match the scene format.";
          emit({ type: "progress", stage: "generate", state: "failed", attempt, message: reason });
          emit({ type: "attempt", attempt, maxAttempts, outcome: "rejected", reasons: [reason] });
          lastReasons = [reason];
          previous = {
            candidate: previous?.candidate ?? null,
            critique: [`${reason}${error.detail ? ` Details: ${error.detail}` : ""}`],
          };
          continue;
        }
        throw error;
      }
      emit({ type: "progress", stage: "generate", state: "done", attempt, message: `Draft ready: ${content.steps.length} steps` });

      emit({
        type: "progress",
        stage: "validate",
        state: "running",
        attempt,
        message: "Checking node references, scene bounds, label limits, and identity across steps",
      });
      const concept = assembleConcept(content, deps.newId());
      const validation = validateConcept(concept);
      if (!validation.ok) {
        const errors = validation.issues.filter((i) => i.severity === "error");
        emit({
          type: "progress",
          stage: "validate",
          state: "failed",
          attempt,
          message: `Found ${errors.length} structural problem${errors.length === 1 ? "" : "s"}`,
        });
        lastReasons = errors.map((i) => i.message);
        emit({ type: "attempt", attempt, maxAttempts, outcome: "rejected", reasons: lastReasons.slice(0, MAX_REASONS) });
        previous = { candidate: content, critique: errors.slice(0, 20).map(issueToCritique) };
        continue;
      }
      const warnings = validation.issues;
      emit({
        type: "progress",
        stage: "validate",
        state: "done",
        attempt,
        message:
          warnings.length === 0
            ? "Structure and layout checks passed"
            : `Structure checks passed with ${warnings.length} layout warning${warnings.length === 1 ? "" : "s"}`,
      });

      role = "evaluator";
      emit({
        type: "progress",
        stage: "evaluate",
        state: "running",
        attempt,
        message: "Reviewing accuracy, text–scene consistency, progression, and readability",
      });
      let evaluation;
      try {
        const result = await evaluateConcept(
          llm,
          { plan, concept: validation.concept, warnings, previousIssues: lastReviewIssues },
          callFor("evaluator"),
        );
        record("evaluator", result);
        evaluation = result.data;
      } catch (error) {
        recordFailedCall("evaluator", error);
        throw error;
      }

      if (!isAccepted(evaluation)) {
        const critique = critiqueFromEvaluation(evaluation);
        const serious = evaluation.issues.filter((i) => i.severity !== "minor");
        emit({
          type: "progress",
          stage: "evaluate",
          state: "failed",
          attempt,
          message: `Review found ${serious.length || "unresolved"} issue${serious.length === 1 ? "" : "s"} to fix`,
        });
        lastReasons = serious.length ? serious.map((i) => i.problem) : [evaluation.summary];
        emit({ type: "attempt", attempt, maxAttempts, outcome: "rejected", reasons: lastReasons.slice(0, MAX_REASONS) });
        previous = { candidate: content, critique: critique.length ? critique : [evaluation.summary] };
        lastReviewIssues = previous.critique;
        continue;
      }

      emit({ type: "progress", stage: "evaluate", state: "done", attempt, message: `Review passed. ${evaluation.summary}` });
      emit({ type: "attempt", attempt, maxAttempts, outcome: "accepted" });

      // ---- Persist ----------------------------------------------------------
      if (signal.aborted) return cancelledOrTimedOut(deadline, fail);
      emit({ type: "progress", stage: "persist", state: "running", message: deps.persistMessages?.running ?? "Saving the explanation to your library" });
      const usage = totalUsage();
      const meta: GenerationMeta = {
        models: { ...models },
        attempts,
        totalLatencyMs: deadline.elapsedMs(),
        usage,
        calls,
        evaluatorSummary: evaluation.summary,
      };
      let saved: { id: string };
      try {
        saved = await deps.persist(validation.concept, meta, signal);
      } catch {
        emit({ type: "progress", stage: "persist", state: "failed", message: "Saving failed" });
        if (signal.aborted) {
          // The save may have completed before the abort.
          return fail(
            deadline.expired() ? "timeout" : "cancelled",
            "Stopped while saving, so the explanation may or may not have been saved. Retrying will open it if it was.",
            true,
          );
        }
        return fail(
          "persistence_failed",
          "The explanation passed review but could not be saved, so it was not published. Please try again.",
          true,
        );
      }
      emit({ type: "progress", stage: "persist", state: "done", message: deps.persistMessages?.done ?? "Saved" });
      return { ok: true, conceptId: saved.id, attempts, meta };
    }

    return fail(
      "rejected",
      `All ${maxAttempts} drafts were rejected, so nothing was saved. You can retry or rephrase the topic.${lastReasons.length ? " Last problems found:" : ""}`,
      true,
      lastReasons,
    );
  } catch (error) {
    return mapError(error, role, deadline, fail);
  }
}

function issueToCritique(issue: ValidationIssue): string {
  return `${issue.code}${issue.path ? ` at ${issue.path}` : ""}: ${issue.message}`;
}

type Fail = (code: FailureCode, message: string, retryable: boolean, reasons?: string[]) => PipelineOutcome;

function cancelledOrTimedOut(deadline: Deadline, fail: Fail): PipelineOutcome {
  return deadline.expired()
    ? fail("timeout", "Generation ran out of time and was stopped. Nothing was saved.", true)
    : fail("cancelled", "Generation was cancelled. Nothing was saved.", true);
}

function mapError(error: unknown, role: PipelineRole, deadline: Deadline, fail: Fail): PipelineOutcome {
  if (error instanceof BudgetExhaustedError) {
    return fail("timeout", `Ran out of time before the ${ROLE_LABEL[error.role]} could run. Nothing was saved.`, true);
  }
  if (!(error instanceof LlmError)) {
    return fail("internal", "Something went wrong on our side. Nothing was saved.", true);
  }
  const who = ROLE_LABEL[role];
  switch (error.kind) {
    case "aborted":
      return cancelledOrTimedOut(deadline, fail);
    case "timeout":
      return fail("timeout", `The ${who} took too long to respond. Nothing was saved.`, true);
    case "refusal":
      return fail("model_refused", "The AI model declined to explain this topic.", false);
    case "provider": {
      const status = error.status;
      if (status === 401 || status === 403) {
        return fail("provider_error", "The server's AI credentials were rejected. Please contact the site operator.", false);
      }
      const transient = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      return fail(
        "provider_error",
        transient
          ? "The AI provider is busy or unavailable right now. Please try again shortly."
          : "The AI provider rejected the request. Please contact the site operator if this continues.",
        transient,
      );
    }
    case "invalid_output":
    case "incomplete":
      return fail("provider_error", `The ${who} returned an unusable response. Please try again.`, true);
    case "schema_unsupported":
      return fail("internal", "The server's output schema is misconfigured. Please contact the site operator.", false);
  }
}
