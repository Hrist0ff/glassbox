import { PANEL } from "@/lib/concept/constants";
import type { ComparisonFrame } from "@/lib/concept/frames";
import { ease, progress, TWEEN, type Live } from "@/lib/story/engine";
import { asRect, BORDER, BoxText, MARK, MUTED, TitleBand, toneColor, type PanelGeometry } from "./frame";

/**
 * Alternatives (columns) against criteria (rows). Each row has one unit,
 * shown with its label. Unknown and not-applicable values say so in gray
 * italics on a hatched cell, never as a blank or a guess. There is no score
 * or winner: emphasis only marks what the current step talks about.
 */

const MISSING_TEXT = { unknown: "Unknown", not_applicable: "N/A" } as const;

export function ComparisonPanelBody({ g, live, t }: { g: PanelGeometry; live: Live; t: number }) {
  const frame = g.entity.frame as ComparisonFrame;
  const c = PANEL.comparison[frame.orient];
  const k = g.k;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const top = g.title;
  const rowIndex = new Map(frame.rows.map((row, i) => [row.id, i]));
  const shown = new Set(live.cells.flatMap((cell) => (cell.meta?.panel === "comparison" ? [cell.meta.criterion] : [])));
  const hatch = `hatch-${g.entity.id}`;

  return (
    <>
      <defs>
        <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6} height={6} fill="#fafafa" />
          <line x1={0} y1={0} x2={0} y2={6} stroke="#e4e4e4" strokeWidth={3} />
        </pattern>
      </defs>
      <TitleBand g={g} />
      {frame.alternatives.map((name, i) => (
        <BoxText key={`alt${i}`} text={name} box={g.rect(c.label + i * c.column, top, c.column, c.header)} size={14 * k} color="#222" weight={700} />
      ))}
      <line
        x1={g.point(0, top + c.header).x}
        x2={g.point(c.label + frame.alternatives.length * c.column, 0).x}
        y1={g.point(0, top + c.header).y}
        y2={g.point(0, top + c.header).y}
        stroke={BORDER}
        strokeWidth={1.5}
      />
      {frame.rows.map((row, r) =>
        shown.has(row.id) ? (
          <BoxText
            key={`row${row.id}`}
            text={row.unit ? `${row.label} (${row.unit})` : row.label}
            box={g.rect(0, top + c.header + r * c.row, c.label - 6, c.row)}
            size={13 * k}
            color="#333"
            align="start"
          />
        ) : null,
      )}
      {live.cells.map((cell) => {
        if (cell.meta?.panel !== "comparison") return null;
        const r = rowIndex.get(cell.meta.criterion) ?? 0;
        const box = g.rect(c.label + cell.meta.alternative * c.column, top + c.header + r * c.row, c.column, c.row);
        const missing = cell.meta.missing;
        return (
          <g key={cell.key} opacity={born(cell)}>
            <rect
              {...asRect({ x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 })}
              fill={missing ? `url(#${hatch})` : cell.mark ? MARK : "#fff"}
              stroke={missing ? "#ccc" : "#bbb"}
              strokeDasharray={missing ? "4,3" : undefined}
              rx={3 * k}
            />
            <BoxText
              text={missing ? MISSING_TEXT[missing] : cell.text}
              box={box}
              size={14 * k}
              color={missing ? MUTED : toneColor(cell)}
              italic={missing !== null}
              weight={cell.mark ? 700 : 400}
            />
          </g>
        );
      })}
    </>
  );
}
