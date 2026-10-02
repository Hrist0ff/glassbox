import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { toGeneratedContent, type Concept, type GeneratedConceptContent } from "@/lib/concept/schema";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { Deadline } from "@/lib/pipeline/budget";
import { LlmError, type LlmClient, type StructuredRequest } from "@/lib/pipeline/llm";
import { runGenerationPipeline, type PipelineDeps } from "@/lib/pipeline/orchestrator";
import type { Evaluation, TeachingPlan } from "@/lib/pipeline/roles";
import type { GenerationEventInput } from "@/lib/sse/events";

const plan: TeachingPlan = {
  status: "ok",
  limitation: null,
  concept: "Binary search",
  audience: "beginners",
  centralMechanism: "halving a sorted range",
  scope: "search in a sorted array",
  prerequisites: [],
  entities: [{ id: "target", label: "Target", shape: "circle", role: "value sought" }],
  panels: [],
  storyboard: Array.from({ length: 5 }, (_, i) => ({ purpose: "mechanism" as const, event: `beat ${i}`, visualChange: "x" })),
  simplifications: [],
  assumptions: [],
  uncertainty: [],
};

/** A valid generated candidate (wire format: every key present). */
const goodCandidate: GeneratedConceptContent = toGeneratedContent(binarySearch);

/** Fails deterministic validation: an edge points at a node that does not exist. */
const brokenCandidate: GeneratedConceptContent = {
  ...goodCandidate,
  steps: goodCandidate.steps.map((s, i) => (i === 2 ? { ...s, edges: [{ ...s.edges[0]!, to: "ghost" }] } : s)),
};

const pass: Evaluation = { passed: true, summary: "Accurate and clear.", issues: [] };
const fail: Evaluation = {
  passed: false,
  summary: "Step 3 is wrong.",
  issues: [{ category: "technical_accuracy", severity: "major", stepId: "first-middle", problem: "Wrong middle.", suggestion: "Use index 3." }],
};

type Script = {
  extractor?: Array<TeachingPlan | Error>;
  generator?: Array<GeneratedConceptContent | Error>;
  evaluator?: Array<Evaluation | Error>;
};

function fakeLlm(script: Script) {
  const calls: Array<{ role: string; input: string }> = [];
  const queues = { extractor: [...(script.extractor ?? [plan])], generator: [...(script.generator ?? [])], evaluator: [...(script.evaluator ?? [])] };
  const llm: LlmClient = {
    async structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      calls.push({ role: request.role, input: request.input });
      if (request.signal.aborted) throw new LlmError("aborted", "aborted");
      const next = queues[request.role].shift();
      if (next === undefined) throw new Error(`unexpected ${request.role} call`);
      if (next instanceof Error) throw next;
      return { data: next as z.infer<S>, usage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 5, model: "fake" };
    },
  };
  return { llm, calls };
}

function deps(llm: LlmClient, overrides: Partial<PipelineDeps> = {}) {
  const events: GenerationEventInput[] = [];
  const persist = vi.fn(async (concept: Concept) => {
    events.push({ type: "progress", stage: "persist", state: "done", message: "(persist resolved)" });
    return { id: concept.id };
  });
  const base: PipelineDeps = {
    llm,
    models: { extractor: "m", generator: "m", evaluator: "m" },
    persist,
    newId: () => "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99",
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    deadline: new Deadline(270_000),
    ...overrides,
  };
  return { deps: base, events, persist };
}

describe("runGenerationPipeline", () => {
  it("persists and returns ok when the first draft passes", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const { deps: d, events, persist } = deps(llm);
    const outcome = await runGenerationPipeline("binary search", d);

    expect(outcome).toMatchObject({ ok: true, conceptId: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99", attempts: 1 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.role)).toEqual(["extractor", "generator", "evaluator"]);
    // The saved concept carries app-generated identity, not model output.
    const saved = persist.mock.calls[0]![0];
    expect(saved).toMatchObject({ schemaVersion: 1, id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99" });
    // Progress is reported in the order the work actually happened.
    const stages = events.filter((e) => e.type === "progress" && e.state !== "running").map((e) => e.type === "progress" && e.stage);
    expect(stages).toEqual(["plan", "generate", "validate", "evaluate", "persist", "persist"]);
  });

  it("stops after three total attempts and never persists a rejected candidate", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, goodCandidate, goodCandidate], evaluator: [fail, fail] });
    const { deps: d, events, persist } = deps(llm);
    const outcome = await runGenerationPipeline("binary search", d);

    expect(outcome).toMatchObject({ ok: false, code: "rejected", attempts: 3, retryable: true });
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(3);
    expect(persist).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === "attempt" && e.outcome === "rejected")).toHaveLength(3);
    expect(events.some((e) => e.type === "progress" && e.stage === "persist")).toBe(false);
  });

  it("caps maxAttempts at three even if configured higher", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, brokenCandidate, brokenCandidate, goodCandidate], evaluator: [pass] });
    const { deps: d } = deps(llm, { maxAttempts: 10 });
    const outcome = await runGenerationPipeline("x", d);
    expect(outcome.ok).toBe(false);
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(3);
  });

  it("skips evaluation for candidates that fail deterministic validation and repairs with the critique", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, goodCandidate], evaluator: [pass] });
    const { deps: d, persist } = deps(llm);
    const outcome = await runGenerationPipeline("x", d);

    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(calls.map((c) => c.role)).toEqual(["extractor", "generator", "generator", "evaluator"]);
    const repair = calls[2]!.input;
    expect(repair).toContain("PREVIOUS_CANDIDATE");
    expect(repair).toContain("unknown_edge_endpoint");
    expect(repair).toContain("TEACHING_PLAN");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("sends evaluator critique to the next attempt", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate, goodCandidate], evaluator: [fail, pass] });
    const { deps: d } = deps(llm);
    await runGenerationPipeline("x", d);
    expect(calls[3]!.input).toContain("Wrong middle. Fix: Use index 3.");
  });

  it("gives the next review the previous review's issues", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate, goodCandidate], evaluator: [fail, pass] });
    const { deps: d } = deps(llm);
    await runGenerationPipeline("x", d);
    const reviews = calls.filter((c) => c.role === "evaluator");
    expect(reviews[0]!.input).not.toContain("PREVIOUS_REVIEW_ISSUES");
    expect(reviews[1]!.input).toContain("PREVIOUS_REVIEW_ISSUES");
    expect(reviews[1]!.input).toContain("Wrong middle.");
  });

  it("treats evaluator passed=true with a major issue as a rejection", async () => {
    const sneaky: Evaluation = { ...fail, passed: true };
    const { llm } = fakeLlm({ generator: [goodCandidate, goodCandidate, goodCandidate], evaluator: [sneaky, sneaky, sneaky] });
    const { deps: d, persist } = deps(llm);
    const outcome = await runGenerationPipeline("x", d);
    expect(outcome).toMatchObject({ ok: false, code: "rejected" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("repairs after malformed or truncated generator output", async () => {
    const { llm, calls } = fakeLlm({
      generator: [new LlmError("incomplete", "cut off", { detail: "max_output_tokens" }), goodCandidate],
      evaluator: [pass],
    });
    const { deps: d } = deps(llm);
    const outcome = await runGenerationPipeline("x", d);
    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[2]!.input).toContain("needs to be shorter");
    expect(calls[2]!.input).not.toContain("PREVIOUS_CANDIDATE");
  });

  it("returns the planner's limitation for unsupported topics without generating", async () => {
    const { llm, calls } = fakeLlm({
      extractor: [{ ...plan, status: "unsupported", limitation: "Try a narrower topic such as TCP handshakes." }],
    });
    const { deps: d } = deps(llm);
    const outcome = await runGenerationPipeline("the meaning of life", d);
    expect(outcome).toMatchObject({ ok: false, code: "unsupported_topic", message: "Try a narrower topic such as TCP handshakes." });
    expect(calls).toHaveLength(1);
  });

  it("maps a refusal and provider errors to explicit failures", async () => {
    const refusal = fakeLlm({ generator: [new LlmError("refusal", "no")] });
    expect(await runGenerationPipeline("x", deps(refusal.llm).deps)).toMatchObject({ code: "model_refused", retryable: false });

    const busy = fakeLlm({ extractor: [new LlmError("provider", "x", { status: 503 })] });
    expect(await runGenerationPipeline("x", deps(busy.llm).deps)).toMatchObject({ code: "provider_error", retryable: true });

    const auth = fakeLlm({ extractor: [new LlmError("provider", "x", { status: 401 })] });
    expect(await runGenerationPipeline("x", deps(auth.llm).deps)).toMatchObject({ code: "provider_error", retryable: false });

    const slow = fakeLlm({ generator: [new LlmError("timeout", "x")] });
    expect(await runGenerationPipeline("x", deps(slow.llm).deps)).toMatchObject({ code: "timeout" });
  });

  it("reports a failed save as persistence_failed, never as success", async () => {
    const { llm } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const { deps: d } = deps(llm, {
      persist: async () => {
        throw new Error("db down");
      },
    });
    expect(await runGenerationPipeline("x", d)).toMatchObject({ ok: false, code: "persistence_failed" });
  });

  it("reports an abort during the save honestly (it may or may not have been saved)", async () => {
    const controller = new AbortController();
    const { llm } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const { deps: d } = deps(llm, {
      signal: controller.signal,
      persist: async (_concept, _meta, signal) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        throw new Error("aborted");
      },
    });
    expect(await runGenerationPipeline("x", d)).toMatchObject({ ok: false, code: "cancelled", message: expect.stringMatching(/may or may not/) });
  });

  it("returns cancelled when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { llm } = fakeLlm({});
    const { deps: d, persist } = deps(llm, { signal: controller.signal });
    expect(await runGenerationPipeline("x", d)).toMatchObject({ ok: false, code: "cancelled" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not start an attempt it cannot finish within the deadline", async () => {
    let now = 0;
    const deadline = new Deadline(270_000, () => now);
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, goodCandidate], evaluator: [pass] });
    const slowLlm: LlmClient = {
      async structured(request) {
        const result = await llm.structured(request);
        now += request.role === "generator" ? 230_000 : 1_000; // leaves < 45 s + 12 s reserve
        return result;
      },
    };
    const outcome = await runGenerationPipeline("x", deps(slowLlm, { deadline }).deps);
    expect(outcome).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(1);
  });
});
