import { describe, expect, it } from "vitest";
import { generationMode, modelConfig, parseServerEnv } from "@/lib/env";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SECRET_KEY: "sk",
};

describe("server env", () => {
  it("treats empty values as unset (a copied .env.example parses)", () => {
    const env = parseServerEnv({ GENERATION_MODE: "", OPENAI_API_KEY: "", OPENAI_REASONING_EFFORT: "", GENERATION_DEADLINE_MS: "" });
    expect(env.GENERATION_MODE).toBeUndefined();
    expect(env.GENERATION_DEADLINE_MS).toBe(270_000);
    expect(generationMode(env)).toMatchObject({ mode: "demo" });
  });

  it("goes live with OpenAI, saving only when Supabase is fully configured", () => {
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k" }))).toEqual({ mode: "live", storage: "none" });
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k", ...supabase }))).toEqual({ mode: "live", storage: "database" });
    // Partial Supabase settings are an error, never a silent switch to unsaved mode.
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1" }))).toMatchObject({
      mode: "misconfigured",
    });
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k", GENERATION_MODE: "demo", ...supabase }))).toMatchObject({ mode: "demo" });
  });

  it("keeps the deadline below the 300 s route limit", () => {
    expect(() => parseServerEnv({ GENERATION_DEADLINE_MS: "300000" })).toThrow();
    expect(parseServerEnv({ GENERATION_DEADLINE_MS: "120000" }).GENERATION_DEADLINE_MS).toBe(120_000);
  });

  it("lets each role use its own model", () => {
    const models = modelConfig(parseServerEnv({ OPENAI_MODEL: "base", OPENAI_EVALUATOR_MODEL: "judge" }));
    expect(models).toMatchObject({ extractor: "base", generator: "base", evaluator: "judge" });
  });
});
