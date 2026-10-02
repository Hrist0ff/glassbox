"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  initialLoaderState,
  loaderReducer,
  streamGeneration,
  type LoaderState,
  type StageStatus,
} from "@/lib/generation/client";
import { storeUnsaved } from "@/lib/generation/unsaved";
import type { Stage } from "@/lib/sse/events";

/**
 * Drives one generation request and exposes its state. Requests start from
 * user actions (submit / retry), never from effects, so React Strict Mode
 * cannot double-submit, and a second start while one is running is ignored.
 */
export function useGenerationRun() {
  const [state, dispatch] = useReducer(loaderReducer, initialLoaderState);
  const active = useRef<AbortController | null>(null);
  const last = useRef<{ topic: string; idempotencyKey: string } | null>(null);
  const router = useRouter();
  // Set when an unsaved explanation could not be handed to /preview.
  const [storageBlocked, setStorageBlocked] = useState(false);

  const start = useCallback(
    async (topic: string, idempotencyKey: string) => {
      if (active.current) return;
      const controller = new AbortController();
      active.current = controller;
      last.current = { topic, idempotencyKey };
      setStorageBlocked(false);
      dispatch({ type: "start", topic });
      const end = await streamGeneration({
        topic,
        idempotencyKey,
        signal: controller.signal,
        onEvent: (event) => dispatch({ type: "event", event }),
      });
      active.current = null;
      dispatch({ type: "end", end });
      if (end.kind !== "terminal" || end.event.type !== "completed") return;
      // Navigate only after the server confirmed the save...
      if (end.event.persisted) {
        router.push(end.event.url);
        return;
      }
      // ...or, without a database, once the explanation itself is in this tab.
      if (end.event.concept) {
        if (storeUnsaved({ topic, concept: end.event.concept, createdAt: new Date().toISOString() })) router.push(end.event.url);
        else setStorageBlocked(true);
      }
    },
    [router],
  );

  const cancel = useCallback(() => active.current?.abort(), []);
  const retry = useCallback(() => {
    if (last.current) void start(last.current.topic, last.current.idempotencyKey);
  }, [start]);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  // Leaving the page cancels the request; the server stops when the connection closes.
  useEffect(() => () => active.current?.abort(), []);

  return { state, start, cancel, retry, reset, storageBlocked };
}

const STAGE_LABELS: Record<Stage, { live: string; demo: string }> = {
  access: { live: "Check access", demo: "Check access" },
  plan: { live: "Plan the explanation", demo: "Find a bundled fixture" },
  generate: { live: "Draft scenes", demo: "Draft scenes" },
  validate: { live: "Check structure and layout", demo: "Check structure and layout" },
  evaluate: { live: "Review accuracy and teaching quality", demo: "Review" },
  persist: { live: "Save to your library", demo: "Save" },
};

const DEMO_STAGES: Stage[] = ["plan", "validate"];
const LIVE_STAGES: Stage[] = ["access", "plan", "generate", "validate", "evaluate", "persist"];

export function GenerationLoader({
  state,
  saves = true,
  storageBlocked = false,
  onCancel,
  onRetry,
  onEditTopic,
}: {
  state: LoaderState;
  /** False when no database is configured: results open in this tab and are not saved. */
  saves?: boolean;
  storageBlocked?: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onEditTopic: () => void;
}) {
  const running = state.status === "connecting" || state.status === "running";
  const elapsed = useElapsedSeconds(running);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the outcome so keyboard and screen-reader users notice it.
  useEffect(() => {
    if (state.status === "failed" || state.status === "completed" || state.status === "cancelled") {
      headingRef.current?.focus();
    }
  }, [state.status]);

  if (state.status === "idle") return null;

  const stages = state.mode === "demo" ? DEMO_STAGES : LIVE_STAGES;
  const currentAttempt = state.attempts.at(-1)?.attempt ?? 0;
  const rejected = state.attempts.filter((a) => a.outcome === "rejected");

  return (
    <section
      aria-labelledby="generation-heading"
      className="rounded-2xl border border-line bg-paper-raised p-5 shadow-[0_12px_32px_-22px_rgba(30,25,15,0.35)] sm:p-6"
      data-testid="generation-loader"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="generation-heading" ref={headingRef} tabIndex={-1} className="font-display text-xl text-ink outline-none">
            {headingFor(state)}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-medium text-ink-soft">“{state.topic}”</span>
            {running ? <span className="tabular-nums"> · {formatElapsed(elapsed)} elapsed</span> : null}
            {currentAttempt > 0 && state.maxAttempts > 0 ? (
              <span>
                {" "}
                · Attempt {currentAttempt} of {state.maxAttempts}
              </span>
            ) : null}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-paper-sunk hover:text-ink"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {state.mode === "demo" ? (
        <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <strong className="font-semibold">Local demo mode.</strong> No AI model is called and nothing is saved; only bundled fixtures can be opened.
        </p>
      ) : null}

      {state.status === "connecting" ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Spinner /> Connecting to the server…
        </p>
      ) : (
        <ol className="mt-5 space-y-3" aria-label="Generation stages">
          {stages.map((stage) => (
            <StageRow
              key={stage}
              label={stage === "persist" && !saves ? "Skip saving (no database)" : STAGE_LABELS[stage][state.mode ?? "live"]}
              {...state.stages[stage]}
            />
          ))}
        </ol>
      )}

      {rejected.length > 0 && state.status !== "failed" ? (
        <div className="mt-5 border-t border-line pt-4">
          {rejected.map((attempt) => (
            <div key={attempt.attempt} className="text-sm">
              <p className="font-medium text-ink-soft">
                Attempt {attempt.attempt} was sent back for revision{attempt.reasons.length ? ":" : "."}
              </p>
              {attempt.reasons.length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
                  {attempt.reasons.slice(0, 3).map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {liveMessage(state)}
      </p>

      {state.status === "failed" && state.error ? (
        <div className="mt-5 rounded-xl border border-danger/25 bg-danger-soft/60 p-4" role="alert">
          <p className="font-semibold text-danger">{state.error.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{state.error.message}</p>
          {state.error.reasons?.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
              {state.error.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {state.error.retryAfterSeconds ? (
            <p className="mt-2 text-sm text-ink-muted">You can try again in about {formatWait(state.error.retryAfterSeconds)}.</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {state.error.retryable ? (
              <button type="button" onClick={onRetry} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/85">
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={onEditTopic}
              className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-paper-sunk"
            >
              Edit topic
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "cancelled" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <p>
            Cancelled. The server stops when the connection closes.
            {saves ? " If you cancelled during the final save, the explanation may still appear in your library." : null}
          </p>
          <button type="button" onClick={onRetry} className="rounded-full bg-ink px-4 py-2 font-semibold text-paper hover:bg-ink/85">
            Start again
          </button>
        </div>
      ) : null}

      {state.status === "completed" && state.completed ? (
        state.completed.persisted ? (
          <p className="mt-5 flex items-center gap-2 text-sm font-medium text-success" role="status">
            <Spinner /> Saved. Opening your explanation…
          </p>
        ) : !state.completed.demo ? (
          storageBlocked ? (
            <p className="mt-5 rounded-xl border border-danger/25 bg-danger-soft/60 p-4 text-sm text-ink-soft" role="alert">
              The explanation is ready, but this browser blocked session storage, so it can&apos;t be opened. Nothing is
              saved without a database. Allow site data for this page and try again.
            </p>
          ) : (
            <p className="mt-5 flex items-center gap-2 text-sm font-medium text-success" role="status">
              <Spinner /> Ready. Opening your explanation (not saved)…
            </p>
          )
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-soft">Demo fixture ready. Nothing was generated or saved.</p>
            <Link
              href={state.completed.url}
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/85"
            >
              Open demo explanation →
            </Link>
          </div>
        )
      ) : null}
    </section>
  );
}

function StageRow({ label, status, message }: { label: string; status: StageStatus; message?: string }) {
  return (
    <li className="flex gap-3">
      <StageIcon status={status} />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${status === "pending" ? "text-ink-faint" : "text-ink"}`}>
          {label}
          <span className="sr-only">: {status}</span>
        </p>
        {message && status !== "pending" ? <p className="mt-0.5 text-sm text-ink-muted">{message}</p> : null}
      </div>
    </li>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  const base = "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold";
  switch (status) {
    case "done":
      return <span aria-hidden className={`${base} bg-success text-white`}>✓</span>;
    case "failed":
      return <span aria-hidden className={`${base} bg-danger text-white`}>!</span>;
    case "running":
      return (
        <span aria-hidden className={`${base} border-2 border-accent`}>
          <span className="size-2 animate-pulse rounded-full bg-accent" />
        </span>
      );
    default:
      return <span aria-hidden className={`${base} border-2 border-line-strong`} />;
  }
}

function Spinner() {
  return <span aria-hidden className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

function headingFor(state: LoaderState): string {
  switch (state.status) {
    case "connecting":
    case "running":
      return state.mode === "demo" ? "Opening a demo explanation" : "Building your explanation";
    case "completed":
      return state.completed?.persisted ? "Explanation saved" : state.completed?.demo ? "Demo explanation ready" : "Explanation ready";
    case "cancelled":
      return "Generation cancelled";
    case "failed":
      return "Generation stopped";
    default:
      return "";
  }
}

function liveMessage(state: LoaderState): string {
  if (state.status === "failed") return state.error ? `${state.error.title}. ${state.error.message}` : "Generation failed.";
  if (state.status === "completed") {
    if (state.completed?.persisted) return "Saved. Opening your explanation.";
    return state.completed?.demo ? "Demo explanation ready." : "Ready. Opening your explanation; it is not saved.";
  }
  const running = Object.entries(state.stages).find(([, s]) => s.status === "running");
  return running?.[1].message ?? "";
}

/** Real elapsed time of the current run (no estimates). */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const begin = Date.now();
    const reset = window.setTimeout(() => setElapsed(0), 0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - begin) / 1000)), 1000);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [running]);
  return elapsed;
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatWait(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}
