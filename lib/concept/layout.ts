import { ARENA, ARENAS, LABEL, LIMITS, NODE, type Arena, type LayoutStrategy } from "./constants";
import { framesFor, type Size } from "./frames";
import { distanceToSegment, visualLength, wrapLabel } from "./geometry";
import {
  panelFromGenerated,
  panelToGenerated,
  type Concept,
  type ConceptContent,
  type GeneratedConceptContent,
  type GeneratedStep,
  type Panel,
  type Step,
  type UnplacedPanel,
  type VisualNode,
} from "./schema";
import { geometryErrors } from "./validate";

/**
 * Deterministic layout: semantic placement in, positions out.
 *
 * The generator says *where things belong* (a node's grid column and row, or
 * its order around a ring; which panels appear) and the strategy; this module
 * computes coordinates from the real sizes of nodes, labels, and panel
 * frames, considering everything each panel will ever show. Positions depend
 * only on the grid cell, so an entity keeps its place across steps unless the
 * explanation moves it on purpose.
 *
 * Several arrangements are tried (nodes above, below, left, or right of the
 * panels; panels side by side or stacked); the one with the fewest geometry
 * errors, then the most room, wins. The validator still checks the result.
 */

type PlacedNode = VisualNode & { col: number; row: number };
/** A step whose nodes carry grid cells; positions are (re)computed. */
export type PlaceableStep = Omit<Step, "nodes" | "panels"> & { nodes: Omit<PlacedNode, "x" | "y">[]; panels?: UnplacedPanel[] };

const PAD = ARENA.safeMargin + 8;
const GAP = 28;
/** Below a node center: radius, gap, and two label lines. */
const LABEL_DROP = NODE.radius + LABEL.gap + LABEL.maxLines * LABEL.lineHeight;
const MAX_COL_SPACING = 240;
const MAX_ROW_SPACING = 170;

type Region = { x0: number; y0: number; x1: number; y1: number };
type Placement = "top" | "bottom" | "left" | "right" | "alone";
type Candidate = { placement: Placement; flow: "row" | "column" };

export type LayoutResult = { steps: Step[]; errors: number; arrangement: string };

/** Distinct values in order, mapped to 0..n-1, so unused grid lines don't waste room. */
function compact(values: number[]): Map<number, number> {
  return new Map([...new Set(values)].sort((a, b) => a - b).map((v, i) => [v, i]));
}

const labelHalfWidth = (label: string) => (Math.max(...wrapLabel(label).map(visualLength)) * LABEL.charWidth) / 2;

function panelOrder(steps: PlaceableStep[]): string[] {
  const order: string[] = [];
  for (const step of steps) for (const panel of step.panels ?? []) if (!order.includes(panel.id)) order.push(panel.id);
  return order;
}

/**
 * Panels that never appear in the same step can share a place: a code panel
 * that a timeline replaces later needs no room beside it. Greedy, in order of
 * first appearance; a slot is as large as its largest panel.
 */
function panelSlots(steps: PlaceableStep[], ids: string[], sizes: Map<string, Size>): { ids: string[]; size: Size }[] {
  const together = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const step of steps) {
    const present = (step.panels ?? []).map((p) => p.id);
    for (const a of present) for (const b of present) if (a !== b) together.get(a)!.add(b);
  }
  const slots: { ids: string[]; size: Size }[] = [];
  for (const id of ids) {
    const size = sizes.get(id)!;
    const fits = slots.filter((slot) => slot.ids.every((other) => !together.get(id)!.has(other)));
    // Prefer the slot whose size is closest, so sharing wastes the least room.
    const best = fits.sort((a, b) => sizeGap(a.size, size) - sizeGap(b.size, size))[0];
    if (best) {
      best.ids.push(id);
      best.size = { width: Math.max(best.size.width, size.width), height: Math.max(best.size.height, size.height) };
    } else slots.push({ ids: [id], size: { ...size } });
  }
  return slots;
}

const sizeGap = (a: Size, b: Size) => Math.abs(a.width - b.width) + Math.abs(a.height - b.height);

/** Positions of panel centers for slots laid out in a row or a column, centered in a region. */
function placeBlock(slots: { ids: string[]; size: Size }[], flow: "row" | "column", region: Region): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const block = blockSize(slots.map((s) => s.size), flow);
  const cx = (region.x0 + region.x1) / 2;
  const cy = (region.y0 + region.y1) / 2;
  let cursor = flow === "row" ? cx - block.width / 2 : cy - block.height / 2;
  for (const slot of slots) {
    const center = flow === "row" ? { x: cursor + slot.size.width / 2, y: cy } : { x: cx, y: cursor + slot.size.height / 2 };
    for (const id of slot.ids) out.set(id, center);
    cursor += (flow === "row" ? slot.size.width : slot.size.height) + GAP;
  }
  return out;
}

function blockSize(list: Size[], flow: "row" | "column"): Size {
  if (list.length === 0) return { width: 0, height: 0 };
  return flow === "row"
    ? { width: list.reduce((s, x) => s + x.width, 0) + GAP * (list.length - 1), height: Math.max(...list.map((x) => x.height)) }
    : { width: Math.max(...list.map((x) => x.width)), height: list.reduce((s, x) => s + x.height, 0) + GAP * (list.length - 1) };
}

/** Node centers for every grid cell (or ring position) used, inside a region. */
function placeNodes(steps: PlaceableStep[], strategy: LayoutStrategy, region: Region): { at: (node: Omit<PlacedNode, "x" | "y">) => { x: number; y: number }; room: number } {
  const nodes = steps.flatMap((s) => s.nodes);
  const half = Math.max(NODE.radius, ...nodes.map((n) => labelHalfWidth(n.label)));
  const top = region.y0 + NODE.radius;
  const bottom = region.y1 - LABEL_DROP;
  const left = region.x0 + half;
  const right = region.x1 - half;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const cx = (region.x0 + region.x1) / 2;
  // Labels hang below nodes, so the visual center sits a little above the region's.
  const cy = (top + bottom) / 2;

  if (strategy === "ring") {
    const order = [...new Map(nodes.map((n) => [n.col, n.col])).keys()].sort((a, b) => a - b);
    const index = compact(order);
    const n = Math.max(1, index.size);
    const rx = width / 2;
    const ry = height / 2;
    const chord = n > 1 ? 2 * Math.min(rx, ry) * Math.sin(Math.PI / n) : Infinity;
    return {
      at: (node) => {
        if (n === 1) return { x: cx, y: cy };
        const angle = -Math.PI / 2 + (2 * Math.PI * (index.get(node.col) ?? 0)) / n;
        return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
      },
      room: Math.min(chord / (half * 2 + 12), 2),
    };
  }

  const cols = compact(nodes.map((n) => n.col));
  const rows = compact(nodes.map((n) => n.row));
  const colSpacing = cols.size > 1 ? Math.min(MAX_COL_SPACING, width / (cols.size - 1)) : 0;
  const rowSpacing = rows.size > 1 ? Math.min(MAX_ROW_SPACING, height / (rows.size - 1)) : 0;
  const gridWidth = colSpacing * (cols.size - 1);
  const gridHeight = rowSpacing * (rows.size - 1);
  const x0 = cx - gridWidth / 2;
  const y0 = cy - gridHeight / 2;
  const base = (col: number, row: number) => ({
    x: x0 + (cols.get(col) ?? 0) * colSpacing,
    y: y0 + (rows.get(row) ?? 0) * rowSpacing,
  });

  // A connection must not pass through another node. Move each crossed cell
  // away from the line, perpendicular to it, just far enough; repeat a few
  // rounds, since one move can create another crossing. Positions stay per
  // cell, so a node keeps its place in every step.
  const shift = new Map<string, { x: number; y: number }>();
  const clearance = NODE.radius + 18;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(right, Math.max(left, p.x)),
    y: Math.min(bottom, Math.max(top, p.y)),
  });
  const at = (col: number, row: number) => {
    const p = base(col, row);
    const d = shift.get(`${col}:${row}`);
    return clamp(d ? { x: p.x + d.x, y: p.y + d.y } : p);
  };
  for (let round = 0; round < 6; round++) {
    let moved = false;
    for (const step of steps) {
      const byId = new Map(step.nodes.map((n) => [n.id, n]));
      for (const edge of step.edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        const pa = at(a.col, a.row);
        const pb = at(b.col, b.row);
        for (const other of step.nodes) {
          if (other.id === a.id || other.id === b.id) continue;
          const po = at(other.col, other.row);
          const distance = distanceToSegment(po, pa, pb);
          if (distance >= clearance) continue;
          const length = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
          let nx = -(pb.y - pa.y) / length;
          let ny = (pb.x - pa.x) / length;
          const side = (po.x - pa.x) * nx + (po.y - pa.y) * ny;
          // Move to the side the node is already on; exactly on the line, move up (or left).
          if (side < 0 || (Math.abs(side) < 1e-6 && (ny > 0 || (ny === 0 && nx > 0)))) {
            nx = -nx;
            ny = -ny;
          }
          const push = clearance - distance + 4;
          const key = `${other.col}:${other.row}`;
          const current = shift.get(key) ?? { x: 0, y: 0 };
          shift.set(key, { x: current.x + nx * push, y: current.y + ny * push });
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const need = Math.max(NODE.minSeparation, half * 2 + 8);
  const room = Math.min(cols.size > 1 ? colSpacing / need : 2, rows.size > 1 ? rowSpacing / (NODE.radius * 2 + LABEL_DROP - 20) : 2);
  return { at: (node) => at(node.col, node.row), room };
}

function preferred(strategy: LayoutStrategy): Candidate[] {
  switch (strategy) {
    case "code_beside_data":
      return [
        { placement: "top", flow: "row" },
        { placement: "left", flow: "row" },
        { placement: "top", flow: "column" },
        { placement: "left", flow: "column" },
        { placement: "bottom", flow: "row" },
      ];
    case "flow":
    case "ring":
      return [
        { placement: "top", flow: "row" },
        { placement: "left", flow: "column" },
        { placement: "top", flow: "column" },
        { placement: "right", flow: "column" },
        { placement: "bottom", flow: "row" },
        { placement: "left", flow: "row" },
      ];
    default:
      return [
        { placement: "top", flow: "column" },
        { placement: "top", flow: "row" },
        { placement: "left", flow: "column" },
        { placement: "bottom", flow: "column" },
        { placement: "right", flow: "column" },
      ];
  }
}

function arrange(steps: PlaceableStep[], strategy: LayoutStrategy, arena: Arena, candidate: Candidate): { steps: Step[]; room: number } {
  const frames = framesFor(steps, arena, true);
  const sizes = new Map([...frames].map(([id, frame]) => [id, frame.size]));
  const ids = panelOrder(steps);
  const slots = panelSlots(steps, ids, sizes);
  const hasNodes = steps.some((s) => s.nodes.length > 0);
  const full: Region = { x0: PAD, y0: PAD, x1: arena.width - PAD, y1: arena.height - PAD };
  const block = blockSize(slots.map((s) => s.size), candidate.flow);

  let nodeRegion = full;
  let panelRegion = full;
  if (ids.length > 0 && hasNodes) {
    switch (candidate.placement) {
      case "top":
        nodeRegion = { ...full, y1: full.y1 - block.height - GAP };
        panelRegion = { ...full, y0: full.y1 - block.height };
        break;
      case "bottom":
        panelRegion = { ...full, y1: full.y0 + block.height };
        nodeRegion = { ...full, y0: full.y0 + block.height + GAP };
        break;
      case "left":
        nodeRegion = { ...full, x1: full.x1 - block.width - GAP };
        panelRegion = { ...full, x0: full.x1 - block.width };
        break;
      case "right":
        panelRegion = { ...full, x1: full.x0 + block.width };
        nodeRegion = { ...full, x0: full.x0 + block.width + GAP };
        break;
      case "alone":
        break;
    }
  }

  const panelAt = placeBlock(slots, candidate.flow, panelRegion);
  const nodes = hasNodes ? placeNodes(steps, strategy, nodeRegion) : { at: () => ({ x: 0, y: 0 }), room: 2 };
  const round = (v: number) => Math.round(v * 10) / 10;
  const clampX = (v: number) => Math.min(arena.width, Math.max(0, round(v)));
  const clampY = (v: number) => Math.min(arena.height, Math.max(0, round(v)));

  const placed: Step[] = steps.map((step) => {
    const { panels, nodes: stepNodes, ...rest } = step;
    const out: Step = {
      ...rest,
      nodes: stepNodes.map((node) => {
        const p = nodes.at(node);
        return { ...node, x: clampX(p.x), y: clampY(p.y) };
      }),
    };
    if (panels && panels.length > 0) {
      out.panels = panels.map((panel) => {
        const p = panelAt.get(panel.id)!;
        return { ...panel, x: clampX(p.x), y: clampY(p.y) } as Panel;
      });
    }
    return out;
  });
  const fits = block.width <= full.x1 - full.x0 && block.height <= full.y1 - full.y0;
  return { steps: placed, room: fits ? nodes.room : 0 };
}

/** Lay out steps with semantic placement on an arena. */
export function placeSteps(steps: PlaceableStep[], strategy: LayoutStrategy, arena: Arena): LayoutResult {
  let best: (LayoutResult & { room: number }) | null = null;
  for (const candidate of preferred(strategy)) {
    const { steps: placed, room } = arrange(steps, strategy, arena, candidate);
    const errors = geometryErrors(placed, arena).length;
    const better =
      !best ||
      errors < best.errors ||
      // Prefer clearly more room between nodes; otherwise keep the earlier (preferred) arrangement.
      (errors === best.errors && room > best.room * 1.25 && room < 1);
    if (better) best = { steps: placed, errors, room, arrangement: `${candidate.placement}/${candidate.flow}` };
    if (best!.errors === 0 && best!.room >= 1) break;
  }
  return { steps: best!.steps, errors: best!.errors, arrangement: best!.arrangement };
}

/** Canonical content without positions → laid out on the landscape arena (used by bundled examples). */
export function layoutPlaceable(
  content: { title: string; description: string; steps: PlaceableStep[] },
  strategy: LayoutStrategy,
): ConceptContent {
  const result = placeSteps(content.steps, strategy, ARENAS.landscape);
  return { title: content.title, description: content.description, steps: result.steps };
}

/** Wire-format content from the generator → canonical, laid-out content on the landscape arena. */
export function layoutGenerated(generated: GeneratedConceptContent, strategy: LayoutStrategy): { content: ConceptContent; arrangement: string } {
  const steps: PlaceableStep[] = generated.steps.map(fromGeneratedStep);
  const result = placeSteps(steps, strategy, ARENAS.landscape);
  return { content: { title: generated.title, description: generated.description, steps: result.steps }, arrangement: result.arrangement };
}

function fromGeneratedStep(step: GeneratedStep): PlaceableStep {
  const { notes, panels, focus, timing, edges, claims, ...rest } = step;
  return {
    ...rest,
    edges: edges.map(({ order, ...edge }) => (order > 1 ? { ...edge, order } : edge)),
    ...(notes && notes.trim().length > 0 ? { notes } : {}),
    ...(panels.length > 0 ? { panels: panels.map(panelFromGenerated) } : {}),
    ...(focus && focus.length > 0 ? { focus } : {}),
    ...(timing !== "changes_first" ? { timing } : {}),
    ...(claims.length > 0 ? { claims } : {}),
  };
}

/**
 * A stored explanation laid out again on another arena (the portrait one),
 * or null when it has no semantic placement or the result has geometry
 * errors; the caller then shows the stored landscape layout.
 */
export function relayout(concept: Concept, arena: Arena): Step[] | null {
  if (!concept.layout) return null;
  const steps: PlaceableStep[] = [];
  for (const step of concept.steps) {
    if (step.nodes.some((n) => n.col === undefined || n.row === undefined)) return null;
    steps.push({ ...step, nodes: step.nodes.map((node) => ({ id: node.id, label: node.label, shape: node.shape, color: node.color, status: node.status, col: node.col!, row: node.row! })) });
  }
  const result = placeSteps(steps, concept.layout, arena);
  return result.errors === 0 ? result.steps : null;
}

// ---------------------------------------------------------------------------
// Inverse: canonical content back to the wire format (for mocks and tests)
// ---------------------------------------------------------------------------

/**
 * Grid cells inferred from written positions: distinct x values (within a
 * tolerance) become columns and distinct y values rows. Used to turn
 * version-1 content into wire format for mocks and tests.
 */
function inferGrid(steps: Step[]): (node: VisualNode) => { col: number; row: number } {
  const cluster = (values: number[], limit: number) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const centers: number[] = [];
    for (const v of sorted) if (centers.length === 0 || v - centers.at(-1)! > 40) centers.push(v);
    return (v: number) => {
      let best = 0;
      centers.forEach((c, i) => {
        if (Math.abs(c - v) < Math.abs(centers[best]! - v)) best = i;
      });
      return Math.min(best, limit - 1);
    };
  };
  const nodes = steps.flatMap((s) => s.nodes);
  const col = cluster(nodes.map((n) => n.x), LIMITS.grid.columns);
  const row = cluster(nodes.map((n) => n.y), LIMITS.grid.rows);
  return (node) => ({ col: node.col ?? col(node.x), row: node.row ?? row(node.y) });
}

/** The wire shape of canonical content (every key present, no coordinates). */
export function toGeneratedContent(content: ConceptContent): GeneratedConceptContent {
  const cell = inferGrid(content.steps);
  return {
    title: content.title,
    description: content.description,
    steps: content.steps.map(({ notes, panels, focus, timing, edges, claims, nodes, ...step }) => ({
      ...step,
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.label,
        shape: node.shape,
        color: node.color,
        status: node.status,
        ...cell(node),
      })),
      edges: edges.map((edge) => ({ ...edge, order: edge.order ?? 1 })),
      notes: notes ?? null,
      panels: (panels ?? []).map(panelToGenerated),
      focus: focus ?? null,
      timing: timing ?? "changes_first",
      claims: claims ?? [],
    })),
  };
}

