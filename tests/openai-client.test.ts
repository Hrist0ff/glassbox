import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeneratedConceptContentSchema } from "@/lib/concept/schema";
import { LlmError } from "@/lib/pipeline/llm";
import { createOpenAiClient } from "@/lib/pipeline/openai-client";
import { EvaluationSchema, TeachingPlanSchema } from "@/lib/pipeline/roles";

/** Walks a JSON Schema and checks the strict-mode invariants OpenAI requires. */
function assertStrict(schema: unknown, path = "#"): void {
  if (!schema || typeof schema !== "object") return;
  const node = schema as Record<string, unknown>;
  if (node.type === "object" || node.properties) {
    expect(node.additionalProperties, `${path} additionalProperties`).toBe(false);
    const props = Object.keys((node.properties as object) ?? {});
    expect([...((node.required as string[]) ?? [])].sort(), `${path} required`).toEqual(props.sort());
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) value.forEach((v, i) => assertStrict(v, `${path}/${key}/${i}`));
    else if (typeof value === "object") assertStrict(value, `${path}/${key}`);
  }
}

describe("structured output schemas", () => {
  it.each([
    ["concept_scenes", GeneratedConceptContentSchema],
    ["teaching_plan", TeachingPlanSchema],
    ["concept_review", EvaluationSchema],
  ] as const)("%s converts to a strict JSON Schema", (name, schema) => {
    const format = zodTextFormat(schema, name);
    expect(format.strict).toBe(true);
    assertStrict(format.schema);
  });
});

// ---------------------------------------------------------------------------

const Tiny = z.strictObject({ answer: z.string().max(10) });

function responseBody(overrides: Record<string, unknown> = {}, text = '{"answer":"ok"}') {
  return {
    id: "resp_1",
    object: "response",
    created_at: 0,
    model: "test-model",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    ...overrides,
  };
}

function clientReturning(body: unknown, status = 200) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { client: createOpenAiClient({ apiKey: "sk-test", fetch: fetchImpl, maxRetries: 0 }), calls: () => calls };
}

const request = (signal = new AbortController().signal) => ({
  role: "generator" as const,
  model: "test-model",
  schemaName: "tiny",
  schema: Tiny,
  instructions: "x",
  input: "y",
  maxOutputTokens: 100,
  timeoutMs: 5_000,
  signal,
});

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof LlmError ? error.kind : `unexpected: ${String(error)}`;
  }
}

describe("createOpenAiClient", () => {
  it("returns validated data with usage", async () => {
    const { client } = clientReturning(responseBody());
    const result = await client.structured(request());
    expect(result.data).toEqual({ answer: "ok" });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it("surfaces refusals", async () => {
    const body = responseBody({
      output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "no" }] }],
    });
    expect(await kindOf(clientReturning(body).client.structured(request()))).toBe("refusal");
  });

  it("surfaces incomplete output", async () => {
    const body = responseBody({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, '{"answ');
    expect(await kindOf(clientReturning(body).client.structured(request()))).toBe("incomplete");
  });

  it("rejects output that is not JSON or does not match the schema", async () => {
    expect(await kindOf(clientReturning(responseBody({}, "```json\n{}\n```")).client.structured(request()))).toBe("invalid_output");
    expect(await kindOf(clientReturning(responseBody({}, '{"answer":"far too long for the limit"}')).client.structured(request()))).toBe(
      "invalid_output",
    );
    expect(await kindOf(clientReturning(responseBody({}, '{"answer":"ok","extra":1}')).client.structured(request()))).toBe(
      "invalid_output",
    );
  });

  it("maps HTTP errors to provider errors without leaking provider messages", async () => {
    const { client } = clientReturning({ error: { message: "secret detail echoing input", type: "server_error" } }, 500);
    try {
      await client.structured(request());
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).kind).toBe("provider");
      expect((error as LlmError).status).toBe(500);
      expect((error as LlmError).message).not.toContain("secret");
    }
  });

  it("distinguishes caller cancellation from timeouts", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const client = createOpenAiClient({ apiKey: "sk-test", fetch: hanging, maxRetries: 0 });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    expect(await kindOf(client.structured(request(controller.signal)))).toBe("aborted");
    expect(await kindOf(client.structured({ ...request(), timeoutMs: 20 }))).toBe("timeout");
  });
});
