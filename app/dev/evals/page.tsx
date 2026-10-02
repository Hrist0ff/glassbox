import type { Metadata } from "next";
import Link from "next/link";
import { assertDevOnly, listEvalRuns } from "@/lib/evals/load";

export const metadata: Metadata = { title: "Prompt evals (dev)", robots: { index: false } };

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);

/** Mean of the grader's dimension means, for a one-number summary (older runs have none). */
function meanGrade(quality: Record<string, number | null | undefined> | undefined): string {
  const values = Object.values(quality ?? {}).filter((v): v is number => typeof v === "number");
  return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "n/a";
}

export default function EvalRunsPage() {
  assertDevOnly();
  const runs = listEvalRuns();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-warning">Development only</p>
      <h1 className="mt-2 font-display text-4xl text-ink">Prompt evaluations</h1>
      <p className="mt-2 text-ink-soft">
        Runs from <code className="font-mono text-sm">npm run eval:prompts</code>, newest first.
      </p>
      {runs.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-muted">No runs yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-paper-raised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {["Run", "Generator prompt", "Accepted", "First-attempt pass", "Mean attempts", "Declines", "Representation ok", "Mean grade", "Cost"].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.dir} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/dev/evals/${run.dir}`} className="font-semibold text-accent underline-offset-4 hover:underline">
                      {run.dir}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{run.promptHashes.generator}</td>
                  <td className="px-4 py-3">{pct(run.metrics.acceptRate)}</td>
                  <td className="px-4 py-3">{pct(run.metrics.firstAttemptPassRate)}</td>
                  <td className="px-4 py-3">{run.metrics.meanAttemptsWhenAccepted?.toFixed(2) ?? "n/a"}</td>
                  <td className="px-4 py-3">{pct(run.metrics.correctDeclineRate)}</td>
                  <td className="px-4 py-3">{pct(run.metrics.representationMatchRate)}</td>
                  <td className="px-4 py-3">{meanGrade(run.metrics.quality)}</td>
                  <td className="px-4 py-3">{run.metrics.totalCostUsd === null ? "n/a" : `$${run.metrics.totalCostUsd.toFixed(4)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
