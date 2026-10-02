import { describe, expect, it } from "vitest";
import { generationMode, modelConfig, parseServerEnv } from "@/lib/env";

describe("server env", () => {
  it("treats empty values as unset (a copied .env.example parses)", () => {
    const env = parseServerEnv({ GENERATION_MODE: "", OPENAI_API_KEY: "", OPENAI_REASONING_EFFORT: "", GENERATION_DEADLINE_MS: "" });
    expect(env.GENERATION_MODE).toBeUndefined();
    expect(env.GENERATION_DEADLINE_MS).toBe(270_000);
    expect(generationMode(env)).toMatchObject({ mode: "demo" });
  });

  it("goes live with an OpenAI key, and is misconfigured when live is forced without one", () => {
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k" }))).toEqual({ mode: "live" });
    expect(generationMode(parseServerEnv({ GENERATION_MODE: "live" }))).toEqual({ mode: "misconfigured", missing: ["OPENAI_API_KEY"] });
    expect(generationMode(parseServerEnv({ OPENAI_API_KEY: "k", GENERATION_MODE: "demo" }))).toMatchObject({ mode: "demo" });
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
