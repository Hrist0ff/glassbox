import { validateConcept } from "@/lib/concept/validate";
import type { Concept } from "@/lib/concept/schema";

/**
 * Explanations generated in this browser, saved in localStorage. Nothing is
 * stored on the server, so a saved explanation's link works only in the
 * browser that made it.
 *
 * Stored data is generated content that the reader could edit, so every
 * read validates it again and drops anything invalid.
 */

const KEY = "glassbox:library";

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

/** The raw stored value: a stable snapshot for `useSyncExternalStore`. */
export function readLibraryRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parseItem(value: unknown): SavedExplanation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SavedExplanation>;
  const checked = validateConcept(item.concept);
  if (!checked.ok || typeof item.topic !== "string" || typeof item.createdAt !== "string") return null;
  return { topic: item.topic, concept: checked.concept, createdAt: item.createdAt, attempts: typeof item.attempts === "number" ? item.attempts : 1 };
}

/** Saved explanations, newest first. Invalid entries are skipped. */
export function parseLibrary(raw: string | null): SavedExplanation[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { items?: unknown };
    return Array.isArray(data.items) ? data.items.flatMap((item) => parseItem(item) ?? []) : [];
  } catch {
    return [];
  }
}

function write(items: SavedExplanation[]): SaveResult {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, items }));
    return "saved";
  } catch (error) {
    return error instanceof DOMException && error.name === "QuotaExceededError" ? "full" : "blocked";
  }
}

/** Save an explanation at the top of the library. It can be opened during this visit even if saving fails. */
export function saveExplanation(item: SavedExplanation): SaveResult {
  thisVisit.set(item.concept.id, item);
  const others = parseLibrary(readLibraryRaw()).filter((saved) => saved.concept.id !== item.concept.id);
  const result = write([item, ...others]);
  notify();
  return result;
}

export function deleteExplanation(id: string): void {
  thisVisit.delete(id);
  write(parseLibrary(readLibraryRaw()).filter((saved) => saved.concept.id !== id));
  notify();
}

/** A saved explanation by id, from storage or from this visit. */
export function findExplanation(raw: string | null, id: string): { item: SavedExplanation; stored: boolean } | null {
  const stored = parseLibrary(raw).find((saved) => saved.concept.id === id);
  if (stored) return { item: stored, stored: true };
  const unsaved = thisVisit.get(id);
  return unsaved ? { item: unsaved, stored: false } : null;
}
