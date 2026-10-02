/**
 * Prompt evaluation harness: runs the cases in evals/topics.json through the
 * REAL pipeline (real OpenAI calls, costs money; nothing is saved to the app),
 * records why attempts were rejected, checks accepted explanations
 * deterministically, and grades them with an independent judge, so prompt
 * changes can be measured.
 *
 *   npm run eval:prompts -- --label baseline
 *   npm run eval:prompts -- --label tweak --repeat 2 --concurrency 4
 *   npm run eval:prompts -- --only apollo,incident --no-grade
 *
 * Output: evals/runs/<timestamp>-<label>/{run.json, report.md, concepts/*.json}
 * Each run is compared with the previous run in evals/runs (or --compare <dir>).
 * Browse results in the player at http://localhost:3000/dev/evals (dev server only).
 *
 * The grader (EVAL_GRADER_MODEL, default gpt-6.1-sol) is another model's
 * opinion, not proof of accuracy; the pipeline's own reviewer is not used as
 * evidence of quality here.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { z } from "zod";
import { ARENAS, type LayoutStrategy } from "../lib/concept/constants";
import { layoutGenerated, relayout } from "../lib/concept/layout";
import { assembleConcept, type Concept, type GeneratedConceptContent } from "../lib/concept/schema";
import { validateConcept } from "../lib/concept/validate";
import { DEFAULT_OPENAI_MODEL } from "../lib/env";
import { GRADER_INSTRUCTIONS, gradeExplanation, QUALITY_DIMENSIONS, type Grade } from "../lib/evals/grade";
import { EVAL_PRICES, type EvalAttempt, type EvalCase, type EvalChecks, type EvalMetrics, type EvalRun, type EvalRunResult } from "../lib/evals/types";
import { normalizePreferences, type GenerationRequest } from "../lib/generation/request";
import { Deadline } from "../lib/pipeline/budget";
import { LlmError, type LlmClient, type PipelineRole, type StructuredRequest } from "../lib/pipeline/llm";
import { createOpenAiClient } from "../lib/pipeline/openai-client";
import { buildProvenance, runGenerationPipeline } from "../lib/pipeline/orchestrator";
import { PROMPTS, verifyClaims, type ClaimSet, type Evaluation, type TeachingPlan, type VerifiedClaims } from "../lib/pipeline/roles";
import { buildSource, locateQuote } from "../lib/sources/passages";

loadEnvConfig(process.cwd(), true, { info: () => undefined, error: console.error });

const RUNS_DIR = join(process.cwd(), "evals", "runs");
const SOURCES_DIR = join(process.cwd(), "evals", "sources");
const ROLES: PipelineRole[] = ["extractor", "reader", "generator", "writer", "evaluator"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

type Usage = Record<PipelineRole, { input: number; output: number }>;
type Trace = { attempts: EvalAttempt[]; usageByRole: Usage; layout: LayoutStrategy; plan?: TeachingPlan; claims: VerifiedClaims | null };

/** Wraps the client to record each role's output for the report, checking drafts the way the pipeline does. */
function tracing(inner: LlmClient, trace: Trace, requestOf: GenerationRequest): LlmClient {
  return {
    async structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      const generation = requestOf;
      try {
        const result = await inner.structured(request);
        const usage = trace.usageByRole[request.role];
        usage.input += result.usage.inputTokens;
        usage.output += result.usage.outputTokens;
        if (request.role === "extractor") {
          trace.plan = result.data as TeachingPlan;
          trace.layout = trace.plan.layout ?? trace.layout;
        }
        if (request.role === "reader" && generation.kind === "source") trace.claims = verifyClaims(result.data as ClaimSet, generation.source, locateQuote);
        if (request.role === "generator") {
          // The same layout, provenance, and checks the pipeline applies.
          const { content } = layoutGenerated(result.data as GeneratedConceptContent, trace.layout);
          const provenance = trace.plan ? buildProvenance(generation, trace.plan, trace.claims) : undefined;
          const check = validateConcept(assembleConcept(content, randomUUID(), { layout: trace.layout, provenance }));
          trace.attempts.push({
            validationErrors: check.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`),
            validationWarnings: check.issues.filter((i) => i.severity === "warning").map((i) => `${i.code}: ${i.message}`),
            review: null,
          });
        } else if (request.role === "evaluator" || request.role === "writer") {
          const last = trace.attempts.at(-1);
          if (last && request.role === "evaluator") last.review = result.data as Evaluation;
        }
        return result;
      } catch (error) {
        if (error instanceof LlmError && error.usage) {
          trace.usageByRole[request.role].input += error.usage.inputTokens;
          trace.usageByRole[request.role].output += error.usage.outputTokens;
        }
        if (request.role === "generator") {
          trace.attempts.push({
            validationErrors: [],
            validationWarnings: [],
            review: null,
            generatorError: error instanceof LlmError ? `${error.kind}${error.detail ? `: ${error.detail}` : ""}` : String(error),
          });
        }
        throw error;
      }
    },
  };
}

function costOf(usage: Usage, models: Record<PipelineRole, string>): number | null {
  let total = 0;
  for (const role of ROLES) {
    if (usage[role].input === 0 && usage[role].output === 0) continue;
    const price = EVAL_PRICES[models[role]];
    if (!price) return null;
    total += (usage[role].input * price.input + usage[role].output * price.output) / 1_000_000;
  }
  return total;
}

async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]!, i);
      }
    }),
  );
  return results;
}

const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const rate = (values: (boolean | undefined)[]) => mean(values.filter((v): v is boolean => v !== undefined).map((v) => (v ? 1 : 0)));

function metricsOf(results: EvalRunResult[], graderCost: number | null): EvalMetrics {
  const accept = results.filter((r) => r.expect === "accept");
  const decline = results.filter((r) => r.expect === "decline");
  const accepted = accept.filter((r) => r.outcome === "accepted");
  const costs = results.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const count = (items: string[]) =>
    Object.fromEntries(
      Object.entries(items.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]),
    );
  const attempts = results.flatMap((r) => r.attempts);
  const graded = results.flatMap((r) => (r.grade ? [r.grade] : []));
  const checks = results.flatMap((r) => (r.checks ? [r.checks] : []));
  return {
    runs: results.length,
    acceptRate: accept.length ? accepted.length / accept.length : null,
    firstAttemptPassRate: accept.length ? accept.filter((r) => r.firstPass).length / accept.length : null,
    meanAttemptsWhenAccepted: accepted.length ? accepted.reduce((s, r) => s + r.attemptCount, 0) / accepted.length : null,
    correctDeclineRate: decline.length ? decline.filter((r) => r.outcome === "declined").length / decline.length : null,
    meanLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, results.length),
    totalCostUsd: costs.length === results.length ? costs.reduce((s, c) => s + c, 0) : null,
    validationErrorCodes: count(attempts.flatMap((a) => a.validationErrors.map((e) => e.split(":")[0]!))),
    reviewIssues: count(
      attempts.flatMap((a) => (a.review?.issues ?? []).filter((i) => i.severity !== "minor").map((i) => `${i.severity}/${i.category}`)),
    ),
    generatorErrors: count(attempts.flatMap((a) => (a.generatorError ? [a.generatorError.split(":")[0]!] : []))),
    representationMatchRate: rate(checks.map((c) => c.representationOk)),
    meanCitationCoverage: mean(checks.flatMap((c) => (c.citationCoverage === undefined ? [] : [c.citationCoverage]))),
    canaryAbsentRate: rate(checks.map((c) => c.canaryAbsent)),
    limitationsShownRate: rate(checks.map((c) => c.limitationsShown)),
    portraitRate: rate(checks.map((c) => c.portraitOk)),
    quality: Object.fromEntries(QUALITY_DIMENSIONS.map((d) => [d, mean(graded.map((g) => g.scores[d]).filter((v) => v > 0))])),
    languageOkRate: rate(graded.map((g) => g.languageOk)),
    graded: graded.length,
    graderCostUsd: graderCost,
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "n/a" : v.toFixed(digits));
const usd = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `$${v.toFixed(4)}`);

function reportMarkdown(run: EvalRun, previous: EvalRun | null): string {
  const m = run.metrics;
  const p = previous?.metrics;
  const lines = [
    `# Prompt eval: ${run.label}`,
    "",
    `Started ${run.startedAt} · models ${JSON.stringify(run.models)} · grader ${run.graderModel ?? "none"} · reasoning effort ${run.reasoningEffort ?? "unset"}`,
    `Prompt hashes: ${Object.entries(run.promptHashes).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "Grades come from a separate model with its own rubric; they are a signal for comparing versions, not proof of accuracy.",
    "",
    "| Metric | This run | Previous |",
    "| --- | --- | --- |",
    `| Accepted (accept cases) | ${pct(m.acceptRate)} | ${pct(p?.acceptRate)} |`,
    `| Passed on first attempt | ${pct(m.firstAttemptPassRate)} | ${pct(p?.firstAttemptPassRate)} |`,
    `| Mean attempts when accepted | ${num(m.meanAttemptsWhenAccepted)} | ${num(p?.meanAttemptsWhenAccepted)} |`,
    `| Correctly declined | ${pct(m.correctDeclineRate)} | ${pct(p?.correctDeclineRate)} |`,
    `| Representation as expected | ${pct(m.representationMatchRate)} | ${pct(p?.representationMatchRate)} |`,
    `| Citation coverage (material) | ${pct(m.meanCitationCoverage)} | ${pct(p?.meanCitationCoverage)} |`,
    `| Limitations recorded when expected | ${pct(m.limitationsShownRate)} | ${pct(p?.limitationsShownRate)} |`,
    `| Embedded instructions ignored | ${pct(m.canaryAbsentRate)} | ${pct(p?.canaryAbsentRate)} |`,
    `| Lays out on phones (portrait) | ${pct(m.portraitRate)} | ${pct(p?.portraitRate)} |`,
    ...QUALITY_DIMENSIONS.map((d) => `| Grade: ${d.replace(/_/g, " ")} (1–5) | ${num(m.quality?.[d])} | ${num(p?.quality?.[d])} |`),
    `| Grade: right language | ${pct(m.languageOkRate)} | ${pct(p?.languageOkRate)} |`,
    `| Mean latency | ${(m.meanLatencyMs / 1000).toFixed(1)} s | ${p ? `${(p.meanLatencyMs / 1000).toFixed(1)} s` : "n/a"} |`,
    `| Pipeline cost | ${usd(m.totalCostUsd)} | ${usd(p?.totalCostUsd)} |`,
    `| Grader cost | ${usd(m.graderCostUsd)} | ${usd(p?.graderCostUsd)} |`,
    "",
    `Validation error codes: ${JSON.stringify(m.validationErrorCodes)}`,
    `Reviewer blocker/major issues: ${JSON.stringify(m.reviewIssues)}`,
    `Generator errors: ${JSON.stringify(m.generatorErrors)}`,
    "",
    "## By category",
    "",
    "| Category | Runs | Accepted / correct | Mean attempts | Representation ok | Mean grade |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const categories = [...new Set(run.results.map((r) => r.category ?? "uncategorized"))];
  for (const category of categories) {
    const rs = run.results.filter((r) => (r.category ?? "uncategorized") === category);
    const grades = rs.flatMap((r) => (r.grade ? QUALITY_DIMENSIONS.map((d) => r.grade!.scores[d]).filter((v) => v > 0) : []));
    lines.push(
      `| ${category} | ${rs.length} | ${rs.filter((r) => r.correct).length}/${rs.length} | ${num(mean(rs.filter((r) => r.outcome === "accepted").map((r) => r.attemptCount)))} | ${pct(rate(rs.map((r) => r.checks?.representationOk)))} | ${num(mean(grades))} |`,
    );
  }
  lines.push("", "## Runs");
  for (const r of run.results) {
    lines.push(
      "",
      `### ${r.id ?? r.topic}${r.repeat > 1 ? ` (#${r.repeat})` : ""}: ${r.outcome}${r.correct ? "" : " ✗ unexpected"}`,
      `${r.kind === "source" ? "Material" : "Topic"}: ${r.topic} · ${r.attemptCount} attempt(s) · ${(r.latencyMs / 1000).toFixed(1)} s · ${usd(r.costUsd)}${r.title ? ` · "${r.title}"` : ""}${r.failureMessage ? ` · ${r.failureMessage}` : ""}`,
    );
    if (r.suggestions?.length) lines.push(`- Suggested instead: ${r.suggestions.join("; ")}`);
    for (const reason of r.reasons ?? []) lines.push(`- Last problem: ${reason}`);
    if (r.checks) lines.push(`- Checks: ${JSON.stringify(r.checks)}`);
    if (r.grade) {
      lines.push(
        `- Grade: ${QUALITY_DIMENSIONS.map((d) => `${d}=${r.grade!.scores[d] || "n/a"}`).join(", ")}; language ${r.grade.languageOk ? "ok" : "WRONG"}. ${r.grade.summary}`,
      );
      for (const problem of r.grade.problems) lines.push(`  - grader ${problem.severity}/${problem.dimension}${problem.step ? ` [${problem.step}]` : ""}: ${problem.problem}`);
    }
    if (r.gradeError) lines.push(`- Grading failed: ${r.gradeError}`);
    r.attempts.forEach((a, i) => {
      const verdict = a.generatorError
        ? `generator error (${a.generatorError})`
        : a.validationErrors.length
          ? "failed validation"
          : a.review
            ? a.review.passed && !a.review.issues.some((x) => x.severity !== "minor")
              ? "accepted"
              : "rejected by reviewer"
            : "not reviewed";
      lines.push(`- Attempt ${i + 1}: ${verdict}`);
      for (const e of a.validationErrors.slice(0, 6)) lines.push(`  - validation: ${e}`);
      for (const issue of a.review?.issues ?? []) {
        lines.push(`  - ${issue.severity}/${issue.category}${issue.stepId ? ` [${issue.stepId}]` : ""}: ${issue.problem} → ${issue.suggestion}`);
      }
    });
  }
  return `${lines.join("\n")}\n`;
}

function latestRun(excluding: string): EvalRun | null {
  if (!existsSync(RUNS_DIR)) return null;
  const dirs = readdirSync(RUNS_DIR).filter((d) => d !== excluding && existsSync(join(RUNS_DIR, d, "run.json"))).sort();
  const last = dirs.at(-1);
  return last ? (JSON.parse(readFileSync(join(RUNS_DIR, last, "run.json"), "utf8")) as EvalRun) : null;
}

function requestFor(c: EvalCase): { request: GenerationRequest; material: string | null } {
  const preferences = normalizePreferences(c.preferences);
  if (c.kind === "topic") return { request: { kind: "topic", topic: c.topic!, preferences }, material: null };
  const text = readFileSync(join(SOURCES_DIR, c.file!), "utf8");
  const built = buildSource(text, c.title ?? "Pasted text");
  if (!built.ok) throw new Error(`${c.id}: ${built.message}`);
  return { request: { kind: "source", title: c.title ?? "Pasted text", question: c.question ?? "", source: built.source, preferences }, material: text };
}

function checksFor(c: EvalCase, concept: Concept): EvalChecks {
  const p = concept.provenance;
  const representation = p?.representation;
  const validation = validateConcept(concept);
  const checks: EvalChecks = {
    representation,
    representationOk: c.representations ? Boolean(representation && c.representations.includes(representation)) : undefined,
    portraitOk: relayout(concept, ARENAS.portrait) !== null,
    layoutWarnings: validation.issues.length,
  };
  if (c.kind === "source" && p) {
    const steps = concept.steps.slice(0, -1);
    const fromMaterial = new Set(p.claims.filter((x) => x.basis !== "assumption").map((x) => x.id));
    checks.citationCoverage = steps.length ? steps.filter((s) => (s.claims ?? []).some((id) => fromMaterial.has(id))).length / steps.length : 0;
    checks.claimsStated = p.claims.filter((x) => x.basis === "source").length;
    checks.claimsTotal = p.claims.filter((x) => x.basis !== "assumption").length;
  }
  // What the reader sees: everything but the stored copy of the material itself (which contains the canary).
  if (c.canary) {
    const { sources: _sources, ...shown } = concept.provenance ?? {};
    void _sources;
    checks.canaryAbsent = !JSON.stringify({ ...concept, provenance: shown }).toLowerCase().includes(c.canary.toLowerCase());
  }
  if (c.limitations) checks.limitationsShown = (p?.limitations.length ?? 0) + (p?.uncertainty.length ?? 0) > 0;
  return checks;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not set (checked the environment and .env files); nothing was run.");
    return;
  }
  const label = slug(arg("label") ?? "run") || "run";
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 4));
  const only = arg("only")?.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const set = JSON.parse(readFileSync(join(process.cwd(), "evals", "topics.json"), "utf8")) as { cases: EvalCase[] };
  const cases = set.cases.filter((c) => !only || only.some((o) => c.id.includes(o) || c.category.includes(o)));
  const jobs = cases.flatMap((c) => Array.from({ length: repeat }, (_, i) => ({ ...c, repeat: i + 1 })));

  const base = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const models: Record<PipelineRole, string> = {
    extractor: process.env.OPENAI_EXTRACTOR_MODEL ?? base,
    reader: process.env.OPENAI_EXTRACTOR_MODEL ?? base,
    generator: process.env.OPENAI_GENERATOR_MODEL ?? base,
    writer: process.env.OPENAI_GENERATOR_MODEL ?? base,
    evaluator: process.env.OPENAI_EVALUATOR_MODEL ?? base,
  };
  const graderModel = flag("no-grade") ? null : (process.env.EVAL_GRADER_MODEL ?? "gpt-6.1-sol");
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" | undefined;
  const client = createOpenAiClient({ apiKey, reasoningEffort });
  const grader = createOpenAiClient({ apiKey });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const dirName = `${stamp}-${label}`;
  const dir = join(RUNS_DIR, dirName);
  mkdirSync(join(dir, "concepts"), { recursive: true });

  console.log(`Prompt eval "${label}": ${jobs.length} run(s), concurrency ${concurrency}, models ${JSON.stringify(models)}, grader ${graderModel ?? "off"}`);
  console.log("This makes real OpenAI calls. Nothing is saved to the app.\n");

  let graderCost = 0;
  let graderPriced = true;
  const results = await pool(jobs, concurrency, async (job, index): Promise<EvalRunResult> => {
    const trace: Trace = {
      attempts: [],
      usageByRole: Object.fromEntries(ROLES.map((r) => [r, { input: 0, output: 0 }])) as Usage,
      layout: "flow",
      claims: null,
    };
    const { request, material } = requestFor(job);
    const deadline = new Deadline(270_000);
    let conceptFile: string | undefined;
    let concept: Concept | undefined;
    const outcome = await runGenerationPipeline(request, {
      llm: tracing(client, trace, request),
      models,
      deadline,
      signal: new AbortController().signal,
      newId: randomUUID,
      emit: () => undefined,
      persist: async (product) => {
        if (product.kind !== "concept") throw new Error("expected an explanation");
        concept = product.concept;
        conceptFile = `${String(index + 1).padStart(2, "0")}-${slug(job.id)}${job.repeat > 1 ? `-${job.repeat}` : ""}.json`;
        writeFileSync(join(dir, "concepts", conceptFile), JSON.stringify(concept, null, 2));
        return { id: concept.id };
      },
    });
    const declined = !outcome.ok && outcome.code === "unsupported_topic";
    const result: EvalRunResult = {
      id: job.id,
      category: job.category,
      kind: job.kind,
      topic: job.kind === "topic" ? job.topic! : `${job.title} (${job.file})`,
      expect: job.expect,
      repeat: job.repeat,
      outcome: outcome.ok ? "accepted" : declined ? "declined" : outcome.code,
      correct: job.expect === "either" ? outcome.ok || declined : outcome.ok ? job.expect === "accept" : declined && job.expect === "decline",
      attemptCount: outcome.attempts,
      firstPass: outcome.ok && outcome.attempts === 1,
      latencyMs: deadline.elapsedMs(),
      costUsd: costOf(trace.usageByRole, models),
      usage: trace.usageByRole,
      attempts: trace.attempts,
      ...(concept ? { title: (concept as Concept).title } : {}),
      ...(conceptFile ? { conceptFile } : {}),
      ...(outcome.ok
        ? {}
        : {
            failureMessage: outcome.message,
            ...(outcome.reasons ? { reasons: outcome.reasons } : {}),
            ...(outcome.suggestions ? { suggestions: outcome.suggestions } : {}),
          }),
    };
    if (concept) result.checks = checksFor(job, concept);
    if (declined) result.checks = { suggestionsOffered: (outcome.ok ? [] : (outcome.suggestions ?? [])).length > 0 };
    if (concept && graderModel) {
      try {
        const { grade, usage } = await gradeExplanation(
          grader,
          {
            request: job.kind === "topic" ? `Explain a topic: ${job.topic}` : `Visualize the supplied material titled "${job.title}".${job.question ? ` Question: ${job.question}` : ""}`,
            preferences: JSON.stringify(job.preferences ?? {}),
            material,
            concept,
          },
          { model: graderModel },
        );
        result.grade = grade;
        const price = EVAL_PRICES[graderModel];
        if (price) graderCost += (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
        else graderPriced = false;
      } catch (error) {
        result.gradeError = error instanceof LlmError ? `${error.kind}${error.detail ? `: ${error.detail}` : ""}` : String(error);
      }
    }
    const grade = result.grade as Grade | undefined;
    console.log(
      `${result.correct ? "✓" : "✗"} ${job.id}${job.repeat > 1 ? ` #${job.repeat}` : ""}: ${result.outcome} after ${result.attemptCount} attempt(s), ${(result.latencyMs / 1000).toFixed(1)} s, ${usd(result.costUsd)}` +
        (result.checks?.representation ? ` · ${result.checks.representation}${result.checks.representationOk === false ? " (unexpected)" : ""}` : "") +
        (grade ? ` · grade ${QUALITY_DIMENSIONS.map((d) => grade.scores[d] || "-").join("/")}` : ""),
    );
    return result;
  });

  const prompts: Record<string, string> = { ...PROMPTS, grader: GRADER_INSTRUCTIONS };
  const promptHashes = Object.fromEntries(Object.entries(prompts).map(([k, v]) => [k, hash(v)]));
  const run: EvalRun = {
    label,
    dir: dirName,
    startedAt: new Date().toISOString(),
    models,
    graderModel,
    reasoningEffort: reasoningEffort ?? null,
    promptHashes,
    prompts,
    metrics: metricsOf(results, graderModel ? (graderPriced ? graderCost : null) : null),
    results,
  };
  const compareArg = arg("compare");
  const previous = compareArg
    ? (JSON.parse(readFileSync(join(RUNS_DIR, compareArg, "run.json"), "utf8")) as EvalRun)
    : latestRun(dirName);

  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, "report.md"), reportMarkdown(run, previous));

  const m = run.metrics;
  console.log(
    `\nAccepted ${pct(m.acceptRate)} · first-attempt pass ${pct(m.firstAttemptPassRate)} · mean attempts ${num(m.meanAttemptsWhenAccepted)} · declines ${pct(m.correctDeclineRate)} · representation ${pct(m.representationMatchRate)} · ${usd(m.totalCostUsd)} pipeline + ${usd(m.graderCostUsd)} grading`,
  );
  console.log(`Quality (grader, 1–5): ${QUALITY_DIMENSIONS.map((d) => `${d}=${num(m.quality?.[d])}`).join(", ")}`);
  if (previous) {
    const changed = Object.keys(run.promptHashes).filter((r) => run.promptHashes[r] !== previous.promptHashes[r]);
    console.log(
      `Previous (${previous.label}): accepted ${pct(previous.metrics.acceptRate)} · first-attempt pass ${pct(previous.metrics.firstAttemptPassRate)} · mean attempts ${num(previous.metrics.meanAttemptsWhenAccepted)} · prompts changed: ${changed.join(", ") || "none"}`,
    );
  }
  console.log(`Reviewer issues: ${JSON.stringify(m.reviewIssues)}`);
  console.log(`Validation errors: ${JSON.stringify(m.validationErrorCodes)}`);
  console.log(`\nReport: evals/runs/${dirName}/report.md`);
  console.log("Browse: npm run dev, then http://localhost:3000/dev/evals");
}

void main();
