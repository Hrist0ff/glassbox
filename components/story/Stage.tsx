import { cameraAt, FADE, liveValue, progress, TWEEN, ease, type Live, type Message, type World } from "@/lib/story/engine";
import { cardSize, makeScales, MONO, SIZE, type Scales } from "@/lib/story/geometry";
import { INK, TONE } from "@/lib/story/palette";
import { colorFade, fitFont, MONO_FONT, presence, SANS_FONT } from "./draw";
import { PanelMark, panelAnchor } from "./PanelMark";
import type { Anchor, CardEntity, LinkEntity, LogEntity, NodeEntity, TextEntity } from "@/lib/story/types";

/**
 * SVG renderer for a story scene at time `t`. A pure function of its props:
 * the player re-renders it every animation frame while something moves.
 *
 * The drawing conventions follow the original visualization: flat steelblue
 * nodes, Raft-style outlines for roles, white-on-black boxed log entries in
 * Courier, red for uncommitted entries, and small dots for messages.
 */


type Point = { x: number; y: number };

export type StageProps = {
  world: World;
  t: number;
  width: number;
  height: number;
  /** Reduced motion: draw every message of the beat at this fraction of its path instead of animating. */
  frozenMessagesAt?: number;
  /** Playback rate of story time, for CSS color fades that run on the wall clock. Default 1. */
  rate?: number;
};


function logLayout(live: Live, t: number, s: Scales) {
  const entity = live.entity as LogEntity;
  const w = s.size(entity.cellW ?? SIZE.cellW);
  const h = s.size(entity.cellH ?? SIZE.cellH);
  const x = s.x(liveValue(live, "x", t));
  const y = s.y(liveValue(live, "y", t));
  const column = entity.dir === "column";
  return { entity, x, y, w, h, column, cell: (i: number): Point => (column ? { x, y: y + i * h } : { x: x + i * w, y }) };
}

function center(live: Live, t: number, s: Scales): Point | null {
  switch (live.entity.kind) {
    case "node":
    case "card":
    case "text":
      return { x: s.x(liveValue(live, "x", t)), y: s.y(liveValue(live, "y", t)) };
    case "log": {
      const log = logLayout(live, t, s);
      const n = Math.max(1, live.cells.length);
      return log.column ? { x: log.x + log.w / 2, y: log.y + (n * log.h) / 2 } : { x: log.x + (n * log.w) / 2, y: log.y + log.h / 2 };
    }
    case "panel":
      return panelAnchor(live, t, s, "from");
    default:
      return null;
  }
}

/** Where a message starts (`from`) or lands (`to`). Messages to a log or timeline panel land on its next free slot. */
function anchorPoint(world: World, anchor: Anchor, t: number, s: Scales, role: "from" | "to"): Point | null {
  if (typeof anchor === "string") {
    const live = world.live.get(anchor);
    if (live?.entity.kind === "panel") return panelAnchor(live, t, s, role);
    return live ? center(live, t, s) : null;
  }
  const live = world.live.get(anchor.log);
  if (!live || live.entity.kind !== "log") return null;
  const log = logLayout(live, t, s);
  const index = anchor.index === "end" ? live.cells.length : anchor.index;
  const cell = log.cell(index);
  return { x: cell.x + log.w / 2, y: cell.y + log.h / 2 };
}


export function Stage({ world, t, width, height, frozenMessagesAt, rate = 1 }: StageProps) {
  const s = makeScales(cameraAt(world, t), width, height);
  const entries = [...world.live.entries()];
  const ofKind = <K extends Live["entity"]["kind"]>(kind: K) => entries.filter(([, live]) => live.entity.kind === kind);

  // Cursors on the same log stack in rows, in insertion order.
  const cursorRow = new Map<string, number>();
  const rowsPerLog = new Map<string, number>();
  for (const [id, live] of ofKind("cursor")) {
    if (live.entity.kind !== "cursor") continue;
    const row = rowsPerLog.get(live.entity.log) ?? 0;
    cursorRow.set(id, row);
    rowsPerLog.set(live.entity.log, row + 1);
  }

  return (
    <g>
      {ofKind("link").map(([id, live]) => {
        const entity = live.entity as LinkEntity;
        const from = world.live.get(entity.from);
        const to = world.live.get(entity.to);
        const a = from && center(from, t, s);
        const b = to && center(to, t, s);
        if (!a || !b) return null;
        const labelPx = s.font(5.5);
        return (
          <g key={id} opacity={presence(live, t)}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#b8b8b8"
              strokeWidth={Math.max(1.5, s.size(0.45))}
              strokeDasharray={entity.dashed ? "6,5" : undefined}
            />
            {entity.label ? (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2}
                fontFamily={MONO_FONT}
                fontSize={labelPx}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#555"
                stroke="#fff"
                strokeWidth={labelPx * 0.35}
                paintOrder="stroke"
              >
                {entity.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {ofKind("log").map(([id, live]) => {
        const log = logLayout(live, t, s);
        const unitsH = log.entity.cellH ?? SIZE.cellH;
        const textPx = s.font(unitsH * 1.3);
        const tagPx = s.font(unitsH * 1.05);
        const labelPx = s.font(6);
        return (
          <g key={id} opacity={presence(live, t)} fontFamily={MONO_FONT}>
            {log.entity.label ? (
              <text
                x={log.column ? log.x : log.x - labelPx * 0.6}
                y={log.column ? log.y - labelPx * 0.7 : log.y + log.h / 2}
                fontSize={labelPx}
                textAnchor={log.column ? "start" : "end"}
                dominantBaseline="middle"
                fill="#000"
              >
                {log.entity.label}
              </text>
            ) : null}
            {live.cells.map((cell, i) => {
              const p = log.cell(i);
              return (
                <g key={i} opacity={ease(progress(t, cell.born, TWEEN))}>
                  <rect x={p.x} y={p.y} width={log.w} height={log.h} fill="#fff" stroke="#000" shapeRendering="crispEdges" />
                  <text
                    x={p.x + log.w / 2}
                    y={p.y + log.h / 2 + 1}
                    fontSize={fitFont(textPx, cell.text.length, log.w * 0.86)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fill: TONE[cell.tone ?? "normal"], transition: colorFade(rate) }}
                  >
                    {cell.text}
                  </text>
                  {cell.tag !== undefined && !log.column ? (
                    <text x={p.x + log.w / 2} y={p.y - tagPx * 0.45} fontSize={tagPx} textAnchor="middle" fill="#777">
                      {cell.tag}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}

      {ofKind("cursor").map(([id, live]) => {
        if (live.entity.kind !== "cursor") return null;
        const target = world.live.get(live.entity.log);
        if (!target || target.entity.kind !== "log") return null;
        const log = logLayout(target, t, s);
        const index = liveValue(live, "index", t);
        const half = s.size(1.6);
        const tall = s.size(2.2);
        const labelPx = s.font(7);
        const rowH = tall + labelPx * 1.5;
        const color = INK[live.entity.ink];
        const row = cursorRow.get(id) ?? 0;
        // Row logs: the pointer sits under the cell, pointing up. Column logs: to the right, pointing left.
        const tip = log.column
          ? { x: log.x + log.w + s.size(0.6) + row * (labelPx * 4), y: log.y + (index + 0.5) * log.h }
          : { x: log.x + (index + 0.5) * log.w, y: log.y + log.h + s.size(0.6) + row * rowH };
        const points = log.column
          ? `${tip.x},${tip.y} ${tip.x + tall},${tip.y - half} ${tip.x + tall},${tip.y + half}`
          : `${tip.x},${tip.y} ${tip.x - half},${tip.y + tall} ${tip.x + half},${tip.y + tall}`;
        return (
          <g key={id} opacity={presence(live, t)} fontFamily={MONO_FONT}>
            <polygon points={points} fill={color} />
            {live.entity.label ? (
              <text
                x={log.column ? tip.x + tall + labelPx * 0.3 : tip.x}
                y={log.column ? tip.y : tip.y + tall + labelPx * 0.75}
                fontSize={labelPx}
                textAnchor={log.column ? "start" : "middle"}
                dominantBaseline="middle"
                fill={color}
              >
                {live.entity.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {ofKind("card").map(([id, live]) => {
        const entity = live.entity as CardEntity;
        const fontPx = s.font(entity.font ?? SIZE.cardFont);
        const size = cardSize(live.cells, fontPx);
        const cx = s.x(liveValue(live, "x", t));
        const cy = s.y(liveValue(live, "y", t));
        const left = cx - size.width / 2;
        const top = cy - size.height / 2;
        return (
          <g key={id} opacity={presence(live, t)} fontFamily={MONO_FONT}>
            <rect x={left} y={top} width={size.width} height={size.height} fill="#fff" stroke="#000" shapeRendering="crispEdges" />
            {live.cells.map((cell, i) => (
              <text
                key={i}
                x={left + size.pad}
                y={top + size.pad + (i + 0.5) * MONO.line * fontPx}
                fontSize={fontPx}
                dominantBaseline="middle"
                opacity={ease(progress(t, cell.born, TWEEN))}
                style={{ fill: TONE[cell.tone ?? "normal"], transition: colorFade(rate), whiteSpace: "pre" }}
              >
                {cell.text}
              </text>
            ))}
          </g>
        );
      })}

      {ofKind("panel").map(([id, live]) => (
        <PanelMark key={id} live={live} t={t} s={s} rate={rate} />
      ))}

      {world.messages.map((message) => (
        <MessageMark key={message.key} world={world} message={message} t={t} s={s} frozenAt={frozenMessagesAt} />
      ))}

      {ofKind("node").map(([id, live]) => (
        <NodeMark key={id} live={live} t={t} s={s} rate={rate} />
      ))}

      {ofKind("text").map(([id, live]) => {
        const entity = live.entity as TextEntity;
        return (
          <text
            key={id}
            x={s.x(liveValue(live, "x", t))}
            y={s.y(liveValue(live, "y", t))}
            fontFamily={MONO_FONT}
            fontSize={s.font(entity.font ?? SIZE.textFont)}
            textAnchor={entity.anchor ?? "middle"}
            dominantBaseline="middle"
            opacity={presence(live, t)}
            style={{ fill: INK[entity.ink ?? "black"], transition: colorFade(rate) }}
          >
            {entity.text}
          </text>
        );
      })}
    </g>
  );
}

function NodeMark({ live, t, s, rate }: { live: Live; t: number; s: Scales; rate: number }) {
  const entity = live.entity as NodeEntity;
  const units = liveValue(live, "r", t) || SIZE.nodeRadius;
  const grow = ease(progress(t, live.born, TWEEN));
  const fade = live.dying === null ? 1 : 1 - ease(progress(t, live.dying, FADE));
  if (fade <= 0) return null;
  const r = s.size(units) * grow;
  const x = s.x(liveValue(live, "x", t));
  const y = s.y(liveValue(live, "y", t));
  const ring = entity.ring ?? "none";
  const descPx = s.font(SIZE.descFont);
  const lineH = descPx * 1.2;
  const desc = entity.desc ?? [];
  const below = entity.descAt === "below";
  const gap = s.size(units) + descPx * 0.45;

  let arc: string | null = null;
  if (live.timer && t >= live.timer.start && t < live.timer.start + live.timer.duration) {
    const pct = (t - live.timer.start) / live.timer.duration;
    arc = arcPath(Math.max(0, s.size(units - 1)), s.size(units) + 1, pct * Math.PI * 2);
  }

  return (
    <g data-entity-id={entity.id} transform={`translate(${x},${y})`} opacity={fade}>
      {entity.shape === "square" ? (
        <rect
          x={-Math.max(0, r)}
          y={-Math.max(0, r)}
          width={Math.max(0, r) * 2}
          height={Math.max(0, r) * 2}
          rx={r * 0.18}
          stroke="#000"
          strokeWidth={Math.max(2, Math.min(5, s.size(0.75)))}
          strokeDasharray={ring === "dashed" ? "5,5" : undefined}
          style={{ transition: colorFade(rate, "fill, stroke-opacity"), fill: INK[entity.fill], strokeOpacity: ring === "none" ? 0 : 1 }}
        />
      ) : (
        <circle
          r={Math.max(0, r)}
          stroke="#000"
          strokeWidth={Math.max(2, Math.min(5, s.size(0.75)))}
          strokeDasharray={ring === "dashed" ? "5,5" : undefined}
          style={{ transition: colorFade(rate, "fill, stroke-opacity"), fill: INK[entity.fill], strokeOpacity: ring === "none" ? 0 : 1 }}
        />
      )}
      {arc ? <path d={arc} fill="#fff" /> : null}
      {entity.value ? (
        <text
          y={2}
          fill="#fff"
          fontFamily={SANS_FONT}
          fontSize={fitFont(s.font(12 * (units / SIZE.nodeRadius)), entity.value.length * 0.95, r * 1.6)}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={grow}
        >
          {entity.value}
        </text>
      ) : null}
      {desc.map((line, i) => (
        <text
          key={i}
          y={below ? gap + (i + 0.5) * lineH : -gap - (desc.length - i - 0.5) * lineH}
          fontFamily={MONO_FONT}
          fontSize={descPx}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#000"
          opacity={grow}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function MessageMark({ world, message, t, s, frozenAt }: { world: World; message: Message; t: number; s: Scales; frozenAt?: number }) {
  let p: number;
  if (frozenAt !== undefined) p = frozenAt;
  else if (t < message.sent || t >= message.arrives) return null;
  else p = (t - message.sent) / (message.arrives - message.sent);

  const a = anchorPoint(world, message.from, t, s, "from");
  const b = anchorPoint(world, message.to, t, s, "to");
  if (!a || !b) return null;
  const x = a.x + (b.x - a.x) * p;
  const y = a.y + (b.y - a.y) * p;
  const opacity = frozenAt !== undefined ? 0.6 : 1;
  const { look } = message;

  if (look.shape === "dot") {
    const color = INK[look.ink];
    return look.hollow ? (
      <circle data-message={message.key} cx={x} cy={y} r={s.size(SIZE.hollowDot)} fill="#fff" stroke={color} strokeWidth={2} opacity={opacity} />
    ) : (
      <circle data-message={message.key} cx={x} cy={y} r={s.size(SIZE.dot)} fill={color} stroke={color} strokeWidth={2} opacity={opacity} />
    );
  }

  const fontPx = s.font(SIZE.packetFont);
  const pad = fontPx * 0.45;
  const w = look.text.length * MONO.advance * fontPx + pad * 2;
  const h = fontPx * 1.5;
  const color = look.ink ? INK[look.ink] : "#000";
  return (
    <g data-message={message.key} transform={`translate(${x},${y})`} opacity={opacity} fontFamily={MONO_FONT}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#fff" stroke={color} strokeWidth={1.5} shapeRendering="crispEdges" />
      <text y={1} fontSize={fontPx} textAnchor="middle" dominantBaseline="middle" fill={color}>
        {look.text}
      </text>
    </g>
  );
}

/** A ring sector from 12 o'clock, clockwise, like the original's election timer. */
function arcPath(inner: number, outer: number, angle: number): string {
  const a = Math.min(angle, Math.PI * 2 - 1e-4);
  const large = a > Math.PI ? 1 : 0;
  const pt = (r: number, theta: number) => `${(r * Math.sin(theta)).toFixed(2)},${(-r * Math.cos(theta)).toFixed(2)}`;
  return [
    `M${pt(outer, 0)}`,
    `A${outer},${outer} 0 ${large} 1 ${pt(outer, a)}`,
    `L${pt(inner, a)}`,
    `A${inner},${inner} 0 ${large} 0 ${pt(inner, 0)}`,
    "Z",
  ].join(" ");
}
