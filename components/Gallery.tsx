import Link from "next/link";
import type { Step } from "@/lib/concept/schema";
import { listPublicConcepts, type ConceptCard as CardRow, type ListResult } from "@/lib/data/concepts";
import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { STORIES } from "@/lib/stories";
import { stepToStory } from "@/lib/story/from-concept";
import { ConceptCard, type ConceptCardData } from "./ConceptCard";
import { StorySnapshot } from "./story/StorySnapshot";

const stepThumbnail = (step: Step | undefined) => (step ? <StorySnapshot story={stepToStory(step)} /> : undefined);

const fromRow = (row: CardRow): ConceptCardData => ({
  href: `/concept/${row.id}`,
  title: row.title,
  description: row.description,
  length: `${row.step_count} steps`,
  origin: row.origin,
  thumbnail: stepThumbnail(row.preview),
});

/** The frame each hand-written story shows on its card. */
const STORY_FRAMES: Record<string, { chapter: string; beat: number }> = {
  http: { chapter: "intro", beat: 4 },
  kafka: { chapter: "replication", beat: 5 },
};

/** Hand-written stories from /learn, shown on the home page with the same cards. */
export function StoriesSection() {
  return (
    <section aria-labelledby="gallery-visualizations">
      <SectionHeading
        id="gallery-visualizations"
        title="Visualizations"
        subtitle="Longer hand-written stories, in the style of The Secret Lives of Data."
      />
      <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STORIES.map((story) => (
          <ConceptCard
            key={story.slug}
            card={{
              href: `/learn/${story.slug}`,
              title: `${story.title}: ${story.subtitle}`,
              description: story.summary,
              length: `${story.chapters.length} chapters`,
              origin: "curated",
              thumbnail: <StorySnapshot story={story} {...STORY_FRAMES[story.slug]} />,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/** Server component: every explanation is public. */
export async function Gallery() {
  const result = await listPublicConcepts();
  if (result.status === "unconfigured") return <BundledGallery />;
  return (
    <GallerySection
      title="Explore"
      subtitle="Curated and AI-generated explanations. Anyone can open them."
      result={result}
      empty="No explanations yet. Run the seed script to add the curated examples."
    />
  );
}

function GallerySection({ title, subtitle, result, empty }: { title: string; subtitle: string; result: ListResult; empty: string }) {
  const headingId = `gallery-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <SectionHeading id={headingId} title={title} subtitle={subtitle} />
      {result.status === "error" ? (
        <div className="mt-5 rounded-xl border border-danger/25 bg-danger-soft/50 p-4 text-sm" role="alert">
          <p className="font-semibold text-danger">{result.message}</p>
          <p className="mt-1 text-ink-soft">
            The database didn&apos;t respond.{" "}
            <Link href="/" className="font-medium underline underline-offset-4">
              Reload
            </Link>{" "}
            to try again.
          </p>
        </div>
      ) : result.status === "ok" ? (
        result.cards.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-muted">{empty}</p>
        ) : (
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.cards.map((row) => (
              <ConceptCard key={row.id} card={fromRow(row)} />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/** Shown when Supabase is not configured: the same fixtures, served from the app bundle. */
function BundledGallery() {
  return (
    <section aria-labelledby="gallery-bundled">
      <SectionHeading
        id="gallery-bundled"
        title="Explore"
        subtitle="The database isn't configured, so these bundled demo explanations are served directly from the app."
      />
      <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {BUNDLED_FIXTURES.map(({ slug, concept }) => (
          <ConceptCard
            key={slug}
            card={{
              href: `/demo/${slug}`,
              title: concept.title,
              description: concept.description,
              length: `${concept.steps.length} steps`,
              origin: "curated",
              bundled: true,
              thumbnail: stepThumbnail(concept.steps[3]),
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div>
      <h2 id={id} className="font-display text-3xl tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
    </div>
  );
}

export function GallerySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading explanations">
      <div className="h-8 w-40 animate-pulse rounded bg-paper-sunk" />
      <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="overflow-hidden rounded-2xl border border-line bg-paper-raised">
            <div className="aspect-[5/3] animate-pulse bg-paper-sunk" />
            <div className="space-y-2 p-5">
              <div className="h-4 w-24 animate-pulse rounded bg-paper-sunk" />
              <div className="h-5 w-3/4 animate-pulse rounded bg-paper-sunk" />
              <div className="h-4 w-full animate-pulse rounded bg-paper-sunk" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
