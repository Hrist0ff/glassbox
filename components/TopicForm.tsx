"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { DEPTHS, LANGUAGES, LIMITS, type Depth } from "@/lib/concept/constants";
import { normalizeSourceText } from "@/lib/sources/passages";
import { normalizeTopic } from "@/lib/generation/topic";
import { GenerationLoader, useGenerationRun } from "./GenerationLoader";

export type GenerationAvailability =
  | { mode: "live"; perHourLimit: number }
  | { mode: "demo"; demoTopics: string[] }
  | { mode: "misconfigured" };

/** Technical and nontechnical requests that exercise each kind of view. */
const LIVE_SUGGESTIONS = [
  "Raft leader election",
  "TCP three-way handshake",
  "Key events of the Apollo 11 mission",
  "Mitosis vs meiosis",
  "How vertebrates are classified",
  "How a mortgage balance falls over time",
  "How a bill becomes law in the U.S.",
  "Bloom filters",
];

/** Sample material for "Visualize my information": a short report with a contradiction and a gap. */
const SAMPLE_MATERIAL = {
  title: "Warehouse move: status notes",
  text: `Status notes, warehouse move (week 14)

Planning started on March 3 when the lease for the old warehouse at Pier 9 was not renewed. The team chose a new site in Riverside on March 10.

Packing began on March 17. Two crews worked in parallel: the north crew packed shelving and racks, and the south crew packed customer orders. The south crew finished on March 24; the north crew finished on March 26.

Trucks moved the stock on March 27 and 28. One truck broke down on March 28, which delayed about 40 pallets by a day.

The new warehouse opened for orders on March 31. Another note from the operations manager says it opened on April 1.

Order processing was slower in the first week because the shelf labels were not ready. The notes do not say when the labels were finished.`,
};

const AUDIENCES = [
  { value: "", label: "Anyone curious" },
  { value: "Children aged 10–12", label: "Children (10–12)" },
  { value: "High-school students", label: "High-school students" },
  { value: "University students", label: "University students" },
  { value: "Professionals in the field", label: "Professionals in the field" },
];

const DEPTH_LABEL: Record<Depth, string> = { overview: "Overview", standard: "Standard", detailed: "Detailed" };

type Path = "topic" | "material";

export function TopicForm({ availability }: { availability: GenerationAvailability }) {
  const { state, start, cancel, retry, reset } = useGenerationRun();
  const [path, setPath] = useState<Path>("topic");
  const [topic, setTopic] = useState("");
  const [material, setMaterial] = useState("");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [preferences, setPreferences] = useState({ audience: "", language: "", depth: "standard" as Depth });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const materialRef = useRef<HTMLTextAreaElement>(null);
  const tabRefs = useRef<Record<Path, HTMLButtonElement | null>>({ topic: null, material: null });
  const ids = {
    input: useId(),
    hint: useId(),
    error: useId(),
    material: useId(),
    title: useId(),
    question: useId(),
    count: useId(),
    tabTopic: useId(),
    tabMaterial: useId(),
    panel: useId(),
  };

  const live = availability.mode === "live";
  const running = state.status === "connecting" || state.status === "running";
  const navigating = state.status === "completed" && state.completed?.persisted === true;
  const disabled = availability.mode === "misconfigured";
  const suggestions = availability.mode === "demo" ? availability.demoTopics : LIVE_SUGGESTIONS;
  const busy = running || navigating || disabled;
  const prefs = live ? { preferences } : {};

  function submitTopic(value: string) {
    if (busy) return;
    const result = normalizeTopic(value);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setTopic(result.topic);
    setPath("topic");
    // A fresh idempotency key per submission; Retry reuses it.
    void start({ body: { topic: result.topic, ...prefs }, label: result.topic, kind: "topic" }, newIdempotencyKey());
  }

  function submitMaterial() {
    if (busy) return;
    const checked = normalizeSourceText(material);
    if (!checked.ok) {
      setError(checked.message);
      materialRef.current?.focus();
      return;
    }
    setError(null);
    const label = title.trim() || "Pasted text";
    void start(
      { body: { kind: "source", text: checked.text, title: title.trim(), question: question.trim(), preferences }, label, kind: "source" },
      newIdempotencyKey(),
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (path === "topic") submitTopic(topic);
    else submitMaterial();
  }

  function edit() {
    reset();
    requestAnimationFrame(() => (path === "topic" ? inputRef.current : materialRef.current)?.focus());
  }

  function choosePath(next: Path, focus = false) {
    setPath(next);
    setError(null);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  // Arrow keys move between the two tabs, as in a standard tab list.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      choosePath(path === "topic" ? "material" : "topic", true);
    }
  }

  const count = material.length;

  return (
    <div>
      {live ? (
        <div role="tablist" aria-label="What to visualize" className="inline-flex rounded-full border border-line bg-paper-sunk/70 p-1">
          {(
            [
              ["topic", "Explain a topic", ids.tabTopic],
              ["material", "Visualize my information", ids.tabMaterial],
            ] as const
          ).map(([value, label, id]) => (
            <button
              key={value}
              ref={(el) => {
                tabRefs.current[value] = el;
              }}
              id={id}
              type="button"
              role="tab"
              aria-selected={path === value}
              aria-controls={ids.panel}
              tabIndex={path === value ? 0 : -1}
              disabled={running || navigating}
              onClick={() => choosePath(value)}
              onKeyDown={onTabKey}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                path === value ? "bg-paper-raised text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <form
        id={ids.panel}
        role={live ? "tabpanel" : undefined}
        aria-labelledby={live ? (path === "topic" ? ids.tabTopic : ids.tabMaterial) : undefined}
        onSubmit={onSubmit}
        noValidate
        aria-describedby={ids.hint}
        className={live ? "mt-4" : undefined}
      >
        {path === "topic" ? (
          <>
            <label htmlFor={ids.input} className="block text-base font-semibold text-ink sm:text-lg">
              What should we visualize today?
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
                placeholder="e.g. Raft leader election, or the Apollo 11 mission"
                autoComplete="off"
                disabled={disabled}
                readOnly={running || navigating}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? ids.error : undefined}
                className="h-13 w-full min-w-0 shrink-0 rounded-full border border-line-strong bg-paper-raised px-5 text-base text-ink shadow-inner shadow-black/[0.02] placeholder:text-ink-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30 disabled:cursor-not-allowed disabled:opacity-60 read-only:opacity-80 sm:w-auto sm:flex-1"
              />
              <SubmitButton busy={running} disabled={disabled || running || navigating} label={availability.mode === "demo" ? "Open demo" : "Visualize"} />
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={ids.material} className="block text-base font-semibold text-ink sm:text-lg">
                  Paste the material to visualize
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMaterial(SAMPLE_MATERIAL.text);
                    setTitle(SAMPLE_MATERIAL.title);
                    setQuestion("");
                    setError(null);
                  }}
                  disabled={running || navigating}
                  className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  Use a sample
                </button>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Notes, a report, an article excerpt, or a list of events. It is used only to make this explanation and is saved with it in
                this browser.
              </p>
              <textarea
                ref={materialRef}
                id={ids.material}
                name="material"
                value={material}
                onChange={(event) => {
                  setMaterial(event.target.value);
                  if (error) setError(null);
                }}
                maxLength={LIMITS.sourceText.max}
                rows={8}
                readOnly={running || navigating}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${ids.count}${error ? ` ${ids.error}` : ""}`}
                className="mt-2 block w-full resize-y rounded-2xl border border-line-strong bg-paper-raised px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30 read-only:opacity-80"
                placeholder="Paste text here…"
              />
              <p id={ids.count} className="mt-1 text-right text-xs tabular-nums text-ink-muted">
                {count.toLocaleString("en")} / {LIMITS.sourceText.max.toLocaleString("en")} characters
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={ids.title} className="block text-sm font-semibold text-ink">
                  Title <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <input
                  id={ids.title}
                  type="text"
                  value={title}
                  maxLength={LIMITS.title.max}
                  onChange={(event) => setTitle(event.target.value)}
                  readOnly={running || navigating}
                  className="mt-1 h-11 w-full rounded-xl border border-line-strong bg-paper-raised px-3 text-[15px] text-ink focus:border-accent focus:outline-2 focus:outline-accent/30"
                />
              </div>
              <div>
                <label htmlFor={ids.question} className="block text-sm font-semibold text-ink">
                  Focus on <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <input
                  id={ids.question}
                  type="text"
                  value={question}
                  maxLength={LIMITS.question.max}
                  onChange={(event) => setQuestion(event.target.value)}
                  readOnly={running || navigating}
                  placeholder="e.g. what delayed the opening?"
                  className="mt-1 h-11 w-full rounded-xl border border-line-strong bg-paper-raised px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-2 focus:outline-accent/30"
                />
              </div>
            </div>
            <SubmitButton busy={running} disabled={running || navigating} label="Visualize it" />
          </div>
        )}

        {live ? <Options preferences={preferences} onChange={setPreferences} disabled={running || navigating} /> : null}

        {error ? (
          <p id={ids.error} className="mt-2 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <AvailabilityNote availability={availability} id={ids.hint} path={path} />
      </form>

      {state.status === "idle" ? (
        path === "topic" ? (
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
                    onClick={() => submitTopic(suggestion)}
                    className="rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ) : (
        <div className="mt-6">
          <GenerationLoader
            state={state}
            onCancel={cancel}
            onRetry={retry}
            onEditTopic={edit}
            onSuggestion={(suggestion) => {
              reset();
              submitTopic(suggestion);
            }}
          />
        </div>
      )}
    </div>
  );
}

function SubmitButton({ busy, disabled, label }: { busy: boolean; disabled: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-ink px-7 text-base font-semibold text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Working…" : label}
    </button>
  );
}

function Options({
  preferences,
  onChange,
  disabled,
}: {
  preferences: { audience: string; language: string; depth: Depth };
  onChange: (next: { audience: string; language: string; depth: Depth }) => void;
  disabled: boolean;
}) {
  const ids = { audience: useId(), language: useId(), depth: useId() };
  const changed = preferences.audience || preferences.language || preferences.depth !== "standard";
  const select =
    "mt-1 h-10 w-full rounded-xl border border-line-strong bg-paper-raised px-2.5 text-sm text-ink focus:border-accent focus:outline-2 focus:outline-accent/30";
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ›
        </span>
        Options{changed ? ": " : ""}
        {changed ? (
          <span className="text-ink-soft">
            {[preferences.audience, preferences.language, preferences.depth !== "standard" ? DEPTH_LABEL[preferences.depth] : ""].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={ids.audience} className="text-sm font-semibold text-ink">
            Audience
          </label>
          <select
            id={ids.audience}
            value={preferences.audience}
            disabled={disabled}
            onChange={(event) => onChange({ ...preferences, audience: event.target.value })}
            className={select}
          >
            {AUDIENCES.map((a) => (
              <option key={a.label} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.language} className="text-sm font-semibold text-ink">
            Language
          </label>
          <select
            id={ids.language}
            value={preferences.language}
            disabled={disabled}
            onChange={(event) => onChange({ ...preferences, language: event.target.value })}
            className={select}
          >
            <option value="">Same as my request</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.depth} className="text-sm font-semibold text-ink">
            Depth
          </label>
          <select
            id={ids.depth}
            value={preferences.depth}
            disabled={disabled}
            onChange={(event) => onChange({ ...preferences, depth: event.target.value as Depth })}
            className={select}
          >
            {DEPTHS.map((depth) => (
              <option key={depth} value={depth}>
                {DEPTH_LABEL[depth]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}

/** RFC 4122 v4 UUID; `crypto.randomUUID` only exists in secure contexts (not plain-http LAN hosts). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function AvailabilityNote({ availability, id, path }: { availability: GenerationAvailability; id: string; path: Path }) {
  const className = "mt-3 text-sm text-ink-muted";
  switch (availability.mode) {
    case "demo":
      return (
        <p id={id} className={className}>
          <span className="mr-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Local demo mode</span>
          No AI calls are made. Topics are matched to the bundled examples below. Visualizing your own material needs an AI model.
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
          {path === "topic"
            ? "Topic explanations come from the AI model's general knowledge; no sources are consulted."
            : "Claims are linked to the passages of your text that support them; nothing is checked against other sources."}{" "}
          Results are checked automatically, labeled as AI-generated, and saved in this browser.
        </p>
      );
  }
}
