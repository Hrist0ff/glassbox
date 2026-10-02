import {
  GenerationEventSchema,
  PreStreamErrorSchema,
  STAGES,
  type FailureCode,
  type GenerationEvent,
  type PreStreamError,
  type Stage,
} from "@/lib/sse/events";
import { SseParser } from "@/lib/sse/parser";

/**
 * Browser side of POST /api/generate: a streaming-fetch SSE consumer (native
 * EventSource cannot POST) and a pure reducer for the loader UI.
 */

export type StreamEnd =
  | { kind: "terminal"; event: Extract<GenerationEvent, { type: "completed" | "failed" }> }
  | { kind: "http_error"; status: number; error: PreStreamError }
  | { kind: "ended_early" }
  | { kind: "protocol_error"; message: string }
  | { kind: "aborted"; reason: "cancelled" | "stalled" | "timeout" };

export const CLIENT_LIMITS = {
  /** No bytes (not even a heartbeat) for this long means the connection is dead. */
  stallMs: 45_000,
  /** Absolute cap, slightly above the server's maximum duration. */
  totalMs: 330_000,
};

class ClientAbort extends Error {
  constructor(readonly reason: "cancelled" | "stalled" | "timeout") {
    super(reason);
  }
}

export async function streamGeneration(params: {
  topic: string;
  idempotencyKey: string;
  signal: AbortSignal;
  onEvent: (event: GenerationEvent) => void;
  fetchImpl?: typeof fetch;
  limits?: typeof CLIENT_LIMITS;
}): Promise<StreamEnd> {
  const limits = params.limits ?? CLIENT_LIMITS;
  const controller = new AbortController();
  const abortWith = (reason: ClientAbort["reason"]) => controller.abort(new ClientAbort(reason));
  const onOuterAbort = () => abortWith("cancelled");
  params.signal.addEventListener("abort", onOuterAbort, { once: true });
  let stallTimer = setTimeout(() => abortWith("stalled"), limits.stallMs);
  const totalTimer = setTimeout(() => abortWith("timeout"), limits.totalMs);
  const resetStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => abortWith("stalled"), limits.stallMs);
  };
  const abortReason = (): ClientAbort["reason"] | null =>
    controller.signal.reason instanceof ClientAbort ? controller.signal.reason.reason : params.signal.aborted ? "cancelled" : null;

  try {
    if (params.signal.aborted) return { kind: "aborted", reason: "cancelled" };
    const response = await (params.fetchImpl ?? fetch)("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ topic: params.topic, idempotencyKey: params.idempotencyKey }),
      signal: controller.signal,
    });

    // Errors that happen before streaming are plain JSON responses.
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const parsed = PreStreamErrorSchema.safeParse(body);
      return {
        kind: "http_error",
        status: response.status,
        error: parsed.success
          ? parsed.data.error
          : { code: "internal", message: `The server responded with HTTP ${response.status}.` },
      };
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
      return { kind: "protocol_error", message: "The server did not return an event stream." };
    }

    const reader = response.body.getReader();
    const parser = new SseParser();
    let requestId: string | null = null;
    let lastSeq = -1;

    const handle = (messages: ReturnType<SseParser["feed"]>): StreamEnd | null => {
      for (const message of messages) {
        let data: unknown;
        try {
          data = JSON.parse(message.data);
        } catch {
          return { kind: "protocol_error", message: "Received a malformed event." };
        }
        const parsed = GenerationEventSchema.safeParse(data);
        if (!parsed.success || parsed.data.type !== message.event) {
          return { kind: "protocol_error", message: "Received an unexpected event." };
        }
        const event = parsed.data;
        requestId ??= event.requestId;
        if (event.requestId !== requestId || event.seq <= lastSeq) {
          return { kind: "protocol_error", message: "Received events out of order." };
        }
        lastSeq = event.seq;
        params.onEvent(event);
        if (event.type === "completed" || event.type === "failed") return { kind: "terminal", event };
      }
      return null;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStall();
      const end = handle(parser.feed(value));
      if (end) {
        await reader.cancel().catch(() => undefined);
        return end;
      }
    }
    return handle(parser.end()) ?? { kind: "ended_early" };
  } catch (error) {
    const reason = abortReason();
    if (reason) return { kind: "aborted", reason };
    if (error instanceof ClientAbort) return { kind: "aborted", reason: error.reason };
    return { kind: "ended_early" };
  } finally {
    clearTimeout(stallTimer);
    clearTimeout(totalTimer);
    params.signal.removeEventListener("abort", onOuterAbort);
  }
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export type StageStatus = "pending" | "running" | "done" | "failed";

export type AttemptRecord = { attempt: number; outcome: "started" | "rejected" | "accepted"; reasons: string[] };

export type LoaderError = {
  /** Failure codes from the stream, pre-stream HTTP codes, or client-side transport codes. */
  code: FailureCode | PreStreamError["code"] | "connection_lost" | "stalled" | "client_timeout" | "protocol";
  title: string;
  message: string;
  retryable: boolean;
  reasons?: string[];
  retryAfterSeconds?: number;
};

export type LoaderState = {
  status: "idle" | "connecting" | "running" | "completed" | "failed" | "cancelled";
  topic: string;
  mode: "live" | "demo" | null;
  stages: Record<Stage, { status: StageStatus; message?: string }>;
  maxAttempts: number;
  attempts: AttemptRecord[];
  completed: Extract<GenerationEvent, { type: "completed" }> | null;
  error: LoaderError | null;
};

const freshStages = (): LoaderState["stages"] =>
  Object.fromEntries(STAGES.map((s) => [s, { status: "pending" as StageStatus }])) as LoaderState["stages"];

export const initialLoaderState: LoaderState = {
  status: "idle",
  topic: "",
  mode: null,
  stages: freshStages(),
  maxAttempts: 0,
  attempts: [],
  completed: null,
  error: null,
};

export type LoaderAction =
  | { type: "start"; topic: string }
  | { type: "event"; event: GenerationEvent }
  | { type: "end"; end: StreamEnd }
  | { type: "reset" };

const FAILURE_TITLES: Record<LoaderError["code"], string> = {
  unsupported_topic: "This topic doesn't fit the format",
  model_refused: "The AI model declined",
  rejected: "No draft passed the checks",
  timeout: "Generation ran out of time",
  provider_error: "The AI provider had a problem",
  persistence_failed: "Saving failed",
  cancelled: "Generation cancelled",
  internal: "Something went wrong",
  invalid_request: "Check the topic",
  payload_too_large: "The request is too large",
  unsupported_media_type: "Unsupported request",
  forbidden: "Request not allowed",
  rate_limited: "Generation limit reached",
  in_progress: "A generation is already running",
  misconfigured: "Generation isn't set up",
  connection_lost: "Connection lost",
  stalled: "The server stopped responding",
  client_timeout: "Generation took too long",
  protocol: "Unexpected server response",
};

const RETRYABLE_HTTP: ReadonlySet<PreStreamError["code"]> = new Set(["rate_limited", "in_progress", "internal"]);

function errorFromEnd(end: StreamEnd): LoaderError | null {
  switch (end.kind) {
    case "terminal":
      if (end.event.type !== "failed") return null;
      return {
        code: end.event.code,
        title: FAILURE_TITLES[end.event.code],
        message: end.event.message,
        retryable: end.event.retryable,
        reasons: end.event.reasons,
      };
    case "http_error":
      if (end.error.code === "in_progress") {
        // The lease's expiry is only an upper bound; a just-cancelled run frees it within seconds.
        return {
          code: "in_progress",
          title: FAILURE_TITLES.in_progress,
          message: "Another generation for your account is still running or just stopping. Try again in a few seconds.",
          retryable: true,
        };
      }
      return {
        code: end.error.code,
        title: FAILURE_TITLES[end.error.code],
        message: end.error.message,
        retryable: RETRYABLE_HTTP.has(end.error.code),
        retryAfterSeconds: end.error.retryAfterSeconds,
      };
    case "ended_early":
      return {
        code: "connection_lost",
        title: FAILURE_TITLES.connection_lost,
        message:
          "The connection closed before the server confirmed the result. Retrying is safe: if the explanation was already saved, you'll be taken to it.",
        retryable: true,
      };
    case "protocol_error":
      return { code: "protocol", title: FAILURE_TITLES.protocol, message: end.message, retryable: true };
    case "aborted":
      if (end.reason === "cancelled") return null;
      return end.reason === "stalled"
        ? {
            code: "stalled",
            title: FAILURE_TITLES.stalled,
            message: "No updates arrived for 45 seconds, so the connection was closed. The server cancels work when the connection closes.",
            retryable: true,
          }
        : {
            code: "client_timeout",
            title: FAILURE_TITLES.client_timeout,
            message: "The request exceeded the maximum generation time and was stopped.",
            retryable: true,
          };
  }
}

export function loaderReducer(state: LoaderState, action: LoaderAction): LoaderState {
  switch (action.type) {
    case "reset":
      return initialLoaderState;
    case "start":
      return { ...initialLoaderState, stages: freshStages(), status: "connecting", topic: action.topic };
    case "event": {
      const event = action.event;
      switch (event.type) {
        case "started":
          return { ...state, status: "running", mode: event.mode, maxAttempts: event.maxAttempts };
        case "progress": {
          const stages = { ...state.stages, [event.stage]: { status: event.state, message: event.message } };
          // A new attempt re-runs later stages; clear their stale results.
          if (event.stage === "generate" && event.state === "running") {
            stages.validate = { status: "pending" };
            stages.evaluate = { status: "pending" };
          }
          return { ...state, status: "running", stages };
        }
        case "attempt": {
          const others = state.attempts.filter((a) => a.attempt !== event.attempt);
          const record = { attempt: event.attempt, outcome: event.outcome, reasons: event.reasons ?? [] };
          return { ...state, maxAttempts: event.maxAttempts, attempts: [...others, record].sort((a, b) => a.attempt - b.attempt) };
        }
        case "completed":
          return { ...state, status: "completed", completed: event };
        case "failed":
          return state; // handled by "end", which carries the same event
      }
      return state;
    }
    case "end": {
      if (action.end.kind === "terminal" && action.end.event.type === "completed") {
        return { ...state, status: "completed", completed: action.end.event };
      }
      if (action.end.kind === "aborted" && action.end.reason === "cancelled") {
        return { ...state, status: "cancelled", error: null };
      }
      const error = errorFromEnd(action.end);
      const stages = { ...state.stages };
      for (const stage of STAGES) if (stages[stage].status === "running") stages[stage] = { ...stages[stage], status: "failed" };
      return { ...state, status: "failed", error, stages };
    }
  }
}
