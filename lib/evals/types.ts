import type { PipelineRole } from "@/lib/pipeline/llm";
import type { Evaluation } from "@/lib/pipeline/roles";
import type { Grade, QualityDimension } from "./grade";

/** Shapes written by scripts/eval-prompts.ts and read by the /dev/evals pages. Fields added later are optional, so older runs still load. */

/** USD per 1M tokens (standard tier), from https://platform.openai.com/docs/pricing as of 2026-10-01. */
export const EVAL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-astra": { input: 10, output: 50 },
};

export type EvalCase = {
  id: string;
  category: string;
  kind: "topic" | "source";
  topic?: string;
  title?: string;
  /** Source cases: a file in evals/sources. */
  file?: string;
  question?: string;
  preferences?: { audience?: string; language?: string; depth?: "overview" | "standard" | "detailed" };
  expect: "accept" | "decline" | "either";
  /** Representations that suit the request. */
  representations?: string[];
  /** Text that must not appear in the output (instructions embedded in the material). */
  canary?: string;
  /** Whether the explanation should record contradictions or gaps in the material. */
  limitations?: boolean;
  /** The language the reader-facing text should be in. */
  language?: string;
};

export type EvalAttempt = {
  validationErrors: string[];
  validationWarnings: string[];
  review: Evaluation | null;
  generatorError?: string;
};

/** Deterministic checks of an accepted explanation. Absent where they do not apply. */
export type EvalChecks = {
  representation?: string;
  representationOk?: boolean;
  /** Share of non-summary steps citing at least one claim (supplied material). */
  citationCoverage?: number;
  /** Claims stated in the material, with checked excerpts / all claims. */
  claimsStated?: number;
  claimsTotal?: number;
  canaryAbsent?: boolean;
  limitationsShown?: boolean;
  /** The explanation also lays out on the portrait (phone) arena. */
  portraitOk?: boolean;
  layoutWarnings?: number;
  /** Decline outcomes: alternatives were offered. */
  suggestionsOffered?: boolean;
};

export type EvalRunResult = {
  /** Present from the second version of the eval set on. */
  id?: string;
  category?: string;
  kind?: "topic" | "source";
  topic: string;
  expect: "accept" | "decline" | "either";
  repeat: number;
  /** "accepted", "declined", or a pipeline failure code. */
  outcome: string;
  correct: boolean;
  attemptCount: number;
  firstPass: boolean;
  latencyMs: number;
  costUsd: number | null;
  usage: Partial<Record<PipelineRole, { input: number; output: number }>>;
  attempts: EvalAttempt[];
  title?: string;
  conceptFile?: string;
  failureMessage?: string;
  /** The last problems found when a run failed (plan checks, validation, or review). */
  reasons?: string[];
  suggestions?: string[];
  checks?: EvalChecks;
  grade?: Grade | null;
  gradeError?: string;
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
  representationMatchRate?: number | null;
  meanCitationCoverage?: number | null;
  canaryAbsentRate?: number | null;
  limitationsShownRate?: number | null;
  portraitRate?: number | null;
  /** Mean grade per dimension over graded runs (ignoring "not applicable"). */
  quality?: Partial<Record<QualityDimension, number | null>>;
  languageOkRate?: number | null;
  graded?: number;
  graderCostUsd?: number | null;
};

export type EvalRun = {
  label: string;
  dir: string;
  startedAt: string;
  models: Partial<Record<PipelineRole, string>>;
  graderModel?: string | null;
  reasoningEffort: string | null;
  promptHashes: Record<string, string>;
  prompts: Record<string, string>;
  metrics: EvalMetrics;
  results: EvalRunResult[];
};
