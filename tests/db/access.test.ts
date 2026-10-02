import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleConcept, type Concept } from "@/lib/concept/schema";
import { binarySearch } from "@/lib/fixtures/binary-search";

/**
 * Runs against the Supabase project in .env.local (local `supabase start`).
 * There are no accounts: visitors use the anonymous role, the server uses the
 * service role.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set Supabase env vars (see .env.example) before running test:db");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const anon = createClient(url, anonKey, options);

const PUBLIC_SEED_ID = "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01";

function newConcept(): Concept {
  const { title, description, steps } = binarySearch;
  return assembleConcept({ title, description, steps }, randomUUID());
}

function row(concept: Concept, visibility: "public" | "private" = "public") {
  return {
    id: concept.id,
    title: concept.title,
    description: concept.description,
    schema_version: 1,
    content: concept,
    visibility,
    origin: "ai_generated",
    source_topic: "binary search",
  };
}

const created: string[] = [];
let generated: Concept;
let legacyPrivate: Concept;

beforeAll(async () => {
  generated = newConcept();
  // A row saved as private before accounts were removed.
  legacyPrivate = newConcept();
  const insert = await admin.from("concepts").insert([row(generated), row(legacyPrivate, "private")]);
  if (insert.error) throw insert.error;
  created.push(generated.id, legacyPrivate.id);
});

afterAll(async () => {
  if (created.length) await admin.from("concepts").delete().in("id", created);
});

describe("row level security on concepts", () => {
  it("lets anyone read curated and generated public concepts", async () => {
    const { data, error } = await anon.from("concepts").select("id").in("id", [PUBLIC_SEED_ID, generated.id]);
    expect(error).toBeNull();
    expect(data?.map((r) => r.id).sort()).toEqual([PUBLIC_SEED_ID, generated.id].sort());
  });

  it("keeps rows saved as private hidden from everyone using the API", async () => {
    const one = await anon.from("concepts").select("id").eq("id", legacyPrivate.id);
    expect(one.error).toBeNull();
    expect(one.data).toEqual([]);
    const all = await anon.from("concepts").select("id");
    expect(all.data?.map((r) => r.id)).not.toContain(legacyPrivate.id);
  });

  it("denies inserts, updates, and deletes through the anonymous role", async () => {
    const forged = newConcept();
    const insert = await anon.from("concepts").insert(row(forged));
    expect(insert.error).not.toBeNull();

    const update = await anon.from("concepts").update({ title: "Changed by a visitor" }).eq("id", generated.id).select();
    expect(update.error !== null || update.data?.length === 0).toBe(true);
    const remove = await anon.from("concepts").delete().eq("id", generated.id).select();
    expect(remove.error !== null || remove.data?.length === 0).toBe(true);

    const still = await admin.from("concepts").select("title").eq("id", generated.id).single();
    expect(still.data?.title).toBe(generated.title);
  });
});

describe("database constraints", () => {
  it("rejects content whose id does not match the row", async () => {
    const concept = newConcept();
    const result = await admin.from("concepts").insert({ ...row(concept), id: randomUUID() });
    expect(result.error?.code).toBe("23514");
  });

  it("allows one saved concept per idempotency key", async () => {
    const key = randomUUID();
    const a = newConcept();
    const b = newConcept();
    const first = await admin.from("concepts").insert({ ...row(a), generation_request_id: key });
    expect(first.error).toBeNull();
    created.push(a.id);
    const second = await admin.from("concepts").insert({ ...row(b), generation_request_id: key });
    expect(second.error?.code).toBe("23505");
  });
});

describe("generation slot functions", () => {
  const claim = (client: SupabaseClient, clientKey: string, requestId: string, clientLimit = 2) =>
    client.rpc("claim_generation_slot", {
      p_client_key: clientKey,
      p_request_id: requestId,
      p_client_limit: clientLimit,
      p_global_limit: 1000,
      p_window_seconds: 3600,
      p_lease_seconds: 60,
    });

  it("cannot be called by anonymous API users", async () => {
    const key = `test-${randomUUID()}`;
    expect((await claim(anon, key, randomUUID())).error).not.toBeNull();
    expect((await anon.rpc("release_generation_slot", { p_client_key: key, p_request_id: randomUUID() })).error).not.toBeNull();
  });

  it("enforces one running generation per client and an hourly limit", async () => {
    const key = `test-${randomUUID()}`;
    const first = randomUUID();
    const a = await claim(admin, key, first);
    expect(a.data?.[0]).toMatchObject({ allowed: true, reason: "ok" });

    const concurrent = await claim(admin, key, randomUUID());
    expect(concurrent.data?.[0]).toMatchObject({ allowed: false, reason: "in_progress" });

    // Another client is not blocked by this one's lease.
    expect((await claim(admin, `test-${randomUUID()}`, randomUUID())).data?.[0]).toMatchObject({ allowed: true });

    await admin.rpc("release_generation_slot", { p_client_key: key, p_request_id: first });
    const second = randomUUID();
    expect((await claim(admin, key, second)).data?.[0]).toMatchObject({ allowed: true });
    await admin.rpc("release_generation_slot", { p_client_key: key, p_request_id: second });

    const third = await claim(admin, key, randomUUID());
    expect(third.data?.[0]).toMatchObject({ allowed: false, reason: "client_rate_limited" });
    expect(third.data?.[0].retry_after_seconds).toBeGreaterThan(0);
  });
});
