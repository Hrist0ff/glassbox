"use client";

import { useMemo } from "react";
import { StepTools } from "@/components/story/StepTools";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import type { Concept } from "@/lib/concept/schema";
import { conceptStories } from "@/lib/story/from-concept";

/** An eval result in the real player, with its Sources view (development only). */
export function EvalPlayer({ concept, subtitle }: { concept: Concept; subtitle: string }) {
  const stories = useMemo(() => conceptStories(concept, { subtitle }), [concept, subtitle]);
  return (
    <StoryPlayer
      story={stories.landscape}
      portrait={stories.portrait}
      label="AI-generated (eval)"
      embedded
      tools={({ step, onDrawer }) => <StepTools concept={concept} step={step} origin="eval" onDrawer={onDrawer} />}
    />
  );
}
