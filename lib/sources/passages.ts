import { LIMITS } from "@/lib/concept/constants";
import type { Source } from "@/lib/concept/schema";

/**
 * Pasted material as a source record with stable passage ids.
 *
 * The same text always yields the same passages and ids (p1, p2, …), so
 * claims can cite passages and the citation can be checked again later,
 * in the browser, against the stored source.
 */

export type SourceText = { ok: true; text: string } | { ok: false; message: string };

/** Normalize pasted text: drop control characters (keeping line breaks), trim trailing spaces, cap blank lines. */
export function normalizeSourceText(raw: string): SourceText {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < LIMITS.sourceText.min) {
    return { ok: false, message: `Paste at least ${LIMITS.sourceText.min} characters of material to visualize.` };
  }
  if (text.length > LIMITS.sourceText.max) {
    return {
      ok: false,
      message: `The material is ${text.length.toLocaleString("en")} characters; the limit is ${LIMITS.sourceText.max.toLocaleString("en")}. Paste the part you want explained.`,
    };
  }
  if (!/\p{L}/u.test(text)) return { ok: false, message: "The material needs some text." };
  // Links are not opened: material that is mostly links would be visualized as if the pages had been read.
  const withoutLinks = text.replace(/(https?:\/\/|www\.)\S+/gi, "").replace(/\s+/g, " ").trim();
  if (withoutLinks.length < LIMITS.sourceText.min) {
    return { ok: false, message: "Glassbox can't open links. Paste the text itself, not a link to it." };
  }
  return { ok: true, text };
}

/** Split a paragraph longer than the passage limit at sentence ends, then at spaces. */
function splitLong(paragraph: string): string[] {
  if (paragraph.length <= LIMITS.passage.max) return [paragraph];
  const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]*["'”’)\]]*\s*/g) ?? [paragraph];
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > LIMITS.passage.max) {
      flush();
      // A single enormous sentence: hard-wrap at spaces.
      let rest = sentence.trim();
      while (rest.length > LIMITS.passage.max) {
        const cut = rest.lastIndexOf(" ", LIMITS.passage.max);
        const at = cut > LIMITS.passage.max / 2 ? cut : LIMITS.passage.max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest ? `${rest} ` : "";
      continue;
    }
    if (current.length + sentence.length > LIMITS.passage.max) flush();
    current += sentence;
  }
  flush();
  return out;
}

/**
 * Passages are paragraphs (separated by blank lines; single line breaks
 * inside a list keep each line separate when lines are short), split further
 * when long. A short line that is not a sentence (a heading or label) is
 * merged into what follows, so ids stay meaningful.
 */
export function toPassages(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    // Lists and line-per-fact material: keep lines apart if they look like items.
    const listy = lines.length > 1 && lines.every((l) => l.length < 200);
    return listy ? lines : [lines.join(" ")];
  });
  const merged: string[] = [];
  for (const block of blocks.flatMap(splitLong)) {
    const prev = merged.at(-1);
    // List items stay separate, even when short.
    const heading = prev !== undefined && prev.length < 60 && !/[.!?。！？:;)"”’]$/.test(prev) && !/^([-*•–]|\d+[.)])\s/.test(prev);
    if (prev !== undefined && heading && prev.length + block.length + 1 <= LIMITS.passage.max) {
      merged[merged.length - 1] = `${prev} ${block}`;
    } else merged.push(block);
  }
  return merged;
}

export type SourceResult = { ok: true; source: Source } | { ok: false; message: string };

export function buildSource(raw: string, title: string): SourceResult {
  const normalized = normalizeSourceText(raw);
  if (!normalized.ok) return normalized;
  const passages = toPassages(normalized.text);
  if (passages.length > LIMITS.passages.max) {
    return {
      ok: false,
      message: `The material splits into ${passages.length} passages; the limit is ${LIMITS.passages.max}. Paste a shorter excerpt.`,
    };
  }
  return {
    ok: true,
    source: {
      id: "s1",
      kind: "pasted_text",
      title: title.trim().slice(0, LIMITS.title.max) || "Pasted text",
      passages: passages.map((text, i) => ({ id: `p${i + 1}`, text })),
    },
  };
}

/** Comparable form of text: case, whitespace, quotes, dashes, and ellipses don't matter. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `quote` appears in `passage`, allowing an elided middle written as "..." between two located parts. */
export function quoteInPassage(quote: string, passage: string): boolean {
  const q = normalizeForMatch(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  if (q.length < 8) return false;
  const p = normalizeForMatch(passage);
  if (p.includes(q)) return true;
  const parts = q.split(/\s*\.\.\.\s*/).filter((part) => part.length >= 8);
  if (parts.length < 2) return false;
  let from = 0;
  for (const part of parts) {
    const at = p.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

/** Ids of the passages that contain the quote. */
export function locateQuote(quote: string, source: Source): string[] {
  return source.passages.filter((passage) => quoteInPassage(quote, passage.text)).map((passage) => passage.id);
}
