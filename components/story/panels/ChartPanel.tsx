import { PANEL } from "@/lib/concept/constants";
import { formatValue, type ChartFrame } from "@/lib/concept/frames";
import { ease, progress, TWEEN, type Live, type LiveCell } from "@/lib/story/engine";
import { BoxText, MARK, MUTED, TitleBand, toneColor, type PanelGeometry } from "./frame";

/**
 * Bar and line charts for a few categories. The axis covers every value the
 * chart ever shows, so revealing values never rescales it. Missing values are
 * marked "no data" rather than drawn as zero, and a note under the chart says
 * whether the numbers are illustrative or where they come from.
 */

/** Room above the plot for the y-axis title. */
const TOP = 20;

export function ChartPanelBody({ g, live, t }: { g: PanelGeometry; live: Live; t: number }) {
  const frame = g.entity.frame as ChartFrame;
  const c = PANEL.chart[frame.orient];
  const k = g.k;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const n = frame.categories.length;
  const plotTop = g.title + TOP;
  const plotBottom = g.title + c.plot;
  const y = (v: number) => plotTop + ((frame.max - v) / (frame.max - frame.min || 1)) * (plotBottom - plotTop);
  const x = (category: number) => c.axis + (category + 0.5) * c.slot;
  const cells = live.cells.filter((cell): cell is LiveCell & { meta: Extract<NonNullable<LiveCell["meta"]>, { panel: "chart" }> } => cell.meta?.panel === "chart");
  const seriesCount = Math.max(1, frame.series.length);
  const highlighted = new Set(cells.filter((cell) => cell.mark).map((cell) => cell.meta.category));
  const toneOfSeries = new Map(cells.map((cell) => [cell.meta.series, cell]));
  const font = 12 * k;
  const yTitle = `${frame.yLabel}${frame.unit ? ` (${frame.unit})` : ""}`;
  const valueFont = Math.min(11 * k, ((c.slot * 0.7) / seriesCount) * k * 0.4);

  return (
    <>
      <TitleBand g={g} />
      {[...highlighted].map((category) => (
        <rect key={`hl${category}`} {...rectAttrs(g.rect(c.axis + category * c.slot, plotTop - 6, c.slot, plotBottom - plotTop + 6 + 34))} fill={MARK} />
      ))}
      {yTitle ? <BoxText text={yTitle} box={g.rect(0, g.title, c.axis + n * c.slot, TOP - 4)} size={11.5 * k} color="#444" align="start" italic /> : null}
      {frame.ticks.map((tick) => {
        const p = g.point(c.axis, y(tick));
        return (
          <g key={`tick${tick}`}>
            <line x1={p.x} x2={g.point(c.axis + n * c.slot, 0).x} y1={p.y} y2={p.y} stroke={tick === 0 ? "#555" : "#e2e2e2"} strokeWidth={tick === 0 ? 1.5 : 1} />
            <text x={p.x - 6 * k} y={p.y} fontSize={11 * k} textAnchor="end" dominantBaseline="middle" fill="#555">
              {formatValue(tick)}
            </text>
          </g>
        );
      })}
      <line x1={g.point(c.axis, 0).x} x2={g.point(c.axis, 0).x} y1={g.point(0, plotTop).y} y2={g.point(0, plotBottom).y} stroke="#555" strokeWidth={1.5} />
      {frame.categories.map((name, category) => (
        <BoxText
          key={`cat${category}`}
          text={name}
          box={g.rect(c.axis + category * c.slot, plotBottom + 2, c.slot, 32)}
          size={font}
          color="#333"
          weight={highlighted.has(category) ? 700 : 400}
        />
      ))}
      {frame.xLabel ? (
        <BoxText text={frame.xLabel} box={g.rect(c.axis, plotBottom + 34, n * c.slot, c.labels - 36)} size={11.5 * k} color="#444" italic />
      ) : null}

      {frame.chart === "bar"
        ? cells.map((cell) => {
            const { series, category, value } = cell.meta;
            const group = c.slot * 0.7;
            const width = group / seriesCount;
            const left = c.axis + category * c.slot + (c.slot - group) / 2 + series * width;
            if (value === null) return <NoData key={cell.key} at={g.point(left + width / 2, y(0))} k={k} opacity={born(cell)} />;
            const top = y(Math.max(0, value));
            const bottom = y(Math.min(0, value));
            // Bars grow from the axis as they appear.
            const grow = born(cell);
            const r = g.rect(left + width * 0.08, value >= 0 ? bottom - (bottom - top) * grow : top, width * 0.84, (bottom - top) * grow);
            return (
              <g key={cell.key}>
                <rect {...rectAttrs(r)} fill={toneColor(cell)} opacity={0.85} />
                {valueFont >= 6 ? (
                  <text
                    x={r.x + r.w / 2}
                    y={value >= 0 ? r.y - 3 : r.y + r.h + valueFont}
                    fontSize={valueFont}
                    textAnchor="middle"
                    fill="#333"
                    opacity={grow}
                    fontWeight={cell.mark ? 700 : 400}
                  >
                    {formatValue(value)}
                  </text>
                ) : null}
              </g>
            );
          })
        : Array.from({ length: seriesCount }, (_, series) => {
            const points = cells.filter((cell) => cell.meta.series === series).sort((a, b) => a.meta.category - b.meta.category);
            const segments: string[] = [];
            let open = false;
            let previous = -2;
            for (const cell of points) {
              if (cell.meta.value === null) {
                open = false;
                continue;
              }
              const p = g.point(x(cell.meta.category), y(cell.meta.value));
              segments.push(`${open && previous === cell.meta.category - 1 ? "L" : "M"} ${p.x} ${p.y}`);
              open = true;
              previous = cell.meta.category;
            }
            const sample = toneOfSeries.get(series);
            return (
              <g key={`series${series}`}>
                {segments.length > 1 ? <path d={segments.join(" ")} fill="none" stroke={sample ? toneColor(sample) : "#333"} strokeWidth={2.5} /> : null}
                {points.map((cell) =>
                  cell.meta.value === null ? (
                    <NoData key={cell.key} at={g.point(x(cell.meta.category), y(0))} k={k} opacity={born(cell)} />
                  ) : (
                    <g key={cell.key} opacity={born(cell)}>
                      <circle cx={g.point(x(cell.meta.category), 0).x} cy={g.point(0, y(cell.meta.value)).y} r={(cell.mark ? 6 : 4.5) * Math.max(0.7, k)} fill={toneColor(cell)} stroke="#fff" strokeWidth={1.5} />
                      {cell.mark || seriesCount === 1 ? (
                        <text
                          x={g.point(x(cell.meta.category), 0).x}
                          y={g.point(0, y(cell.meta.value)).y - 9 * k}
                          fontSize={11 * k}
                          textAnchor="middle"
                          fill="#333"
                          stroke="#fff"
                          strokeWidth={3 * k}
                          paintOrder="stroke"
                          fontWeight={cell.mark ? 700 : 400}
                        >
                          {formatValue(cell.meta.value)}
                        </text>
                      ) : null}
                    </g>
                  ),
                )}
              </g>
            );
          })}

      <Legend g={g} frame={frame} toneOfSeries={toneOfSeries} />
    </>
  );
}

function rectAttrs(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) };
}

function NoData({ at, k, opacity }: { at: { x: number; y: number }; k: number; opacity: number }) {
  const d = 4 * Math.max(0.7, k);
  return (
    <g opacity={opacity}>
      <path d={`M ${at.x - d} ${at.y - d - 6 * k} l ${2 * d} ${2 * d} M ${at.x + d} ${at.y - d - 6 * k} l ${-2 * d} ${2 * d}`} stroke={MUTED} strokeWidth={1.5} />
      <text x={at.x} y={at.y - 16 * k} fontSize={9.5 * k} textAnchor="middle" fill={MUTED} fontStyle="italic">
        no data
      </text>
    </g>
  );
}

function Legend({ g, frame, toneOfSeries }: { g: PanelGeometry; frame: ChartFrame; toneOfSeries: Map<number, LiveCell> }) {
  const c = PANEL.chart[frame.orient];
  const k = g.k;
  const top = frame.size.height - c.legend;
  const rowHeight = frame.orient === "horizontal" ? c.legend : c.legend / 2;
  const note = g.entity.note ?? "";
  const width = frame.size.width;
  // Each legend entry starts after the previous ones: swatch, gap, and name.
  const starts = frame.series.map((_, i) => frame.series.slice(0, i).reduce((sum, name) => sum + 26 + name.length * 7.5, 0));
  const cursor = frame.series.reduce((sum, name) => sum + 26 + name.length * 7.5, 0);
  return (
    <>
      {frame.series.map((name, i) => {
        const sample = toneOfSeries.get(i);
        const color = sample ? toneColor(sample) : "#999";
        const x = starts[i]!;
        return (
          <g key={`legend${i}`}>
            {frame.chart === "bar" ? (
              <rect {...rectAttrs(g.rect(x, top + rowHeight / 2 - 6, 14, 12))} fill={color} opacity={0.85} />
            ) : (
              <line x1={g.point(x, 0).x} x2={g.point(x + 16, 0).x} y1={g.point(0, top + rowHeight / 2).y} y2={g.point(0, top + rowHeight / 2).y} stroke={color} strokeWidth={2.5} />
            )}
            <text x={g.point(x + 20, 0).x} y={g.point(0, top + rowHeight / 2).y} fontSize={11 * k} dominantBaseline="middle" fill="#333">
              {name}
            </text>
          </g>
        );
      })}
      {note ? (
        frame.orient === "horizontal" ? (
          <BoxText text={note} box={g.rect(Math.min(cursor + 10, width * 0.45), top, width - Math.min(cursor + 10, width * 0.45), rowHeight)} size={10.5 * k} color="#666" italic align="start" />
        ) : (
          <BoxText text={note} box={g.rect(0, top + rowHeight, width, rowHeight)} size={10.5 * k} color="#666" italic align="start" />
        )
      ) : null}
    </>
  );
}
