"use client";

import {
  AnimatePresence,
  animate,
  motion,
  motionValue,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ARENA, EDGE_LABEL, LABEL, NODE } from "@/lib/concept/constants";
import {
  BIDIRECTIONAL_BEND,
  clampCenterToArena,
  edgeGeometry,
  edgeLabelSize,
  quadraticPoint,
  type EdgeGeometry,
  wrapLabel,
} from "@/lib/concept/geometry";
import { INACTIVE_PAINT, PALETTE } from "@/lib/concept/palette";
import type { Concept, NodeShape, VisualEdge, VisualNode } from "@/lib/concept/schema";

/**
 * Renderer-owned, deterministic timings (seconds). Content never controls them.
 */
export const TIMING = {
  move: { duration: 0.75, ease: [0.65, 0, 0.35, 1] as const },
  nodeEnter: { duration: 0.4, delay: 0.2 },
  nodeExit: { duration: 0.25 },
  edgeEnter: { duration: 0.35, delay: 0.45 },
  edgeExit: { duration: 0.2 },
  paint: { duration: 0.4 },
  pulse: { duration: 1.6, repeatDelay: 0.4 },
  /** Used instead of the above when the reader prefers reduced motion. */
  reducedFade: { duration: 0.12 },
} as const;

type Position = { x: MotionValue<number>; y: MotionValue<number> };
type PositionStore = ReadonlyMap<string, Position>;

/**
 * One pair of motion values per node id for the whole concept, created once.
 * Nodes read them for their transform and edges read them to recompute their
 * paths every frame, so edges stay attached while nodes move.
 */
function createPositionStore(concept: Concept): PositionStore {
  const store = new Map<string, Position>();
  for (const step of concept.steps) {
    for (const node of step.nodes) {
      if (!store.has(node.id)) {
        store.set(node.id, { x: motionValue(node.x), y: motionValue(node.y) });
      }
    }
  }
  return store;
}

type SceneArenaProps = {
  concept: Concept;
  stepIndex: number;
  reducedMotion: boolean;
  /** Stable 1-based numbers per entity, shown inside nodes on narrow screens. */
  numbers: ReadonlyMap<string, number>;
  /** Unique per player instance; prefixes SVG ids such as markers. */
  idPrefix: string;
  label: string;
  describedBy?: string;
};

export function SceneArena({
  concept,
  stepIndex,
  reducedMotion,
  numbers,
  idPrefix,
  label,
  describedBy,
}: SceneArenaProps) {
  const [store] = useState(() => createPositionStore(concept));
  const step = concept.steps[stepIndex]!;
  const previousNodeIds = useRef<ReadonlySet<string> | null>(null);

  // Layout effect: entering nodes must be placed before the browser paints.
  useLayoutEffect(() => {
    const running: AnimationPlaybackControls[] = [];
    const previous = previousNodeIds.current;
    for (const node of step.nodes) {
      const position = store.get(node.id);
      if (!position) continue;
      const entering = !previous?.has(node.id);
      if (entering || reducedMotion) {
        position.x.jump(node.x);
        position.y.jump(node.y);
      } else {
        // `animate` retargets from the current (possibly mid-flight) value.
        running.push(animate(position.x, node.x, TIMING.move), animate(position.y, node.y, TIMING.move));
      }
    }
    previousNodeIds.current = new Set(step.nodes.map((n) => n.id));
    // Stopping on cleanup means a newer step always owns the motion values;
    // no stale animation can finish later and overwrite a newer position.
    return () => running.forEach((controls) => controls.stop());
  }, [step, store, reducedMotion]);

  const nodesById = new Map(step.nodes.map((n) => [n.id, n]));
  const connections = new Set(step.edges.map((e) => `${e.from}->${e.to}`));
  // Draw moving messages above static connections.
  const edges = [...step.edges].sort((a, b) => Number(a.animated) - Number(b.animated));

  return (
    <svg
      viewBox={`0 0 ${ARENA.width} ${ARENA.height}`}
      className="block h-auto w-full select-none"
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id={`${idPrefix}-arrow`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="11"
          markerHeight="11"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0,0.5 L10,5 L0,9.5 z" fill="var(--edge-static)" />
        </marker>
        <marker
          id={`${idPrefix}-arrow-live`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="13"
          markerHeight="13"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0,0.5 L10,5 L0,9.5 z" fill="var(--edge-live)" />
        </marker>
      </defs>

      <g>
        <AnimatePresence initial={false}>
          {edges.map((edge) => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            const fromPos = store.get(edge.from);
            const toPos = store.get(edge.to);
            if (!from || !to || !fromPos || !toPos) return null;
            return (
              <SceneEdge
                key={edge.id}
                edge={edge}
                from={fromPos}
                to={toPos}
                fromShape={from.shape}
                toShape={to.shape}
                bend={connections.has(`${edge.to}->${edge.from}`) ? BIDIRECTIONAL_BEND : 0}
                reducedMotion={reducedMotion}
                idPrefix={idPrefix}
              />
            );
          })}
        </AnimatePresence>
      </g>

      <g>
        <AnimatePresence initial={false}>
          {step.nodes.map((node) => {
            const position = store.get(node.id);
            if (!position) return null;
            return (
              <SceneNode
                key={node.id}
                node={node}
                position={position}
                number={numbers.get(node.id) ?? 0}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </AnimatePresence>
      </g>
    </svg>
  );
}

function SceneNode({
  node,
  position,
  number,
  reducedMotion,
}: {
  node: VisualNode;
  position: Position;
  number: number;
  reducedMotion: boolean;
}) {
  const active = node.status === "active";
  const paint = active ? PALETTE[node.color] : INACTIVE_PAINT;
  const lines = wrapLabel(node.label);
  const paintTransition = reducedMotion ? { duration: 0 } : TIMING.paint;
  const r = NODE.radius;

  return (
    <motion.g
      style={{ x: position.x, y: position.y }}
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? 1 : 0.7, transition: reducedMotion ? TIMING.reducedFade : TIMING.nodeEnter }}
      exit={{ opacity: 0, transition: reducedMotion ? TIMING.reducedFade : TIMING.nodeExit }}
      data-node-id={node.id}
    >
      {/* Focus halo: a non-color cue for the entity the step is about. */}
      <motion.circle
        r={r + 11}
        fill="none"
        stroke={PALETTE.primary.stroke}
        strokeWidth={5}
        initial={false}
        animate={{ opacity: active && node.color === "primary" ? 0.22 : 0 }}
        transition={paintTransition}
      />
      {node.shape === "circle" ? (
        <motion.circle
          r={r}
          strokeWidth={3}
          initial={false}
          animate={{ fill: paint.fill, stroke: paint.stroke }}
          transition={paintTransition}
          strokeDasharray={active ? undefined : "7 6"}
        />
      ) : (
        <motion.rect
          x={-r}
          y={-r}
          width={r * 2}
          height={r * 2}
          rx={NODE.squareCorner}
          strokeWidth={3}
          initial={false}
          animate={{ fill: paint.fill, stroke: paint.stroke }}
          transition={paintTransition}
          strokeDasharray={active ? undefined : "7 6"}
        />
      )}
      {/* Status glyph inside the node: solid dot = active, hollow ring = inactive. */}
      <circle
        className="@max-xl:hidden"
        r={active ? 5 : 5.5}
        fill={active ? paint.stroke : "none"}
        stroke={paint.stroke}
        strokeWidth={active ? 0 : 2}
      />
      {/* Narrow screens show a stable number instead of the label; see the scene key. */}
      <text
        className="hidden font-semibold @max-xl:inline"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={30}
        fill={paint.stroke}
      >
        {number}
      </text>
      {/* The halo (stroke painted under the fill) keeps labels legible where edges pass behind them. */}
      <text
        className="@max-xl:hidden"
        textAnchor="middle"
        fontSize={LABEL.fontSize}
        fontWeight={600}
        fill={active ? "var(--ink)" : "var(--ink-muted)"}
        stroke="var(--arena-bg)"
        strokeWidth={5}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={0} y={r + LABEL.gap + LABEL.lineHeight * (i + 1) - 4}>
            {line}
          </tspan>
        ))}
      </text>
    </motion.g>
  );
}

function SceneEdge({
  edge,
  from,
  to,
  fromShape,
  toShape,
  bend,
  reducedMotion,
  idPrefix,
}: {
  edge: VisualEdge;
  from: Position;
  to: Position;
  fromShape: NodeShape;
  toShape: NodeShape;
  bend: number;
  reducedMotion: boolean;
  idPrefix: string;
}) {
  const bendValue = useMotionValue(bend);
  useEffect(() => {
    if (reducedMotion) {
      bendValue.jump(bend);
      return;
    }
    const controls = animate(bendValue, bend, TIMING.move);
    return () => controls.stop();
  }, [bend, bendValue, reducedMotion]);

  const geometry = useTransform<number, EdgeGeometry>([from.x, from.y, to.x, to.y, bendValue], ([fx, fy, tx, ty, b]) =>
    edgeGeometry({ x: fx!, y: fy!, shape: fromShape }, { x: tx!, y: ty!, shape: toShape }, b!),
  );
  const d = useTransform(geometry, (g) => g.d);

  const text = edge.label.trim();
  const size = edgeLabelSize(text);
  const labelCenter = useTransform(geometry, (g) => clampCenterToArena(g.mid, size.width, size.height));
  const labelX = useTransform(labelCenter, (p) => p.x);
  const labelY = useTransform(labelCenter, (p) => p.y);

  const progress = useMotionValue(0.6);
  useEffect(() => {
    if (!edge.animated || reducedMotion) {
      progress.jump(0.6);
      return;
    }
    progress.jump(0);
    const controls = animate(progress, 1, {
      duration: TIMING.pulse.duration,
      ease: "easeInOut",
      repeat: Infinity,
      repeatDelay: TIMING.pulse.repeatDelay,
      delay: TIMING.edgeEnter.delay,
    });
    return () => controls.stop();
  }, [edge.animated, reducedMotion, progress]);

  const pulse = useTransform(() => {
    const g = geometry.get();
    return quadraticPoint(g.start, g.control, g.end, progress.get());
  });
  const pulseX = useTransform(pulse, (p) => p.x);
  const pulseY = useTransform(pulse, (p) => p.y);

  const live = edge.animated;

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: reducedMotion ? TIMING.reducedFade : TIMING.edgeEnter }}
      exit={{ opacity: 0, transition: reducedMotion ? TIMING.reducedFade : TIMING.edgeExit }}
      data-edge-id={edge.id}
    >
      <motion.path
        d={d}
        fill="none"
        stroke={live ? "var(--edge-live)" : "var(--edge-static)"}
        strokeWidth={live ? 2.75 : 2.25}
        strokeLinecap="round"
        markerEnd={`url(#${idPrefix}-arrow${live ? "-live" : ""})`}
      />
      {text && (
        <motion.g className="@max-xl:hidden" style={{ x: labelX, y: labelY }}>
          <rect
            x={-size.width / 2}
            y={-size.height / 2}
            width={size.width}
            height={size.height}
            rx={size.height / 2}
            fill="var(--pill-bg)"
            stroke={live ? "var(--edge-live)" : "var(--edge-static)"}
            strokeOpacity={0.45}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={EDGE_LABEL.fontSize}
            fontWeight={500}
            fill="var(--ink)"
          >
            {text}
          </text>
        </motion.g>
      )}
      {live && (
        <motion.circle
          r={7}
          fill="var(--pulse)"
          stroke="var(--arena-bg)"
          strokeWidth={2.5}
          style={{ x: pulseX, y: pulseY }}
        />
      )}
    </motion.g>
  );
}

