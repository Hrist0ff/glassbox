import { randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { LIMITS } from "@/lib/concept/constants";
import { findConceptByRequest, insertGeneratedConcept } from "@/lib/data/concepts";
import { claimGenerationSlot, releaseGenerationSlot, type SlotClaim } from "@/lib/data/generation-slots";
import { generationMode, modelConfig, serverEnv, supabaseSecretKey } from "@/lib/env";
import { clientKey } from "@/lib/generation/client-key";
import { MemorySlots } from "@/lib/generation/memory-slots";
import { createGenerationStream, SSE_HEADERS, type TerminalEventInput } from "@/lib/generation/stream";
import { normalizeTopic } from "@/lib/generation/topic";
import { Deadline } from "@/lib/pipeline/budget";
import { runDemoPipeline } from "@/lib/pipeline/demo";
import { createOpenAiClient } from "@/lib/pipeline/openai-client";
import { runGenerationPipeline, type GenerationMeta, type PipelineOutcome } from "@/lib/pipeline/orchestrator";
import { GenerateRequestSchema, MAX_ATTEMPTS, type PreStreamError } from "@/lib/sse/events";
import type { Concept } from "@/lib/concept/schema";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * POST /api/generate — JSON request, server-sent events response.
 *
 * Execution model: the whole pipeline runs inside this request. Streaming
 * keeps the client informed but does not extend the platform limit, so:
 *   - maxDuration is 300 s (the Vercel default on all plans with Fluid Compute);
 *   - the pipeline deadline (GENERATION_DEADLINE_MS, default 270 s) aborts work
 *     before the platform does, keeping time for the save and terminal event;
 *   - every provider call has its own timeout and at most one provider retry.
 * If the client disconnects, the generation is cancelled and nothing continues
 * in the background. (A disconnect during the final insert may still save it;
 * the idempotency key lets a retry find that result.)
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const RATE_WINDOW_SECONDS = 3600;
/** Lease outlives the longest possible request, so a crashed instance cannot block a visitor for long. */
const LEASE_SECONDS = maxDuration + 30;

/** Rate-limit state when no database is configured; per server process (see MemorySlots). */
const memorySlots = new MemorySlots();
/** Keys the in-process limiter only, so a random per-process secret is enough. */
const PROCESS_SECRET = randomBytes(32).toString("hex");

/** Where a finished explanation goes: the database, or back to the browser when there is none. */
type Storage = {
  persist: (concept: Concept, meta: GenerationMeta, signal: AbortSignal) => Promise<Extract<TerminalEventInput, { type: "completed" }>>;
  release: () => Promise<void>;
  messages?: { running: string; done: string };
};

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
  // Metadata only: never the topic, prompts, generated content, or keys.
  console.info(JSON.stringify({ event: "generation", ...fields }));
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
  const raw = await readLimitedText(request, LIMITS.requestBodyBytes);
  if (raw === null) {
    return jsonError(413, { code: "payload_too_large", message: "The request is too large." });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, { code: "invalid_request", message: "The request body is not valid JSON." });
  }
  const parsed = GenerateRequestSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, { code: "invalid_request", message: "Send a topic and an idempotency key." });
  }
  const topicResult = normalizeTopic(parsed.data.topic);
  if (!topicResult.ok) return jsonError(400, { code: "invalid_request", message: topicResult.message });
  const topic = topicResult.topic;
  const requestId = randomUUID();

  const mode = generationMode();
  if (mode.mode === "misconfigured") {
    console.error(JSON.stringify({ event: "generation_misconfigured", missing: mode.missing }));
    return jsonError(503, { code: "misconfigured", message: "Generation is not configured on this server yet." });
  }

  // ---- Demo mode: bundled fixtures, no AI, no persistence. ----
  if (mode.mode === "demo") {
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

  let claim: SlotClaim;
  let storage: Storage;
  if (mode.storage === "database") {
    const admin = createAdminClient();
    const secret = supabaseSecretKey();
    if (!admin || !secret) {
      return jsonError(503, { code: "misconfigured", message: "Generation is not configured on this server yet." });
    }
    const visitor = clientKey(request.headers, secret);

    let existingId: string | null;
    try {
      existingId = await findConceptByRequest(admin, idempotencyKey);
    } catch {
      return jsonError(503, { code: "internal", message: "The database is unavailable. Please try again." });
    }
    if (existingId) {
      // A previous request with this key already saved its result (for example,
      // the connection dropped right after saving). Return it instead of paying again.
      const stream = createGenerationStream({
        requestId,
        deadlineMs: 5_000,
        run: async ({ emit }) => {
          emit({ type: "started", mode: "live", topic, maxAttempts: MAX_ATTEMPTS });
          emit({ type: "progress", stage: "access", state: "done", message: "Found the explanation saved by your earlier request" });
          return { type: "completed", conceptId: existingId, url: `/concept/${existingId}`, attempts: 0, persisted: true, demo: false };
        },
      });
      return sseResponse(stream.body, requestId);
    }

    try {
      claim = await claimGenerationSlot(admin, { clientKey: visitor, ...limits });
    } catch {
      return jsonError(503, { code: "internal", message: "The database is unavailable. Please try again." });
    }
    storage = {
      persist: async (concept, meta, signal) => {
        const { id } = await insertGeneratedConcept(admin, { concept, topic, requestId: idempotencyKey, meta }, signal);
        return { type: "completed", conceptId: id, url: `/concept/${id}`, attempts: meta.attempts, persisted: true, demo: false };
      },
      release: () => releaseGenerationSlot(admin, visitor, idempotencyKey),
    };
  } else {
    // No database: limits live in this process and the result goes back to the
    // browser instead of being saved. Retrying generates again.
    const visitor = clientKey(request.headers, PROCESS_SECRET);
    claim = memorySlots.claim({ clientKey: visitor, ...limits });
    storage = {
      persist: async (concept, meta) => ({
        type: "completed",
        conceptId: concept.id,
        url: "/preview",
        attempts: meta.attempts,
        persisted: false,
        demo: false,
        concept,
      }),
      release: async () => memorySlots.release(visitor, idempotencyKey),
      messages: { running: "Not saving: no database is configured", done: "Ready to open in this tab (not saved)" },
    };
  }

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
  let completed: Extract<TerminalEventInput, { type: "completed" }> | undefined;

  const stream = createGenerationStream({
    requestId,
    deadlineMs: env.GENERATION_DEADLINE_MS,
    requestSignal: request.signal,
    run: async ({ emit, signal }): Promise<TerminalEventInput> => {
      emit({ type: "started", mode: "live", topic, maxAttempts: MAX_ATTEMPTS });
      emit({ type: "progress", stage: "access", state: "done", message: "Within the generation limit" });
      outcome = await runGenerationPipeline(topic, {
        llm,
        models,
        emit,
        signal,
        deadline,
        newId: randomUUID,
        persist: async (concept, meta, persistSignal) => {
          completed = await storage.persist(concept, meta, persistSignal);
          return { id: completed.conceptId };
        },
        persistMessages: storage.messages,
      });
      if (!outcome.ok) {
        return { type: "failed", code: outcome.code, message: outcome.message, retryable: outcome.retryable, reasons: outcome.reasons };
      }
      // `persist` resolved, so `completed` is set; the terminal event is sent only now.
      return completed!;
    },
    onSettled: async (terminal) => {
      logOutcome({
        requestId,
        result: terminal.type === "completed" ? "completed" : terminal.code,
        storage: mode.storage,
        attempts: outcome?.attempts ?? 0,
        latencyMs: deadline.elapsedMs(),
        usage: outcome ? (outcome.ok ? outcome.meta.usage : outcome.usage) : undefined,
        models,
      });
      await storage.release();
    },
  });

  // Keep the invocation alive until cleanup finishes, even if the client
  // disconnects mid-stream. Bounded by maxDuration; the lease TTL is the fallback.
  after(() => stream.settled);
  return sseResponse(stream.body, requestId);
}
