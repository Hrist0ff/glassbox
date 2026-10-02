import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { z } from "zod";
import { StepSchema, type Concept } from "@/lib/concept/schema";
import { parseStoredConcept, validateConcept } from "@/lib/concept/validate";
import type { GenerationMeta } from "@/lib/pipeline/orchestrator";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Data access for `public.concepts`.
 *
 * There are no accounts. Reads use the anonymous client, so Row Level
 * Security limits them to public rows. Writes take the admin client.
 *
 * Reads call `connection()` so pages showing concepts render per request:
 * nothing else on them (no cookies, no headers) marks them dynamic, and a
 * gallery prerendered at build time would never show new explanations.
 */

/** `preview` is one scene used for the card thumbnail; every concept has at least 4 steps. */
const CARD_COLUMNS = "id, title, description, origin, step_count, created_at, preview:content->steps->3";

const ConceptCardSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  origin: z.enum(["curated", "ai_generated"]),
  step_count: z.number().int(),
  created_at: z.string(),
  // Validated separately so a bad thumbnail never hides the card.
  preview: z.unknown().transform((value) => {
    const step = StepSchema.safeParse(value);
    return step.success ? step.data : undefined;
  }),
});
export type ConceptCard = z.infer<typeof ConceptCardSchema>;

const GenerationMetaSchema = z
  .looseObject({
    models: z.record(z.string(), z.string()).optional(),
    attempts: z.number().int().optional(),
  })
  .nullable();

const ConceptRowSchema = z.object({
  id: z.uuid(),
  content: z.unknown(),
  origin: z.enum(["curated", "ai_generated"]),
  source_topic: z.string().nullable(),
  generation_meta: GenerationMetaSchema,
  created_at: z.string(),
});

export type ConceptRecord = {
  concept: Concept;
  origin: "curated" | "ai_generated";
  sourceTopic: string | null;
  generationMeta: z.infer<typeof GenerationMetaSchema>;
  createdAt: string;
};

export type ListResult =
  | { status: "ok"; cards: ConceptCard[] }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

function parseCards(data: unknown): ConceptCard[] {
  // Drop rows that do not match instead of failing the whole gallery.
  return z
    .array(z.unknown())
    .parse(data ?? [])
    .flatMap((row) => {
      const parsed = ConceptCardSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
}

export async function listPublicConcepts(limit = 24): Promise<ListResult> {
  await connection();
  const supabase = createPublicClient();
  if (!supabase) return { status: "unconfigured" };
  const { data, error } = await supabase
    .from("concepts")
    .select(CARD_COLUMNS)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { status: "error", message: "Could not load explanations." };
  return { status: "ok", cards: parseCards(data) };
}

export type GetResult =
  | { status: "ok"; record: ConceptRecord }
  | { status: "not_found" }
  | { status: "invalid"; reason: string }
  | { status: "unconfigured" }
  | { status: "error" };

/** Load one public concept. Rows hidden by RLS look exactly like missing rows. */
export async function getConcept(id: string): Promise<GetResult> {
  await connection();
  if (!z.uuid().safeParse(id).success) return { status: "not_found" };
  const supabase = createPublicClient();
  if (!supabase) return { status: "unconfigured" };

  const { data, error } = await supabase
    .from("concepts")
    .select("id, content, origin, source_topic, generation_meta, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { status: "error" };
  if (!data) return { status: "not_found" };

  const row = ConceptRowSchema.safeParse(data);
  if (!row.success) return { status: "invalid", reason: "unexpected row shape" };
  const parsed = parseStoredConcept(row.data.content, row.data.id);
  if (!parsed.ok) return { status: "invalid", reason: parsed.reason };

  return {
    status: "ok",
    record: {
      concept: parsed.concept,
      origin: row.data.origin,
      sourceTopic: row.data.source_topic,
      generationMeta: row.data.generation_meta,
      createdAt: row.data.created_at,
    },
  };
}

/**
 * Persist an AI-generated concept as a public record.
 * Identity, visibility, and origin are set here, never by the model.
 * The content is validated again immediately before the write.
 */
export async function insertGeneratedConcept(
  admin: SupabaseClient,
  input: { concept: Concept; topic: string; requestId: string; meta: GenerationMeta },
  signal?: AbortSignal,
): Promise<{ id: string }> {
  const checked = validateConcept(input.concept);
  if (!checked.ok) throw new Error("Refusing to persist a concept that fails validation");
  const concept = checked.concept;

  const { data, error } = await admin
    .from("concepts")
    .insert({
      id: concept.id,
      title: concept.title,
      description: concept.description,
      schema_version: concept.schemaVersion,
      content: concept,
      visibility: "public",
      origin: "ai_generated",
      source_topic: input.topic,
      generation_request_id: input.requestId,
      generation_meta: input.meta,
    })
    .select("id")
    .abortSignal(signal ?? AbortSignal.timeout(15_000))
    .single();
  if (error || !data) throw new Error(`Insert failed${error?.code ? ` (${error.code})` : ""}`);
  return { id: z.object({ id: z.uuid() }).parse(data).id };
}

/** Find a concept already saved for this idempotency key. */
export async function findConceptByRequest(admin: SupabaseClient, requestId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("concepts")
    .select("id")
    .eq("generation_request_id", requestId)
    .maybeSingle();
  if (error) throw new Error("Lookup by request id failed");
  return data ? z.object({ id: z.uuid() }).parse(data).id : null;
}
