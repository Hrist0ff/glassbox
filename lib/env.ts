import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Secrets (OpenAI key, Supabase secret key) are
 * only read here and never sent to the browser.
 */

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().transform((v) => v ?? fallback);

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  /** Legacy name for the publishable key. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SECRET_KEY: optionalString,
  /** Legacy name for the secret key. */
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_EXTRACTOR_MODEL: optionalString,
  OPENAI_GENERATOR_MODEL: optionalString,
  OPENAI_EVALUATOR_MODEL: optionalString,
  /** Leave unset for models that do not support reasoning effort. */
  OPENAI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),

  /** `live` calls OpenAI and persists; `demo` serves bundled fixtures. Defaults to live when OPENAI_API_KEY is set. */
  GENERATION_MODE: z.enum(["live", "demo"]).optional(),
  /** Server deadline for one generation request; must stay below the route's maxDuration (300 s). */
  GENERATION_DEADLINE_MS: int(270_000, 30_000, 290_000),
  /** Per visitor (pseudonymous client key), in a rolling hour. */
  RATE_LIMIT_PER_CLIENT_PER_HOUR: int(5, 1, 1000),
  RATE_LIMIT_GLOBAL_PER_HOUR: int(100, 1, 100_000),
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Treat `KEY=` (empty) as unset, so a copied .env.example works as-is.
  const present = Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== "");
  return EnvSchema.parse(Object.fromEntries(present));
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export type SupabasePublicConfig = { url: string; publishableKey: string };

export function supabasePublicConfig(env: ServerEnv = serverEnv()): SupabasePublicConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

export function supabaseSecretKey(env: ServerEnv = serverEnv()): string | undefined {
  return env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
}

export type GenerationMode =
  | { mode: "demo"; reason: string }
  /** `none`: no database is configured, so explanations are generated and shown but never saved. */
  | { mode: "live"; storage: "database" | "none" }
  | { mode: "misconfigured"; missing: string[] };

/**
 * Live generation needs OpenAI. With Supabase (URL, publishable key, and
 * secret key) it also rate-limits in Postgres and saves results; with no
 * Supabase settings at all it runs without saving. Partial Supabase settings
 * are an error, so a typo cannot silently turn saving off. Demo mode needs
 * nothing.
 */
export function generationMode(env: ServerEnv = serverEnv()): GenerationMode {
  const requested = env.GENERATION_MODE ?? (env.OPENAI_API_KEY ? "live" : "demo");
  if (requested === "demo") {
    return {
      mode: "demo",
      reason: env.GENERATION_MODE === "demo" ? "GENERATION_MODE is set to demo" : "OPENAI_API_KEY is not set",
    };
  }
  const missing: string[] = [];
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  const anySupabase = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || supabaseSecretKey(env),
  );
  if (anySupabase) {
    if (!supabasePublicConfig(env)) missing.push("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseSecretKey(env)) missing.push("SUPABASE_SECRET_KEY");
  }
  if (missing.length) return { mode: "misconfigured", missing };
  return { mode: "live", storage: anySupabase ? "database" : "none" };
}

export type ModelConfig = {
  extractor: string;
  generator: string;
  evaluator: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export function modelConfig(env: ServerEnv = serverEnv()): ModelConfig {
  const fallback = env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  return {
    extractor: env.OPENAI_EXTRACTOR_MODEL ?? fallback,
    generator: env.OPENAI_GENERATOR_MODEL ?? fallback,
    evaluator: env.OPENAI_EVALUATOR_MODEL ?? fallback,
    reasoningEffort: env.OPENAI_REASONING_EFFORT,
  };
}
