import { INK } from "./palette";
import type { Ink } from "./types";

/**
 * Tiny caption markup, rendered as React text (never as HTML):
 *
 * - `*words*` for emphasis
 * - `` `code` `` for monospace
 * - `[words|ink]` for words in a palette color, e.g. `[server|steelblue]`
 *
 * Markers that don't close, and unknown inks, stay literal text.
 */
export type Segment =
  | { kind: "text" | "em" | "code"; text: string }
  | { kind: "ink"; text: string; ink: Ink };

const INK_SPAN = /^\[([^\]|]+)\|([a-z]+)\]/;

const isInk = (value: string): value is Ink => Object.hasOwn(INK, value);

export function parseCaption(source: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "*" || ch === "`") {
      const close = source.indexOf(ch, i + 1);
      if (close > i + 1) {
        flush();
        out.push({ kind: ch === "*" ? "em" : "code", text: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    } else if (ch === "[") {
      const match = INK_SPAN.exec(source.slice(i));
      if (match && isInk(match[2]!)) {
        flush();
        out.push({ kind: "ink", text: match[1]!, ink: match[2] });
        i += match[0].length;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The caption without markup, for screen readers and metadata. */
export function captionText(source: string): string {
  return parseCaption(source)
    .map((segment) => segment.text)
    .join("");
}
