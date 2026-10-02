import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { STORIES } from "@/lib/stories";
import { ConceptCard } from "./ConceptCard";
import { LibrarySection } from "./LibrarySection";
import { SectionHeading } from "./SectionHeading";
import { StepThumbnail } from "./StepThumbnail";
import { StorySnapshot } from "./story/StorySnapshot";

/** The frame each hand-written story shows on its card. */
const STORY_FRAMES: Record<string, { chapter: string; beat: number }> = {
  http: { chapter: "intro", beat: 4 },
  kafka: { chapter: "replication", beat: 5 },
};

/** Everything a reader can open: hand-written stories, their own library, and bundled examples. */
export function Gallery() {
  return (
    <div className="space-y-12">
      <StoriesSection />
      <LibrarySection />
      <ExamplesSection />
    </div>
  );
}

/** Hand-written stories from /learn. */
function StoriesSection() {
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

/** Hand-written explanations bundled with the app, played like generated ones. */
function ExamplesSection() {
  return (
    <section aria-labelledby="gallery-examples">
      <SectionHeading id="gallery-examples" title="Examples" subtitle="Hand-written explanations bundled with the app." />
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
              thumbnail: concept.steps[3] ? <StepThumbnail step={concept.steps[3]} /> : undefined,
            }}
          />
        ))}
      </ul>
    </section>
  );
}
