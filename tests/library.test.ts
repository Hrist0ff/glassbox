// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { dnsResolution } from "@/lib/fixtures/dns";
import { MemorySlots } from "@/lib/generation/memory-slots";
import { deleteExplanation, findExplanation, parseLibrary, readLibraryRaw, readSupplementsRaw, saveExplanation, saveSupplement, supplementsFor } from "@/lib/library";
import { compoundInterest } from "@/lib/fixtures/compound-interest";
import { GenerationEventSchema } from "@/lib/sse/events";

const limits = { clientLimit: 2, globalLimit: 3, windowSeconds: 3600, leaseSeconds: 60 };

describe("MemorySlots (rate limit)", () => {
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

describe("the completed event", () => {
  const base = { requestId: "r", seq: 3, type: "completed", conceptId: binarySearch.id, url: `/concept/${binarySearch.id}`, attempts: 1, persisted: false, demo: false };

  it("carries the generated explanation, schema-checked on the way", () => {
    expect(GenerationEventSchema.safeParse({ ...base, concept: binarySearch }).success).toBe(true);
    expect(GenerationEventSchema.safeParse({ ...base, concept: { ...binarySearch, steps: [] } }).success).toBe(false);
  });
});

describe("the browser library", () => {
  const item = (concept = binarySearch, topic = "Binary search") => ({ topic, concept, createdAt: "2026-10-02T10:00:00.000Z", attempts: 1 });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("saves explanations newest first, without duplicates, and deletes them", () => {
    expect(saveExplanation(item())).toBe("saved");
    expect(saveExplanation(item(dnsResolution, "DNS"))).toBe("saved");
    expect(saveExplanation(item())).toBe("saved"); // saved again: moves to the top
    expect(parseLibrary(readLibraryRaw()).map((i) => i.topic)).toEqual(["Binary search", "DNS"]);

    deleteExplanation(binarySearch.id);
    expect(parseLibrary(readLibraryRaw()).map((i) => i.topic)).toEqual(["DNS"]);
    expect(findExplanation(readLibraryRaw(), binarySearch.id)).toBeNull();
  });

  it("validates stored data again and skips anything invalid", () => {
    saveExplanation(item());
    const stored = JSON.parse(readLibraryRaw()!);
    stored.items.push({ topic: "edited", concept: { ...dnsResolution, title: "" }, createdAt: "x" }, "garbage");
    window.localStorage.setItem("glassbox:library", JSON.stringify(stored));
    expect(parseLibrary(readLibraryRaw()).map((i) => i.topic)).toEqual(["Binary search"]);
    expect(parseLibrary("not json")).toEqual([]);
    expect(parseLibrary(null)).toEqual([]);
  });

  it("reads a version-1 library written before this release, migrating its explanations", () => {
    const v1 = { version: 1, items: [{ topic: "Binary search", concept: { ...structuredClone(binarySearch), schemaVersion: 1 }, createdAt: "2026-10-01T09:00:00.000Z", attempts: 2 }] };
    window.localStorage.setItem("glassbox:library", JSON.stringify(v1));
    const [item] = parseLibrary(readLibraryRaw());
    expect(item).toMatchObject({ topic: "Binary search", attempts: 2, concept: { schemaVersion: 2, id: binarySearch.id } });
    expect(item!.concept.steps).toEqual(binarySearch.steps);
    // Saving again writes the current version.
    saveExplanation(item!);
    expect(JSON.parse(readLibraryRaw()!).version).toBe(2);
  });

  it("leaves a library from a newer, unknown version alone, and never overwrites it", () => {
    const newer = JSON.stringify({ version: 99, items: [item()] });
    window.localStorage.setItem("glassbox:library", newer);
    expect(parseLibrary(readLibraryRaw())).toEqual([]);
    expect(saveExplanation(item(dnsResolution, "DNS"))).toBe("blocked");
    deleteExplanation(binarySearch.id);
    expect(readLibraryRaw()).toBe(newer);
    // It still opens for this visit.
    expect(findExplanation(readLibraryRaw(), dnsResolution.id)).toMatchObject({ stored: false });
  });

  it("keeps entries it cannot validate when it writes, instead of deleting them", () => {
    const unreadable = { topic: "edited elsewhere", concept: { ...dnsResolution, id: "7a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a00", title: "" }, createdAt: "x" };
    window.localStorage.setItem("glassbox:library", JSON.stringify({ version: 2, items: [unreadable] }));
    saveExplanation(item());
    deleteExplanation("6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a77");
    expect(JSON.parse(readLibraryRaw()!).items).toEqual([expect.objectContaining({ topic: "Binary search" }), unreadable]);
  });

  it("keeps step supplements beside their explanation, validates them, and deletes them with it", () => {
    saveExplanation(item());
    const base = { conceptId: binarySearch.id, stepId: binarySearch.steps[1]!.id, createdAt: "2026-10-02T10:00:00.000Z" };
    saveSupplement({ kind: "explain", id: "0b1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01", ...base, text: "Why the middle matters.", claims: [] });
    saveSupplement({ kind: "example", id: "0b1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a02", ...base, createdAt: "2026-10-02T11:00:00.000Z", concept: compoundInterest });
    expect(supplementsFor(readSupplementsRaw(), binarySearch.id).map((s) => s.kind)).toEqual(["example", "explain"]);

    // Edited storage: an invalid example is dropped on read.
    const stored = JSON.parse(readSupplementsRaw()!);
    stored.items[0].concept.steps = [];
    window.localStorage.setItem("glassbox:supplements", JSON.stringify(stored));
    expect(supplementsFor(readSupplementsRaw(), binarySearch.id).map((s) => s.kind)).toEqual(["explain"]);

    deleteExplanation(binarySearch.id);
    expect(JSON.parse(readSupplementsRaw()!).items).toEqual([]);
  });

  it("still opens an explanation during this visit when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(saveExplanation(item(dnsResolution, "DNS"))).toBe("full");
    expect(findExplanation(readLibraryRaw(), dnsResolution.id)).toMatchObject({ stored: false, item: { topic: "DNS" } });
  });
});
