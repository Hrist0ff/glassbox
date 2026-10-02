import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import type { Concept } from "@/lib/concept/schema";
import { validateConcept } from "@/lib/concept/validate";
import type { EvalRun } from "./types";

/** Local prompt-evaluation results (written by scripts/eval-prompts.ts). Development only. */

const RUNS_DIR = join(process.cwd(), "evals", "runs");
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function assertDevOnly(): void {
  if (process.env.NODE_ENV === "production") notFound();
}

export function listEvalRuns(): EvalRun[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((d) => SAFE_NAME.test(d) && existsSync(join(RUNS_DIR, d, "run.json")))
    .sort()
    .reverse()
    .map((d) => JSON.parse(readFileSync(join(RUNS_DIR, d, "run.json"), "utf8")) as EvalRun);
}

export function loadEvalRun(dir: string): EvalRun | null {
  if (!SAFE_NAME.test(dir)) return null;
  const file = join(RUNS_DIR, dir, "run.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as EvalRun) : null;
}

export function loadEvalConcept(dir: string, file: string): Concept | null {
  if (!SAFE_NAME.test(dir) || !SAFE_NAME.test(file)) return null;
  const path = join(RUNS_DIR, dir, "concepts", file);
  if (!existsSync(path)) return null;
  const result = validateConcept(JSON.parse(readFileSync(path, "utf8")));
  return result.ok ? result.concept : null;
}
