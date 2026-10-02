import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { assertDevOnly, loadEvalConcept, loadEvalRun } from "@/lib/evals/load";
import { conceptToStory } from "@/lib/story/from-concept";
import type { EvalAttempt } from "@/lib/evals/types";

export default async function EvalRunPage({ params, searchParams }: PageProps<"/dev/evals/[run]">) {
  assertDevOnly();
  const { run: dir } = await params;
  const { view } = await searchParams;
  const run = loadEvalRun(dir);
  if (!run) notFound();
  const selected = Number(Array.isArray(view) ? view[0] : view);
  const result = Number.isInteger(selected) ? run.results[selected] : undefined;
  const concept = result?.conceptFile ? loadEvalConcept(run.dir, result.conceptFile) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/dev/evals" className="text-sm font-medium text-ink-muted hover:text-ink">
        ← All runs
      </Link>
      <h1 className="mt-4 font-display text-3xl text-ink">{run.dir}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Models {Object.values(run.models).join(" / ")} · prompts{" "}
        <span className="font-mono">{Object.entries(run.promptHashes).map(([k, v]) => `${k}=${v}`).join(" ")}</span>
      </p>

      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-paper-raised">
        {run.results.map((r, i) => (
          <li key={i} className={`px-4 py-3 ${i === selected ? "bg-accent-soft/50" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/dev/evals/${run.dir}?view=${i}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                {r.correct ? "✓" : "✗"} {r.topic}
                {r.repeat > 1 ? ` #${r.repeat}` : ""}
              </Link>
              <span className="text-sm text-ink-muted">
                {r.outcome} · {r.attemptCount} attempt(s) · {(r.latencyMs / 1000).toFixed(1)} s
                {r.costUsd === null ? "" : ` · $${r.costUsd.toFixed(4)}`}
              </span>
            </div>
            {r.failureMessage ? <p className="mt-1 text-sm text-ink-soft">{r.failureMessage}</p> : null}
          </li>
        ))}
      </ul>

      {result ? (
        <div className="mt-10 space-y-8">
          <section>
            <h2 className="font-display text-2xl text-ink">Attempts</h2>
            <ol className="mt-3 space-y-3">
              {result.attempts.map((a, i) => (
                <AttemptCard key={i} n={i + 1} attempt={a} />
              ))}
            </ol>
          </section>
          {concept ? (
            <div className="h-[85vh] overflow-hidden rounded-xl border border-line">
              <StoryPlayer
                key={`${run.dir}-${selected}`}
                story={conceptToStory(concept, { subtitle: `Eval run ${run.dir}` })}
                label="AI-generated (eval)"
                embedded
              />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No accepted explanation for this run.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AttemptCard({ n, attempt }: { n: number; attempt: EvalAttempt }) {
  return (
    <li className="rounded-xl border border-line bg-paper-raised p-4 text-sm">
      <p className="font-semibold text-ink">Attempt {n}</p>
      {attempt.generatorError ? <p className="mt-1 text-danger">Generator error: {attempt.generatorError}</p> : null}
      {attempt.validationErrors.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-danger">
          {attempt.validationErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {attempt.validationWarnings.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-warning">
          {attempt.validationWarnings.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {attempt.review ? (
        <div className="mt-2">
          <p className="text-ink-soft">
            Reviewer: {attempt.review.passed ? "passed" : "failed"}. {attempt.review.summary}
          </p>
          <ul className="mt-1 space-y-1">
            {attempt.review.issues.map((issue, i) => (
              <li key={i} className="text-ink-soft">
                <span className={`font-semibold ${issue.severity === "minor" ? "text-ink-muted" : "text-danger"}`}>
                  {issue.severity}/{issue.category}
                  {issue.stepId ? ` [${issue.stepId}]` : ""}
                </span>{" "}
                {issue.problem} <span className="text-ink-muted">→ {issue.suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
