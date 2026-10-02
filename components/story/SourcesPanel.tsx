"use client";

import { normalizeForMatch } from "@/lib/sources/passages";
import type { Claim, Concept, Provenance } from "@/lib/concept/schema";

/**
 * "Sources and assumptions": what the current step rests on, and what the
 * whole explanation covers, leaves out, and assumes. Everything here is
 * stored data shown as plain text.
 */

const BASIS: Record<Claim["basis"], { label: string; className: string }> = {
  source: { label: "Stated in the material", className: "bg-[#e3f1e6] text-[#1d5e2c]" },
  interpretation: { label: "Interpretation", className: "bg-[#fdf0d9] text-[#7a4a06]" },
  assumption: { label: "Assumption", className: "bg-[#ece6f5] text-[#523075]" },
};

const DEPTH_TEXT = { overview: "Overview", standard: "Standard", detailed: "Detailed" } as const;

export function SourcesPanel({ concept, step, origin }: { concept: Concept; step: string | null; origin: "generated" | "bundled" | "eval" }) {
  const provenance = concept.provenance;
  const current = step ? concept.steps.find((s) => s.id === step) : undefined;
  const stepNumber = current ? concept.steps.indexOf(current) + 1 : null;

  return (
    <div className="space-y-6 text-[14px] leading-relaxed text-[#333]">
      <section aria-labelledby="sources-step">
        <h3 id="sources-step" className="text-[15px] font-semibold">
          {stepNumber ? `Step ${stepNumber} of ${concept.steps.length}` : "This step"}
        </h3>
        {current ? (
          <StepEvidence claimIds={current.claims ?? []} provenance={provenance} />
        ) : (
          <p className="mt-1 text-[#666]">Move to a step of the explanation to see what it rests on.</p>
        )}
      </section>

      <section aria-labelledby="sources-whole" className="border-t border-[#e5e5e5] pt-5">
        <h3 id="sources-whole" className="text-[15px] font-semibold">
          The whole explanation
        </h3>
        <SourcesLine provenance={provenance} origin={origin} />
        {provenance ? <Overview provenance={provenance} /> : null}
      </section>
    </div>
  );
}

function SourcesLine({ provenance, origin }: { provenance: Provenance | undefined; origin: "generated" | "bundled" | "eval" }) {
  if (provenance?.sourcesConsulted) {
    const source = provenance.sources[0];
    return (
      <p className="mt-1">
        Made from material you supplied{source ? `: “${source.title}”, split into ${source.passages.length} passages` : ""}. Claims marked
        “Stated in the material” have an excerpt that was checked to appear in the cited passage. The AI did not check the material against
        any other source.
      </p>
    );
  }
  if (origin === "bundled") {
    return <p className="mt-1">A hand-written example bundled with the app. No sources are attached to it.</p>;
  }
  if (!provenance) {
    return <p className="mt-1">This explanation was made before sources and assumptions were recorded, so none are available.</p>;
  }
  return (
    <p className="mt-1">
      No sources were consulted. This explanation comes from the AI model&apos;s general knowledge, so verify anything important.
    </p>
  );
}

function StepEvidence({ claimIds, provenance }: { claimIds: string[]; provenance: Provenance | undefined }) {
  const claims = claimIds.flatMap((id) => provenance?.claims.find((c) => c.id === id) ?? []);
  if (claims.length === 0) {
    return (
      <p className="mt-1 text-[#666]">
        {provenance?.sourcesConsulted
          ? "This step does not cite a specific claim from the material."
          : "This step cites no specific claim or assumption."}
      </p>
    );
  }
  const passages = new Map((provenance?.sources ?? []).flatMap((s) => s.passages.map((p) => [p.id, p.text] as const)));
  return (
    <ul className="mt-2 space-y-3">
      {claims.map((claim) => (
        <li key={claim.id} className="rounded-[6px] border border-[#e2e2e2] bg-[#fbfbfb] p-3">
          <span className={`inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${BASIS[claim.basis].className}`}>
            {BASIS[claim.basis].label}
          </span>
          <p className="mt-1.5">{claim.text}</p>
          {claim.passages.map((id) => {
            const text = passages.get(id);
            if (!text) return null;
            return (
              <blockquote key={id} className="mt-2 border-l-[3px] border-[#ccc] pl-3 text-[13px] text-[#555]">
                <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-[#666]">Passage {id.replace(/^p/, "")}</span>
                <Highlighted text={text} quote={claim.basis === "source" ? claim.quote : ""} />
              </blockquote>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

/** The passage with the cited excerpt marked, when it can be found by a plain search. */
function Highlighted({ text, quote }: { text: string; quote: string }) {
  const range = quote ? findLoosely(text, quote) : null;
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="bg-[#fff1a8] text-inherit">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

/** Character range of `quote` in `text`, ignoring case, spacing, and quote styles; null when not found contiguously. */
function findLoosely(text: string, quote: string): [number, number] | null {
  // Map each normalized character back to its index in the original text.
  const map: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    const piece = normalizeForMatch(text[i]!) || (/\s/.test(text[i]!) ? " " : "");
    if (piece === " " && normalized.endsWith(" ")) continue;
    for (const ch of piece) {
      normalized += ch;
      map.push(i);
    }
  }
  const needle = normalizeForMatch(quote);
  const at = normalized.indexOf(needle);
  if (at === -1 || needle.length === 0) return null;
  return [map[at]!, map[at + needle.length - 1]! + 1];
}

function Overview({ provenance }: { provenance: Provenance }) {
  const assumptions = provenance.claims.filter((c) => c.basis === "assumption");
  const request = provenance.request;
  return (
    <dl className="mt-3 space-y-3">
      <Item term="Goal">{provenance.learningGoal}</Item>
      <Item term="Covers">{provenance.scope}</Item>
      <List term="Left out" items={provenance.omissions} />
      <List term="Simplified" items={provenance.simplifications} />
      <List term="Assumed" items={assumptions.map((a) => a.text)} />
      <List term="Uncertain" items={provenance.uncertainty} />
      <List term="Limits of the material" items={provenance.limitations} emphasis />
      <Item term="Made for">
        {[request.audience || "a general audience", request.language, `${DEPTH_TEXT[request.depth]} depth`].filter(Boolean).join(" · ")}
      </Item>
    </dl>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-[#666]">{term}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function List({ term, items, emphasis = false }: { term: string; items: string[]; emphasis?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <dt className={`text-[12px] font-semibold uppercase tracking-wide ${emphasis ? "text-[#a3460b]" : "text-[#666]"}`}>{term}</dt>
      <dd className="m-0">
        <ul className="list-disc space-y-0.5 pl-5">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
