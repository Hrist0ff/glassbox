/**
 * Prompt evaluation harness: runs a fixed topic set through the REAL pipeline
 * (real OpenAI calls, costs money; nothing is saved) and
 * records why attempts were rejected, so prompt changes can be measured.
 *
 *   npm run eval:prompts -- --label baseline
 *   npm run eval:prompts -- --label tweak --repeat 2 --concurrency 3
 *   npm run eval:prompts -- --only "raft"
 *
 * Output: evals/runs/<timestamp>-<label>/{run.json, report.md, concepts/*.json}
 * Each run is compared with the previous run in evals/runs (or --compare <dir>).
 * Browse results in the player at http://localhost:3000/dev/evals (dev server only).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { z } from "zod";
import { assembleConcept, toConceptContent, type GeneratedConceptContent } from "../lib/concept/schema";
import { validateConcept } from "../lib/concept/validate";
import { DEFAULT_OPENAI_MODEL } from "../lib/env";
import { EVAL_PRICES, type EvalAttempt, type EvalMetrics, type EvalRun, type EvalRunResult } from "../lib/evals/types";
import { Deadline } from "../lib/pipeline/budget";
import { LlmError, type LlmClient, type PipelineRole, type StructuredRequest } from "../lib/pipeline/llm";
import { createOpenAiClient } from "../lib/pipeline/openai-client";
import { runGenerationPipeline } from "../lib/pipeline/orchestrator";
import { PROMPTS, type Evaluation } from "../lib/pipeline/roles";

loadEnvConfig(process.cwd(), true, { info: () => undefined, error: console.error });

const RUNS_DIR = join(process.cwd(), "evals", "runs");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

type Trace = { attempts: EvalAttempt[]; usageByRole: Record<PipelineRole, { input: number; output: number }> };

/** Wraps the client to record each role's output for the report. */
function tracing(inner: LlmClient, trace: Trace): LlmClient {
  return {
    async structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      try {
        const result = await inner.structured(request);
        const usage = trace.usageByRole[request.role];
        usage.input += result.usage.inputTokens;
        usage.output += result.usage.outputTokens;
        if (request.role === "generator") {
          const concept = assembleConcept(toConceptContent(result.data as GeneratedConceptContent), randomUUID());
          const check = validateConcept(concept);
          trace.attempts.push({
            validationErrors: check.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`),
            validationWarnings: check.issues.filter((i) => i.severity === "warning").map((i) => `${i.code}: ${i.message}`),
            review: null,
          });
        } else if (request.role === "evaluator") {
          const last = trace.attempts.at(-1);
          if (last) last.review = result.data as Evaluation;
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

function costOf(usage: Trace["usageByRole"], models: Record<PipelineRole, string>): number | null {
  let total = 0;
  for (const role of Object.keys(usage) as PipelineRole[]) {
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

function metricsOf(results: EvalRunResult[]): EvalMetrics {
  const accept = results.filter((r) => r.expect === "accept");
  const decline = results.filter((r) => r.expect === "decline");
  const accepted = accept.filter((r) => r.outcome === "accepted");
  const costs = results.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const count = (items: string[]) =>
    Object.fromEntries(
      Object.entries(items.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]),
    );
  const attempts = results.flatMap((r) => r.attempts);
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
  };
}

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | null, digits = 2) => (v === null ? "n/a" : v.toFixed(digits));
const usd = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(4)}`);

function reportMarkdown(run: EvalRun, previous: EvalRun | null): string {
  const m = run.metrics;
  const lines = [
    `# Prompt eval: ${run.label}`,
    "",
    `Started ${run.startedAt} · models ${JSON.stringify(run.models)} · reasoning effort ${run.reasoningEffort ?? "unset"}`,
    `Prompt hashes: ${Object.entries(run.promptHashes).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "| Metric | This run | Previous |",
    "| --- | --- | --- |",
    `| Accepted (accept topics) | ${pct(m.acceptRate)} | ${pct(previous?.metrics.acceptRate ?? null)} |`,
    `| Passed on first attempt | ${pct(m.firstAttemptPassRate)} | ${pct(previous?.metrics.firstAttemptPassRate ?? null)} |`,
    `| Mean attempts when accepted | ${num(m.meanAttemptsWhenAccepted)} | ${num(previous?.metrics.meanAttemptsWhenAccepted ?? null)} |`,
    `| Correctly declined | ${pct(m.correctDeclineRate)} | ${pct(previous?.metrics.correctDeclineRate ?? null)} |`,
    `| Mean latency | ${(m.meanLatencyMs / 1000).toFixed(1)} s | ${previous ? `${(previous.metrics.meanLatencyMs / 1000).toFixed(1)} s` : "n/a"} |`,
    `| Total cost | ${usd(m.totalCostUsd)} | ${usd(previous?.metrics.totalCostUsd ?? null)} |`,
    "",
    `Validation error codes: ${JSON.stringify(m.validationErrorCodes)}`,
    `Reviewer blocker/major issues: ${JSON.stringify(m.reviewIssues)}`,
    `Generator errors: ${JSON.stringify(m.generatorErrors)}`,
    "",
    "## Runs",
  ];
  for (const r of run.results) {
    lines.push(
      "",
      `### ${r.topic}${r.repeat > 1 ? ` (#${r.repeat})` : ""}: ${r.outcome}${r.correct ? "" : " ✗ unexpected"}`,
      `${r.attemptCount} attempt(s) · ${(r.latencyMs / 1000).toFixed(1)} s · ${usd(r.costUsd)}${r.title ? ` · "${r.title}"` : ""}${r.failureMessage ? ` · ${r.failureMessage}` : ""}`,
    );
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

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not set (checked the environment and .env files); nothing was run.");
    return;
  }
  const label = slug(arg("label") ?? "run") || "run";
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 3));
  const only = arg("only")?.toLowerCase();
  const set = JSON.parse(readFileSync(join(process.cwd(), "evals", "topics.json"), "utf8")) as {
    topics: Array<{ topic: string; expect: "accept" | "decline" }>;
  };
  const topics = set.topics.filter((t) => !only || t.topic.toLowerCase().includes(only));
  const jobs = topics.flatMap((t) => Array.from({ length: repeat }, (_, i) => ({ ...t, repeat: i + 1 })));

  const base = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const models: Record<PipelineRole, string> = {
    extractor: process.env.OPENAI_EXTRACTOR_MODEL ?? base,
    generator: process.env.OPENAI_GENERATOR_MODEL ?? base,
    evaluator: process.env.OPENAI_EVALUATOR_MODEL ?? base,
  };
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" | undefined;
  const client = createOpenAiClient({ apiKey, reasoningEffort });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const dirName = `${stamp}-${label}`;
  const dir = join(RUNS_DIR, dirName);
  mkdirSync(join(dir, "concepts"), { recursive: true });

  console.log(`Prompt eval "${label}": ${jobs.length} run(s), concurrency ${concurrency}, models ${JSON.stringify(models)}`);
  console.log("This makes real OpenAI calls. Nothing is saved to the app.\n");

  const results = await pool(jobs, concurrency, async (job, index): Promise<EvalRunResult> => {
    const trace: Trace = {
      attempts: [],
      usageByRole: { extractor: { input: 0, output: 0 }, generator: { input: 0, output: 0 }, evaluator: { input: 0, output: 0 } },
    };
    const deadline = new Deadline(270_000);
    let conceptFile: string | undefined;
    let title: string | undefined;
    const outcome = await runGenerationPipeline(job.topic, {
      llm: tracing(client, trace),
      models,
      deadline,
      signal: new AbortController().signal,
      newId: randomUUID,
      emit: () => undefined,
      persist: async (concept) => {
        conceptFile = `${String(index + 1).padStart(2, "0")}-${slug(job.topic)}${job.repeat > 1 ? `-${job.repeat}` : ""}.json`;
        title = concept.title;
        writeFileSync(join(dir, "concepts", conceptFile), JSON.stringify(concept, null, 2));
        return { id: concept.id };
      },
    });
    const result: EvalRunResult = {
      topic: job.topic,
      expect: job.expect,
      repeat: job.repeat,
      outcome: outcome.ok ? "accepted" : outcome.code === "unsupported_topic" ? "declined" : outcome.code,
      correct: outcome.ok ? job.expect === "accept" : outcome.code === "unsupported_topic" ? job.expect === "decline" : false,
      attemptCount: outcome.attempts,
      firstPass: outcome.ok && outcome.attempts === 1,
      latencyMs: deadline.elapsedMs(),
      costUsd: costOf(trace.usageByRole, models),
      usage: trace.usageByRole,
      attempts: trace.attempts,
      ...(title ? { title } : {}),
      ...(conceptFile ? { conceptFile } : {}),
      ...(outcome.ok ? {} : { failureMessage: outcome.message }),
    };
    console.log(
      `${result.correct ? "✓" : "✗"} ${job.topic}${job.repeat > 1 ? ` #${job.repeat}` : ""}: ${result.outcome} after ${result.attemptCount} attempt(s), ${(result.latencyMs / 1000).toFixed(1)} s, ${usd(result.costUsd)}`,
    );
    return result;
  });

  const run: EvalRun = {
    label,
    dir: dirName,
    startedAt: new Date().toISOString(),
    models,
    reasoningEffort: reasoningEffort ?? null,
    promptHashes: { extractor: hash(PROMPTS.extractor), generator: hash(PROMPTS.generator), evaluator: hash(PROMPTS.evaluator) },
    prompts: PROMPTS,
    metrics: metricsOf(results),
    results,
  };
  const compareArg = arg("compare");
  const previous = compareArg
    ? (JSON.parse(readFileSync(join(RUNS_DIR, compareArg, "run.json"), "utf8")) as EvalRun)
    : latestRun(dirName);

  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, "report.md"), reportMarkdown(run, previous));

  const m = run.metrics;
  console.log(`\nAccepted ${pct(m.acceptRate)} · first-attempt pass ${pct(m.firstAttemptPassRate)} · mean attempts ${num(m.meanAttemptsWhenAccepted)} · declines ${pct(m.correctDeclineRate)} · ${usd(m.totalCostUsd)} total`);
  if (previous) {
    const changed = (Object.keys(run.promptHashes) as PipelineRole[]).filter((r) => run.promptHashes[r] !== previous.promptHashes[r]);
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
