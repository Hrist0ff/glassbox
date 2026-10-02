import { describe, expect, it } from "vitest";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { MemorySlots } from "@/lib/generation/memory-slots";
import { parseUnsaved } from "@/lib/generation/unsaved";
import { GenerationEventSchema } from "@/lib/sse/events";

const limits = { clientLimit: 2, globalLimit: 3, windowSeconds: 3600, leaseSeconds: 60 };

describe("MemorySlots (rate limit without a database)", () => {
  it("allows one running generation per client and frees it on release", () => {
    const slots = new MemorySlots(() => 0);
    expect(slots.claim({ clientKey: "a", requestId: "r1", ...limits })).toEqual({ allowed: true });
    expect(slots.claim({ clientKey: "a", requestId: "r2", ...limits })).toEqual({ allowed: false, reason: "in_progress", retryAfterSeconds: 60 });
    expect(slots.claim({ clientKey: "b", requestId: "r3", ...limits })).toEqual({ allowed: true });
    slots.release("a", "someone-else");
    expect(slots.claim({ clientKey: "a", requestId: "r4", ...limits })).toMatchObject({ reason: "in_progress" });
    slots.release("a", "r1");
    expect(slots.claim({ clientKey: "a", requestId: "r5", ...limits })).toEqual({ allowed: true });
  });

  it("enforces the per-client and global hourly limits, which expire with the window", () => {
    let now = 0;
    const slots = new MemorySlots(() => now);
    const run = (key: string, id: string) => {
      const claim = slots.claim({ clientKey: key, requestId: id, ...limits });
      if (claim.allowed) slots.release(key, id);
      return claim;
    };
    expect(run("a", "1")).toEqual({ allowed: true });
    now = 1000;
    expect(run("a", "2")).toEqual({ allowed: true });
    expect(run("a", "3")).toEqual({ allowed: false, reason: "client_rate_limited", retryAfterSeconds: 3599 });
    expect(run("b", "4")).toEqual({ allowed: true });
    expect(run("c", "5")).toMatchObject({ allowed: false, reason: "global_rate_limited" });
    now = 3_600_001;
    expect(run("a", "6")).toEqual({ allowed: true });
  });
});

describe("unsaved explanations", () => {
  const base = { requestId: "r", seq: 3, type: "completed", conceptId: binarySearch.id, url: "/preview", attempts: 1, persisted: false, demo: false };

  it("travel in the completed event and are schema-checked on the way", () => {
    expect(GenerationEventSchema.safeParse({ ...base, concept: binarySearch }).success).toBe(true);
    expect(GenerationEventSchema.safeParse({ ...base, concept: { ...binarySearch, steps: [] } }).success).toBe(false);
  });

  it("are re-validated when read back from storage", () => {
    const stored = { topic: "Binary search", concept: binarySearch, createdAt: "2026-10-02T10:00:00.000Z" };
    expect(parseUnsaved(JSON.stringify(stored))?.concept.id).toBe(binarySearch.id);
    expect(parseUnsaved(JSON.stringify({ ...stored, concept: { ...binarySearch, title: "" } }))).toBeNull();
    expect(parseUnsaved("not json")).toBeNull();
    expect(parseUnsaved(null)).toBeNull();
  });
});
