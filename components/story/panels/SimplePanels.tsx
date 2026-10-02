import { PANEL } from "@/lib/concept/constants";
import { wrapLabel } from "@/lib/concept/geometry";
import { ease, progress, TWEEN, type Live } from "@/lib/story/engine";
import type { Cell } from "@/lib/story/types";
import { colorFade, fitFont } from "../draw";
import { asRect, BORDER, MARK, mid, toneColor, type PanelGeometry, type Rect } from "./frame";

/**
 * Logs, code, tables, and version-1 timelines. Their content starts at the
 * top-left of the panel's box, so a laid-out log grows to the right inside
 * the room reserved for it.
 */

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

export function SimplePanelBody({ g, live, t, rate }: { g: PanelGeometry; live: Live; t: number; rate: number }) {
  const { entity, rect, title } = g;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const fade = { transition: colorFade(rate) };

  switch (entity.variant) {
    case "log": {
      const { width, height, tag } = PANEL.record;
      const tagBand = g.shape.tags ? tag : 0;
      return live.cells.length === 0 ? (
        <rect {...asRect(rect(0, title + tagBand, width, height))} fill="none" stroke="#bbb" strokeDasharray="4,3" />
      ) : (
        <>
          {live.cells.map((cell, i) => {
            const box = rect(i * width, title + tagBand, width, height);
            return (
              <g key={i} opacity={born(cell)}>
                <rect {...asRect(box)} fill="#fff" stroke={BORDER} shapeRendering="crispEdges" />
                <FitText cell={cell} box={box} tone={toneColor(cell)} />
                {cell.tag ? <FitText cell={{ text: cell.tag }} box={rect(i * width, title, width, tagBand)} share={0.75} tone="#777" /> : null}
              </g>
            );
          })}
        </>
      );
    }
    case "timeline": {
      const { spacing, date, axis, text } = PANEL.timeline;
      const axisY = rect(0, title + date + axis / 2, 0, 0).y;
      return (
        <>
          <line x1={rect(0, 0, 0, 0).x} x2={rect(g.size.width, 0, 0, 0).x} y1={axisY} y2={axisY} stroke="#999" strokeWidth={2} />
          {live.cells.map((cell, i) => {
            const slot = rect(i * spacing, title, spacing, date + axis + text);
            const dot = mid(rect(i * spacing, title + date, spacing, axis));
            const lines = wrapLabel(cell.text);
            const lineH = (text * g.k) / 2;
            return (
              <g key={i} opacity={born(cell)}>
                <circle cx={dot.x} cy={dot.y} r={Math.max(3, Math.min(axis * g.k * 0.4, spacing * g.k * 0.08))} style={{ ...fade, fill: toneColor(cell) }} />
                {cell.tag ? <FitText cell={{ text: cell.tag }} box={rect(i * spacing, title, spacing, date)} share={0.7} tone="#555" /> : null}
                {lines.map((line, l) => (
                  <FitText
                    key={l}
                    cell={{ text: line }}
                    box={{ x: slot.x, y: rect(0, title + date + axis, 0, 0).y + l * lineH, w: slot.w, h: lineH }}
                    share={0.8}
                    tone={toneColor(cell)}
                  />
                ))}
              </g>
            );
          })}
        </>
      );
    }
    case "code": {
      const { gutter, lineHeight, padding } = PANEL.code;
      const width = g.content.width;
      const textWidth = width - gutter - padding * 2;
      const longest = Math.max(1, g.shape.longestLine);
      const fontPx = fitFont(lineHeight * g.k * 0.62, longest, textWidth * g.k);
      return (
        <>
          <rect {...asRect(rect(0, title, width, g.content.height - title))} fill="#fff" stroke={BORDER} shapeRendering="crispEdges" />
          {live.cells.map((cell, i) => {
            const row = rect(0, title + padding + i * lineHeight, width, lineHeight);
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
                  style={{ ...fade, fill: toneColor(cell), whiteSpace: "pre", fontWeight: cell.mark ? 700 : 400 }}
                >
                  {cell.text}
                </text>
              </g>
            );
          })}
        </>
      );
    }
    case "table": {
      const { column, rowLabel, header, row } = PANEL.table;
      const columns = entity.columns ?? [];
      const rows = entity.rows ?? [];
      const labelWidth = g.shape.rowLabels ? rowLabel : 0;
      return (
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
                <FitText cell={cell} box={box} tone={toneColor(cell)} />
              </g>
            );
          })}
        </>
      );
    }
    default:
      return null;
  }
}

/** Where messages to a simple panel land: the next free record of a log or timeline, otherwise the center. */
export function simpleAnchor(g: PanelGeometry, cells: number, role: "from" | "to"): { x: number; y: number } {
  if (role === "to" && g.entity.variant === "log") {
    return mid(g.rect(cells * PANEL.record.width, g.title + (g.shape.tags ? PANEL.record.tag : 0), PANEL.record.width, PANEL.record.height));
  }
  if (role === "to" && g.entity.variant === "timeline" && !g.entity.frame) {
    const { spacing, date, axis } = PANEL.timeline;
    return mid(g.rect(cells * spacing, g.title + date, spacing, axis));
  }
  return mid(g.rect(0, 0, g.size.width, g.size.height));
}
