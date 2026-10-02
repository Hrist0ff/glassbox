"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Supplement } from "@/lib/concept/schema";
import {
  initialLoaderState,
  loaderReducer,
  streamGeneration,
  type LoaderState,
  type RequestKind,
  type StageStatus,
} from "@/lib/generation/client";
import { saveExplanation } from "@/lib/library";
import type { Stage } from "@/lib/sse/events";

/** One request to start: the body for POST /api/generate, plus how to show and keep its result. */
export type RunSpec = {
  body: Record<string, unknown>;
  /** Shown while it runs: the topic, the material's title, or the step being explored. */
  label: string;
  kind: RequestKind;
};

/**
 * Drives one generation request and exposes its state. Requests start from
 * user actions (submit / retry), never from effects, so React Strict Mode
 * cannot double-submit, and a second start while one is running is ignored.
 *
 * A finished explanation is saved in this browser and opened. A supplement
 * (exploring a step) is handed to `onSupplement` instead; the page stays.
 */
export function useGenerationRun(options: { onSupplement?: (supplement: Supplement) => void } = {}) {
  const [state, dispatch] = useReducer(loaderReducer, initialLoaderState);
  const active = useRef<AbortController | null>(null);
  const last = useRef<{ spec: RunSpec; idempotencyKey: string } | null>(null);
  const router = useRouter();
  const onSupplement = useRef(options.onSupplement);
  useEffect(() => {
    onSupplement.current = options.onSupplement;
  });

  const start = useCallback(
    async (spec: RunSpec, idempotencyKey: string) => {
      if (active.current) return;
      const controller = new AbortController();
      active.current = controller;
      last.current = { spec, idempotencyKey };
      dispatch({ type: "start", topic: spec.label, kind: spec.kind });
      const end = await streamGeneration({
        body: spec.body,
        idempotencyKey,
        signal: controller.signal,
        onEvent: (event) => dispatch({ type: "event", event }),
      });
      active.current = null;
      dispatch({ type: "end", end });
      if (end.kind !== "terminal" || end.event.type !== "completed") return;
      if (end.event.supplement) {
        onSupplement.current?.(end.event.supplement);
        return;
      }
      // Navigate only after the server confirmed the save...
      if (end.event.persisted) {
        router.push(end.event.url);
        return;
      }
      // ...or once the explanation itself has arrived: save it in this browser and open it.
      // If storage is full or blocked it still opens for this visit, marked as not saved.
      if (end.event.concept) {
        saveExplanation({ topic: spec.label, concept: end.event.concept, createdAt: new Date().toISOString(), attempts: end.event.attempts });
        router.push(end.event.url);
      }
    },
    [router],
  );

  const cancel = useCallback(() => active.current?.abort(), []);
  const retry = useCallback(() => {
    if (last.current) void start(last.current.spec, last.current.idempotencyKey);
  }, [start]);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  // Leaving the page cancels the request; the server stops when the connection closes.
  useEffect(() => () => active.current?.abort(), []);

  return { state, start, cancel, retry, reset };
}

const STAGE_LABELS: Record<Stage, { live: string; demo: string; text?: string }> = {
  access: { live: "Check access", demo: "Check access" },
  read: { live: "Read your material", demo: "Read your material" },
  plan: { live: "Plan the explanation", demo: "Find a bundled example" },
  generate: { live: "Draft scenes", demo: "Draft scenes", text: "Write the text" },
  validate: { live: "Lay out and check the scenes", demo: "Check structure and layout", text: "Check the text" },
  evaluate: { live: "Review accuracy and fidelity", demo: "Review" },
  persist: { live: "Save to this browser", demo: "Save", text: "Keep it with this step" },
};

const DEMO_STAGES: Stage[] = ["plan", "validate"];
const LIVE_STAGES: Record<RequestKind, Stage[]> = {
  topic: ["access", "plan", "generate", "validate", "evaluate", "persist"],
  source: ["access", "read", "plan", "generate", "validate", "evaluate", "persist"],
  example: ["access", "plan", "generate", "validate", "evaluate", "persist"],
  text: ["access", "generate", "validate", "evaluate", "persist"],
};

export function GenerationLoader({
  state,
  onCancel,
  onRetry,
  onEditTopic,
  onSuggestion,
  editLabel = "Edit request",
  compact = false,
}: {
  state: LoaderState;
  onCancel: () => void;
  onRetry: () => void;
  onEditTopic: () => void;
  /** Submit one of the alternatives offered for an unsupported or ambiguous request. */
  onSuggestion?: (suggestion: string) => void;
  editLabel?: string;
  /** Smaller, for the player's drawer. */
  compact?: boolean;
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

  const stages = state.mode === "demo" ? DEMO_STAGES : LIVE_STAGES[state.kind];
  const labelOf = (stage: Stage) => {
    const labels = STAGE_LABELS[stage];
    return state.mode === "demo" ? labels.demo : state.kind === "text" && labels.text ? labels.text : labels.live;
  };
  const currentAttempt = state.attempts.at(-1)?.attempt ?? 0;
  const rejected = state.attempts.filter((a) => a.outcome === "rejected");

  return (
    <section
      aria-labelledby="generation-heading"
      className={compact ? "rounded-xl border border-line bg-paper-raised p-4" : "rounded-2xl border border-line bg-paper-raised p-5 shadow-[0_12px_32px_-22px_rgba(30,25,15,0.35)] sm:p-6"}
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
            <StageRow key={stage} label={labelOf(stage)} {...state.stages[stage]} />
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
          {state.error.suggestions?.length && onSuggestion ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink-soft">Try instead:</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {state.error.suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => onSuggestion(suggestion)}
                      className="rounded-full border border-line-strong bg-paper-raised px-3 py-1 text-sm text-ink-soft hover:border-ink-faint hover:text-ink"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
              {editLabel}
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "cancelled" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <p>
            Cancelled. The server stops when the connection closes.
          </p>
          <button type="button" onClick={onRetry} className="rounded-full bg-ink px-4 py-2 font-semibold text-paper hover:bg-ink/85">
            Start again
          </button>
        </div>
      ) : null}

      {state.status === "completed" && state.completed ? (
        state.completed.supplement ? (
          <p className="mt-5 text-sm font-medium text-success" role="status">
            {state.completed.supplement.kind === "example" ? "The example is ready below." : "Done. The text is below."}
          </p>
        ) : state.completed.persisted ? (
          <p className="mt-5 flex items-center gap-2 text-sm font-medium text-success" role="status">
            <Spinner /> Saved. Opening your explanation…
          </p>
        ) : !state.completed.demo ? (
          <p className="mt-5 flex items-center gap-2 text-sm font-medium text-success" role="status">
            <Spinner /> Saved in this browser. Opening your explanation…
          </p>
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

const RUNNING_HEADING: Record<RequestKind, string> = {
  topic: "Building your explanation",
  source: "Visualizing your material",
  example: "Making another example",
  text: "Writing about this step",
};

function headingFor(state: LoaderState): string {
  switch (state.status) {
    case "connecting":
    case "running":
      return state.mode === "demo" ? "Opening a demo explanation" : RUNNING_HEADING[state.kind];
    case "completed":
      if (state.completed?.supplement) return state.completed.supplement.kind === "example" ? "Example ready" : "Text ready";
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
    if (state.completed?.supplement) return state.completed.supplement.kind === "example" ? "The example is ready." : "The text is ready.";
    if (state.completed?.persisted) return "Saved. Opening your explanation.";
    return state.completed?.demo ? "Demo explanation ready." : "Saved in this browser. Opening your explanation.";
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
