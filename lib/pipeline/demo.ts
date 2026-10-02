import { validateConcept } from "@/lib/concept/validate";
import { BUNDLED_FIXTURES, matchFixtureForTopic } from "@/lib/fixtures";
import type { TerminalEventInput } from "@/lib/generation/stream";
import type { GenerationEventInput } from "@/lib/sse/events";

/**
 * Local demo mode: no AI call. The topic is matched
 * against bundled fixtures by keyword, the fixture is run through the real
 * deterministic validator, and the reader is pointed at /demo/<slug>.
 * Every message says plainly that this is demo mode.
 */
export async function runDemoPipeline(
  topic: string,
  emit: (event: GenerationEventInput) => void,
): Promise<TerminalEventInput> {
  emit({
    type: "progress",
    stage: "plan",
    state: "running",
    message: "Demo mode: matching your topic against the bundled fixtures. No AI model is called.",
  });
  const fixture = matchFixtureForTopic(topic);
  if (!fixture) {
    emit({ type: "progress", stage: "plan", state: "failed", message: "No bundled fixture matches this topic" });
    const titles = BUNDLED_FIXTURES.map((f) => f.concept.title).join(", ");
    return {
      type: "failed",
      code: "unsupported_topic",
      message: `Demo mode can only open the bundled explanations (${titles}). Set OPENAI_API_KEY to generate new topics.`,
      retryable: false,
    };
  }
  emit({ type: "progress", stage: "plan", state: "done", message: `Matched the bundled fixture “${fixture.concept.title}”` });

  emit({ type: "progress", stage: "validate", state: "running", message: "Checking node references and scene bounds" });
  const result = validateConcept(fixture.concept);
  if (!result.ok) {
    emit({ type: "progress", stage: "validate", state: "failed", message: "The bundled fixture failed validation" });
    return { type: "failed", code: "internal", message: "A bundled fixture is invalid.", retryable: false };
  }
  emit({ type: "progress", stage: "validate", state: "done", message: "The fixture passed the same checks used for generated content" });

  return {
    type: "completed",
    conceptId: fixture.concept.id,
    url: `/demo/${fixture.slug}`,
    attempts: 0,
    persisted: false,
    demo: true,
  };
}
