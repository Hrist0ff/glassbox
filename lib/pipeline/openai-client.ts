import "server-only";
import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { LlmError, type LlmClient, type StructuredRequest, type StructuredResult, type TokenUsage } from "./llm";

/** Provider-level retries per call (429/5xx/connection). Separate from content repair attempts. */
const PROVIDER_MAX_RETRIES = 1;

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

/**
 * OpenAI Responses API with strict Structured Outputs. The JSON Schema is
 * derived from the same Zod schema used for validation, and the parsed result
 * is validated again with Zod; the strict schema is not trusted on its own.
 */
export function createOpenAiClient(options: {
  apiKey: string;
  reasoningEffort?: ReasoningEffort;
  /** For tests. */
  fetch?: typeof fetch;
  maxRetries?: number;
}): LlmClient {
  const client = new OpenAI({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries ?? PROVIDER_MAX_RETRIES,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    async structured<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
      let format: ReturnType<typeof zodTextFormat>;
      try {
        format = zodTextFormat(request.schema, request.schemaName);
      } catch (error) {
        throw new LlmError("schema_unsupported", "Schema cannot be used for strict structured output", {
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      const timeout = AbortSignal.timeout(request.timeoutMs);
      const signal = AbortSignal.any([request.signal, timeout]);
      const started = performance.now();

      let response: OpenAI.Responses.Response;
      try {
        response = await client.responses.create(
          {
            model: request.model,
            instructions: request.instructions,
            input: request.input,
            max_output_tokens: request.maxOutputTokens,
            store: false,
            text: {
              format: { type: "json_schema", name: format.name, schema: format.schema, strict: true },
            },
            ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
          },
          { signal, timeout: request.timeoutMs },
        );
      } catch (error) {
        if (request.signal.aborted) throw new LlmError("aborted", "Request was cancelled");
        if (timeout.aborted || error instanceof APIConnectionTimeoutError) {
          throw new LlmError("timeout", `${request.role} call exceeded ${Math.round(request.timeoutMs / 1000)} s`);
        }
        if (error instanceof APIUserAbortError) throw new LlmError("aborted", "Request was cancelled");
        if (error instanceof APIError) {
          // Keep only status and error code; provider messages can echo input.
          throw new LlmError("provider", "The AI provider returned an error", {
            status: error.status,
            detail: typeof error.code === "string" ? error.code : undefined,
          });
        }
        throw new LlmError("provider", "Could not reach the AI provider");
      }

      const latencyMs = Math.round(performance.now() - started);
      const usage: TokenUsage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };

      for (const item of response.output) {
        if (item.type !== "message") continue;
        for (const part of item.content) {
          if (part.type === "refusal") throw new LlmError("refusal", "The model declined this request", { usage });
        }
      }
      if (response.status === "incomplete") {
        throw new LlmError("incomplete", "The model stopped before finishing", {
          detail: response.incomplete_details?.reason ?? undefined,
          usage,
        });
      }
      if (response.status !== "completed") {
        throw new LlmError("provider", `Unexpected response status: ${response.status}`, { usage });
      }

      let json: unknown;
      try {
        json = JSON.parse(response.output_text);
      } catch {
        throw new LlmError("invalid_output", "Output was not valid JSON", { usage });
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        throw new LlmError("invalid_output", "Output did not match the schema", {
          detail: parsed.error.issues
            .slice(0, 10)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          usage,
        });
      }

      return { data: parsed.data, usage, latencyMs, model: response.model };
    },
  };
}
