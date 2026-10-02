import type { z } from "zod";

/**
 * Provider-neutral structured-output call used by the pipeline roles.
 * The OpenAI implementation lives in `openai-client.ts`; tests use fakes.
 */

/** `extractor` plans, `reader` extracts claims from supplied material, `writer` writes step explanations. */
export type PipelineRole = "extractor" | "reader" | "generator" | "writer" | "evaluator";

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type StructuredRequest<S extends z.ZodType> = {
  role: PipelineRole;
  model: string;
  schemaName: string;
  schema: S;
  /** Developer instructions (fixed, application-authored). */
  instructions: string;
  /** Task input; may contain user-provided text, clearly delimited. */
  input: string;
  maxOutputTokens: number;
  /** Total budget for this call including provider retries. */
  timeoutMs: number;
  signal: AbortSignal;
};

export type StructuredResult<T> = {
  data: T;
  usage: TokenUsage;
  latencyMs: number;
  model: string;
};

export interface LlmClient {
  structured<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
}

export type LlmErrorKind =
  /** The model declined to answer. */
  | "refusal"
  /** Output stopped early (token limit or content filter). */
  | "incomplete"
  /** Output was not valid JSON or did not match the schema. */
  | "invalid_output"
  /** The per-call time budget ran out. */
  | "timeout"
  /** The caller cancelled (client disconnect or server deadline). */
  | "aborted"
  /** HTTP/API failure after provider retries. */
  | "provider"
  /** Our schema cannot be expressed as a strict Structured Outputs schema. */
  | "schema_unsupported";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** Safe, non-sensitive detail for logs and repair prompts. */
  readonly detail?: string;
  readonly status?: number;
  readonly usage?: TokenUsage;

  constructor(kind: LlmErrorKind, message: string, extra: { detail?: string; status?: number; usage?: TokenUsage } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.detail = extra.detail;
    this.status = extra.status;
    this.usage = extra.usage;
  }
}
