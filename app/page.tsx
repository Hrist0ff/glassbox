import Link from "next/link";
import { connection } from "next/server";
import { Gallery } from "@/components/Gallery";
import { StorySnapshot } from "@/components/story/StorySnapshot";
import { TopicForm, type GenerationAvailability } from "@/components/TopicForm";
import { LIMITS } from "@/lib/concept/constants";
import { MAX_ATTEMPTS } from "@/lib/sse/events";
import { generationMode, serverEnv } from "@/lib/env";
import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { raftLeaderElection } from "@/lib/fixtures/raft";
import { stepToStory } from "@/lib/story/from-concept";

export default async function HomePage() {
  // The mode and limits come from the server's environment at request time, not at build time.
  await connection();
  const mode = generationMode();

  const availability: GenerationAvailability =
    mode.mode === "live"
      ? { mode: "live", perHourLimit: serverEnv().RATE_LIMIT_PER_CLIENT_PER_HOUR }
      : mode.mode === "demo"
        ? { mode: "demo", demoTopics: BUNDLED_FIXTURES.map((f) => f.concept.title.replace(/ \(simplified\)$/, "")) }
        : { mode: "misconfigured" };

  const heroStep = raftLeaderElection.steps[3]!;

  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:pt-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Interactive visual explanations</p>
            <h1 className="mt-4 font-display text-[2.6rem] leading-[1.05] tracking-tight text-ink sm:text-6xl">
              See how it works, <em className="italic text-ink-soft">one change at a time.</em>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              Each explanation is a short animated story, drawn the way the subject needs: messages between actors, a timeline, a
              comparison, a hierarchy, or a chart. Step forward and back at your own pace, or paste your own notes and see them
              laid out, with each claim linked to the passage it came from.
            </p>
            <div className="mt-9">
              <TopicForm availability={availability} />
            </div>
          </div>

          <figure className="hidden lg:block">
            <Link
              href="/demo/raft-leader-election"
              className="block overflow-hidden rounded-2xl border border-line bg-arena shadow-[0_24px_48px_-30px_rgba(30,25,15,0.45)] transition-transform hover:-translate-y-0.5"
            >
              <StorySnapshot story={stepToStory(heroStep)} />
              <figcaption className="border-t border-line bg-paper-raised px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  Raft leader election · Step 4 of {raftLeaderElection.steps.length}
                </p>
                <p className="mt-1 font-display text-lg leading-snug text-ink">{heroStep.text}</p>
              </figcaption>
            </Link>
          </figure>
        </div>
      </section>

      <div id="explore" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <Gallery />
      </div>

      <section id="how-it-works" className="scroll-mt-20 border-t border-line bg-paper-raised/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-display text-3xl tracking-tight text-ink">How explanations are made</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Generated explanations are data, not code: the AI writes a small storyboard, and the application decides how to lay
            it out, draw it, and animate it.
          </p>
          <ol className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <HowStep n={1} title="Read">
              For pasted material, the AI lists its claims with the passages that support them. Every quoted excerpt is checked
              word for word; a claim whose excerpt isn&apos;t found is marked as interpretation.
            </HowStep>
            <HowStep n={2} title="Plan">
              A planner states what you should come away understanding and picks the view that shows it best. Requests the
              player can&apos;t show are declined with alternatives that would work.
            </HowStep>
            <HowStep n={3} title="Draft, lay out, check">
              A generator writes {LIMITS.steps.min}–{LIMITS.steps.max} scenes as data. Application code lays them out for wide
              and phone screens and checks references, sizes, overlaps, and citations.
            </HowStep>
            <HowStep n={4} title="Review, revise, save">
              A separate reviewer compares the draft with your request (and your material). Drafts get up to {MAX_ATTEMPTS}{" "}
              attempts; only one that passes every check is saved, in this browser.
            </HowStep>
          </ol>
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-muted">
            Automated review is a quality check, not proof of correctness. Topic explanations come from the AI model&apos;s
            general knowledge and consult no sources; explanations of your material are only as reliable as the material. Every
            explanation lists its scope, omissions, and assumptions under Sources. AI-generated explanations are always labeled;
            verify anything important.
          </p>
        </div>
      </section>
    </>
  );
}

function HowStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-paper-raised p-6">
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-ink font-display text-lg text-paper">{n}</span>
      <h3 className="mt-4 font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</p>
    </li>
  );
}
