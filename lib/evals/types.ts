import type { PipelineRole } from "@/lib/pipeline/llm";
import type { Evaluation } from "@/lib/pipeline/roles";

/** Shapes written by scripts/eval-prompts.ts and read by the /dev/evals pages. */

/** USD per 1M tokens (standard tier), from https://platform.openai.com/docs/pricing as of 2026-10-01. */
export const EVAL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-astra": { input: 10, output: 50 },
};

export type EvalAttempt = {
  validationErrors: string[];
  validationWarnings: string[];
  review: Evaluation | null;
  generatorError?: string;
};

export type EvalRunResult = {
  topic: string;
  expect: "accept" | "decline";
  repeat: number;
  /** "accepted", "declined", or a pipeline failure code. */
  outcome: string;
  correct: boolean;
  attemptCount: number;
  firstPass: boolean;
  latencyMs: number;
  costUsd: number | null;
  usage: Record<PipelineRole, { input: number; output: number }>;
  attempts: EvalAttempt[];
  title?: string;
  conceptFile?: string;
  failureMessage?: string;
};

export type EvalMetrics = {
  runs: number;
  acceptRate: number | null;
  firstAttemptPassRate: number | null;
  meanAttemptsWhenAccepted: number | null;
  correctDeclineRate: number | null;
  meanLatencyMs: number;
  totalCostUsd: number | null;
  validationErrorCodes: Record<string, number>;
  reviewIssues: Record<string, number>;
  generatorErrors: Record<string, number>;
};

export type EvalRun = {
  label: string;
  dir: string;
  startedAt: string;
  models: Record<PipelineRole, string>;
  reasoningEffort: string | null;
  promptHashes: Record<PipelineRole, string>;
  prompts: Record<PipelineRole, string>;
  metrics: EvalMetrics;
  results: EvalRunResult[];
};
