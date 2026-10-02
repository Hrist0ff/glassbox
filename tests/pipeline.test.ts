import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { toGeneratedContent } from "@/lib/concept/layout";
import type { GeneratedConceptContent } from "@/lib/concept/schema";
import { validateConcept } from "@/lib/concept/validate";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { DEFAULT_PREFERENCES, type GenerationRequest } from "@/lib/generation/request";
import { Deadline } from "@/lib/pipeline/budget";
import { LlmError, type LlmClient, type PipelineRole, type StructuredRequest } from "@/lib/pipeline/llm";
import { runGenerationPipeline, type PipelineDeps, type PipelineProduct } from "@/lib/pipeline/orchestrator";
import type { ClaimSet, Evaluation, StepText, TeachingPlan } from "@/lib/pipeline/roles";
import type { GenerationEventInput } from "@/lib/sse/events";
import { buildSource } from "@/lib/sources/passages";

const plan: TeachingPlan = {
  status: "ok",
  limitation: null,
  alternatives: [],
  concept: "Binary search",
  learningGoal: "See how one comparison with the middle element discards half of a sorted range.",
  explanationType: "mechanism",
  representation: "actors_and_messages",
  representationReason: "The target and array cells are entities whose roles change with each comparison.",
  layout: "flow",
  audience: "beginners",
  language: "English",
  depth: "standard",
  scope: "Search in a sorted array of seven numbers.",
  omissions: ["Duplicates"],
  prerequisites: [],
  centralIdea: "Halving a sorted range by comparing with its middle element.",
  essentials: ["Each comparison halves the remaining range, so the search needs about log2(n) steps."],
  entities: [
    { id: "target", label: "Target", shape: "circle", role: "value sought" },
    { id: "cell-0", label: "[0] 3", shape: "square", role: "array cell" },
  ],
  panels: [],
  beats: Array.from({ length: 5 }, (_, i) => ({
    purpose: i === 4 ? ("summary" as const) : ("mechanism" as const),
    before: "The range before this comparison",
    event: `Comparison number ${i + 1}`,
    after: "The range after this comparison",
    why: "Each comparison halves the range.",
    connection: i === 0 ? ("none" as const) : ("sequence" as const),
    claims: [],
  })),
  simplifications: [],
  assumptions: [{ id: "a1", text: "The array is sorted ascending." }],
  uncertainty: [],
};

const topic = (text = "binary search"): GenerationRequest => ({ kind: "topic", topic: text, preferences: DEFAULT_PREFERENCES });

/** A valid generated candidate (wire format: every key present, no coordinates). */
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

type Script = Partial<Record<PipelineRole, Array<unknown>>>;

function fakeLlm(script: Script) {
  const calls: Array<{ role: string; input: string; instructions: string }> = [];
  const queues: Record<PipelineRole, unknown[]> = {
    extractor: [...(script.extractor ?? [plan])],
    reader: [...(script.reader ?? [])],
    generator: [...(script.generator ?? [])],
    writer: [...(script.writer ?? [])],
    evaluator: [...(script.evaluator ?? [])],
  };
  const llm: LlmClient = {
    async structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      calls.push({ role: request.role, input: request.input, instructions: request.instructions });
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
  const persist = vi.fn(async (product: PipelineProduct) => {
    events.push({ type: "progress", stage: "persist", state: "done", message: "(persist resolved)" });
    return { id: product.kind === "concept" ? product.concept.id : product.stepId };
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

const savedConcept = (persist: ReturnType<typeof deps>["persist"]) => {
  const product = persist.mock.calls[0]![0];
  if (product.kind !== "concept") throw new Error("expected an explanation");
  return product.concept;
};

describe("runGenerationPipeline", () => {
  it("lays out, persists, and returns ok when the first draft passes", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const { deps: d, events, persist } = deps(llm);
    const outcome = await runGenerationPipeline(topic(), d);

    expect(outcome).toMatchObject({ ok: true, conceptId: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99", attempts: 1 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.role)).toEqual(["extractor", "generator", "evaluator"]);
    // The saved concept carries app-generated identity, app-computed positions, and provenance.
    const saved = savedConcept(persist);
    expect(saved).toMatchObject({ schemaVersion: 2, id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99", layout: "flow" });
    expect(validateConcept(saved).ok).toBe(true);
    expect(saved.steps[0]!.nodes.every((n) => typeof n.x === "number" && n.col !== undefined)).toBe(true);
    expect(saved.provenance).toMatchObject({
      request: { kind: "topic", topic: "binary search" },
      sourcesConsulted: false,
      sources: [],
      learningGoal: plan.learningGoal,
      explanationType: "mechanism",
      representation: "actors_and_messages",
    });
    expect(saved.provenance!.claims).toEqual([{ id: "a1", text: "The array is sorted ascending.", basis: "assumption", passages: [], quote: "" }]);
    // Progress is reported in the order the work actually happened.
    const stages = events.filter((e) => e.type === "progress" && e.state !== "running").map((e) => e.type === "progress" && e.stage);
    expect(stages).toEqual(["plan", "generate", "validate", "evaluate", "persist", "persist"]);
  });

  it("gives the reviewer the original request and preferences, and never coordinates", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    await runGenerationPipeline({ kind: "topic", topic: "binary search", preferences: { audience: "Children", language: "", depth: "overview" } }, deps(llm).deps);
    const review = calls.find((c) => c.role === "evaluator")!.input;
    expect(review).toContain("<<<REQUEST\nExplain a topic: binary search");
    expect(review).toContain("audience: Children");
    expect(review).toContain("depth: overview");
    expect(review).not.toMatch(/"x":/);
  });

  it("stops after three total attempts and never persists a rejected candidate", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, goodCandidate, goodCandidate], evaluator: [fail, fail] });
    const { deps: d, events, persist } = deps(llm);
    const outcome = await runGenerationPipeline(topic(), d);

    expect(outcome).toMatchObject({ ok: false, code: "rejected", attempts: 3, retryable: true });
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(3);
    expect(persist).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === "attempt" && e.outcome === "rejected")).toHaveLength(3);
    expect(events.some((e) => e.type === "progress" && e.stage === "persist")).toBe(false);
  });

  it("caps maxAttempts at three even if configured higher", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, brokenCandidate, brokenCandidate, goodCandidate], evaluator: [pass] });
    const outcome = await runGenerationPipeline(topic(), deps(llm, { maxAttempts: 10 }).deps);
    expect(outcome.ok).toBe(false);
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(3);
  });

  it("skips evaluation for candidates that fail deterministic validation and repairs with the critique", async () => {
    const { llm, calls } = fakeLlm({ generator: [brokenCandidate, goodCandidate], evaluator: [pass] });
    const { deps: d, persist } = deps(llm);
    const outcome = await runGenerationPipeline(topic(), d);

    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(calls.map((c) => c.role)).toEqual(["extractor", "generator", "generator", "evaluator"]);
    const repair = calls[2]!.input;
    expect(repair).toContain("PREVIOUS_CANDIDATE");
    expect(repair).toContain("unknown_edge_endpoint");
    expect(repair).toContain("TEACHING_PLAN");
    // Repairs may move what a fix needs, and must keep the rest.
    expect(repair).toContain("change only the cells (col, row) or the panel content involved");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("sends a cited claim the plan never made back for repair", async () => {
    const citing = { ...goodCandidate, steps: goodCandidate.steps.map((s, i) => (i === 1 ? { ...s, claims: ["c7"] } : s)) };
    const { llm, calls } = fakeLlm({ generator: [citing, goodCandidate], evaluator: [pass] });
    const outcome = await runGenerationPipeline(topic(), deps(llm).deps);
    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[2]!.input).toContain('unknown_claim at step');
  });

  it("sends evaluator critique to the next attempt, and the previous issues to the next review", async () => {
    const { llm, calls } = fakeLlm({ generator: [goodCandidate, goodCandidate], evaluator: [fail, pass] });
    await runGenerationPipeline(topic(), deps(llm).deps);
    expect(calls[3]!.input).toContain("Wrong middle. Fix: Use index 3.");
    const reviews = calls.filter((c) => c.role === "evaluator");
    expect(reviews[0]!.input).not.toContain("PREVIOUS_REVIEW_ISSUES");
    expect(reviews[1]!.input).toContain("PREVIOUS_REVIEW_ISSUES");
  });

  it("treats evaluator passed=true with a major issue as a rejection", async () => {
    const sneaky: Evaluation = { ...fail, passed: true };
    const { llm } = fakeLlm({ generator: [goodCandidate, goodCandidate, goodCandidate], evaluator: [sneaky, sneaky, sneaky] });
    const { deps: d, persist } = deps(llm);
    expect(await runGenerationPipeline(topic(), d)).toMatchObject({ ok: false, code: "rejected" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("repairs after malformed or truncated generator output", async () => {
    const { llm, calls } = fakeLlm({
      generator: [new LlmError("incomplete", "cut off", { detail: "max_output_tokens" }), goodCandidate],
      evaluator: [pass],
    });
    const outcome = await runGenerationPipeline(topic(), deps(llm).deps);
    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[2]!.input).toContain("needs to be shorter");
    expect(calls[2]!.input).not.toContain("PREVIOUS_CANDIDATE");
  });

  it("returns the planner's limitation and alternatives for unsupported requests without generating", async () => {
    const { llm, calls } = fakeLlm({
      extractor: [{ ...plan, status: "unsupported", limitation: "Plots of functions can't be drawn.", alternatives: ["How derivatives measure slope"] }],
    });
    const outcome = await runGenerationPipeline(topic("plot sin(x)"), deps(llm).deps);
    expect(outcome).toMatchObject({ ok: false, code: "unsupported_topic", message: "Plots of functions can't be drawn.", suggestions: ["How derivatives measure slope"] });
    expect(calls).toHaveLength(1);
  });

  it("drops blank list items from the plan instead of failing every draft", async () => {
    const sloppy: TeachingPlan = { ...plan, uncertainty: [""], omissions: ["  ", "Duplicates"], assumptions: [{ id: "a1", text: " " }] };
    const { llm } = fakeLlm({ extractor: [sloppy], generator: [goodCandidate], evaluator: [pass] });
    const { deps: d, persist } = deps(llm);
    expect(await runGenerationPipeline(topic(), d)).toMatchObject({ ok: true, attempts: 1 });
    expect(savedConcept(persist).provenance).toMatchObject({ uncertainty: [], omissions: ["Duplicates"], claims: [] });
  });

  it("repairs an incomplete plan once, then gives up with the problems", async () => {
    const mismatched: TeachingPlan = { ...plan, explanationType: "chronology", representation: "comparison" };
    const repaired = fakeLlm({ extractor: [mismatched, plan], generator: [goodCandidate], evaluator: [pass] });
    expect(await runGenerationPipeline(topic(), deps(repaired.llm).deps)).toMatchObject({ ok: true });
    expect(repaired.calls[1]!.input).toContain("PLAN_PROBLEMS");
    expect(repaired.calls[1]!.input).toContain('Representation "comparison" does not suit a chronology explanation');

    const stubborn = fakeLlm({ extractor: [mismatched, mismatched] });
    const outcome = await runGenerationPipeline(topic(), deps(stubborn.llm).deps);
    expect(outcome).toMatchObject({ ok: false, code: "rejected" });
    expect(stubborn.calls.map((c) => c.role)).toEqual(["extractor", "extractor"]);
  });

  it("maps a refusal and provider errors to explicit failures", async () => {
    const refusal = fakeLlm({ generator: [new LlmError("refusal", "no")] });
    expect(await runGenerationPipeline(topic(), deps(refusal.llm).deps)).toMatchObject({ code: "model_refused", retryable: false });

    const busy = fakeLlm({ extractor: [new LlmError("provider", "x", { status: 503 })] });
    expect(await runGenerationPipeline(topic(), deps(busy.llm).deps)).toMatchObject({ code: "provider_error", retryable: true });

    const auth = fakeLlm({ extractor: [new LlmError("provider", "x", { status: 401 })] });
    expect(await runGenerationPipeline(topic(), deps(auth.llm).deps)).toMatchObject({ code: "provider_error", retryable: false });

    const slow = fakeLlm({ generator: [new LlmError("timeout", "x")] });
    expect(await runGenerationPipeline(topic(), deps(slow.llm).deps)).toMatchObject({ code: "timeout" });
  });

  it("reports a failed save as persistence_failed, never as success", async () => {
    const { llm } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const d = deps(llm, {
      persist: async () => {
        throw new Error("storage down");
      },
    }).deps;
    expect(await runGenerationPipeline(topic(), d)).toMatchObject({ ok: false, code: "persistence_failed" });
  });

  it("reports an abort during the save honestly (it may or may not have been saved)", async () => {
    const controller = new AbortController();
    const { llm } = fakeLlm({ generator: [goodCandidate], evaluator: [pass] });
    const d = deps(llm, {
      signal: controller.signal,
      persist: async (_product, _meta, signal) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        throw new Error("aborted");
      },
    }).deps;
    expect(await runGenerationPipeline(topic(), d)).toMatchObject({ ok: false, code: "cancelled", message: expect.stringMatching(/may or may not/) });
  });

  it("returns cancelled when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { llm } = fakeLlm({});
    const { deps: d, persist } = deps(llm, { signal: controller.signal });
    expect(await runGenerationPipeline(topic(), d)).toMatchObject({ ok: false, code: "cancelled" });
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
    const outcome = await runGenerationPipeline(topic(), deps(slowLlm, { deadline }).deps);
    expect(outcome).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(calls.filter((c) => c.role === "generator")).toHaveLength(1);
  });
});

describe("supplied material", () => {
  const built = buildSource(
    "The bridge opened in 1932 after six years of work.\n\nA second report says it opened in 1933.\n\nTraffic doubled within a decade.",
    "Bridge history",
  );
  if (!built.ok) throw new Error(built.message);
  const source = built.source;
  const request: GenerationRequest = { kind: "source", title: "Bridge history", question: "", source, preferences: DEFAULT_PREFERENCES };

  const claimSet: ClaimSet = {
    status: "ok",
    limitation: null,
    title: "Bridge history",
    summary: "When a bridge opened, and what happened to traffic.",
    claims: [
      { id: "c1", text: "The bridge opened in 1932.", basis: "source", passages: ["p1"], quote: "The bridge opened in 1932" },
      // Cited to the wrong passage: the server corrects the citation.
      { id: "c2", text: "A second report gives 1933.", basis: "source", passages: ["p1"], quote: "it opened in 1933" },
      // An invented excerpt: the claim loses "source" status.
      { id: "c3", text: "Tolls were removed in 1950.", basis: "source", passages: ["p3"], quote: "tolls were removed in 1950" },
      { id: "c4", text: "Traffic doubled within ten years.", basis: "interpretation", passages: ["p3", "p99"], quote: "" },
    ],
    conflicts: [{ claims: ["c1", "c2"], note: "Two different opening years (1932 and 1933)." }],
    gaps: ["Why the reports disagree"],
    embeddedInstructions: true,
    language: "English",
  };
  const sourcePlan: TeachingPlan = {
    ...plan,
    explanationType: "chronology",
    representation: "timeline",
    layout: "timeline",
    panels: [{ id: "events", kind: "timeline", label: "Events", purpose: "When things happened" }],
    entities: [],
    beats: plan.beats.map((b, i) => ({ ...b, claims: i === 4 ? [] : ["c1"] })),
  };

  it("reads claims, checks every excerpt, and keeps the material, contradictions, and gaps", async () => {
    const { llm, calls } = fakeLlm({ reader: [claimSet], extractor: [sourcePlan], generator: [goodCandidate], evaluator: [pass] });
    const { deps: d, events, persist } = deps(llm);
    const outcome = await runGenerationPipeline(request, d);
    expect(outcome).toMatchObject({ ok: true });
    expect(calls.map((c) => c.role)).toEqual(["reader", "extractor", "generator", "evaluator"]);

    // The material is data inside a block it cannot close.
    expect(calls[0]!.input).toContain("<<<SOURCE\n[p1] The bridge opened in 1932");
    // The planner and generator see verified claims; the reviewer also sees the material.
    expect(calls[1]!.input).toContain("<<<CLAIMS");
    expect(calls[1]!.input).toContain("<<<CONFLICTS");
    expect(calls[3]!.input).toContain("<<<SOURCE");

    const saved = savedConcept(persist);
    const claims = Object.fromEntries(saved.provenance!.claims.map((c) => [c.id, c]));
    expect(claims.c1).toMatchObject({ basis: "source", passages: ["p1"] });
    expect(claims.c2).toMatchObject({ basis: "source", passages: ["p2"] });
    expect(claims.c3).toMatchObject({ basis: "interpretation", quote: "" });
    expect(claims.c4).toMatchObject({ basis: "interpretation", passages: ["p3"] });
    expect(saved.provenance).toMatchObject({ sourcesConsulted: true, request: { kind: "source", topic: "Bridge history" } });
    expect(saved.provenance!.sources[0]).toEqual(source);
    expect(saved.provenance!.limitations.join(" ")).toMatch(/inconsistent: Two different opening years/);
    expect(saved.provenance!.limitations.join(" ")).toMatch(/Not stated in the material: Why the reports disagree/);
    expect(saved.provenance!.limitations.join(" ")).toMatch(/instructions addressed to an AI; they were ignored/);
    expect(saved.provenance!.limitations.join(" ")).toMatch(/1 statement could not be matched/);
    expect(validateConcept(saved).ok).toBe(true);

    const read = events.find((e) => e.type === "progress" && e.stage === "read" && e.state === "done");
    expect(read).toMatchObject({ message: expect.stringMatching(/2 stated in the material with a checked excerpt, 2 interpretations/) });
  });

  it("requires beats about the material to cite claims", async () => {
    const uncited: TeachingPlan = { ...sourcePlan, beats: sourcePlan.beats.map((b) => ({ ...b, claims: [] })) };
    const { llm, calls } = fakeLlm({ reader: [claimSet], extractor: [uncited, uncited] });
    const outcome = await runGenerationPipeline(request, deps(llm).deps);
    expect(outcome).toMatchObject({ ok: false, code: "rejected" });
    expect(calls[2]!.input).toContain("cites no claim from the material");
  });

  it("declines material with nothing to explain", async () => {
    const { llm } = fakeLlm({ reader: [{ ...claimSet, status: "unusable", limitation: "Only instructions.", claims: [] }] });
    expect(await runGenerationPipeline(request, deps(llm).deps)).toMatchObject({ ok: false, code: "unsupported_topic", message: "Only instructions." });
  });
});

describe("exploring a step", () => {
  const explore = (action: "explain" | "simplify" | "example"): GenerationRequest => ({
    kind: "explore",
    context: { action, concept: binarySearch, stepId: binarySearch.steps[2]!.id, stepIndex: 2, topic: "Binary search" },
  });
  const text: StepText = { status: "ok", limitation: null, text: "The middle element is compared with the target, so half of the range can be ruled out.", claims: [] };

  it("explains a step: write, check, review, and keep it beside the explanation", async () => {
    const { llm, calls } = fakeLlm({ writer: [text], evaluator: [pass] });
    const { deps: d, persist } = deps(llm);
    const outcome = await runGenerationPipeline(explore("explain"), d);
    expect(outcome).toMatchObject({ ok: true, attempts: 1 });
    expect(calls.map((c) => c.role)).toEqual(["writer", "evaluator"]);
    expect(calls[0]!.input).toContain("<<<SELECTED_STEP");
    expect(calls[0]!.input).toContain("<<<PARENT_EXPLANATION");
    expect(persist.mock.calls[0]![0]).toEqual({ kind: "text", action: "explain", stepId: binarySearch.steps[2]!.id, text: text.text, claims: [] });
  });

  it("rejects markup and unknown citations, then rewrites", async () => {
    const markup: StepText = { ...text, text: "See <b>this</b> at https://example.com", claims: ["c9"] };
    const { llm, calls } = fakeLlm({ writer: [markup, text], evaluator: [pass] });
    expect(await runGenerationPipeline(explore("simplify"), deps(llm).deps)).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[1]!.input).toContain("REQUIRED_FIXES");
    expect(calls[1]!.input).toContain("markup, a list, or a link");
    expect(calls[1]!.input).toContain('cites "c9"');
  });

  it("makes another example through the full pipeline, labeled as made up", async () => {
    const { llm, calls } = fakeLlm({ extractor: [{ ...plan, concept: "Another example: guessing a number" }], generator: [goodCandidate], evaluator: [pass] });
    const { deps: d, persist } = deps(llm);
    expect(await runGenerationPipeline(explore("example"), d)).toMatchObject({ ok: true });
    expect(calls[0]!.input).toContain("another example of the idea in the selected step");
    const saved = savedConcept(persist);
    expect(saved.provenance).toMatchObject({ request: { kind: "example" }, sourcesConsulted: false });
    expect(saved.provenance!.claims.find((c) => c.id === "example")?.text).toMatch(/made-up example for step 3/);
  });
});
