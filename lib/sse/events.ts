import { z } from "zod";
import { ConceptSchema, SupplementSchema } from "@/lib/concept/schema";

/**
 * Typed event contract for POST /api/generate (server-sent events).
 * Shared by the route (encoder) and GenerationLoader (decoder).
 *
 * Every event carries the request id and a strictly increasing sequence
 * number. `completed` and `failed` are terminal: exactly one of them ends a
 * stream that started successfully.
 */

export const MAX_ATTEMPTS = 3;

/** `read` runs only for supplied material. */
export const STAGES = ["access", "read", "plan", "generate", "validate", "evaluate", "persist"] as const;
export type Stage = (typeof STAGES)[number];

export const FAILURE_CODES = [
  "unsupported_topic",
  "model_refused",
  "rejected",
  "timeout",
  "provider_error",
  "persistence_failed",
  "cancelled",
  "internal",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

const base = {
  requestId: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
};

/** Wire limits; `fitEvent` clips text so the server never emits an event the client would reject. */
export const EVENT_LIMITS = { message: 400, failedMessage: 600, reason: 400, reasons: 8, suggestion: 100, suggestions: 3 } as const;

const shortList = z.array(z.string().max(EVENT_LIMITS.reason)).max(EVENT_LIMITS.reasons);

export const GenerationEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("started"),
    mode: z.enum(["live", "demo"]),
    topic: z.string(),
    /** 0 in demo mode, where nothing is generated. */
    maxAttempts: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal("progress"),
    stage: z.enum(STAGES),
    state: z.enum(["running", "done", "failed"]),
    message: z.string().max(EVENT_LIMITS.message),
    attempt: z.number().int().positive().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("attempt"),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    outcome: z.enum(["started", "rejected", "accepted"]),
    reasons: shortList.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("completed"),
    conceptId: z.string(),
    url: z.string().startsWith("/"),
    attempts: z.number().int().nonnegative(),
    /** Always false: nothing is stored on the server (the browser saves generated explanations). */
    persisted: z.boolean(),
    demo: z.boolean(),
    /**
     * Only when a generated explanation was not saved: the explanation itself,
     * since there is no URL to load it from. Validated again before rendering.
     */
    concept: ConceptSchema.optional(),
    /** For "explore" requests: the step explanation, simpler version, or example, for the browser to keep. */
    supplement: SupplementSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("failed"),
    code: z.enum(FAILURE_CODES),
    message: z.string().max(EVENT_LIMITS.failedMessage),
    retryable: z.boolean(),
    reasons: shortList.optional(),
    /** Requests that would work instead, for unsupported or ambiguous ones. */
    suggestions: z.array(z.string().max(EVENT_LIMITS.suggestion)).max(EVENT_LIMITS.suggestions).optional(),
  }),
]);

export type GenerationEvent = z.infer<typeof GenerationEventSchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What pipeline code emits; the stream adds `requestId` and `seq`. */
export type GenerationEventInput = DistributiveOmit<GenerationEvent, "requestId" | "seq">;

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const clipReasons = (reasons: string[] | undefined) =>
  reasons?.slice(0, EVENT_LIMITS.reasons).map((r) => clip(r, EVENT_LIMITS.reason));

/**
 * Clip free text (which can include model-written summaries) to the wire
 * limits. Applied to every event before it is sent.
 */
export function fitEvent<E extends GenerationEventInput>(event: E): E {
  switch (event.type) {
    case "progress":
      return { ...event, message: clip(event.message, EVENT_LIMITS.message) };
    case "attempt":
      return event.reasons ? { ...event, reasons: clipReasons(event.reasons) } : event;
    case "failed":
      return {
        ...event,
        message: clip(event.message, EVENT_LIMITS.failedMessage),
        ...(event.reasons ? { reasons: clipReasons(event.reasons) } : {}),
        ...(event.suggestions
          ? { suggestions: event.suggestions.slice(0, EVENT_LIMITS.suggestions).map((s) => clip(s, EVENT_LIMITS.suggestion)) }
          : {}),
      };
    default:
      return event;
  }
}

/** JSON error body for failures that happen before the stream starts. */
export const PreStreamErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "payload_too_large",
      "unsupported_media_type",
      "forbidden",
      "rate_limited",
      "in_progress",
      "misconfigured",
      "demo_mode",
      "internal",
    ]),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});
export type PreStreamError = z.infer<typeof PreStreamErrorSchema>["error"];
