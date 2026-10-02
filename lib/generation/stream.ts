import { fitEvent, type GenerationEvent, type GenerationEventInput } from "@/lib/sse/events";
import { encodeSseEvent, SSE_HEARTBEAT } from "@/lib/sse/parser";

export type TerminalEventInput = Extract<GenerationEventInput, { type: "completed" | "failed" }>;
export type TerminalEvent = Extract<GenerationEvent, { type: "completed" | "failed" }>;

export type StreamRunContext = {
  emit: (event: GenerationEventInput) => void;
  /** Aborted when the client disconnects or the server deadline passes. */
  signal: AbortSignal;
};

export type GenerationStreamOptions = {
  requestId: string;
  /** Runs the work and returns the terminal event. Must not emit terminal events itself. */
  run: (context: StreamRunContext) => Promise<TerminalEventInput>;
  /** Hard stop for the work; should be below the platform's max duration. */
  deadlineMs: number;
  heartbeatMs?: number;
  /** Aborts the work when the HTTP request is aborted. */
  requestSignal?: AbortSignal;
  /** Cleanup (e.g. releasing the generation lease). Runs on every path. */
  onSettled?: (terminal: TerminalEvent) => Promise<void> | void;
  /**
   * After an abort (deadline or disconnect), how long `run` may take to wind
   * down before the stream gives up on it and sends the terminal event itself.
   */
  abortGraceMs?: number;
};

export type GenerationStream = {
  body: ReadableStream<Uint8Array>;
  /** Resolves after the terminal event was sent (or dropped) and cleanup ran. */
  settled: Promise<void>;
};

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  "X-Accel-Buffering": "no",
} as const;

/**
 * SSE body for one generation request.
 *
 * Guarantees: sequence numbers strictly increase; exactly one terminal event
 * (`completed` or `failed`) is sent last; heartbeats keep intermediaries from
 * timing out; timers and listeners are cleared and `onSettled` runs on every
 * path, including client cancellation and unexpected exceptions.
 */
export function createGenerationStream(options: GenerationStreamOptions): GenerationStream {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let seq = 0;
  let open = true;
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => (resolveSettled = resolve));

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const send = (event: GenerationEventInput): GenerationEvent => {
        const full = { ...fitEvent(event), requestId: options.requestId, seq: seq++ } as GenerationEvent;
        write(encodeSseEvent(full.type, full, full.seq));
        return full;
      };
      let finished = false;
      const emit = (event: GenerationEventInput) => {
        // Terminal events are reserved for this module; late emits are dropped.
        if (finished || event.type === "completed" || event.type === "failed") return;
        send(event);
      };

      const heartbeat = setInterval(() => write(SSE_HEARTBEAT), options.heartbeatMs ?? 15_000);
      const deadline = setTimeout(() => abort.abort(new Error("deadline")), options.deadlineMs);
      const onRequestAbort = () => abort.abort(new Error("client disconnected"));
      options.requestSignal?.addEventListener("abort", onRequestAbort, { once: true });

      // If the work ignores the abort (e.g. a hung network call), stop waiting
      // after a grace period so a terminal event and cleanup still happen.
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const abandoned = new Promise<TerminalEventInput>((resolve) => {
        abort.signal.addEventListener(
          "abort",
          () => {
            if (finished) return;
            const timedOut = (abort.signal.reason as Error | undefined)?.message === "deadline";
            graceTimer = setTimeout(
              () =>
                resolve({
                  type: "failed",
                  code: timedOut ? "timeout" : "cancelled",
                  message: timedOut
                    ? "Generation ran out of time and was stopped. If saving had already started it may still finish; retrying will open it."
                    : "Generation was cancelled.",
                  retryable: true,
                }),
              options.abortGraceMs ?? 3_000,
            );
          },
          { once: true },
        );
      });

      void (async () => {
        let terminal: TerminalEventInput;
        try {
          terminal = await Promise.race([options.run({ emit, signal: abort.signal }), abandoned]);
        } catch {
          terminal = {
            type: "failed",
            code: "internal",
            message: "Something went wrong on our side. Nothing was saved.",
            retryable: true,
          };
        }
        finished = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        clearTimeout(graceTimer);
        options.requestSignal?.removeEventListener("abort", onRequestAbort);
        const sent = send(terminal) as TerminalEvent;
        try {
          await options.onSettled?.(sent);
        } catch {
          // Cleanup failures must not prevent closing the stream.
        }
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by a cancel.
          }
        }
        resolveSettled();
      })();
    },
    cancel() {
      // Reader went away (client disconnected or cancelled): stop the work.
      open = false;
      abort.abort(new Error("stream cancelled"));
    },
  });

  return { body, settled };
}
