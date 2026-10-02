import type { Step } from "@/lib/concept/schema";
import { stepToStory } from "@/lib/story/from-concept";
import { StorySnapshot } from "./story/StorySnapshot";

/** A card thumbnail: one step of an explanation, drawn by the story renderer. */
export function StepThumbnail({ step }: { step: Step }) {
  return <StorySnapshot story={stepToStory(step)} />;
}
