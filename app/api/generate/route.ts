import { randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { LIMITS } from "@/lib/concept/constants";
import type { Supplement } from "@/lib/concept/schema";
import { validateConcept } from "@/lib/concept/validate";
import { generationMode, modelConfig, serverEnv } from "@/lib/env";
import { clientKey } from "@/lib/generation/client-key";
import { MemorySlots } from "@/lib/generation/memory-slots";
import { bodyLimit, GenerateRequestSchema, requestLabel, toGenerationRequest, type GenerationRequest } from "@/lib/generation/request";
import { createGenerationStream, SSE_HEADERS, type TerminalEventInput } from "@/lib/generation/stream";
import { Deadline } from "@/lib/pipeline/budget";
import { runDemoPipeline } from "@/lib/pipeline/demo";
import { createOpenAiClient } from "@/lib/pipeline/openai-client";
import { runGenerationPipeline, TEXT_ATTEMPTS, type PipelineOutcome, type PipelineProduct } from "@/lib/pipeline/orchestrator";
import { MAX_ATTEMPTS, type PreStreamError } from "@/lib/sse/events";

/**
 * POST /api/generate — JSON request, server-sent events response.
 *
 * Execution model: the whole pipeline runs inside this request. Streaming
 * keeps the client informed but does not extend the platform limit, so:
 *   - maxDuration is 300 s (the Vercel default on all plans with Fluid Compute);
 *   - the pipeline deadline (GENERATION_DEADLINE_MS, default 270 s) aborts work
 *     before the platform does, keeping time for the terminal event;
 *   - every provider call has its own timeout and at most one provider retry.
 * If the client disconnects, the generation is cancelled and nothing continues
 * in the background. Nothing is stored on the server: the `completed` event
 * carries the validated explanation (or, for exploring a step, the
 * supplement), and the browser saves it in localStorage.
 * The idempotency key identifies the request for the per-visitor lease.
 *
 * Requests: a topic, pasted material (`kind: "source"`), or a step of an
 * explanation the browser already has (`kind: "explore"`); body limits
 * depend on the kind (see LIMITS).
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const RATE_WINDOW_SECONDS = 3600;
/** Lease outlives the longest possible request, so a crashed instance cannot block a visitor for long. */
const LEASE_SECONDS = maxDuration + 30;

/** Rate-limit state, per server process (see MemorySlots). */
const memorySlots = new MemorySlots();
/** Keys the in-process limiter only, so a random per-process secret is enough. */
const PROCESS_SECRET = randomBytes(32).toString("hex");

function jsonError(status: number, error: PreStreamError, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Browsers send Origin on POST; reject other sites (and the opaque "null" origin). */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function sseResponse(body: ReadableStream<Uint8Array>, requestId: string) {
  return new Response(body, { headers: { ...SSE_HEADERS, "X-Request-Id": requestId } });
}

function logOutcome(fields: Record<string, unknown>) {
  // Metadata only: never the topic, material, prompts, generated content, or keys.
  console.info(JSON.stringify({ event: "generation", ...fields }));
}

/** The terminal `completed` event for a pipeline product. */
function completedEvent(request: GenerationRequest, product: PipelineProduct, attempts: number): Extract<TerminalEventInput, { type: "completed" }> {
  const base = { type: "completed" as const, attempts, persisted: false, demo: false };
  if (request.kind !== "explore") {
    if (product.kind !== "concept") throw new Error("expected an explanation");
    return { ...base, conceptId: product.concept.id, url: `/concept/${product.concept.id}`, concept: product.concept };
  }
  // Exploring a step: the explanation itself is unchanged; the result travels as a supplement.
  const parent = request.context.concept.id;
  const head = { id: randomUUID(), conceptId: parent, stepId: request.context.stepId, createdAt: new Date().toISOString() };
  const supplement: Supplement =
    product.kind === "concept"
      ? { kind: "example", ...head, concept: product.concept }
      : { kind: product.action, ...head, text: product.text, claims: product.claims };
  return { ...base, conceptId: parent, url: `/concept/${parent}`, supplement };
}

export async function POST(request: Request) {
  // ---- Cheap checks first: nothing expensive happens before these pass. ----
  if (!isSameOrigin(request)) {
    return jsonError(403, { code: "forbidden", message: "Cross-origin requests are not allowed." });
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError(415, { code: "unsupported_media_type", message: "Send the request as application/json." });
  }
  const raw = await readLimitedText(request, LIMITS.exploreRequestBytes);
  if (raw === null) {
    return jsonError(413, { code: "payload_too_large", message: "The request is too large." });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, { code: "invalid_request", message: "The request body is not valid JSON." });
  }
  const kind = json && typeof json === "object" && typeof (json as { kind?: unknown }).kind === "string" ? (json as { kind: string }).kind : null;
  if (new TextEncoder().encode(raw).length > bodyLimit(kind)) {
    return jsonError(413, {
      code: "payload_too_large",
      message: kind === "source" ? `Paste at most ${LIMITS.sourceText.max.toLocaleString("en")} characters.` : "The request is too large.",
    });
  }
  const parsed = GenerateRequestSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, { code: "invalid_request", message: "Send a topic (or pasted material) and an idempotency key." });
  }
  const checked = toGenerationRequest(parsed.data, validateConcept);
  if (!checked.ok) return jsonError(400, { code: "invalid_request", message: checked.message });
  const generation = checked.request;
  const label = requestLabel(generation);
  const requestId = randomUUID();

  const mode = generationMode();
  if (mode.mode === "misconfigured") {
    console.error(JSON.stringify({ event: "generation_misconfigured", missing: mode.missing }));
    return jsonError(503, { code: "misconfigured", message: "Generation is not configured on this server yet." });
  }

  // ---- Demo mode: bundled fixtures, no AI, no persistence. ----
  if (mode.mode === "demo") {
    if (generation.kind !== "topic") {
      return jsonError(503, {
        code: "demo_mode",
        message: "This server runs in demo mode without an AI model, so it can only open the bundled examples.",
      });
    }
    const topic = generation.topic;
    const stream = createGenerationStream({
      requestId,
      deadlineMs: 10_000,
      requestSignal: request.signal,
      run: async ({ emit }) => {
        emit({ type: "started", mode: "demo", topic, maxAttempts: 0 });
        return runDemoPipeline(topic, emit);
      },
    });
    return sseResponse(stream.body, requestId);
  }

  // ---- Live mode: rate-limit per visitor, then stream. There are no accounts. ----
  const env = serverEnv();
  const idempotencyKey = parsed.data.idempotencyKey;
  const limits = {
    requestId: idempotencyKey,
    clientLimit: env.RATE_LIMIT_PER_CLIENT_PER_HOUR,
    globalLimit: env.RATE_LIMIT_GLOBAL_PER_HOUR,
    windowSeconds: RATE_WINDOW_SECONDS,
    leaseSeconds: LEASE_SECONDS,
  };

  // Nothing is stored on the server: the finished explanation goes back to the
  // browser, which saves it in localStorage. Retrying generates again.
  const visitor = clientKey(request.headers, PROCESS_SECRET);
  const claim = memorySlots.claim({ clientKey: visitor, ...limits });
  let completed: Extract<TerminalEventInput, { type: "completed" }> | undefined;
  const persist = async (product: PipelineProduct, meta: { attempts: number }) => {
    completed = completedEvent(generation, product, meta.attempts);
    return { id: completed.conceptId };
  };
  const textOnly = generation.kind === "explore" && generation.context.action !== "example";

  if (!claim.allowed) {
    const retryAfter = { "Retry-After": String(claim.retryAfterSeconds) };
    if (claim.reason === "in_progress") {
      return jsonError(
        409,
        { code: "in_progress", message: "A generation from your connection is already running. Wait for it to finish.", retryAfterSeconds: claim.retryAfterSeconds },
        retryAfter,
      );
    }
    return jsonError(
      429,
      {
        code: "rate_limited",
        message:
          claim.reason === "client_rate_limited"
            ? `You've reached the limit of ${env.RATE_LIMIT_PER_CLIENT_PER_HOUR} generations per hour.`
            : "The site has reached its generation limit for now.",
        retryAfterSeconds: claim.retryAfterSeconds,
      },
      retryAfter,
    );
  }

  const models = modelConfig(env);
  const deadline = new Deadline(env.GENERATION_DEADLINE_MS);
  const llm = createOpenAiClient({ apiKey: env.OPENAI_API_KEY!, reasoningEffort: models.reasoningEffort });
  let outcome: PipelineOutcome | undefined;

  const stream = createGenerationStream({
    requestId,
    deadlineMs: env.GENERATION_DEADLINE_MS,
    requestSignal: request.signal,
    run: async ({ emit, signal }): Promise<TerminalEventInput> => {
      emit({ type: "started", mode: "live", topic: label, maxAttempts: textOnly ? TEXT_ATTEMPTS : MAX_ATTEMPTS });
      emit({ type: "progress", stage: "access", state: "done", message: "Within the generation limit" });
      outcome = await runGenerationPipeline(generation, {
        llm,
        models,
        emit,
        signal,
        deadline,
        newId: randomUUID,
        persist,
        persistMessages: { running: "Preparing the result for your browser", done: "Ready" },
      });
      if (!outcome.ok) {
        return {
          type: "failed",
          code: outcome.code,
          message: outcome.message,
          retryable: outcome.retryable,
          reasons: outcome.reasons,
          ...(outcome.suggestions ? { suggestions: outcome.suggestions } : {}),
        };
      }
      // `persist` resolved, so `completed` is set; the terminal event is sent only now.
      return completed!;
    },
    onSettled: async (terminal) => {
      logOutcome({
        requestId,
        kind: generation.kind === "explore" ? `explore:${generation.context.action}` : generation.kind,
        result: terminal.type === "completed" ? "completed" : terminal.code,
        attempts: outcome?.attempts ?? 0,
        latencyMs: deadline.elapsedMs(),
        usage: outcome ? (outcome.ok ? outcome.meta.usage : outcome.usage) : undefined,
        models,
      });
      memorySlots.release(visitor, idempotencyKey);
    },
  });

  // Keep the invocation alive until cleanup finishes, even if the client
  // disconnects mid-stream. Bounded by maxDuration; the lease TTL is the fallback.
  after(() => stream.settled);
  return sseResponse(stream.body, requestId);
}
