import { PANEL } from "@/lib/concept/constants";
import { panelSize } from "@/lib/concept/geometry";
import { liveValue, type Live } from "@/lib/story/engine";
import { ARENA_PER_DOMAIN, MONO, panelArenaSize, storyPanelShape, type Scales } from "@/lib/story/geometry";
import { TONE } from "@/lib/story/palette";
import type { Cell, PanelEntity } from "@/lib/story/types";
import { fitFont } from "../draw";

/**
 * Where a panel is on screen, and helpers that map its arena-unit layout to
 * pixels. Panels are drawn at one scale on both axes (the smaller of the
 * stage's two), so the drawing always fits inside the box the validator
 * measured and keeps its proportions when the camera zooms.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const BORDER = "#000";
export const MARK = "#dce8f4";
export const MUTED = "#8a8a8a";
export const FAINT = "#d4d4d4";

export function panelFrame(live: Live, t: number, s: Scales) {
  const entity: PanelEntity = { ...(live.entity as PanelEntity), cells: live.cells };
  const shape = storyPanelShape(entity);
  /** What is drawn now; a reserved box can be larger. */
  const content = entity.frame ? entity.frame.size : panelSize(shape);
  const size = panelArenaSize(entity);
  const scale = entity.scale ?? ARENA_PER_DOMAIN;
  const k = Math.min((s.x(1) - s.x(0)) / scale.x, (s.y(1) - s.y(0)) / scale.y);
  const left = s.x(liveValue(live, "x", t)) - (size.width * k) / 2;
  const top = s.y(liveValue(live, "y", t)) - (size.height * k) / 2;
  const rect = (ax: number, ay: number, aw: number, ah: number): Rect => ({ x: left + ax * k, y: top + ay * k, w: aw * k, h: ah * k });
  const point = (ax: number, ay: number): Point => ({ x: left + ax * k, y: top + ay * k });
  const titled = entity.frame ? ("titled" in entity.frame ? entity.frame.titled : false) : shape.titled;
  return { entity, shape, size, content, k, kx: k, ky: k, rect, point, title: titled ? PANEL.title : 0 };
}

export type PanelGeometry = ReturnType<typeof panelFrame>;

export const mid = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const asRect = (r: Rect) => ({ x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) });
export const toneColor = (cell: Pick<Cell, "tone">) => TONE[cell.tone ?? "normal"];

/** Split text into at most `lines` lines of about `chars` characters, at spaces when possible. */
export function wrapText(text: string, chars: number, lines = 2): string[] {
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= chars) current = `${current} ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines - 1);
  kept.push(out.slice(lines - 1).join(" "));
  return kept;
}

/** Text centered in a box, shrunk to fit; wrapped onto two lines when that reads larger. */
export function BoxText({
  text,
  box,
  size,
  color,
  weight = 400,
  italic = false,
  align = "middle",
  halo = false,
}: {
  text: string;
  box: Rect;
  /** Preferred font size in px. */
  size: number;
  color: string;
  weight?: number;
  italic?: boolean;
  align?: "start" | "middle";
  /** White outline so the text stays readable over lines drawn beneath it. */
  halo?: boolean;
}) {
  const room = box.w * 0.9;
  const oneLine = fitFont(size, text.length, room);
  const wrapped = wrapText(text, Math.max(4, Math.ceil(text.length / 2) + 2));
  const twoLines = wrapped.length > 1 ? Math.min(fitFont(size, Math.max(...wrapped.map((l) => l.length)), room), (box.h * 0.85) / (2 * 1.15)) : 0;
  const lines = twoLines > oneLine * 1.15 ? wrapped : [text];
  const font = lines.length > 1 ? twoLines : Math.min(oneLine, box.h * 0.8);
  const x = align === "middle" ? box.x + box.w / 2 : box.x + box.w * 0.05;
  const cy = box.y + box.h / 2;
  return (
    <text
      x={x}
      fontSize={font}
      textAnchor={align}
      fill={color}
      fontWeight={weight}
      fontStyle={italic ? "italic" : undefined}
      style={{ whiteSpace: "pre" }}
      {...(halo ? { stroke: "#fff", strokeWidth: font * 0.35, paintOrder: "stroke" } : {})}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={cy + (i - (lines.length - 1) / 2) * font * 1.15} dominantBaseline="middle">
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** Pixel width of `chars` monospace characters at `font` px. */
export const monoWidthPx = (chars: number, font: number) => chars * MONO.advance * font;

/** Title band: the panel title on the left and an optional note (such as a timeline's spacing) on the right. */
export function TitleBand({ g, note }: { g: PanelGeometry; note?: string }) {
  if (!g.title) return null;
  const band = g.rect(0, 0, g.size.width, g.title);
  const font = g.title * g.k * 0.6;
  const noteFont = g.title * g.k * 0.5;
  const noteWidth = note ? monoWidthPx(note.length, noteFont) + 8 : 0;
  return (
    <>
      {g.entity.title ? (
        <text
          x={band.x}
          y={band.y + band.h * 0.5}
          fontSize={fitFont(font, g.entity.title.length, Math.max(10, band.w - noteWidth - 6))}
          dominantBaseline="middle"
          fill="#333"
        >
          {g.entity.title}
        </text>
      ) : null}
      {note ? (
        <text
          x={band.x + band.w}
          y={band.y + band.h * 0.5}
          fontSize={fitFont(noteFont, note.length, band.w * 0.6)}
          dominantBaseline="middle"
          textAnchor="end"
          fill="#666"
          fontStyle="italic"
        >
          {note}
        </text>
      ) : null}
    </>
  );
}
