import Link from "next/link";
import { Suspense } from "react";
import { Gallery, GallerySkeleton, StoriesSection } from "@/components/Gallery";
import { StorySnapshot } from "@/components/story/StorySnapshot";
import { TopicForm, type GenerationAvailability } from "@/components/TopicForm";
import { LIMITS } from "@/lib/concept/constants";
import { MAX_ATTEMPTS } from "@/lib/sse/events";
import { generationMode, serverEnv, supabasePublicConfig } from "@/lib/env";
import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { raftLeaderElection } from "@/lib/fixtures/raft";
import { stepToStory } from "@/lib/story/from-concept";

export default function HomePage() {
  const mode = generationMode();
  const databaseConfigured = supabasePublicConfig() !== null;

  const availability: GenerationAvailability =
    mode.mode === "live"
      ? { mode: "live", perHourLimit: serverEnv().RATE_LIMIT_PER_CLIENT_PER_HOUR, saves: mode.storage === "database" }
      : mode.mode === "demo"
        ? { mode: "demo", demoTopics: BUNDLED_FIXTURES.map((f) => f.concept.title.replace(/ \(simplified\)$/, "")) }
        : { mode: "misconfigured" };

  const heroStep = raftLeaderElection.steps[3]!;

  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:pt-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">An open, interactive wiki for technical concepts</p>
            <h1 className="mt-4 font-display text-[2.6rem] leading-[1.05] tracking-tight text-ink sm:text-6xl">
              See how systems work, <em className="italic text-ink-soft">one change at a time.</em>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              Each explanation is a short animated story. Step forward and back at your own pace; every step changes one
              thing and tells you why.
            </p>
            <div className="mt-9">
              <TopicForm availability={availability} />
            </div>
          </div>

          <figure className="hidden lg:block">
            <Link
              href={availability.mode === "demo" || !databaseConfigured ? "/demo/raft-leader-election" : `/concept/${raftLeaderElection.id}`}
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

      <div id="explore" className="mx-auto max-w-6xl scroll-mt-20 space-y-12 px-4 py-14 sm:px-6">
        <StoriesSection />
        <Suspense fallback={<GallerySkeleton />}>
          <Gallery />
        </Suspense>
      </div>

      <section id="how-it-works" className="scroll-mt-20 border-t border-line bg-paper-raised/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-display text-3xl tracking-tight text-ink">How explanations are made</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Generated explanations are data, not code: the AI writes a small JSON storyboard and the player decides how to draw
            and animate it.
          </p>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            <HowStep n={1} title="Plan">
              A planner picks the central mechanism, a small cast of entities, and a storyboard that starts with an intuitive
              example and ends with a takeaway. Topics that don&apos;t fit nodes and messages are declined.
            </HowStep>
            <HowStep n={2} title="Draft and check">
              A generator writes {LIMITS.steps.min}–{LIMITS.steps.max} scenes. Deterministic checks verify references, limits,
              and layout before anything else happens.
            </HowStep>
            <HowStep n={3} title="Review, revise, save">
              A separate reviewer critiques accuracy and teaching quality. Drafts get up to {MAX_ATTEMPTS} attempts in
              total; only one that passes every check is saved.
            </HowStep>
          </ol>
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-muted">
            Automated review is a quality check, not proof of correctness, and no sources are consulted. AI-generated
            explanations are always labeled; verify anything important against primary documentation.
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
