"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { Concept, Supplement } from "@/lib/concept/schema";
import { deleteSupplement, readSupplementsSnapshot, saveSupplement, subscribeLibrary, supplementsFor, supplementsRawOf } from "@/lib/library";
import type { ExploreAction } from "@/lib/generation/request";
import { GenerationLoader, useGenerationRun } from "../GenerationLoader";
import { newIdempotencyKey } from "../TopicForm";

/**
 * "Explore this step": ask for an explanation of the current step, a simpler
 * version, or another example. Results are kept in this browser beside the
 * explanation, never mixed into it, and are listed under the step they
 * belong to. Each request goes through the same server checks, rate limit,
 * review, and cancellation as a new explanation.
 */

const ACTIONS: { action: ExploreAction; label: string; hint: string }[] = [
  { action: "explain", label: "Explain this step", hint: "What happens here, and why it matters" },
  { action: "simplify", label: "Make it simpler", hint: "The same step in plainer words" },
  { action: "example", label: "Show another example", hint: "A short new example of the same idea" },
];

const KIND_LABEL: Record<Supplement["kind"], string> = {
  explain: "Explanation of this step",
  simplify: "Simpler version",
  example: "Another example",
};

const noSnapshot = () => "";

export function ExplorePanel({
  concept,
  topic,
  step,
  examplePath,
}: {
  concept: Concept;
  /** The request the explanation was made from. */
  topic: string;
  step: string | null;
  /** Where an example supplement opens, given its id. */
  examplePath: (supplementId: string) => string;
}) {
  const snapshot = useSyncExternalStore(subscribeLibrary, readSupplementsSnapshot, noSnapshot);
  const all = useMemo(() => (snapshot ? supplementsFor(supplementsRawOf(snapshot), concept.id) : []), [snapshot, concept.id]);
  const { state, start, cancel, retry, reset } = useGenerationRun({ onSupplement: (supplement) => saveSupplement(supplement) });
  const index = step ? concept.steps.findIndex((s) => s.id === step) : -1;
  const current = index >= 0 ? concept.steps[index]! : null;
  const running = state.status === "connecting" || state.status === "running";
  const forStep = current ? all.filter((s) => s.stepId === current.id) : [];

  if (!current) {
    return <p className="text-[14px] text-[#555]">Move to a step of the explanation, then ask about it here.</p>;
  }

  function ask(action: ExploreAction) {
    if (running || !current) return;
    reset();
    void start(
      {
        body: { kind: "explore", action, stepId: current.id, topic, concept },
        label: `${ACTIONS.find((a) => a.action === action)!.label}: step ${index + 1}`,
        kind: action === "example" ? "example" : "text",
      },
      newIdempotencyKey(),
    );
  }

  return (
    <div className="space-y-5 text-[14px] text-[#333]">
      <div className="rounded-[6px] border border-[#e2e2e2] bg-[#fafafa] p-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[#666]">
          Step {index + 1} of {concept.steps.length}
        </p>
        <p className="mt-0.5">{current.text}</p>
      </div>

      <div className="grid gap-2">
        {ACTIONS.map(({ action, label, hint }) => (
          <button
            key={action}
            type="button"
            disabled={running}
            onClick={() => ask(action)}
            className="flex flex-col items-start rounded-[6px] border border-[#ccc] bg-white px-3 py-2 text-left hover:border-[#999] hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-semibold">{label}</span>
            <span className="text-[12.5px] text-[#666]">{hint}</span>
          </button>
        ))}
      </div>

      {state.status !== "idle" ? (
        <GenerationLoader state={state} onCancel={cancel} onRetry={retry} onEditTopic={reset} editLabel="Close" compact />
      ) : null}

      <section aria-labelledby="explore-results">
        <h3 id="explore-results" className="text-[15px] font-semibold">
          For this step
        </h3>
        {forStep.length === 0 ? (
          <p className="mt-1 text-[#666]">Nothing yet. Results are AI-generated, reviewed automatically, and kept in this browser.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {forStep.map((supplement) => (
              <SupplementCard key={supplement.id} supplement={supplement} concept={concept} examplePath={examplePath} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SupplementCard({ supplement, concept, examplePath }: { supplement: Supplement; concept: Concept; examplePath: (id: string) => string }) {
  const claims = supplement.kind === "example" ? [] : supplement.claims.flatMap((id) => concept.provenance?.claims.find((c) => c.id === id) ?? []);
  return (
    <li className="rounded-[6px] border border-[#e2e2e2] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[#2a6496]">
          {KIND_LABEL[supplement.kind]} · AI-generated
        </p>
        <button
          type="button"
          onClick={() => deleteSupplement(supplement.id)}
          aria-label={`Remove this ${KIND_LABEL[supplement.kind].toLowerCase()}`}
          className="text-[12px] text-[#666] underline-offset-2 hover:text-[#333] hover:underline"
        >
          Remove
        </button>
      </div>
      {supplement.kind === "example" ? (
        <div className="mt-1">
          <p className="font-medium">{supplement.concept.title}</p>
          <p className="mt-0.5 text-[13px] text-[#555]">{supplement.concept.description}</p>
          <Link href={examplePath(supplement.id)} className="mt-2 inline-block text-[#2a6496] underline-offset-2 hover:underline">
            Play the example ({supplement.concept.steps.length} steps) →
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-line leading-relaxed">{supplement.text}</p>
          {claims.length ? (
            <p className="mt-2 text-[12.5px] text-[#666]">Relies on: {claims.map((c) => c.text).join(" · ")}</p>
          ) : null}
        </>
      )}
    </li>
  );
}
