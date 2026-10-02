import { PANEL, type Arena } from "./constants";
import { conceptPanelShape, panelSize } from "./geometry";
import type {
  ChartPanel,
  ComparisonPanel,
  HierarchyPanel,
  Panel,
  TimelineItem,
  TimelinePanel,
  UnplacedPanel,
} from "./schema";

/**
 * Frames: the stable drawing of one panel across an explanation.
 *
 * A panel appears in several steps with different content (a timeline grows,
 * a comparison reveals criteria, a chart reveals values). Its frame is built
 * from the union of that content, so its size, axes, rows, and the positions
 * of its items never jump between steps. The layout engine reserves the
 * frame's size, the validator checks it, and the renderer draws inside it.
 *
 * Frames are plain JSON data, so the story player can carry them.
 *
 * Logs, code, tables, and version-1 timelines keep their original rule (size
 * follows the current content), unless the concept was laid out by the
 * layout engine, which reserves their largest size.
 */

export type Orientation = "horizontal" | "vertical";
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const orientationOf = (arena: Arena): Orientation => (arena.width >= arena.height ? "horizontal" : "vertical");

/** Panels drawn from a frame, whatever the concept's layout. */
export function isFramed(panel: Pick<Panel, "kind"> & { spacing?: unknown }): boolean {
  return panel.kind === "comparison" || panel.kind === "hierarchy" || panel.kind === "chart" || (panel.kind === "timeline" && panel.spacing !== undefined);
}

export type TimelineFrame = {
  kind: "timeline";
  orient: Orientation;
  titled: boolean;
  lanes: string[];
  spacing: "ordered" | "proportional";
  unit: string;
  /** Event key → slot index (ordered) or fraction of the axis (proportional). */
  positions: Record<string, number>;
  /** Proportional timelines: event key → fraction of the axis where a duration ends. */
  ends: Record<string, number>;
  slots: number;
  /** Width of one slot (horizontal), at most PANEL.timeline.spacing; narrower so lane names and ten events fit. */
  slotWidth: number;
  relations: boolean;
  size: Size;
};

export type ComparisonFrame = {
  kind: "comparison";
  orient: Orientation;
  titled: boolean;
  alternatives: string[];
  /** Criteria in the order they first appear, so revealed rows never move. */
  rows: { id: string; label: string; unit: string }[];
  size: Size;
};

export type HierarchyFrame = {
  kind: "hierarchy";
  orient: Orientation;
  titled: boolean;
  /** `outline` is how trees are drawn on narrow screens. */
  style: "tree" | "outline" | "groups";
  relation: HierarchyPanel["relation"];
  /** Item id → box inside the frame (below the title). */
  boxes: Record<string, Rect & { depth: number; group: boolean }>;
  /** Group container boxes, by root id (groups style). */
  groups: Record<string, Rect>;
  /** Width kept on the right for cross-links between stacked rows; 0 when there is none. */
  gutter: number;
  size: Size;
};

export type ChartFrame = {
  kind: "chart";
  orient: Orientation;
  titled: boolean;
  chart: ChartPanel["chart"];
  data: ChartPanel["data"];
  categories: string[];
  xLabel: string;
  yLabel: string;
  unit: string;
  series: string[];
  /** Axis range and tick values, from every value the chart ever shows. */
  min: number;
  max: number;
  ticks: number[];
  size: Size;
};

/** Logs, code, tables, and version-1 timelines: only a (reserved) size. */
export type SimpleFrame = { kind: "log" | "code" | "table" | "timeline-v1"; size: Size };

export type Frame = TimelineFrame | ComparisonFrame | HierarchyFrame | ChartFrame | SimpleFrame;

const titleBand = (titled: boolean) => (titled ? PANEL.title : 0);
const titledOf = (snapshots: readonly { label: string }[]) => snapshots.some((p) => p.label.trim().length > 0);

/**
 * The frame for one panel id, from its snapshots in step order. All snapshots
 * have the same kind (the validator rejects a panel that changes kind).
 * `reserve` sizes simple panels by their largest snapshot instead of the last.
 */
export function buildFrame(snapshots: readonly UnplacedPanel[], arena: Arena, reserve: boolean): Frame {
  const orient = orientationOf(arena);
  const first = snapshots[0]!;
  switch (first.kind) {
    case "comparison":
      return comparisonFrame(snapshots as ComparisonPanel[], orient);
    case "hierarchy":
      return hierarchyFrame(snapshots as HierarchyPanel[], orient);
    case "chart":
      return chartFrame(snapshots as ChartPanel[], orient);
    case "timeline":
      if ((first as TimelinePanel).spacing !== undefined) return timelineFrame(snapshots as TimelinePanel[], orient);
      return simpleFrame("timeline-v1", snapshots, reserve);
    default:
      return simpleFrame(first.kind, snapshots, reserve);
  }
}

/** Size of one snapshot of a simple panel, by the original rule. */
export function simpleSize(panel: UnplacedPanel): Size {
  return panelSize(conceptPanelShape(panel as Extract<Panel, { kind: "log" | "code" | "table" | "timeline" }>));
}

function simpleFrame(kind: SimpleFrame["kind"], snapshots: readonly UnplacedPanel[], reserve: boolean): SimpleFrame {
  const sizes = (reserve ? snapshots : snapshots.slice(-1)).map(simpleSize);
  return {
    kind,
    size: { width: Math.max(...sizes.map((s) => s.width)), height: Math.max(...sizes.map((s) => s.height)) },
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const eventKey = (item: Pick<TimelineItem, "id">, index: number) => item.id ?? `#${index}`;

/** Widest horizontal timeline: the landscape arena inside its margins. */
const MAX_TIMELINE_WIDTH = 960;

/** Union of events in display order: the longest snapshot's order, then any others by first appearance. */
function unionEvents(snapshots: readonly TimelinePanel[]): { key: string; item: TimelineItem }[] {
  const longest = snapshots.reduce((a, b) => (b.items.length >= a.items.length ? b : a));
  const latest = new Map<string, TimelineItem>();
  for (const snap of snapshots) snap.items.forEach((item, i) => latest.set(eventKey(item, i), item));
  const order = longest.items.map((item, i) => eventKey(item, i));
  for (const key of latest.keys()) if (!order.includes(key)) order.push(key);
  return order.map((key) => ({ key, item: latest.get(key)! }));
}

function timelineFrame(snapshots: readonly TimelinePanel[], orient: Orientation): TimelineFrame {
  const last = snapshots.at(-1)!;
  const events = unionEvents(snapshots);
  const lanes = last.lanes ?? [];
  const spacing = last.spacing ?? "ordered";
  const positions: Record<string, number> = {};
  const ends: Record<string, number> = {};
  let slots = 0;

  if (spacing === "proportional") {
    const times = events.flatMap(({ item }) => [item.at, item.end].filter((v): v is number => typeof v === "number"));
    const min = Math.min(...times);
    const max = Math.max(...times);
    const fraction = (v: number) => (max > min ? (v - min) / (max - min) : 0.5);
    for (const { key, item } of events) {
      positions[key] = typeof item.at === "number" ? fraction(item.at) : 0.5;
      if (typeof item.end === "number") ends[key] = fraction(item.end);
    }
    slots = Math.max(events.length, PANEL.timeline.minProportionalSlots);
  } else {
    // Events that happen at the same time in different lanes share a slot.
    let previous: TimelineItem | null = null;
    for (const { key, item } of events) {
      const simultaneous =
        previous !== null && typeof item.at === "number" && item.at === previous.at && (item.lane ?? 0) !== (previous.lane ?? 0);
      if (!simultaneous) slots += 1;
      positions[key] = slots - 1;
      previous = item;
    }
    slots = Math.max(1, slots);
  }

  const relations = snapshots.some((s) => (s.relations ?? []).length > 0);
  const laneCount = Math.max(1, lanes.length);
  const t = PANEL.timeline;
  const laneLabel = lanes.length > 0 ? t.laneLabel : 0;
  const slotWidth = Math.min(t.spacing, (MAX_TIMELINE_WIDTH - laneLabel) / slots);
  const size =
    orient === "horizontal"
      ? {
          width: laneLabel + slots * slotWidth,
          height: PANEL.title + (relations ? t.relations : 0) + laneCount * (t.date + t.axis + t.text),
        }
      : {
          width: t.vertical.date + laneCount * verticalLaneWidth(laneCount) + (relations ? t.vertical.relations : 0),
          height: PANEL.title + (lanes.length > 1 ? t.vertical.header : 0) + slots * t.vertical.row,
        };
  return { kind: "timeline", orient, titled: true, lanes, spacing, unit: last.unit ?? "", positions, ends, slots, slotWidth, relations, size };
}

/** Width of one lane column of a vertical timeline. */
export const verticalLaneWidth = (lanes: number) => PANEL.timeline.vertical.laneWidths[Math.min(Math.max(lanes, 1), 4) - 1]!;

/** Center of an event's marker inside its frame; `end` gives the end of its duration instead. */
export function timelinePoint(frame: TimelineFrame, key: string, lane: number, end = false): { x: number; y: number } {
  const t = PANEL.timeline;
  const p = (end ? frame.ends[key] : undefined) ?? frame.positions[key] ?? 0;
  if (frame.orient === "horizontal") {
    const left = frame.lanes.length > 0 ? t.laneLabel : 0;
    const slot = frame.slotWidth;
    const x = frame.spacing === "ordered" ? left + (p + 0.5) * slot : left + slot / 2 + p * (frame.slots * slot - slot);
    const laneTop = PANEL.title + (frame.relations ? t.relations : 0) + lane * (t.date + t.axis + t.text);
    return { x, y: laneTop + t.date + t.axis / 2 };
  }
  const v = t.vertical;
  const top = PANEL.title + (frame.lanes.length > 1 ? v.header : 0);
  const y = frame.spacing === "ordered" ? top + (p + 0.5) * v.row : top + v.row / 2 + p * (frame.slots * v.row - v.row);
  return { x: v.date + lane * verticalLaneWidth(Math.max(1, frame.lanes.length)) + 14, y };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function comparisonFrame(snapshots: readonly ComparisonPanel[], orient: Orientation): ComparisonFrame {
  const last = snapshots.at(-1)!;
  const rows: ComparisonFrame["rows"] = [];
  for (const snap of snapshots) {
    for (const criterion of snap.criteria) {
      const existing = rows.find((r) => r.id === criterion.id);
      if (existing) Object.assign(existing, { label: criterion.label, unit: criterion.unit });
      else rows.push({ id: criterion.id, label: criterion.label, unit: criterion.unit });
    }
  }
  const titled = titledOf(snapshots);
  const g = PANEL.comparison[orient];
  const columns = Math.max(...snapshots.map((s) => s.alternatives.length));
  return {
    kind: "comparison",
    orient,
    titled,
    alternatives: last.alternatives,
    rows,
    size: { width: g.label + columns * g.column, height: titleBand(titled) + g.header + Math.max(1, rows.length) * g.row },
  };
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

type TreeItem = { id: string; parent: string | null };

/** Union of items by id, parents from the latest snapshot that has the item. */
function unionItems(snapshots: readonly HierarchyPanel[]): TreeItem[] {
  const items = new Map<string, TreeItem>();
  for (const snap of snapshots) for (const item of snap.items) items.set(item.id, { id: item.id, parent: item.parent });
  const all = [...items.values()];
  // A parent that never appears makes its child a root.
  return all.map((item) => (item.parent !== null && !items.has(item.parent) ? { ...item, parent: null } : item));
}

function childrenOf(items: TreeItem[]) {
  const children = new Map<string | null, string[]>();
  for (const item of items) children.set(item.parent, [...(children.get(item.parent) ?? []), item.id]);
  return (id: string | null) => children.get(id) ?? [];
}

/** Depth-first walk that stops at cycles. */
function walk(items: TreeItem[], visit: (id: string, depth: number) => void) {
  const kids = childrenOf(items);
  const seen = new Set<string>();
  const go = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    visit(id, depth);
    for (const child of kids(id)) go(child, depth + 1);
  };
  for (const root of kids(null)) go(root, 0);
}

/** Leaves and levels of a tree, for choosing between a tree and an outline. */
export function treeExtent(items: TreeItem[]): { leaves: number; depth: number } {
  const kids = childrenOf(items);
  let leaves = 0;
  let depth = 0;
  walk(items, (id, d) => {
    depth = Math.max(depth, d + 1);
    if (kids(id).length === 0) leaves += 1;
  });
  return { leaves: Math.max(1, leaves), depth: Math.max(1, depth) };
}

/** Largest tree drawn as a tree on the landscape arena; wider or deeper ones become outlines. */
const MAX_TREE_WIDTH = 920;
const MAX_TREE_HEIGHT = 480;

function hierarchyFrame(snapshots: readonly HierarchyPanel[], orient: Orientation): HierarchyFrame {
  const last = snapshots.at(-1)!;
  const titled = titledOf(snapshots);
  const items = unionItems(snapshots);
  const h = PANEL.hierarchy;
  const top = titleBand(titled);
  const boxes: HierarchyFrame["boxes"] = {};
  const groups: HierarchyFrame["groups"] = {};
  const kids = childrenOf(items);
  const extent = treeExtent(items);
  // Stacked drawings route cross-links through a gutter on the right.
  const gutter = snapshots.some((s) => s.links.length > 0) ? h.linkGutter : 0;

  if (last.style === "groups") {
    const roots = kids(null);
    // Every descendant of a group is drawn as a chip inside it (the validator allows only one level).
    const members = (root: string) => {
      const out: string[] = [];
      const collect = (id: string) => {
        for (const child of kids(id)) {
          if (out.includes(child) || child === root) continue;
          out.push(child);
          collect(child);
        }
      };
      collect(root);
      return out;
    };
    const g = h.groups;
    if (orient === "horizontal") {
      const most = Math.max(1, ...roots.map((r) => members(r).length));
      const height = g.header + most * g.chip + g.padding;
      roots.forEach((root, i) => {
        const x = i * (g.width + g.gap);
        groups[root] = { x, y: top, w: g.width, h: height };
        boxes[root] = { x, y: top, w: g.width, h: g.header, depth: 0, group: true };
        members(root).forEach((id, m) => {
          boxes[id] = { x: x + g.padding, y: top + g.header + m * g.chip, w: g.width - g.padding * 2, h: g.chip - 8, depth: 1, group: false };
        });
      });
      return {
        kind: "hierarchy",
        orient,
        titled,
        style: "groups",
        relation: last.relation,
        boxes,
        groups,
        gutter: 0,
        size: { width: Math.max(1, roots.length) * (g.width + g.gap) - g.gap, height: top + height + h.legend },
      };
    }
    let y = top;
    for (const root of roots) {
      const list = members(root);
      const height = g.header + Math.max(1, list.length) * g.chip + g.padding;
      groups[root] = { x: 0, y, w: g.stackedWidth, h: height };
      boxes[root] = { x: 0, y, w: g.stackedWidth, h: g.header, depth: 0, group: true };
      list.forEach((id, m) => {
        boxes[id] = { x: g.padding, y: y + g.header + m * g.chip, w: g.stackedWidth - g.padding * 2, h: g.chip - 8, depth: 1, group: false };
      });
      y += height + g.gap;
    }
    return {
      kind: "hierarchy",
      orient,
      titled,
      style: "groups",
      relation: last.relation,
      boxes,
      groups,
      gutter,
      size: { width: g.stackedWidth + gutter, height: y - g.gap + h.legend },
    };
  }

  const tree = h.tree;
  const treeHeight = (extent.depth - 1) * tree.level + tree.box.height;
  if (orient === "horizontal" && extent.leaves * tree.slot <= MAX_TREE_WIDTH && treeHeight <= MAX_TREE_HEIGHT) {
    // Leaves take consecutive slots; a parent is centered over its children.
    let slot = 0;
    const center = new Map<string, number>();
    const place = (id: string, depth: number, seen: Set<string>): number => {
      if (seen.has(id)) return slot;
      seen.add(id);
      const children = kids(id).map((child) => place(child, depth + 1, seen));
      const c = children.length > 0 ? (children[0]! + children.at(-1)!) / 2 : slot++;
      center.set(id, c);
      boxes[id] = {
        x: (c + 0.5) * tree.slot - tree.box.width / 2,
        y: top + depth * tree.level,
        w: tree.box.width,
        h: tree.box.height,
        depth,
        group: false,
      };
      return c;
    };
    const seen = new Set<string>();
    for (const root of kids(null)) place(root, 0, seen);
    return {
      kind: "hierarchy",
      orient,
      titled,
      style: "tree",
      relation: last.relation,
      boxes,
      groups,
      gutter: 0,
      size: { width: extent.leaves * tree.slot, height: top + (extent.depth - 1) * tree.level + tree.box.height + h.legend },
    };
  }

  const o = h.outline;
  let row = 0;
  walk(items, (id, depth) => {
    boxes[id] = { x: depth * o.indent, y: top + row * o.row, w: o.width, h: o.row - 10, depth, group: false };
    row += 1;
  });
  return {
    kind: "hierarchy",
    orient,
    titled,
    style: "outline",
    relation: last.relation,
    boxes,
    groups,
    gutter,
    size: { width: o.width + (extent.depth - 1) * o.indent + gutter, height: top + Math.max(1, row) * o.row + h.legend },
  };
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

/** 1, 2, or 5 times a power of ten, at least `x`. */
function niceStep(x: number): number {
  const exponent = Math.floor(Math.log10(x));
  const base = 10 ** exponent;
  const f = x / base;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base;
}

export function chartScale(values: number[]): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6 && ticks.length < 12; v += step) ticks.push(Number(v.toPrecision(12)));
  return { min: lo, max: hi, ticks };
}

function chartFrame(snapshots: readonly ChartPanel[], orient: Orientation): ChartFrame {
  const last = snapshots.at(-1)!;
  const titled = titledOf(snapshots);
  const values = snapshots.flatMap((s) => s.series.flatMap((series) => series.values.filter((v): v is number => v !== null)));
  const scale = chartScale(values.length ? values : [0, 1]);
  const g = PANEL.chart[orient];
  const categories = last.categories;
  return {
    kind: "chart",
    orient,
    titled,
    chart: last.chart,
    data: last.data,
    categories,
    xLabel: last.xLabel,
    yLabel: last.yLabel,
    unit: last.unit,
    series: last.series.map((s) => s.name),
    ...scale,
    size: { width: g.axis + categories.length * g.slot, height: titleBand(titled) + g.plot + g.labels + g.legend },
  };
}

/** Compact number for axes and labels: 1200 → "1.2k". Plain text, never markup. */
export function formatValue(value: number): string {
  const abs = Math.abs(value);
  const fmt = (v: number, suffix: string) => `${Number(v.toPrecision(3))}${suffix}`;
  if (abs >= 1e9) return fmt(value / 1e9, "B");
  if (abs >= 1e6) return fmt(value / 1e6, "M");
  if (abs >= 1e4) return fmt(value / 1e3, "k");
  return String(Number(value.toPrecision(4)));
}

// ---------------------------------------------------------------------------
// Frames for a whole explanation
// ---------------------------------------------------------------------------

/**
 * Frames for every panel id in a list of steps. With `reserve`, simple
 * panels are sized by their largest snapshot (laid-out concepts); without,
 * each step's own snapshot decides (version-1 concepts, see `stepPanelSize`).
 */
export function framesFor(steps: readonly { panels?: readonly UnplacedPanel[] }[], arena: Arena, reserve: boolean): Map<string, Frame> {
  const snapshots = new Map<string, UnplacedPanel[]>();
  for (const step of steps) {
    for (const panel of step.panels ?? []) {
      const list = snapshots.get(panel.id) ?? [];
      // A kind change is an error the validator reports; keep the frame consistent.
      if (list.length === 0 || list[0]!.kind === panel.kind) list.push(panel);
      snapshots.set(panel.id, list);
    }
  }
  return new Map([...snapshots].map(([id, list]) => [id, buildFrame(list, arena, reserve)]));
}

/** The size a panel is drawn at in one step. */
export function stepPanelSize(panel: UnplacedPanel, frame: Frame, reserve: boolean): Size {
  return reserve || isFramed(panel) ? frame.size : simpleSize(panel);
}
