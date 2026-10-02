import { validateConcept } from "@/lib/concept/validate";
import type { Concept } from "@/lib/concept/schema";

/**
 * Hand-off for explanations generated without a database: the generator puts
 * the result in this tab's sessionStorage and opens /preview, which reads it.
 * Nothing leaves the browser, and closing the tab discards it.
 */
const KEY = "stepwise:unsaved-explanation";

export type UnsavedExplanation = { topic: string; concept: Concept; createdAt: string };

/** Returns false when the browser refuses storage (for example, some private modes). */
export function storeUnsaved(value: UnsavedExplanation): boolean {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readUnsavedRaw(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Parses and re-validates stored data: it is generated content and could have been edited. */
export function parseUnsaved(raw: string | null): UnsavedExplanation | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<UnsavedExplanation>;
    const checked = validateConcept(data.concept);
    if (!checked.ok || typeof data.topic !== "string" || typeof data.createdAt !== "string") return null;
    return { topic: data.topic, concept: checked.concept, createdAt: data.createdAt };
  } catch {
    return null;
  }
}
