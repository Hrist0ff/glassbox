"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { describeChanges, describeEdge, describeNode, entityNumbers, type SceneChange } from "@/lib/concept/describe";
import { INACTIVE_PAINT, PALETTE } from "@/lib/concept/palette";
import type { ColorToken, Concept, Step } from "@/lib/concept/schema";
import { SceneArena } from "./player/SceneArena";

export type InteractivePlayerProps = {
  /** Must already be validated (see `validateConcept` / `parseStoredConcept`). */
  concept: Concept;
  initialStep?: number;
  headingLevel?: 1 | 2;
  /** Rendered under the title, e.g. provenance badges. */
  meta?: ReactNode;
  /**
   * Listen for ←/→ anywhere on the page. Enable for the page's main player
   * only; otherwise the keys work while focus is inside the player.
   */
  pageKeyboardShortcuts?: boolean;
  onStepChange?: (index: number) => void;
};

export function InteractivePlayer(props: InteractivePlayerProps) {
  // Key by concept id so a different concept always starts with fresh state.
  return (
    <MotionConfig reducedMotion="user">
      <Player key={props.concept.id} {...props} />
    </MotionConfig>
  );
}

const clampIndex = (value: number, count: number) => Math.min(Math.max(Math.trunc(value) || 0, 0), count - 1);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.closest('[role="textbox"],[role="combobox"],[role="slider"],[role="listbox"],[role="menu"]') !== null;
}

function Player({
  concept,
  initialStep = 0,
  headingLevel = 2,
  meta,
  pageKeyboardShortcuts = false,
  onStepChange,
}: InteractivePlayerProps) {
  const count = concept.steps.length;
  const [index, setIndex] = useState(() => clampIndex(initialStep, count));
  const [notesOpen, setNotesOpen] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    title: `${uid}-title`,
    sceneText: `${uid}-scene-text`,
  };

  const step = concept.steps[index]!;
  const previous = index > 0 ? concept.steps[index - 1] : undefined;
  const changes = useMemo(() => describeChanges(previous, step), [previous, step]);
  const numbers = useMemo(() => entityNumbers(concept), [concept]);
  const atStart = index === 0;
  const atEnd = index === count - 1;

  // Functional updates: rapid clicks or key repeats each apply to the latest
  // index, never to a stale closure.
  const go = useCallback((delta: number) => setIndex((i) => clampIndex(i + delta, count)), [count]);
  const goTo = useCallback((target: number) => setIndex(clampIndex(target, count)), [count]);

  useEffect(() => {
    onStepChange?.(index);
  }, [index, onStepChange]);

  const handleKey = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    },
    [go],
  );

  useEffect(() => {
    if (!pageKeyboardShortcuts) return;
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pageKeyboardShortcuts, handleKey]);

  const Heading = headingLevel === 1 ? "h1" : "h2";
  const usedColors = useMemo(() => colorsUsed(concept), [concept]);
  const textTransition = reducedMotion ? { duration: 0 } : { duration: 0.25 };

  return (
    <section
      aria-labelledby={ids.title}
      aria-roledescription="interactive explanation"
      className="@container"
      onKeyDown={pageKeyboardShortcuts ? undefined : handleKey}
      data-testid="interactive-player"
    >
      <header className="mb-6 max-w-3xl">
        <Heading id={ids.title} className="font-display text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
          {concept.title}
        </Heading>
        <p className="mt-3 text-base leading-relaxed text-ink-soft sm:text-lg">{concept.description}</p>
        {meta ? <div className="mt-4">{meta}</div> : null}
      </header>

      <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start">
        <div className="arena-frame overflow-hidden rounded-2xl border border-line shadow-[0_1px_0_rgba(0,0,0,0.03),0_12px_32px_-18px_rgba(30,25,15,0.25)]">
          <SceneArena
            concept={concept}
            stepIndex={index}
            reducedMotion={reducedMotion}
            numbers={numbers}
            idPrefix={uid}
            label={`Diagram for step ${index + 1} of ${count}`}
            describedBy={ids.sceneText}
          />
          <Legend colors={usedColors} />
        </div>

        <div className="flex min-w-0 flex-col gap-5 @5xl:sticky @5xl:top-6">
          <StepProgress index={index} count={count} onSelect={goTo} />

          <div className="min-h-[5.5rem]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={step.id}
                initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 0 }}
                transition={textTransition}
                className="font-display text-2xl leading-snug text-ink"
                data-testid="step-text"
              >
                {step.text}
              </motion.p>
            </AnimatePresence>
          </div>

          <Controls
            atStart={atStart}
            atEnd={atEnd}
            onPrevious={() => go(-1)}
            onNext={() => go(1)}
            onRestart={() => goTo(0)}
          />

          <WhatChanged key={step.id} changes={changes} />

          {step.notes ? (
            <div className="rounded-xl border border-line bg-paper-raised">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                aria-expanded={notesOpen}
                aria-controls={`${uid}-notes`}
                onClick={() => setNotesOpen((open) => !open)}
              >
                <span>More detail on this step</span>
                <span aria-hidden className={`text-ink-muted transition-transform ${notesOpen ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </button>
              <div id={`${uid}-notes`} hidden={!notesOpen} className="px-4 pb-4 text-[0.95rem] leading-relaxed text-ink-soft">
                {step.notes}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <SceneKey step={step} numbers={numbers} />

      <details className="group mt-6 rounded-xl border border-line bg-paper-raised @max-xl:hidden">
        <summary className="cursor-pointer list-none rounded-xl px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <span className="mr-2 inline-block text-ink-muted transition-transform group-open:rotate-90" aria-hidden>
            ▸
          </span>
          Text description of this scene
        </summary>
        <div className="px-4 pb-4">
          <SceneDescription step={step} />
        </div>
      </details>

      <p id={ids.sceneText} className="sr-only">
        {sceneSentence(step)}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Step ${index + 1} of ${count}. ${step.text}`}
      </p>
    </section>
  );
}

function StepProgress({ index, count, onSelect }: { index: number; count: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center gap-4">
      <p className="shrink-0 text-sm font-semibold tabular-nums text-ink" data-testid="step-counter">
        Step {index + 1} of {count}
      </p>
      {/* Jump shortcuts. Out of the tab order: keyboard users step with ←/→ or the buttons below. */}
      <div role="group" aria-label="Jump to step" className="flex h-2 flex-1 gap-1">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={`Go to step ${i + 1}`}
            aria-current={i === index ? "step" : undefined}
            onClick={() => onSelect(i)}
            className={`h-full flex-1 cursor-pointer rounded-full transition-colors ${
              i < index ? "bg-accent/55" : i === index ? "bg-accent" : "bg-line hover:bg-ink-faint"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Controls({
  atStart,
  atEnd,
  onPrevious,
  onNext,
  onRestart,
}: {
  atStart: boolean;
  atEnd: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRestart: () => void;
}) {
  // aria-disabled (not `disabled`) keeps focus on the button at a boundary.
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          className={`${base} flex-1 border border-line-strong bg-paper-raised text-ink hover:bg-paper-sunk aria-disabled:hover:bg-paper-raised`}
          aria-disabled={atStart}
          aria-label="Previous step"
          onClick={() => !atStart && onPrevious()}
        >
          <span aria-hidden>←</span> Previous
        </button>
        <button
          type="button"
          className={`${base} flex-1 bg-ink text-paper hover:bg-ink/85 aria-disabled:hover:bg-ink`}
          aria-disabled={atEnd}
          aria-label="Next step"
          onClick={() => !atEnd && onNext()}
        >
          Next <span aria-hidden>→</span>
        </button>
      </div>
      <button
        type="button"
        className={`${base} text-ink-soft hover:bg-paper-sunk aria-disabled:hover:bg-transparent ${atEnd ? "border border-accent text-accent" : ""}`}
        aria-disabled={atStart}
        aria-label="Restart from the first step"
        onClick={() => !atStart && onRestart()}
      >
        <span aria-hidden>↺</span> Restart
      </button>
      <p className="text-center text-xs text-ink-muted @max-3xl:hidden">
        {atEnd ? (
          <span className="font-medium text-ink-soft">End of the explanation.</span>
        ) : (
          <>
            Tip: use <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> to step through
          </>
        )}
      </p>
    </div>
  );
}

const CHANGE_ICON: Record<SceneChange["kind"], { glyph: string; label: string; className: string }> = {
  added: { glyph: "+", label: "Added", className: "bg-success-soft text-success" },
  removed: { glyph: "−", label: "Removed", className: "bg-danger-soft text-danger" },
  changed: { glyph: "~", label: "Changed", className: "bg-warning-soft text-warning" },
  message: { glyph: "→", label: "Message", className: "bg-accent-soft text-accent" },
};

function WhatChanged({ changes }: { changes: SceneChange[] }) {
  const [expanded, setExpanded] = useState(false);
  if (changes.length === 0) return null;
  const limit = 4;
  const visible = expanded ? changes : changes.slice(0, limit);
  const hidden = changes.length - visible.length;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">What changed</h3>
      <ul className="mt-2 space-y-1.5" data-testid="what-changed">
        {visible.map((change, i) => {
          const icon = CHANGE_ICON[change.kind];
          return (
            <li key={i} className="flex items-start gap-2 text-sm leading-snug text-ink-soft">
              <span
                className={`mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${icon.className}`}
                aria-hidden
              >
                {icon.glyph}
              </span>
              <span className="sr-only">{icon.label}: </span>
              <span className="min-w-0">{change.text}</span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 rounded text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Show {hidden} more
        </button>
      ) : null}
    </div>
  );
}

function SceneDescription({ step }: { step: Step }) {
  return (
    <div className="grid gap-4 text-sm leading-relaxed text-ink-soft sm:grid-cols-2">
      <div>
        <h4 className="font-semibold text-ink">Entities</h4>
        <ul className="mt-1 list-disc pl-5">
          {step.nodes.map((node) => (
            <li key={node.id}>{describeNode(node)}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="font-semibold text-ink">Connections</h4>
        {step.edges.length === 0 ? (
          <p className="mt-1">None in this step.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {step.edges.map((edge) => (
              <li key={edge.id}>{describeEdge(edge, step)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Visible on narrow players, where the arena shows numbers instead of labels. */
function SceneKey({ step, numbers }: { step: Step; numbers: ReadonlyMap<string, number> }) {
  return (
    <div className="mt-6 hidden rounded-xl border border-line bg-paper-raised p-4 @max-xl:block">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Scene key</h3>
      <ol className="mt-2 space-y-1.5 text-sm text-ink">
        {[...step.nodes]
          .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0))
          .map((node) => {
            const paint = node.status === "active" ? PALETTE[node.color] : INACTIVE_PAINT;
            return (
              <li key={node.id} className="flex items-center gap-2">
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold"
                  style={{ borderColor: paint.stroke, color: paint.stroke, background: paint.fill, borderStyle: node.status === "active" ? "solid" : "dashed" }}
                  aria-hidden
                >
                  {numbers.get(node.id)}
                </span>
                <span>
                  {node.label}
                  {node.status === "inactive" ? <span className="text-ink-muted"> (inactive)</span> : null}
                </span>
              </li>
            );
          })}
      </ol>
      {step.edges.length > 0 ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Connections</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {step.edges.map((edge) => (
              <li key={edge.id}>{describeEdge(edge, step)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Legend({ colors }: { colors: ColorToken[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-paper-raised/70 px-4 py-2.5 text-xs text-ink-soft">
      <span className="inline-flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#57534E" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2" fill="#57534E" />
        </svg>
        active
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#8A857D" strokeWidth="1.5" strokeDasharray="3 2.5" />
        </svg>
        inactive
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
          <path d="M1 6 H20" stroke="var(--edge-live)" strokeWidth="2" />
          <path d="M18 2 L25 6 L18 10 z" fill="var(--edge-live)" />
          <circle cx="10" cy="6" r="3.5" fill="var(--pulse)" />
        </svg>
        message in transit
      </span>
      {colors.map((token) => (
        <span key={token} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full border-2"
            style={{ background: PALETTE[token].fill, borderColor: PALETTE[token].stroke }}
            aria-hidden
          />
          {PALETTE[token].word}
        </span>
      ))}
    </div>
  );
}

function colorsUsed(concept: Concept): ColorToken[] {
  const used = new Set<ColorToken>();
  for (const step of concept.steps) for (const node of step.nodes) if (node.status === "active") used.add(node.color);
  return (Object.keys(PALETTE) as ColorToken[]).filter((token) => used.has(token) && token !== "neutral");
}

function sceneSentence(step: Step): string {
  const nodes = step.nodes.map(describeNode).join("; ");
  const edges = step.edges.length ? ` Connections: ${step.edges.map((e) => describeEdge(e, step)).join("; ")}.` : "";
  return `The diagram shows ${nodes}.${edges}`;
}
