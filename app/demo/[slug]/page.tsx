import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { parseStoredConcept } from "@/lib/concept/validate";
import { BUNDLED_FIXTURES, findFixtureBySlug } from "@/lib/fixtures";
import { conceptToStory } from "@/lib/story/from-concept";

/** Bundled examples, served without OpenAI. */
export function generateStaticParams() {
  return BUNDLED_FIXTURES.map(({ slug }) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/demo/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const fixture = findFixtureBySlug(slug);
  if (!fixture) return { title: "Demo unavailable" };
  return { title: `${fixture.concept.title} (demo)`, description: fixture.concept.description };
}

export default async function DemoPage({ params }: PageProps<"/demo/[slug]">) {
  const { slug } = await params;
  const fixture = findFixtureBySlug(slug);
  if (!fixture) notFound();

  // Same validation as generated content.
  const parsed = parseStoredConcept(fixture.concept, fixture.concept.id);
  if (!parsed.ok) throw new Error(`Bundled fixture ${slug} is invalid`);

  return (
    <StoryPlayer
      story={conceptToStory(parsed.concept, {
        subtitle: "Curated example",
        closing: "This hand-written example is bundled with the app.",
      })}
      label="Example"
    />
  );
}
