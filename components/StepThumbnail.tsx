import type { Concept } from "@/lib/concept/schema";
import { stepToStory } from "@/lib/story/from-concept";
import { StorySnapshot } from "./story/StorySnapshot";

/** A card thumbnail: one step of an explanation, drawn by the story renderer. */
export function StepThumbnail({ concept, index }: { concept: Concept; index: number }) {
  const step = concept.steps[Math.min(index, concept.steps.length - 1)];
  return step ? <StorySnapshot story={stepToStory(step, concept)} /> : null;
}
