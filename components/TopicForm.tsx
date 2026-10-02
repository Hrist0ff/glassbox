"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { LIMITS } from "@/lib/concept/constants";
import { normalizeTopic } from "@/lib/generation/topic";
import { GenerationLoader, useGenerationRun } from "./GenerationLoader";

export type GenerationAvailability =
  | { mode: "live"; perHourLimit: number }
  | { mode: "demo"; demoTopics: string[] }
  | { mode: "misconfigured" };

const LIVE_SUGGESTIONS = [
  "Raft leader election",
  "TCP three-way handshake",
  "Consistent hashing",
  "OAuth 2.0 authorization code flow",
  "Two-phase commit",
  "Bloom filters",
];

export function TopicForm({ availability }: { availability: GenerationAvailability }) {
  const { state, start, cancel, retry, reset } = useGenerationRun();
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { input: useId(), hint: useId(), error: useId() };

  const running = state.status === "connecting" || state.status === "running";
  const navigating = state.status === "completed" && state.completed?.persisted === true;
  const disabled = availability.mode === "misconfigured";
  const suggestions = availability.mode === "demo" ? availability.demoTopics : LIVE_SUGGESTIONS;

  function submit(value: string) {
    if (running || navigating || disabled) return;
    const result = normalizeTopic(value);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setTopic(result.topic);
    // A fresh idempotency key per submission; Retry reuses it.
    void start(result.topic, newIdempotencyKey());
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(topic);
  }

  function editTopic() {
    reset();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div>
      <form onSubmit={onSubmit} noValidate aria-describedby={ids.hint}>
        <label htmlFor={ids.input} className="block text-base font-semibold text-ink sm:text-lg">
          What complex concept should we visualize today?
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id={ids.input}
            name="topic"
            type="text"
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              if (error) setError(null);
            }}
            maxLength={LIMITS.topic.max}
            placeholder="e.g. Raft leader election"
            autoComplete="off"
            disabled={disabled}
            readOnly={running || navigating}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.error : undefined}
            className="h-13 w-full min-w-0 shrink-0 rounded-full sm:w-auto sm:flex-1 border border-line-strong bg-paper-raised px-5 text-base text-ink shadow-inner shadow-black/[0.02] placeholder:text-ink-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30 disabled:cursor-not-allowed disabled:opacity-60 read-only:opacity-80"
          />
          <button
            type="submit"
            disabled={disabled || running || navigating}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-ink px-7 text-base font-semibold text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Working…" : availability.mode === "demo" ? "Open demo" : "Visualize"}
          </button>
        </div>
        {error ? (
          <p id={ids.error} className="mt-2 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <AvailabilityNote availability={availability} id={ids.hint} />
      </form>

      {state.status === "idle" ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
            {availability.mode === "demo" ? "Available in demo mode" : "Try one of these"}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setTopic(suggestion);
                    submit(suggestion);
                  }}
                  className="rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-6">
          <GenerationLoader
            state={state}
            onCancel={cancel}
            onRetry={retry}
            onEditTopic={editTopic}
          />
        </div>
      )}
    </div>
  );
}

/** RFC 4122 v4 UUID; `crypto.randomUUID` only exists in secure contexts (not plain-http LAN hosts). */
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function AvailabilityNote({ availability, id }: { availability: GenerationAvailability; id: string }) {
  const className = "mt-3 text-sm text-ink-muted";
  switch (availability.mode) {
    case "demo":
      return (
        <p id={id} className={className}>
          <span className="mr-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Local demo mode</span>
          No AI calls are made. Topics are matched to the bundled explanations below.
        </p>
      );
    case "misconfigured":
      return (
        <p id={id} className={className}>
          Generation isn&apos;t configured on this server yet. You can still browse the explanations below.
        </p>
      );
    case "live":
      return (
        <p id={id} className={className}>
          Up to {availability.perHourLimit} generations per hour.{" "}
          Explanations are checked automatically, labeled as AI-generated, and saved in this browser.
        </p>
      );
  }
}
