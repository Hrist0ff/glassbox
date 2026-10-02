import { PANEL } from "@/lib/concept/constants";
import type { HierarchyFrame } from "@/lib/concept/frames";
import { ease, progress, TWEEN, type Live } from "@/lib/story/engine";
import { colorFade } from "../draw";
import { asRect, BoxText, MARK, mid, toneColor, type PanelGeometry, type Rect } from "./frame";

/**
 * Trees (organizations, taxonomies), outlines (trees on narrow screens), and
 * groups (each root a box holding its members). Parent-child lines carry one
 * relation for the whole panel, named in a legend; cross-links are dashed,
 * labeled, and drawn over the boxes so none hides. Nothing here travels:
 * membership and dependency are structure.
 */

const RELATION_TEXT: Record<HierarchyFrame["relation"], string> = {
  part_of: "is part of",
  kind_of: "is a kind of",
  reports_to: "reports to",
  member_of: "is a member of",
};
const LINK_TEXT: Record<string, string> = { depends_on: "depends on", uses: "uses", related_to: "related to" };

export function HierarchyPanelBody({ g, live, t, rate }: { g: PanelGeometry; live: Live; t: number; rate: number }) {
  const frame = g.entity.frame as HierarchyFrame;
  const k = g.k;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const present = new Map(live.cells.flatMap((cell) => (cell.key ? [[cell.key, cell] as const] : [])));
  const box = (id: string): Rect | null => {
    const b = frame.boxes[id];
    return b ? g.rect(b.x, b.y, b.w, b.h) : null;
  };
  const legendY = frame.size.height - PANEL.hierarchy.legend;
  const legend =
    frame.style === "groups"
      ? `Inside a box: ${RELATION_TEXT[frame.relation]} it`
      : `Lines to the item above mean “${RELATION_TEXT[frame.relation]}”`;

  return (
    <>
      <BoxText text={g.entity.title} box={g.rect(0, 0, frame.size.width, g.title)} size={g.title * k * 0.6} color="#333" align="start" />
      {frame.style === "groups"
        ? Object.entries(frame.groups).map(([root, rect]) => {
            const cell = present.get(root);
            if (!cell) return null;
            const r = g.rect(rect.x, rect.y, rect.w, rect.h);
            return (
              <rect
                key={`group${root}`}
                {...asRect(r)}
                rx={8 * k}
                fill={cell.mark ? MARK : "#f7f7f7"}
                stroke="#999"
                opacity={born(cell)}
              />
            );
          })
        : null}
      {frame.style !== "groups"
        ? live.cells.map((cell) => {
            if (cell.meta?.panel !== "hierarchy" || !cell.key || cell.meta.parent === null || !present.has(cell.meta.parent)) return null;
            const child = box(cell.key);
            const parent = box(cell.meta.parent);
            if (!child || !parent) return null;
            const d =
              frame.style === "tree"
                ? (() => {
                    const from = { x: parent.x + parent.w / 2, y: parent.y + parent.h };
                    const to = { x: child.x + child.w / 2, y: child.y };
                    const midY = (from.y + to.y) / 2;
                    return `M ${from.x} ${from.y} V ${midY} H ${to.x} V ${to.y}`;
                  })()
                : (() => {
                    const x = parent.x + Math.min(parent.w / 2, PANEL.hierarchy.outline.indent * k * 0.5);
                    return `M ${x} ${parent.y + parent.h} V ${child.y + child.h / 2} H ${child.x}`;
                  })();
            return <path key={`line${cell.key}`} d={d} fill="none" stroke="#888" strokeWidth={1.5} opacity={born(cell)} />;
          })
        : null}
      {live.cells.map((cell) => {
        if (!cell.key) return null;
        const r = box(cell.key);
        if (!r) return null;
        const group = frame.boxes[cell.key]?.group ?? false;
        return (
          <g key={cell.key} opacity={born(cell)}>
            {group ? null : (
              <rect
                {...asRect(r)}
                rx={5 * k}
                strokeWidth={cell.mark ? 2.5 : 1.5}
                style={{ transition: colorFade(rate, "stroke"), stroke: cell.tone === "normal" || !cell.tone ? "#555" : toneColor(cell), fill: cell.mark ? MARK : "#fff" }}
              />
            )}
            <BoxText text={cell.text} box={r} size={13.5 * k} color={toneColor(cell)} weight={group || cell.mark ? 700 : 400} />
          </g>
        );
      })}
      {(g.entity.links ?? []).map((l, i) => {
        const a = box(l.from);
        const b = box(l.to);
        if (!a || !b || !present.has(l.from) || !present.has(l.to)) return null;
        const pa = mid(a);
        const pb = mid(b);
        // Items in the same column: go around on the right, through the gutter, clear of the boxes between them.
        const stacked = Math.abs(pa.x - pb.x) < Math.max(a.w, b.w) / 2;
        const right = Math.max(a.x + a.w, b.x + b.w);
        const c = stacked
          ? // Longer links bow further out, so links from the same box don't share a curve.
            { x: right + Math.max(frame.gutter, 40) * k * (0.35 + 0.55 * Math.min(1, Math.abs(pb.y - pa.y) / (150 * k))), y: (pa.y + pb.y) / 2 }
          : { x: (pa.x + pb.x) / 2, y: Math.min(pa.y, pb.y) - 30 * k };
        const end = stacked ? { x: b.x + b.w + 2, y: pb.y } : edgePoint(b, c);
        const start = stacked ? { x: a.x + a.w + 2, y: pa.y } : edgePoint(a, c);
        const angle = Math.atan2(end.y - c.y, end.x - c.x);
        const head = 6 * Math.max(0.8, k);
        const directed = l.type !== "related_to";
        const apex = { x: 0.25 * start.x + 0.5 * c.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * c.y + 0.25 * end.y };
        return (
          <g key={`link${i}`}>
            <path d={`M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`} fill="none" stroke="#7b3fa0" strokeWidth={1.5} strokeDasharray="5,4" />
            {directed ? (
              <polygon
                points={`${end.x},${end.y} ${end.x - head * Math.cos(angle - 0.45)},${end.y - head * Math.sin(angle - 0.45)} ${end.x - head * Math.cos(angle + 0.45)},${end.y - head * Math.sin(angle + 0.45)}`}
                fill="#7b3fa0"
              />
            ) : null}
            <text x={apex.x} y={apex.y} fontSize={10.5 * k} textAnchor="middle" fill="#7b3fa0" stroke="#fff" strokeWidth={3 * k} paintOrder="stroke">
              {LINK_TEXT[l.type] ?? l.type}
            </text>
          </g>
        );
      })}
      <BoxText text={legend} box={g.rect(0, legendY, frame.size.width, PANEL.hierarchy.legend)} size={11 * k} color="#666" italic align="start" />
    </>
  );
}

/** Where a line toward `toward` leaves a box. */
function edgePoint(r: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  const c = mid(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const scale = Math.min(Math.abs(dx) > 1e-6 ? r.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? r.h / 2 / Math.abs(dy) : Infinity);
  return Number.isFinite(scale) ? { x: c.x + dx * scale, y: c.y + dy * scale } : c;
}
