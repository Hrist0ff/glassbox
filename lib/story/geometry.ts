import { panelSize, type PanelShape } from "@/lib/concept/geometry";
import type { Entity, PanelEntity } from "./types";

/**
 * Scales and sizes shared by the renderer, the camera, and the story linter.
 *
 * Like the original, positions map the 0–100 domain onto the stage's width
 * and height independently, while sizes and fonts use the smaller of the two
 * scales so shapes keep their proportions on any screen.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const FULL_BOX: Box = { x0: 0, y0: 0, x1: 100, y1: 100 };

/** Default sizes, in size units. */
export const SIZE = {
  nodeRadius: 5,
  cellW: 7,
  cellH: 6,
  cardFont: 5,
  textFont: 7,
  descFont: 7,
  packetFont: 7,
  dot: 2,
  hollowDot: 1.3,
} as const;

/** Monospace glyph advance and line height, as fractions of the font size. */
export const MONO = { advance: 0.6, line: 1.3 } as const;

/** Fraction of each axis a font of size 100 would span (from the original). */
const FONT_RATIO = { x: 0.35, y: 0.4 } as const;

export type Scales = {
  x: (v: number) => number;
  y: (v: number) => number;
  size: (v: number) => number;
  font: (v: number) => number;
};

export function makeScales(box: Box, width: number, height: number): Scales {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  return {
    x: (v) => ((v - box.x0) / bw) * width,
    y: (v) => ((v - box.y0) / bh) * height,
    size: (v) => Math.min((v / bw) * width, (v / bh) * height),
    font: (v) => Math.min((v / bw) * width * FONT_RATIO.x, (v / bh) * height * FONT_RATIO.y),
  };
}

/** Width of `chars` monospace characters at font size `font`, as an upper bound in domain-x units. */
export const monoWidth = (chars: number, font: number) => chars * MONO.advance * font * FONT_RATIO.x;
/** Height of `lines` monospace lines at font size `font`, as an upper bound in domain-y units. */
export const monoHeight = (lines: number, font: number) => lines * MONO.line * font * FONT_RATIO.y;

/** Card padding as a fraction of its font size. */
export const CARD_PAD = 0.7;

/** Pixel size of a card's box at the given font size in pixels. */
export function cardSize(lines: readonly { text: string }[], fontPx: number) {
  const chars = Math.max(1, ...lines.map((line) => line.text.length));
  const pad = fontPx * CARD_PAD;
  return {
    width: chars * MONO.advance * fontPx + pad * 2,
    height: Math.max(1, lines.length) * MONO.line * fontPx + pad * 2,
    pad,
  };
}

/**
 * Conservative bounding box of an entity in domain units, assuming nothing
 * about the stage's aspect ratio. Used to fit the camera and to lint layouts.
 * Links and cursors have no box of their own.
 */
export function entityBox(entity: Entity): Box | null {
  switch (entity.kind) {
    case "node": {
      const r = entity.r ?? SIZE.nodeRadius;
      return { x0: entity.x - r, y0: entity.y - r, x1: entity.x + r, y1: entity.y + r };
    }
    case "log": {
      const w = entity.cellW ?? SIZE.cellW;
      const h = entity.cellH ?? SIZE.cellH;
      const n = Math.max(1, entity.cells.length);
      return entity.dir === "column"
        ? { x0: entity.x, y0: entity.y, x1: entity.x + w, y1: entity.y + h * n }
        : { x0: entity.x, y0: entity.y, x1: entity.x + w * n, y1: entity.y + h };
    }
    case "card": {
      const font = entity.font ?? SIZE.cardFont;
      const chars = Math.max(1, ...entity.cells.map((c) => c.text.length));
      const w = monoWidth(chars + (CARD_PAD * 2) / MONO.advance, font) / 2;
      const h = monoHeight(Math.max(1, entity.cells.length) + (CARD_PAD * 2) / MONO.line, font) / 2;
      return { x0: entity.x - w, y0: entity.y - h, x1: entity.x + w, y1: entity.y + h };
    }
    case "text": {
      const font = entity.font ?? SIZE.textFont;
      const w = monoWidth(entity.text.length, font);
      const h = monoHeight(1, font);
      const x0 = entity.anchor === "start" ? entity.x : entity.anchor === "end" ? entity.x - w : entity.x - w / 2;
      return { x0, y0: entity.y - h / 2, x1: x0 + w, y1: entity.y + h / 2 };
    }
    case "panel": {
      const { width, height } = panelDomainSize(entity);
      return { x0: entity.x - width / 2, y0: entity.y - height / 2, x1: entity.x + width / 2, y1: entity.y + height / 2 };
    }
    case "cursor":
    case "link":
      return null;
  }
}

/** Arena units per domain unit on each axis (the arena is 1000 × 600, the domain 100 × 100). */
export const ARENA_PER_DOMAIN = { x: 10, y: 6 } as const;

/** Size-deciding shape of a log, code, table, or version-1 timeline panel entity. */
export function storyPanelShape(panel: PanelEntity): PanelShape {
  return {
    kind: panel.variant as PanelShape["kind"],
    titled: panel.title.trim().length > 0,
    count: panel.variant === "table" ? (panel.rows?.length ?? 0) : panel.cells.length,
    columns: panel.columns?.length ?? 0,
    rowLabels: (panel.rows ?? []).some((label) => label.length > 0),
    tags: panel.variant === "log" && panel.cells.some((cell) => (cell.tag ?? "").length > 0),
    longestLine: panel.variant === "code" ? Math.max(0, ...panel.cells.map((cell) => cell.text.length)) : 0,
  };
}

/** Panel size in arena units: its frame, its reserved box, or (version 1) its current content. */
export function panelArenaSize(panel: PanelEntity): { width: number; height: number } {
  return panel.frame?.size ?? panel.box ?? panelSize(storyPanelShape(panel));
}

/** Panel size in domain units. */
export function panelDomainSize(panel: PanelEntity): { width: number; height: number } {
  const { width, height } = panelArenaSize(panel);
  const scale = panel.scale ?? ARENA_PER_DOMAIN;
  return { width: width / scale.x, height: height / scale.y };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }));
}
