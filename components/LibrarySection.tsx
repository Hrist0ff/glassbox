"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { deleteExplanation, parseLibrary, readLibraryRaw, subscribeLibrary } from "@/lib/library";
import { ConceptCard } from "./ConceptCard";
import { SectionHeading } from "./SectionHeading";
import { StepThumbnail } from "./StepThumbnail";

/** Explanations generated in this browser, from its localStorage library. */
export function LibrarySection() {
  // `undefined` on the server and during hydration: storage is only readable in the browser.
  const raw = useSyncExternalStore(subscribeLibrary, readLibraryRaw, () => undefined);
  const items = useMemo(() => (raw === undefined ? undefined : parseLibrary(raw)), [raw]);

  return (
    <section aria-labelledby="gallery-library">
      <SectionHeading
        id="gallery-library"
        title="Your library"
        subtitle="Explanations you generate are saved here, in this browser only. Links to them work only in this browser."
      />
      {items === undefined ? (
        <div aria-hidden className="mt-5 h-24 rounded-xl bg-paper-sunk/60" />
      ) : items.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          Nothing here yet. Enter a topic above and the finished explanation will be saved here.
        </p>
      ) : (
        <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ concept, topic }) => {
            const preview = concept.steps[Math.min(3, concept.steps.length - 1)];
            return (
              <ConceptCard
                key={concept.id}
                card={{
                  href: `/concept/${concept.id}`,
                  title: concept.title,
                  description: concept.description,
                  length: `${concept.steps.length} steps · from “${topic}”`,
                  origin: "ai_generated",
                  thumbnail: preview ? <StepThumbnail step={preview} /> : undefined,
                }}
                action={<DeleteButton id={concept.id} title={concept.title} />}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Two clicks to delete, so a stray click never loses a saved explanation. */
function DeleteButton({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const base = "rounded-full border px-3 py-1 text-xs font-semibold shadow-sm";
  return confirming ? (
    <span className="flex gap-1.5">
      <button type="button" onClick={() => deleteExplanation(id)} className={`${base} border-danger bg-danger text-white hover:bg-danger/85`}>
        Delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={`${base} border-line-strong bg-paper-raised text-ink-soft hover:bg-paper-sunk`}>
        Keep
      </button>
    </span>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Delete “${title}” from this browser`}
      className={`${base} border-line-strong bg-paper-raised/95 text-ink-soft hover:bg-paper-sunk hover:text-ink`}
    >
      Delete
    </button>
  );
}
