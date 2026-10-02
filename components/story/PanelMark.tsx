import { PANEL } from "@/lib/concept/constants";
import { panelSize, wrapLabel } from "@/lib/concept/geometry";
import { ease, liveValue, progress, TWEEN, type Live } from "@/lib/story/engine";
import { ARENA_PER_DOMAIN, storyPanelShape, type Scales } from "@/lib/story/geometry";
import { TONE } from "@/lib/story/palette";
import type { Cell, PanelEntity } from "@/lib/story/types";
import { colorFade, fitFont, MONO_FONT, presence } from "./draw";

/**
 * Panels: a log, code, a table, or a timeline. Layout is in arena units (see
 * PANEL in lib/concept/constants.ts) and drawn at one scale on both axes, so
 * a panel keeps its proportions when the camera zooms. That scale is the
 * smaller of the stage's two axis scales, so the drawing always fits inside
 * the box the validator measured.
 */

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const BORDER = "#000";
const MARK = "#dce8f4";

/** Where a panel is on screen, and helpers that map its arena-unit layout to pixels. */
function frame(live: Live, t: number, s: Scales) {
  const entity = { ...(live.entity as PanelEntity), cells: live.cells };
  const shape = storyPanelShape(entity);
  const size = panelSize(shape);
  const k = Math.min((s.x(1) - s.x(0)) / ARENA_PER_DOMAIN.x, (s.y(1) - s.y(0)) / ARENA_PER_DOMAIN.y);
  const kx = k;
  const ky = k;
  const left = s.x(liveValue(live, "x", t)) - (size.width * kx) / 2;
  const top = s.y(liveValue(live, "y", t)) - (size.height * ky) / 2;
  const rect = (ax: number, ay: number, aw: number, ah: number): Rect => ({ x: left + ax * kx, y: top + ay * ky, w: aw * kx, h: ah * ky });
  return { entity, shape, size, kx, ky, rect, title: shape.titled ? PANEL.title : 0 };
}

const mid = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where messages to a panel land: the next free record of a log or timeline, otherwise the center. */
export function panelAnchor(live: Live, t: number, s: Scales, role: "from" | "to"): Point {
  const f = frame(live, t, s);
  const next = live.cells.length;
  if (role === "to" && f.entity.variant === "log") {
    return mid(f.rect(next * PANEL.record.width, f.title + (f.shape.tags ? PANEL.record.tag : 0), PANEL.record.width, PANEL.record.height));
  }
  if (role === "to" && f.entity.variant === "timeline") {
    const { spacing, date, axis } = PANEL.timeline;
    return mid(f.rect(next * spacing, f.title + date, spacing, axis));
  }
  return mid(f.rect(0, 0, f.size.width, f.size.height));
}

/** Centered text that fits its box. */
function FitText({ cell, box, share = 0.55, tone }: { cell: Pick<Cell, "text">; box: Rect; share?: number; tone: string }) {
  const p = mid(box);
  return (
    <text
      x={p.x}
      y={p.y + 1}
      fontSize={fitFont(box.h * share, cell.text.length, box.w * 0.88)}
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ fill: tone }}
    >
      {cell.text}
    </text>
  );
}

export function PanelMark({ live, t, s, rate }: { live: Live; t: number; s: Scales; rate: number }) {
  const f = frame(live, t, s);
  const { entity, rect, title } = f;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const toneOf = (cell: Cell) => TONE[cell.tone ?? "normal"];
  const fade = { transition: colorFade(rate) };

  const heading = title ? (
    <text
      x={rect(0, 0, 0, 0).x}
      y={rect(0, title * 0.5, 0, 0).y}
      fontSize={fitFont(title * f.ky * 0.62, entity.title.length, f.size.width * f.kx)}
      dominantBaseline="middle"
      fill="#333"
    >
      {entity.title}
    </text>
  ) : null;

  let body: React.ReactNode = null;
  switch (entity.variant) {
    case "log": {
      const { width, height, tag } = PANEL.record;
      const tagBand = f.shape.tags ? tag : 0;
      body =
        live.cells.length === 0 ? (
          <rect {...asRect(rect(0, title + tagBand, width, height))} fill="none" stroke="#bbb" strokeDasharray="4,3" />
        ) : (
          live.cells.map((cell, i) => {
            const box = rect(i * width, title + tagBand, width, height);
            return (
              <g key={i} opacity={born(cell)}>
                <rect {...asRect(box)} fill="#fff" stroke={BORDER} shapeRendering="crispEdges" />
                <FitText cell={cell} box={box} tone={toneOf(cell)} />
                {cell.tag ? <FitText cell={{ text: cell.tag }} box={rect(i * width, title, width, tagBand)} share={0.75} tone="#777" /> : null}
              </g>
            );
          })
        );
      break;
    }
    case "timeline": {
      const { spacing, date, axis, text } = PANEL.timeline;
      const axisY = rect(0, title + date + axis / 2, 0, 0).y;
      body = (
        <>
          <line x1={rect(0, 0, 0, 0).x} x2={rect(f.size.width, 0, 0, 0).x} y1={axisY} y2={axisY} stroke="#999" strokeWidth={2} />
          {live.cells.map((cell, i) => {
            const slot = rect(i * spacing, title, spacing, date + axis + text);
            const dot = mid(rect(i * spacing, title + date, spacing, axis));
            const lines = wrapLabel(cell.text);
            const lineH = (text * f.ky) / 2;
            return (
              <g key={i} opacity={born(cell)}>
                <circle cx={dot.x} cy={dot.y} r={Math.max(3, Math.min(axis * f.ky * 0.4, spacing * f.kx * 0.08))} style={{ ...fade, fill: toneOf(cell) }} />
                {cell.tag ? <FitText cell={{ text: cell.tag }} box={rect(i * spacing, title, spacing, date)} share={0.7} tone="#555" /> : null}
                {lines.map((line, l) => (
                  <FitText
                    key={l}
                    cell={{ text: line }}
                    box={{ x: slot.x, y: rect(0, title + date + axis, 0, 0).y + l * lineH, w: slot.w, h: lineH }}
                    share={0.8}
                    tone={toneOf(cell)}
                  />
                ))}
              </g>
            );
          })}
        </>
      );
      break;
    }
    case "code": {
      const { gutter, lineHeight, padding } = PANEL.code;
      const textWidth = f.size.width - gutter - padding * 2;
      const longest = Math.max(1, f.shape.longestLine);
      const fontPx = fitFont(lineHeight * f.ky * 0.62, longest, textWidth * f.kx);
      body = (
        <>
          <rect {...asRect(rect(0, title, f.size.width, f.size.height - title))} fill="#fff" stroke={BORDER} shapeRendering="crispEdges" />
          {live.cells.map((cell, i) => {
            const row = rect(0, title + padding + i * lineHeight, f.size.width, lineHeight);
            const y = row.y + row.h / 2 + 1;
            return (
              <g key={i} opacity={born(cell)}>
                {cell.mark ? <rect x={row.x + 1} y={row.y} width={row.w - 2} height={row.h} fill={MARK} /> : null}
                <text x={rect(gutter - padding, 0, 0, 0).x} y={y} fontSize={fontPx} textAnchor="end" dominantBaseline="middle" fill="#999">
                  {i + 1}
                </text>
                <text
                  x={rect(gutter + padding, 0, 0, 0).x}
                  y={y}
                  fontSize={fontPx}
                  dominantBaseline="middle"
                  style={{ ...fade, fill: toneOf(cell), whiteSpace: "pre", fontWeight: cell.mark ? 700 : 400 }}
                >
                  {cell.text}
                </text>
              </g>
            );
          })}
        </>
      );
      break;
    }
    case "table": {
      const { column, rowLabel, header, row } = PANEL.table;
      const columns = entity.columns ?? [];
      const rows = entity.rows ?? [];
      const labelWidth = f.shape.rowLabels ? rowLabel : 0;
      body = (
        <>
          {columns.map((name, c) => (
            <FitText key={`h${c}`} cell={{ text: name }} box={rect(labelWidth + c * column, title, column, header)} share={0.6} tone="#333" />
          ))}
          {rows.map((name, r) =>
            name ? <FitText key={`r${r}`} cell={{ text: name }} box={rect(0, title + header + r * row, labelWidth, row)} share={0.5} tone="#555" /> : null,
          )}
          {live.cells.map((cell, i) => {
            const r = Math.floor(i / Math.max(1, columns.length));
            const c = i % Math.max(1, columns.length);
            const box = rect(labelWidth + c * column, title + header + r * row, column, row);
            return (
              <g key={i} opacity={born(cell)}>
                <rect {...asRect(box)} fill={cell.mark ? MARK : "#fff"} stroke={BORDER} shapeRendering="crispEdges" />
                <FitText cell={cell} box={box} tone={toneOf(cell)} />
              </g>
            );
          })}
        </>
      );
      break;
    }
  }

  return (
    <g data-entity-id={entity.id} opacity={presence(live, t)} fontFamily={MONO_FONT}>
      {heading}
      {body}
    </g>
  );
}

const asRect = (r: Rect) => ({ x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) });
