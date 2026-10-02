import { LIMITS } from "@/lib/concept/constants";
import { layoutGenerated } from "@/lib/concept/layout";
import { assembleConcept, type Claim, type Concept, type GeneratedConceptContent, type Provenance } from "@/lib/concept/schema";
import { validateConcept, type ValidationIssue } from "@/lib/concept/validate";
import type { GenerationRequest } from "@/lib/generation/request";
import { MAX_ATTEMPTS, type FailureCode, type GenerationEventInput } from "@/lib/sse/events";
import { locateQuote } from "@/lib/sources/passages";
import { BudgetExhaustedError, type Deadline } from "./budget";
import { LlmError, type LlmClient, type PipelineRole, type StructuredResult, type TokenUsage } from "./llm";
import {
  critiqueFromEvaluation,
  evaluateConcept,
  evaluateStepText,
  extractPlan,
  generateScenes,
  isAccepted,
  planProblems,
  readSource,
  ROLE_LABEL,
  verifyClaims,
  writeStepText,
  type Evaluation,
  type TeachingPlan,
  type VerifiedClaims,
} from "./roles";

/**
 * Request-scoped generation pipeline:
 *   [read material] → plan → (generate → lay out → validate → evaluate) × at most MAX_ATTEMPTS → persist.
 * "Explain this step" and "Make it simpler" run a shorter one:
 *   (write → check → evaluate) × at most TEXT_ATTEMPTS → persist.
 *
 * - Attempts are content-repair attempts. Provider retries happen inside the
 *   LLM client and do not count as attempts.
 * - Only a candidate that passes deterministic validation *and* evaluation is
 *   persisted. A rejected final candidate is discarded.
 * - The outcome is `ok` only after `persist` has resolved; the caller sends
 *   the `completed` event from that outcome.
 * - Progress events describe operations as they actually start and finish.
 * - This module has no route or storage imports; dependencies are injected.
 */

export type ModelSet = { extractor: string; generator: string; evaluator: string; reader?: string; writer?: string };

export type GenerationMeta = {
  models: ModelSet;
  attempts: number;
  totalLatencyMs: number;
  usage: TokenUsage;
  calls: Array<{ role: PipelineRole; latencyMs: number; inputTokens: number; outputTokens: number }>;
  evaluatorSummary: string;
};

/** What a successful run produces. */
export type PipelineProduct =
  | { kind: "concept"; concept: Concept }
  | { kind: "text"; action: "explain" | "simplify"; stepId: string; text: string; claims: string[] };

export type PipelineDeps = {
  llm: LlmClient;
  models: ModelSet;
  /** Must throw if the write fails. Should stop when `signal` aborts. */
  persist: (product: PipelineProduct, meta: GenerationMeta, signal: AbortSignal) => Promise<{ id: string }>;
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
  | { ok: true; conceptId: string; attempts: number; meta: GenerationMeta; product: PipelineProduct }
  | {
      ok: false;
      code: FailureCode;
      message: string;
      retryable: boolean;
      reasons?: string[];
      /** Supported requests to offer instead (unsupported or ambiguous requests). */
      suggestions?: string[];
      attempts: number;
      usage: TokenUsage;
    };

const MAX_REASONS = 5;
/** Drafts of a step explanation before giving up. */
export const TEXT_ATTEMPTS = 2;

type Fail = (code: FailureCode, message: string, retryable: boolean, reasons?: string[], suggestions?: string[]) => PipelineOutcome;

/** Shared bookkeeping for one run: call records, usage, failure outcomes, per-role call budgets. */
function runContext(deps: PipelineDeps) {
  const calls: GenerationMeta["calls"] = [];
  const state = { attempts: 0, role: "extractor" as PipelineRole };
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
  const fail: Fail = (code, message, retryable, reasons, suggestions) => ({
    ok: false,
    code,
    message,
    retryable,
    ...(reasons && reasons.length ? { reasons: reasons.slice(0, MAX_REASONS) } : {}),
    ...(suggestions && suggestions.length ? { suggestions: suggestions.slice(0, 3) } : {}),
    attempts: state.attempts,
    usage: totalUsage(),
  });
  const modelFor = (role: PipelineRole) =>
    role === "reader" ? (deps.models.reader ?? deps.models.extractor) : role === "writer" ? (deps.models.writer ?? deps.models.generator) : deps.models[role];
  const callFor = (role: PipelineRole) => ({ model: modelFor(role), signal: deps.signal, timeoutMs: deps.deadline.callTimeout(role) });
  /** Run one model call for a role, recording its usage either way. */
  async function call<T>(role: PipelineRole, run: (c: ReturnType<typeof callFor>) => Promise<StructuredResult<T>>): Promise<T> {
    state.role = role;
    try {
      const result = await run(callFor(role));
      record(role, result);
      return result.data;
    } catch (error) {
      recordFailedCall(role, error);
      throw error;
    }
  }
  const meta = (evaluation: Evaluation): GenerationMeta => ({
    models: { ...deps.models },
    attempts: state.attempts,
    totalLatencyMs: deps.deadline.elapsedMs(),
    usage: totalUsage(),
    calls,
    evaluatorSummary: evaluation.summary,
  });
  return { state, fail, call, meta };
}

export async function runGenerationPipeline(request: GenerationRequest, deps: PipelineDeps): Promise<PipelineOutcome> {
  if (request.kind === "explore" && request.context.action !== "example") return runStepTextPipeline(request, deps);

  const { emit, deadline } = deps;
  const maxAttempts = Math.min(deps.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);
  const run = runContext(deps);
  const { fail, call } = run;

  try {
    // ---- Read supplied material ---------------------------------------------
    let claims: VerifiedClaims | null = null;
    if (request.kind === "source") {
      emit({
        type: "progress",
        stage: "read",
        state: "running",
        message: `Reading your material (${request.source.passages.length} passages): listing its claims and the excerpts that support them`,
      });
      const set = await call("reader", (c) => readSource(deps.llm, { source: request.source, question: request.question, preferences: request.preferences }, c));
      claims = verifyClaims(set, request.source, locateQuote);
      if (set.status !== "ok" || claims.claims.length === 0) {
        emit({ type: "progress", stage: "read", state: "failed", message: "The material has nothing that can be explained visually" });
        return fail(
          "unsupported_topic",
          set.limitation?.trim() || "Couldn't find statements in this material that can be explained visually. Try a longer excerpt, or a question about it.",
          false,
        );
      }
      const stated = claims.claims.filter((c) => c.basis === "source").length;
      emit({
        type: "progress",
        stage: "read",
        state: "done",
        message:
          `Found ${claims.claims.length} claims: ${stated} stated in the material with a checked excerpt, ${claims.claims.length - stated} interpretations` +
          (claims.downgraded ? ` (${claims.downgraded} lost "stated" status because their excerpt was not found)` : "") +
          (claims.conflicts.length ? `; ${claims.conflicts.length} contradiction${claims.conflicts.length === 1 ? "" : "s"} noted` : ""),
      });
    }

    // ---- Plan ---------------------------------------------------------------
    emit({ type: "progress", stage: "plan", state: "running", message: "Planning: what the reader should understand, and the best way to show it" });
    const planContext = {
      claimIds: claims?.claims.map((c) => c.id) ?? [],
      sourceMode: request.kind === "source",
      // The requested language, or for material without a preference, the material's own.
      language: request.kind === "explore" ? undefined : request.preferences.language || claims?.language || undefined,
    };
    let plan: TeachingPlan = await call("extractor", (c) => extractPlan(deps.llm, { request, claims }, c));
    if (plan.status !== "ok") return declined(plan);
    let problems = planProblems(plan, planContext);
    if (problems.length > 0) {
      // One bounded plan repair.
      emit({ type: "progress", stage: "plan", state: "running", message: `Revising the plan to fix ${problems.length} problem${problems.length === 1 ? "" : "s"}` });
      plan = await call("extractor", (c) => extractPlan(deps.llm, { request, claims, problems }, c));
      if (plan.status !== "ok") return declined(plan);
      problems = planProblems(plan, planContext);
    }
    if (problems.length > 0) {
      emit({ type: "progress", stage: "plan", state: "failed", message: "The plan was incomplete" });
      return fail("rejected", "The planner returned an incomplete plan, so no scenes were drafted. Please try again.", true, problems);
    }
    emit({
      type: "progress",
      stage: "plan",
      state: "done",
      message: `Plan ready: a ${plan.explanationType} shown as ${REPRESENTATION_TEXT[plan.representation]}, in ${plan.beats.length} beats. Scope: ${plan.scope}`,
    });

    function declined(p: TeachingPlan): PipelineOutcome {
      emit({ type: "progress", stage: "plan", state: "failed", message: p.status === "ambiguous" ? "The request can be read in more than one way" : "This request does not fit the visual format" });
      return fail(
        "unsupported_topic",
        p.limitation?.trim() ||
          "This request can't be explained well with the views the player supports (actors and messages, timelines, comparisons, hierarchies, charts, code, and tables). Try a narrower, more concrete request.",
        false,
        undefined,
        p.alternatives.map((a) => a.trim()).filter(Boolean),
      );
    }

    const provenance = buildProvenance(request, plan, claims);

    // ---- Generate → lay out → validate → evaluate, with bounded repair ------
    let previous: { candidate: GeneratedConceptContent | null; critique: string[] } | undefined;
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
      run.state.attempts = attempt;
      emit({ type: "attempt", attempt, maxAttempts, outcome: "started" });
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

      let generated: GeneratedConceptContent;
      try {
        generated = await call("generator", (c) => generateScenes(deps.llm, { plan, claims, previous }, c));
      } catch (error) {
        if (error instanceof LlmError && (error.kind === "invalid_output" || error.kind === "incomplete")) {
          const reason =
            error.kind === "incomplete"
              ? "The draft was cut off before it was complete; it needs to be shorter."
              : "The draft did not match the scene format.";
          emit({ type: "progress", stage: "generate", state: "failed", attempt, message: reason });
          emit({ type: "attempt", attempt, maxAttempts, outcome: "rejected", reasons: [reason] });
          lastReasons = [reason];
          previous = { candidate: previous?.candidate ?? null, critique: [`${reason}${error.detail ? ` Details: ${error.detail}` : ""}`] };
          continue;
        }
        throw error;
      }
      emit({ type: "progress", stage: "generate", state: "done", attempt, message: `Draft ready: ${generated.steps.length} steps` });

      emit({
        type: "progress",
        stage: "validate",
        state: "running",
        attempt,
        message: "Laying out the scenes, then checking references, sizes, overlaps, claim citations, and identity across steps",
      });
      const { content } = layoutGenerated(generated, plan.layout);
      const concept = assembleConcept(content, deps.newId(), { layout: plan.layout, provenance });
      const validation = validateConcept(concept);
      const citations = citationProblems(generated, provenance.claims.map((c) => c.id));
      // Unknown citations are reported once, with the list of valid ids, by `citationProblems`.
      const errors = validation.ok ? [] : validation.issues.filter((i) => i.severity === "error" && !(citations.length > 0 && i.code === "unknown_claim"));
      if (!validation.ok || citations.length > 0) {
        const all = [...errors.map(issueToCritique), ...citations];
        emit({
          type: "progress",
          stage: "validate",
          state: "failed",
          attempt,
          message: `Found ${all.length} structural problem${all.length === 1 ? "" : "s"}`,
        });
        lastReasons = [...errors.map((i) => i.message), ...citations];
        emit({ type: "attempt", attempt, maxAttempts, outcome: "rejected", reasons: lastReasons.slice(0, MAX_REASONS) });
        previous = { candidate: generated, critique: all.slice(0, 20) };
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
            ? "Layout and structure checks passed"
            : `Structure checks passed with ${warnings.length} layout warning${warnings.length === 1 ? "" : "s"}`,
      });

      emit({
        type: "progress",
        stage: "evaluate",
        state: "running",
        attempt,
        message:
          request.kind === "source"
            ? "Reviewing fidelity to your material and request, accuracy, text–scene consistency, and progression"
            : "Reviewing fidelity to the request, accuracy, text–scene consistency, and progression",
      });
      const evaluation = await call("evaluator", (c) =>
        evaluateConcept(deps.llm, { request, plan, claims, concept: validation.concept, warnings, previousIssues: lastReviewIssues }, c),
      );

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
        previous = { candidate: generated, critique: critique.length ? critique : [evaluation.summary] };
        lastReviewIssues = previous.critique;
        continue;
      }

      emit({ type: "progress", stage: "evaluate", state: "done", attempt, message: `Review passed. ${evaluation.summary}` });
      emit({ type: "attempt", attempt, maxAttempts, outcome: "accepted" });
      return persistProduct({ kind: "concept", concept: validation.concept }, run.meta(evaluation), deps, fail);
    }

    return fail(
      "rejected",
      `All ${maxAttempts} drafts were rejected, so nothing was saved. You can retry or rephrase the request.${lastReasons.length ? " Last problems found:" : ""}`,
      true,
      lastReasons,
    );
  } catch (error) {
    return mapError(error, run.state.role, deadline, fail);
  }
}

const REPRESENTATION_TEXT: Record<TeachingPlan["representation"], string> = {
  actors_and_messages: "actors and messages",
  code_trace: "a code trace",
  data_structure: "changing data",
  timeline: "a timeline",
  comparison: "a comparison",
  hierarchy: "a hierarchy",
  chart: "a chart",
};

/** Claim ids cited by steps must be ones the plan made available (checked before layout validation sees them). */
function citationProblems(generated: GeneratedConceptContent, allowed: string[]): string[] {
  const known = new Set(allowed);
  return generated.steps.flatMap((step) =>
    step.claims.filter((id) => !known.has(id)).map((id) => `unknown_claim at step ${step.id}: "${id}" is not one of the claims or assumptions (${allowed.join(", ") || "none"}).`),
  );
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** What the explanation was made from, stored with it and shown in "Sources and assumptions". */
export function buildProvenance(request: GenerationRequest, plan: TeachingPlan, claims: VerifiedClaims | null): Provenance {
  // Models sometimes return blank list items; provenance keeps only ones that say something.
  const present = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
  const assumptions: Claim[] = plan.assumptions
    .filter((a) => a.text.trim())
    .map((a) => ({ id: a.id, text: clip(a.text.trim(), LIMITS.claimText.max), basis: "assumption", passages: [], quote: "" }));
  const limitations: string[] = [];
  if (claims) {
    for (const conflict of claims.conflicts) limitations.push(`The material is inconsistent: ${conflict.note}`);
    for (const gap of claims.gaps) limitations.push(`Not stated in the material: ${gap}`);
    if (claims.downgraded > 0) {
      limitations.push(
        `${claims.downgraded} statement${claims.downgraded === 1 ? "" : "s"} could not be matched to an exact excerpt, so ${claims.downgraded === 1 ? "it is" : "they are"} shown as interpretation.`,
      );
    }
    if (claims.embeddedInstructions) limitations.push("The material contained instructions addressed to an AI; they were ignored.");
  }
  if (request.kind === "explore") {
    const c = request.context;
    if (!assumptions.some((a) => a.id === "example")) {
      assumptions.push({
        id: "example",
        text: clip(`A made-up example for step ${c.stepIndex + 1} of “${c.concept.title}”; it does not come from any supplied material.`, LIMITS.claimText.max),
        basis: "assumption",
        passages: [],
        quote: "",
      });
    }
  }
  const topic = request.kind === "topic" ? request.topic : request.kind === "source" ? request.title : request.context.topic;
  return {
    request: {
      kind: request.kind === "explore" ? "example" : request.kind,
      topic: clip(topic || "Untitled", LIMITS.question.max),
      question: request.kind === "source" ? request.question : "",
      audience: clip(plan.audience.trim(), LIMITS.audience.max),
      language: clip(plan.language.trim(), 40),
      depth: plan.depth,
    },
    learningGoal: clip(plan.learningGoal.trim() || plan.concept.trim() || "Understand the request", 240),
    explanationType: plan.explanationType,
    representation: plan.representation,
    sourcesConsulted: request.kind === "source",
    sources: request.kind === "source" ? [request.source] : [],
    claims: [...(claims?.claims ?? []), ...assumptions],
    scope: clip(plan.scope, 300),
    omissions: present(plan.omissions).map((o) => clip(o, LIMITS.listItem.max)).slice(0, 5),
    simplifications: present(plan.simplifications).map((s) => clip(s, LIMITS.listItem.max)).slice(0, 6),
    uncertainty: present(plan.uncertainty).map((u) => clip(u, LIMITS.listItem.max)).slice(0, 4),
    limitations: limitations.map((l) => clip(l, LIMITS.listItem.max)).slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// "Explain this step" and "Make it simpler"
// ---------------------------------------------------------------------------

/** Markup, links, or code fences in what should be plain prose. */
const MARKUP = /<\/?[a-z!][^>]*>|\]\(|https?:\/\/|```|^\s*[#*-]\s/im;

async function runStepTextPipeline(request: Extract<GenerationRequest, { kind: "explore" }>, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { emit, deadline } = deps;
  const context = request.context;
  const action = context.action === "simplify" ? "simplify" : "explain";
  const run = runContext(deps);
  const { fail, call } = run;
  const claimIds = new Set(context.concept.provenance?.claims.map((c) => c.id) ?? []);
  let previous: { text: string; critique: string[] } | undefined;
  let lastReasons: string[] = [];
  let lastReviewIssues: string[] | undefined;

  try {
    for (let attempt = 1; attempt <= TEXT_ATTEMPTS; attempt++) {
      if (!deadline.canStartAttempt()) return fail("timeout", "Ran out of time before the text could be written. Nothing was saved.", true, lastReasons);
      run.state.attempts = attempt;
      emit({ type: "attempt", attempt, maxAttempts: TEXT_ATTEMPTS, outcome: "started" });
      emit({
        type: "progress",
        stage: "generate",
        state: "running",
        attempt,
        message: attempt === 1 ? (action === "explain" ? "Writing an explanation of this step" : "Writing a simpler version of this step") : "Revising the text",
      });
      const written = await call("writer", (c) => writeStepText(deps.llm, { context, previous }, c));
      if (written.status !== "ok") {
        emit({ type: "progress", stage: "generate", state: "failed", attempt, message: "This step can't be explained further from what the explanation contains" });
        return fail("unsupported_topic", written.limitation?.trim() || "This step can't be explained further without information the explanation doesn't have.", false);
      }
      emit({ type: "progress", stage: "generate", state: "done", attempt, message: "Text ready" });

      emit({ type: "progress", stage: "validate", state: "running", attempt, message: "Checking length, plain text, and cited claims" });
      const text = written.text.trim();
      const problems: string[] = [];
      if (text.length < 20) problems.push("The text is empty or too short.");
      if (MARKUP.test(text)) problems.push("The text contains markup, a list, or a link; write plain sentences.");
      for (const id of written.claims) if (!claimIds.has(id)) problems.push(`The text cites "${id}", which is not one of the explanation's claims.`);
      if (problems.length > 0) {
        emit({ type: "progress", stage: "validate", state: "failed", attempt, message: `Found ${problems.length} problem${problems.length === 1 ? "" : "s"}` });
        emit({ type: "attempt", attempt, maxAttempts: TEXT_ATTEMPTS, outcome: "rejected", reasons: problems });
        lastReasons = problems;
        previous = { text, critique: problems };
        continue;
      }
      emit({ type: "progress", stage: "validate", state: "done", attempt, message: "Checks passed" });

      emit({ type: "progress", stage: "evaluate", state: "running", attempt, message: "Reviewing accuracy and fidelity to the explanation" });
      const evaluation = await call("evaluator", (c) =>
        evaluateStepText(deps.llm, { context, text, claims: written.claims }, c),
      );
      if (!isAccepted(evaluation)) {
        const critique = critiqueFromEvaluation(evaluation);
        const serious = evaluation.issues.filter((i) => i.severity !== "minor");
        emit({ type: "progress", stage: "evaluate", state: "failed", attempt, message: `Review found ${serious.length || "unresolved"} issue${serious.length === 1 ? "" : "s"} to fix` });
        lastReasons = serious.length ? serious.map((i) => i.problem) : [evaluation.summary];
        emit({ type: "attempt", attempt, maxAttempts: TEXT_ATTEMPTS, outcome: "rejected", reasons: lastReasons.slice(0, MAX_REASONS) });
        previous = { text, critique: [...critique, ...(lastReviewIssues ?? [])].slice(0, 8) };
        lastReviewIssues = critique;
        continue;
      }
      emit({ type: "progress", stage: "evaluate", state: "done", attempt, message: `Review passed. ${evaluation.summary}` });
      emit({ type: "attempt", attempt, maxAttempts: TEXT_ATTEMPTS, outcome: "accepted" });
      return persistProduct({ kind: "text", action, stepId: context.stepId, text, claims: written.claims }, run.meta(evaluation), deps, fail);
    }
    return fail("rejected", `Both drafts were rejected, so nothing was saved.${lastReasons.length ? " Last problems found:" : ""}`, true, lastReasons);
  } catch (error) {
    return mapError(error, run.state.role, deadline, fail);
  }
}

// ---------------------------------------------------------------------------
// Shared tail
// ---------------------------------------------------------------------------

async function persistProduct(product: PipelineProduct, meta: GenerationMeta, deps: PipelineDeps, fail: Fail): Promise<PipelineOutcome> {
  const { emit, signal, deadline } = deps;
  if (signal.aborted) return cancelledOrTimedOut(deadline, fail);
  emit({ type: "progress", stage: "persist", state: "running", message: deps.persistMessages?.running ?? "Saving to your library" });
  let saved: { id: string };
  try {
    saved = await deps.persist(product, meta, signal);
  } catch {
    emit({ type: "progress", stage: "persist", state: "failed", message: "Saving failed" });
    if (signal.aborted) {
      // The save may have completed before the abort.
      return fail(
        deadline.expired() ? "timeout" : "cancelled",
        "Stopped while saving, so the result may or may not have been saved. Retrying will open it if it was.",
        true,
      );
    }
    return fail("persistence_failed", "The result passed review but could not be saved, so it was not published. Please try again.", true);
  }
  emit({ type: "progress", stage: "persist", state: "done", message: deps.persistMessages?.done ?? "Saved" });
  return { ok: true, conceptId: saved.id, attempts: meta.attempts, meta, product };
}

function issueToCritique(issue: ValidationIssue): string {
  return `${issue.code}${issue.path ? ` at ${issue.path}` : ""}: ${issue.message}`;
}

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
      return fail("model_refused", "The AI model declined this request.", false);
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
