import { LIMITS } from "@/lib/concept/constants";

/** Shared by the form (instant feedback) and the API (authoritative check). */
export function normalizeTopic(raw: string): { ok: true; topic: string } | { ok: false; message: string } {
  // Drop control characters, collapse whitespace.
  const topic = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim();
  if (topic.length < LIMITS.topic.min) {
    return { ok: false, message: `Enter at least ${LIMITS.topic.min} characters.` };
  }
  if (topic.length > LIMITS.topic.max) {
    return { ok: false, message: `Keep the topic under ${LIMITS.topic.max} characters.` };
  }
  if (!/\p{L}/u.test(topic)) {
    return { ok: false, message: "The topic needs at least one letter." };
  }
  return { ok: true, topic };
}
