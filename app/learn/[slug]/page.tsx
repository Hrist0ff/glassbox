import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { findStory, STORIES } from "@/lib/stories";

export function generateStaticParams() {
  return STORIES.map(({ slug }) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const story = findStory(slug);
  if (!story) return { title: "Visualization unavailable" };
  return { title: `${story.title}: ${story.subtitle}`, description: story.summary };
}

export default async function StoryPage({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const story = findStory(slug);
  if (!story) notFound();
  return <StoryPlayer story={story} />;
}
