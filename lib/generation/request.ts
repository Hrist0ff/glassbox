import { z } from "zod";
import { DEPTHS, LANGUAGES, LIMITS, type Depth } from "@/lib/concept/constants";
import type { Concept, Source } from "@/lib/concept/schema";
import { buildSource } from "@/lib/sources/passages";
import { normalizeTopic } from "./topic";

/**
 * What a reader can ask for, as validated by the API and run by the pipeline.
 *
 * - `topic`: explain a subject from the model's general knowledge.
 * - `source`: visualize material the reader pasted (stored with the result).
 * - `explore`: work on one step of an explanation the reader already has:
 *   explain it, make it simpler, or show another example. The browser sends
 *   the explanation, since nothing is stored on the server; it is validated
 *   again here like any other untrusted input.
 */

export type Preferences = { audience: string; language: string; depth: Depth };

export const DEFAULT_PREFERENCES: Preferences = { audience: "", language: "", depth: "standard" };

const PreferencesSchema = z
  .strictObject({
    audience: z.string().max(LIMITS.audience.max * 2).optional(),
    language: z.string().max(60).optional(),
    depth: z.enum(DEPTHS).optional(),
  })
  .optional();

export const EXPLORE_ACTIONS = ["explain", "simplify", "example"] as const;
export type ExploreAction = (typeof EXPLORE_ACTIONS)[number];

/** Request body of POST /api/generate. A body without `kind` is a topic request (the original format). */
export const GenerateRequestSchema = z.union([
  z.strictObject({
    kind: z.literal("topic").optional(),
    topic: z.string(),
    preferences: PreferencesSchema,
    idempotencyKey: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("source"),
    /** Short title for the material; optional. */
    title: z.string().max(200).optional(),
    /** What to focus on in the material; optional. */
    question: z.string().max(400).optional(),
    text: z.string().max(LIMITS.sourceText.max * 2),
    preferences: PreferencesSchema,
    idempotencyKey: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("explore"),
    action: z.enum(EXPLORE_ACTIONS),
    stepId: z.string().min(1).max(LIMITS.id.max),
    /** The topic the explanation was made from (version-1 explanations have no provenance). */
    topic: z.string().max(LIMITS.question.max * 2),
    concept: z.unknown(),
    idempotencyKey: z.uuid(),
  }),
]);
export type GenerateRequestBody = z.infer<typeof GenerateRequestSchema>;

/** A step of an existing explanation to explore, with what the pipeline needs to know about it. */
export type ExploreContext = {
  action: ExploreAction;
  concept: Concept;
  stepId: string;
  stepIndex: number;
  /** The original topic or material title. */
  topic: string;
};

export type GenerationRequest =
  | { kind: "topic"; topic: string; preferences: Preferences }
  | { kind: "source"; title: string; question: string; source: Source; preferences: Preferences }
  | { kind: "explore"; context: ExploreContext };

/** Short label for progress and logs: the topic, the material's title, or the step being explored. */
export function requestLabel(request: GenerationRequest): string {
  switch (request.kind) {
    case "topic":
      return request.topic;
    case "source":
      return request.title;
    case "explore": {
      const verb = { explain: "Explain", simplify: "Simplify", example: "Another example for" }[request.context.action];
      return `${verb} step ${request.context.stepIndex + 1} of “${request.context.concept.title}”`;
    }
  }
}

const clean = (text: string | undefined, max: number) =>
  (text ?? "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function normalizePreferences(raw: z.infer<typeof PreferencesSchema>): Preferences {
  const language = clean(raw?.language, 40);
  return {
    audience: clean(raw?.audience, LIMITS.audience.max),
    // Free text is allowed (the planner can follow it), but only letters, spaces, and a few signs.
    language: /^[\p{L}\p{M} ()-]*$/u.test(language) ? language : "",
    depth: raw?.depth ?? "standard",
  };
}

export const OFFERED_LANGUAGES: readonly string[] = LANGUAGES;

export type ParsedRequest = { ok: true; request: GenerationRequest } | { ok: false; message: string };

/**
 * Turn a schema-valid body into a pipeline request: normalize text, split
 * pasted material into passages, and validate an explanation sent for
 * exploring (its stored claims and excerpts are checked again).
 */
export function toGenerationRequest(body: GenerateRequestBody, validate: (input: unknown) => { ok: true; concept: Concept } | { ok: false }): ParsedRequest {
  if (body.kind === "source") {
    const question = clean(body.question, LIMITS.question.max);
    const title = clean(body.title, LIMITS.title.max) || "Pasted text";
    const built = buildSource(body.text, title);
    if (!built.ok) return built;
    return { ok: true, request: { kind: "source", title, question, source: built.source, preferences: normalizePreferences(body.preferences) } };
  }
  if (body.kind === "explore") {
    const checked = validate(body.concept);
    if (!checked.ok) return { ok: false, message: "The explanation sent for exploring is not valid." };
    const stepIndex = checked.concept.steps.findIndex((s) => s.id === body.stepId);
    if (stepIndex === -1) return { ok: false, message: "That step is not part of the explanation." };
    const topic = clean(body.topic, LIMITS.question.max) || checked.concept.title;
    return { ok: true, request: { kind: "explore", context: { action: body.action, concept: checked.concept, stepId: body.stepId, stepIndex, topic } } };
  }
  const topic = normalizeTopic(body.topic);
  if (!topic.ok) return topic;
  return { ok: true, request: { kind: "topic", topic: topic.topic, preferences: normalizePreferences(body.preferences) } };
}

/** Byte limit for a request body, by kind; checked before parsing JSON (a kind-less body is a topic). */
export function bodyLimit(kind: string | null): number {
  if (kind === "source") return LIMITS.sourceRequestBytes;
  if (kind === "explore") return LIMITS.exploreRequestBytes;
  return LIMITS.requestBodyBytes;
}

