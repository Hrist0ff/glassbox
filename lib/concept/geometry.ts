import { ARENA, EDGE_LABEL, LABEL, NODE, PANEL, type Arena } from "./constants";
import type { NodeShape, Panel, VisualNode } from "./schema";

/**
 * Deterministic geometry shared by the renderer and the validator, so the
 * validator checks the same boxes the player draws.
 *
 * Text width is *estimated* from character counts with a conservative average
 * glyph width. Real rendering depends on the font and the exact glyphs, so the
 * geometric checks are heuristics: they catch clear overlaps and overflow, but
 * they cannot prove a scene is readable.
 */

export type Point = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

const collapse = (text: string) => text.trim().replace(/\s+/g, " ");

/** East Asian wide and fullwidth characters take about two monospace cells. */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Width of text in monospace cells: wide characters count twice. */
export function visualLength(text: string): number {
  let n = 0;
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/** Labels of at most this many characters stay on one line. */
const SINGLE_LINE_CHARS = 14;

/**
 * Wrap a node label into at most two lines. Prefers a balanced split at a
 * space; falls back to a hard break for long unbroken words.
 */
export function wrapLabel(label: string): string[] {
  const text = collapse(label);
  if (text.length <= SINGLE_LINE_CHARS) return [text];

  let best: [string, string] | null = null;
  let bestWidth = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    const a = text.slice(0, i);
    const b = text.slice(i + 1);
    const width = Math.max(a.length, b.length);
    if (width < bestWidth) {
      best = [a, b];
      bestWidth = width;
    }
  }
  if (best && bestWidth <= LABEL.maxLineChars) return best;
  if (text.length <= LABEL.maxLineChars) return [text];

  const cut = Math.ceil(text.length / 2);
  return [text.slice(0, cut), text.slice(cut)];
}

export function nodeBox(node: Pick<VisualNode, "x" | "y">): Box {
  return {
    x0: node.x - NODE.radius,
    y0: node.y - NODE.radius,
    x1: node.x + NODE.radius,
    y1: node.y + NODE.radius,
  };
}

/**
 * Estimated box of the label drawn below a node. `wide` counts East Asian
 * wide characters twice; it applies to concepts laid out by the layout
 * engine. Version-1 concepts keep the original per-character estimate, so
 * explanations that were valid when saved stay valid.
 */
export function labelBox(node: Pick<VisualNode, "x" | "y" | "label">, wide = false): Box {
  const lines = wrapLabel(node.label);
  const width = Math.max(...lines.map((line) => (wide ? visualLength(line) : line.length))) * LABEL.charWidth;
  const top = node.y + NODE.radius + LABEL.gap;
  return {
    x0: node.x - width / 2,
    y0: top,
    x1: node.x + width / 2,
    y1: top + lines.length * LABEL.lineHeight,
  };
}

export function edgeLabelSize(label: string): { width: number; height: number } {
  return {
    width: visualLength(collapse(label)) * EDGE_LABEL.charWidth + EDGE_LABEL.paddingX * 2,
    height: EDGE_LABEL.height,
  };
}

export function boxesOverlap(a: Box, b: Box, padding = 0): boolean {
  return (
    a.x0 - padding < b.x1 &&
    b.x0 - padding < a.x1 &&
    a.y0 - padding < b.y1 &&
    b.y0 - padding < a.y1
  );
}

export function insideArena(box: Box, margin: number = ARENA.safeMargin, arena: Arena = ARENA): boolean {
  return (
    box.x0 >= margin &&
    box.y0 >= margin &&
    box.x1 <= arena.width - margin &&
    box.y1 <= arena.height - margin
  );
}

/**
 * Point where a ray from the node center toward `toward` leaves the node shape.
 * Squares are treated as their bounding square (rounded corners are ignored).
 */
export function boundaryPoint(
  shape: NodeShape,
  center: Point,
  toward: Point,
  inset = 0,
): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return center;
  const r = NODE.radius + inset;
  const t = shape === "circle" ? r / length : r / Math.max(Math.abs(dx), Math.abs(dy));
  return { x: center.x + dx * t, y: center.y + dy * t };
}

/** Perpendicular offset used to separate A→B and B→A edges drawn together. */
export const BIDIRECTIONAL_BEND = 26;
/** Distance kept between the arrow tip and the target node outline. */
const ARROW_CLEARANCE = 3;

export type EdgeGeometry = {
  start: Point;
  control: Point;
  end: Point;
  /** Quadratic Bézier path; always `M … Q …` so it interpolates cleanly. */
  d: string;
  mid: Point;
};

/**
 * Geometry of an edge between two node shapes. The path starts and ends on the
 * shape boundaries rather than at the centers. `bend` curves the edge to the
 * left of the from→to direction, which keeps opposite-direction pairs apart.
 */
export function edgeGeometry(
  from: { x: number; y: number; shape: NodeShape },
  to: { x: number; y: number; shape: NodeShape },
  bend = 0,
): EdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const control = {
    x: (from.x + to.x) / 2 + nx * bend * 2,
    y: (from.y + to.y) / 2 + ny * bend * 2,
  };
  const start = boundaryPoint(from.shape, from, control);
  const end = boundaryPoint(to.shape, to, control, ARROW_CLEARANCE);
  const mid = quadraticPoint(start, control, end, 0.5);
  const f = (n: number) => n.toFixed(2);
  return {
    start,
    control,
    end,
    mid,
    d: `M ${f(start.x)} ${f(start.y)} Q ${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`,
  };
}

export function quadraticPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/** Shortest distance from point `p` to segment `a`–`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Keep a box of the given size, centered on `p`, inside the arena. */
export function clampCenterToArena(p: Point, width: number, height: number): Point {
  const m = ARENA.safeMargin / 2;
  return {
    x: Math.min(Math.max(p.x, m + width / 2), ARENA.width - m - width / 2),
    y: Math.min(Math.max(p.y, m + height / 2), ARENA.height - m - height / 2),
  };
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/**
 * What decides the size of a log, code, table, or version-1 timeline panel.
 * Built from a concept panel or a story panel entity. The other panels are
 * measured from their frames (`frames.ts`).
 */
export type PanelShape = {
  kind: "log" | "code" | "table" | "timeline";
  titled: boolean;
  /** Records (log), events (timeline), lines (code), or rows (table). */
  count: number;
  /** Tables only. */
  columns: number;
  rowLabels: boolean;
  /** Logs only: offsets drawn above the records. */
  tags: boolean;
  /** Code only, in characters. */
  longestLine: number;
};

/** Panel size in arena units. The renderer lays panels out with the same constants. */
export function panelSize(shape: PanelShape): { width: number; height: number } {
  const title = shape.titled ? PANEL.title : 0;
  const n = Math.max(1, shape.count);
  switch (shape.kind) {
    case "log":
      return { width: n * PANEL.record.width, height: title + (shape.tags ? PANEL.record.tag : 0) + PANEL.record.height };
    case "timeline":
      return { width: n * PANEL.timeline.spacing, height: title + PANEL.timeline.date + PANEL.timeline.axis + PANEL.timeline.text };
    case "code":
      return {
        width: PANEL.code.gutter + Math.max(PANEL.code.minChars, shape.longestLine) * PANEL.code.charWidth + PANEL.code.padding * 2,
        height: title + n * PANEL.code.lineHeight + PANEL.code.padding * 2,
      };
    case "table":
      return {
        width: (shape.rowLabels ? PANEL.table.rowLabel : 0) + Math.max(1, shape.columns) * PANEL.table.column,
        height: title + PANEL.table.header + n * PANEL.table.row,
      };
  }
}

export function conceptPanelShape(panel: Extract<Panel, { kind: PanelShape["kind"] }>): PanelShape {
  const base = { kind: panel.kind, titled: panel.label.trim().length > 0, columns: 0, rowLabels: false, tags: false, longestLine: 0 };
  switch (panel.kind) {
    case "log":
      return { ...base, count: panel.items.length, tags: panel.items.some((item) => item.tag.length > 0) };
    case "timeline":
      return { ...base, count: panel.items.length };
    case "code":
      return { ...base, count: panel.lines.length, longestLine: Math.max(0, ...panel.lines.map((line) => line.text.length)) };
    case "table":
      return { ...base, count: panel.rows.length, columns: panel.columns.length, rowLabels: panel.rows.some((row) => row.label.length > 0) };
  }
}

/** Box of the given size centered on a point. */
export function centeredBox(center: Point, size: { width: number; height: number }): Box {
  return { x0: center.x - size.width / 2, y0: center.y - size.height / 2, x1: center.x + size.width / 2, y1: center.y + size.height / 2 };
}
