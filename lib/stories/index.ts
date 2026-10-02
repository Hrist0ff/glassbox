import type { Story } from "@/lib/story/types";
import { http } from "./http";
import { kafka } from "./kafka";

/** Hand-written stories, served at /learn/<slug>. */
export const STORIES: readonly Story[] = [http, kafka];

export function findStory(slug: string): Story | undefined {
  return STORIES.find((story) => story.slug === slug);
}
