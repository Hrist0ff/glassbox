import { validateConcept } from "@/lib/concept/validate";
import { migrateConcept, SupplementSchema, type Concept, type Supplement } from "@/lib/concept/schema";

/**
 * Explanations generated in this browser, saved in localStorage. Nothing is
 * stored on the server, so a saved explanation's link works only in the
 * browser that made it.
 *
 * Stored data is generated content that the reader could edit, so every
 * read validates it again and drops anything invalid. Older versions are
 * migrated on read:
 *   - library version 1 → 2: same entries; their concepts are migrated from
 *     concept schema version 1 by `validateConcept`.
 *   - supplements (explanations, simpler versions, and examples for one step)
 *     live under their own key, version 1, and are deleted with their
 *     explanation.
 */

const KEY = "glassbox:library";
const SUPPLEMENTS_KEY = "glassbox:supplements";
export const LIBRARY_VERSION = 2;
const SUPPLEMENTS_VERSION = 1;
/** Library versions this code can read. */
const READABLE_VERSIONS = new Set([1, 2]);
const READABLE_SUPPLEMENT_VERSIONS = new Set([SUPPLEMENTS_VERSION]);

export type SavedExplanation = {
  topic: string;
  concept: Concept;
  createdAt: string;
  /** Drafts needed before one passed review. */
  attempts: number;
};

export type SaveResult = "saved" | "full" | "blocked";

const listeners = new Set<() => void>();
/** This visit's explanations, so one can still be opened when storage is full or blocked. */
const thisVisit = new Map<string, SavedExplanation>();
const thisVisitSupplements = new Map<string, Supplement>();
/** Bumped on every supplement change, so a snapshot changes even when storage is blocked. */
let supplementsVersion = 0;

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeLibrary(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: unknown): SaveResult {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return "saved";
  } catch (error) {
    return error instanceof DOMException && error.name === "QuotaExceededError" ? "full" : "blocked";
  }
}

/** The raw stored value: a stable snapshot for `useSyncExternalStore`. */
export function readLibraryRaw(): string | null {
  return readKey(KEY);
}

export function readSupplementsRaw(): string | null {
  return readKey(SUPPLEMENTS_KEY);
}

/** Snapshot for `useSyncExternalStore`: the stored value plus this visit's unsaved changes. */
export function readSupplementsSnapshot(): string {
  return `${supplementsVersion}\u0000${readSupplementsRaw() ?? ""}`;
}

/** The stored part of a snapshot. */
export const supplementsRawOf = (snapshot: string) => snapshot.slice(snapshot.indexOf("\u0000") + 1) || null;

/**
 * The stored entries as they are, for rewriting. `writable` is false when the
 * value was written by an unknown (newer) version of the app.
 */
function storedEntries(key: string, versions: Set<number>): { writable: boolean; items: unknown[] } {
  const raw = readKey(key);
  if (!raw) return { writable: true, items: [] };
  try {
    const data = JSON.parse(raw) as { version?: unknown; items?: unknown };
    if (typeof data.version === "number" && !versions.has(data.version)) return { writable: false, items: [] };
    return { writable: true, items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    // Unparseable storage holds nothing recoverable.
    return { writable: true, items: [] };
  }
}

const conceptIdOf = (entry: unknown) =>
  entry && typeof entry === "object" ? ((entry as { concept?: { id?: unknown } }).concept?.id ?? null) : null;
const fieldOf = (entry: unknown, field: string) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>)[field] : undefined);

function parseItem(value: unknown): SavedExplanation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SavedExplanation>;
  const checked = validateConcept(item.concept);
  if (!checked.ok || typeof item.topic !== "string" || typeof item.createdAt !== "string") return null;
  return { topic: item.topic, concept: checked.concept, createdAt: item.createdAt, attempts: typeof item.attempts === "number" ? item.attempts : 1 };
}

/** Saved explanations, newest first, migrated to the current version. Invalid entries are skipped. */
export function parseLibrary(raw: string | null): SavedExplanation[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { version?: unknown; items?: unknown };
    // A library written by a newer version of the app is left alone rather than misread.
    if (typeof data.version === "number" && !READABLE_VERSIONS.has(data.version)) return [];
    return Array.isArray(data.items) ? data.items.flatMap((item) => parseItem(item) ?? []) : [];
  } catch {
    return [];
  }
}

/** Save an explanation at the top of the library. It can be opened during this visit even if saving fails. */
export function saveExplanation(item: SavedExplanation): SaveResult {
  thisVisit.set(item.concept.id, item);
  const stored = storedEntries(KEY, READABLE_VERSIONS);
  const result = stored.writable
    ? writeKey(KEY, { version: LIBRARY_VERSION, items: [item, ...stored.items.filter((entry) => conceptIdOf(entry) !== item.concept.id)] })
    : "blocked";
  notify();
  return result;
}

/** Delete an explanation and everything made for its steps. */
export function deleteExplanation(id: string): void {
  thisVisit.delete(id);
  const stored = storedEntries(KEY, READABLE_VERSIONS);
  if (stored.writable) writeKey(KEY, { version: LIBRARY_VERSION, items: stored.items.filter((entry) => conceptIdOf(entry) !== id) });
  for (const [key, s] of thisVisitSupplements) if (s.conceptId === id) thisVisitSupplements.delete(key);
  supplementsVersion += 1;
  const supplements = storedEntries(SUPPLEMENTS_KEY, READABLE_SUPPLEMENT_VERSIONS);
  if (supplements.writable) {
    writeKey(SUPPLEMENTS_KEY, { version: SUPPLEMENTS_VERSION, items: supplements.items.filter((entry) => fieldOf(entry, "conceptId") !== id) });
  }
  notify();
}

/** A saved explanation by id, from storage or from this visit. */
export function findExplanation(raw: string | null, id: string): { item: SavedExplanation; stored: boolean } | null {
  const stored = parseLibrary(raw).find((saved) => saved.concept.id === id);
  if (stored) return { item: stored, stored: true };
  const unsaved = thisVisit.get(id);
  return unsaved ? { item: unsaved, stored: false } : null;
}

// ---------------------------------------------------------------------------
// Supplements for steps
// ---------------------------------------------------------------------------

function parseSupplement(value: unknown): Supplement | null {
  // Examples hold a concept: migrate it first, as the library does.
  const upgraded = fieldOf(value, "kind") === "example" ? { ...(value as object), concept: migrateConcept(fieldOf(value, "concept")) } : value;
  const parsed = SupplementSchema.safeParse(upgraded);
  if (!parsed.success) return null;
  if (parsed.data.kind !== "example") return parsed.data;
  // An example is an explanation in its own right: validate it like one.
  const checked = validateConcept(parsed.data.concept);
  return checked.ok ? { ...parsed.data, concept: checked.concept } : null;
}

/** Every stored supplement, newest first. Invalid entries are skipped. */
export function parseSupplements(raw: string | null): Supplement[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { version?: unknown; items?: unknown };
    if (typeof data.version !== "number" || !READABLE_SUPPLEMENT_VERSIONS.has(data.version) || !Array.isArray(data.items)) return [];
    return data.items.flatMap((item) => parseSupplement(item) ?? []);
  } catch {
    return [];
  }
}


/** Supplements for one explanation, from storage and from this visit, newest first. */
export function supplementsFor(raw: string | null, conceptId: string): Supplement[] {
  const stored = parseSupplements(raw).filter((s) => s.conceptId === conceptId);
  const ids = new Set(stored.map((s) => s.id));
  const unsaved = [...thisVisitSupplements.values()].filter((s) => s.conceptId === conceptId && !ids.has(s.id));
  return [...unsaved, ...stored].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keep a supplement; if storage is full or blocked, it stays available for this visit only. */
export function saveSupplement(supplement: Supplement): SaveResult {
  supplementsVersion += 1;
  const stored = storedEntries(SUPPLEMENTS_KEY, READABLE_SUPPLEMENT_VERSIONS);
  const result = stored.writable
    ? writeKey(SUPPLEMENTS_KEY, { version: SUPPLEMENTS_VERSION, items: [supplement, ...stored.items.filter((entry) => fieldOf(entry, "id") !== supplement.id)] })
    : "blocked";
  if (result === "saved") thisVisitSupplements.delete(supplement.id);
  else thisVisitSupplements.set(supplement.id, supplement);
  notify();
  return result;
}

export function deleteSupplement(id: string): void {
  thisVisitSupplements.delete(id);
  supplementsVersion += 1;
  const stored = storedEntries(SUPPLEMENTS_KEY, READABLE_SUPPLEMENT_VERSIONS);
  if (stored.writable) writeKey(SUPPLEMENTS_KEY, { version: SUPPLEMENTS_VERSION, items: stored.items.filter((entry) => fieldOf(entry, "id") !== id) });
  notify();
}
