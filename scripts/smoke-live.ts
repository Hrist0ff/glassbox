/**
 * LIVE smoke test against the real OpenAI API (costs money; a few cents).
 *
 *   OPENAI_API_KEY=sk-... npm run smoke:live -- "Raft leader election"
 *
 * Reads .env.local / .env like `next dev` does. Runs the real pipeline
 * (planner → generator → validator → reviewer, with repair) and prints progress. Nothing is written to Supabase: the persist
 * step only re-validates the accepted concept and prints a summary.
 * Exits 0 without calling anything when OPENAI_API_KEY is not set.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { validateConcept } from "../lib/concept/validate";
import { DEFAULT_OPENAI_MODEL } from "../lib/env";
import { Deadline } from "../lib/pipeline/budget";
import { createOpenAiClient } from "../lib/pipeline/openai-client";
import { runGenerationPipeline } from "../lib/pipeline/orchestrator";

async function main() {
  // tsx does not load env files; use Next's loader so .env.local applies here too.
  loadEnvConfig(process.cwd(), true, { info: () => undefined, error: console.error });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not set; live smoke test skipped (nothing was called).");
    return;
  }
  const topic = process.argv.slice(2).join(" ").trim() || "TCP three-way handshake";
  const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const models = {
    extractor: process.env.OPENAI_EXTRACTOR_MODEL ?? model,
    generator: process.env.OPENAI_GENERATOR_MODEL ?? model,
    evaluator: process.env.OPENAI_EVALUATOR_MODEL ?? model,
  };
  const effort = process.env.OPENAI_REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" | undefined;
  const deadline = new Deadline(Number(process.env.GENERATION_DEADLINE_MS ?? 270_000));
  console.log(`LIVE OpenAI smoke test: "${topic}" with ${JSON.stringify(models)}`);

  const outcome = await runGenerationPipeline(topic, {
    llm: createOpenAiClient({ apiKey, reasoningEffort: effort }),
    models,
    deadline,
    signal: new AbortController().signal,
    newId: randomUUID,
    emit: (event) => {
      const t = (deadline.elapsedMs() / 1000).toFixed(1).padStart(6);
      if (event.type === "progress" && event.stage === "persist") {
        // The pipeline reports its save step; this script's save is a dry run.
        if (event.state === "running") console.log(`${t}s  persist  skipped (dry run: nothing is written to the database)`);
      } else if (event.type === "progress") {
        console.log(`${t}s  ${event.stage.padEnd(8)} ${event.state.padEnd(7)} ${event.message}`);
      }
      else if (event.type === "attempt") console.log(`${t}s  attempt ${event.attempt}/${event.maxAttempts} ${event.outcome}${event.reasons ? `: ${event.reasons.join(" | ")}` : ""}`);
    },
    persist: async (concept, meta) => {
      const check = validateConcept(concept);
      if (!check.ok) throw new Error("accepted concept failed re-validation");
      console.log(`\nAccepted "${concept.title}" (${concept.steps.length} steps).`);
      console.log(`Tokens: ${meta.usage.inputTokens} in / ${meta.usage.outputTokens} out; ${meta.attempts} attempt(s).`);
      return { id: concept.id };
    },
  });

  console.log(`\nOutcome: ${JSON.stringify(outcome.ok ? { ok: true, attempts: outcome.attempts } : outcome, null, 2)}`);
  if (!outcome.ok) process.exitCode = 1;
}

void main();
