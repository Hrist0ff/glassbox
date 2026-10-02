import { PANEL } from "@/lib/concept/constants";
import { timelinePoint, verticalLaneWidth, type TimelineFrame } from "@/lib/concept/frames";
import { ease, progress, TWEEN, type Live } from "@/lib/story/engine";
import { colorFade } from "../draw";
import { BoxText, MUTED, TitleBand, toneColor, type PanelGeometry } from "./frame";

/**
 * Version-2 timelines: lanes for parallel actors, events that share a slot
 * when simultaneous, evenly spaced (order only) or spaced to scale, typed
 * relations drawn as labeled arcs, and a note saying which spacing is used.
 * Time order alone is never drawn as a link: only explicit relations are.
 */

const RELATION_TEXT: Record<string, string> = { causes: "causes", enables: "enables", responds_to: "responds to" };

export function spacingNote(frame: TimelineFrame): string {
  return frame.spacing === "proportional" ? `To scale${frame.unit ? ` · ${frame.unit}` : ""}` : "In order · not to scale";
}

export function TimelinePanelBody({ g, live, t, rate }: { g: PanelGeometry; live: Live; t: number; rate: number }) {
  const frame = g.entity.frame as TimelineFrame;
  const tl = PANEL.timeline;
  const k = g.k;
  const born = (cell: { born: number }) => ease(progress(t, cell.born, TWEEN));
  const lanes = Math.max(1, frame.lanes.length);
  const at = (key: string, lane: number, end = false) => timelinePoint(frame, key, lane, end);
  const laneOf = new Map(live.cells.map((cell) => [cell.key ?? "", cell.meta?.panel === "timeline" ? cell.meta.lane : 0]));
  const textFont = 13 * k;
  const dateFont = 11.5 * k;

  if (frame.orient === "horizontal") {
    const left = frame.lanes.length > 0 ? tl.laneLabel : 0;
    const slot = frame.slotWidth;
    const relBand = frame.relations ? tl.relations : 0;
    const laneHeight = tl.date + tl.axis + tl.text;
    return (
      <>
        <TitleBand g={g} note={spacingNote(frame)} />
        {Array.from({ length: lanes }, (_, lane) => {
          const top = g.title + relBand + lane * laneHeight;
          const y = g.point(0, top + tl.date + tl.axis / 2).y;
          return (
            <g key={`lane${lane}`}>
              <line x1={g.point(left, 0).x} x2={g.point(frame.size.width, 0).x} y1={y} y2={y} stroke="#999" strokeWidth={2} />
              {frame.lanes[lane] ? (
                <BoxText text={frame.lanes[lane]!} box={g.rect(0, top, left - 8, tl.date + tl.axis + tl.text / 2)} size={12 * k} color="#444" weight={600} align="start" />
              ) : null}
            </g>
          );
        })}
        <Relations g={g} frame={frame} laneOf={laneOf} />
        {live.cells.map((cell) => {
          if (cell.meta?.panel !== "timeline" || !cell.key) return null;
          const lane = cell.meta.lane;
          const p = at(cell.key, lane);
          const dot = g.point(p.x, p.y);
          const top = g.title + relBand + lane * laneHeight;
          const unknown = cell.meta.date === "unknown";
          const undated = cell.meta.date === "none";
          const end = cell.meta.end && frame.spacing === "proportional" ? g.point(at(cell.key, lane, true).x, p.y) : null;
          const r = Math.max(3, tl.axis * k * 0.42);
          return (
            <g key={cell.key} opacity={born(cell)}>
              {end ? <line x1={dot.x} x2={end.x} y1={dot.y} y2={dot.y} strokeWidth={r * 1.6} strokeLinecap="round" style={{ stroke: toneColor(cell), opacity: 0.35 }} /> : null}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={r}
                strokeWidth={2}
                strokeDasharray={unknown ? "3,2" : undefined}
                style={{ transition: colorFade(rate, "fill, stroke"), stroke: unknown ? MUTED : toneColor(cell), fill: cell.meta.date === "exact" || undated ? toneColor(cell) : "#fff" }}
              />
              <BoxText
                text={undated ? "" : cell.tag || (unknown ? "date unknown" : "")}
                box={g.rect(p.x - slot / 2, top, slot, tl.date)}
                size={dateFont}
                color={unknown ? MUTED : "#555"}
                italic={unknown || cell.meta.date === "approximate"}
              />
              <BoxText text={cell.text} box={g.rect(p.x - slot / 2, top + tl.date + tl.axis, slot, tl.text)} size={textFont} color={toneColor(cell)} weight={cell.mark ? 700 : 400} halo />
            </g>
          );
        })}
      </>
    );
  }

  const v = { ...tl.vertical, lane: verticalLaneWidth(lanes) };
  const header = frame.lanes.length > 1 ? v.header : 0;
  const bottom = g.title + header + frame.slots * v.row;
  return (
    <>
      <TitleBand g={g} note={spacingNote(frame)} />
      {Array.from({ length: lanes }, (_, lane) => {
        const x = g.point(v.date + lane * v.lane + 14, 0).x;
        return (
          <g key={`lane${lane}`}>
            <line x1={x} x2={x} y1={g.point(0, g.title + header + 6).y} y2={g.point(0, bottom - 6).y} stroke="#999" strokeWidth={2} />
            {frame.lanes.length > 1 && frame.lanes[lane] ? (
              <BoxText text={frame.lanes[lane]!} box={g.rect(v.date + lane * v.lane, g.title, v.lane - 8, header)} size={12 * k} color="#444" weight={600} align="start" />
            ) : null}
          </g>
        );
      })}
      <Relations g={g} frame={frame} laneOf={laneOf} />
      {live.cells.map((cell) => {
        if (cell.meta?.panel !== "timeline" || !cell.key) return null;
        const lane = cell.meta.lane;
        const p = at(cell.key, lane);
        const dot = g.point(p.x, p.y);
        const unknown = cell.meta.date === "unknown";
        const undated = cell.meta.date === "none";
        const end = cell.meta.end && frame.spacing === "proportional" ? g.point(p.x, at(cell.key, lane, true).y) : null;
        const r = Math.max(3, 7 * k);
        return (
          <g key={cell.key} opacity={born(cell)}>
            {end ? <line x1={dot.x} x2={end.x} y1={dot.y} y2={end.y} strokeWidth={r * 1.6} strokeLinecap="round" style={{ stroke: toneColor(cell), opacity: 0.35 }} /> : null}
            <circle
              cx={dot.x}
              cy={dot.y}
              r={r}
              strokeWidth={2}
              strokeDasharray={unknown ? "3,2" : undefined}
              style={{ transition: colorFade(rate, "fill, stroke"), stroke: unknown ? MUTED : toneColor(cell), fill: cell.meta.date === "exact" || undated ? toneColor(cell) : "#fff" }}
            />
            {lane === 0 && !undated ? (
              <BoxText
                text={cell.tag || (unknown ? "date unknown" : "")}
                box={g.rect(0, p.y - v.row / 2, v.date - 8, v.row)}
                size={dateFont}
                color={unknown ? MUTED : "#555"}
                italic={unknown || cell.meta.date === "approximate"}
              />
            ) : null}
            <BoxText
              text={lane === 0 || !cell.tag || undated ? cell.text : `${cell.tag}: ${cell.text}`}
              box={g.rect(p.x + 14, p.y - v.row / 2, v.lane - 34, v.row)}
              size={textFont}
              color={toneColor(cell)}
              weight={cell.mark ? 700 : 400}
              align="start"
              halo
            />
          </g>
        );
      })}
    </>
  );
}

/**
 * Typed relations as gray curved arrows from one event's marker to another's,
 * labeled with the relation: stated links, never messages and never implied
 * by time order. Arcs between events in the same lane bow away from the text.
 */
function Relations({ g, frame, laneOf }: { g: PanelGeometry; frame: TimelineFrame; laneOf: Map<string, number> }) {
  const k = g.k;
  const horizontal = frame.orient === "horizontal";
  return (
    <>
      {(g.entity.links ?? []).map((relation, i) => {
        const fromLane = laneOf.get(relation.from);
        const toLane = laneOf.get(relation.to);
        if (fromLane === undefined || toLane === undefined) return null;
        const pa = timelinePoint(frame, relation.from, fromLane);
        const pb = timelinePoint(frame, relation.to, toLane);
        const a = g.point(pa.x, pa.y);
        const b = g.point(pb.x, pb.y);
        const along = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
        const bow = Math.max(22 * k, along * 0.35);
        const c =
          fromLane === toLane
            ? horizontal
              ? { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - bow }
              : { x: Math.min(a.x, b.x) - bow, y: (a.y + b.y) / 2 }
            : horizontal
              ? { x: (a.x + b.x) / 2 + 26 * k, y: (a.y + b.y) / 2 }
              : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 26 * k };
        return <RelationArc key={`rel${i}`} a={a} b={b} c={c} label={RELATION_TEXT[relation.type] ?? relation.type} k={k} />;
      })}
    </>
  );
}

/** A curved arrow between two events with its relation type, drawn in gray: a stated relation, not a message. */
function RelationArc({ a, b, c, label, k }: { a: { x: number; y: number }; b: { x: number; y: number }; c: { x: number; y: number }; label: string; k: number }) {
  // Start and end just outside the markers.
  const gap = 9 * Math.max(0.7, k);
  const shorten = (p: { x: number; y: number }) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    return { x: p.x + ((c.x - p.x) / d) * gap, y: p.y + ((c.y - p.y) / d) * gap };
  };
  const start = shorten(a);
  const end = shorten(b);
  const apex = { x: 0.25 * start.x + 0.5 * c.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * c.y + 0.25 * end.y };
  const angle = Math.atan2(end.y - c.y, end.x - c.x);
  const head = 6 * Math.max(0.8, k);
  const p1 = { x: end.x - head * Math.cos(angle - 0.45), y: end.y - head * Math.sin(angle - 0.45) };
  const p2 = { x: end.x - head * Math.cos(angle + 0.45), y: end.y - head * Math.sin(angle + 0.45) };
  const font = 10.5 * k;
  return (
    <g>
      <path d={`M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`} fill="none" stroke="#777" strokeWidth={1.5} strokeDasharray="5,3" />
      <polygon points={`${end.x},${end.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill="#777" />
      <text x={apex.x} y={apex.y} fontSize={font} textAnchor="middle" dominantBaseline="middle" fill="#444" stroke="#fff" strokeWidth={font * 0.35} paintOrder="stroke">
        {label}
      </text>
    </g>
  );
}
