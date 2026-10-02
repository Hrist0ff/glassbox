"use client";

import { useMemo } from "react";
import { StepTools } from "@/components/story/StepTools";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import type { Concept } from "@/lib/concept/schema";
import { conceptStories } from "@/lib/story/from-concept";

/** A bundled example in the player, with its sources view. */
export function DemoExplanation({ concept }: { concept: Concept }) {
  const stories = useMemo(
    () =>
      conceptStories(concept, {
        subtitle: "Curated example",
        closing: "This hand-written example is bundled with the app.",
      }),
    [concept],
  );
  return (
    <StoryPlayer
      story={stories.landscape}
      portrait={stories.portrait}
      label="Example"
      tools={({ step, onDrawer }) => <StepTools concept={concept} step={step} origin="bundled" onDrawer={onDrawer} />}
    />
  );
}
