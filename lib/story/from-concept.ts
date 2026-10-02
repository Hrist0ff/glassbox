import { ARENAS, type Arena } from "@/lib/concept/constants";
import { eventKey, framesFor, isFramed, type Frame } from "@/lib/concept/frames";
import { wrapLabel } from "@/lib/concept/geometry";
import { relayout } from "@/lib/concept/layout";
import type { ColorToken, Concept, Step as ConceptStep, Panel, PanelItem, VisualEdge, VisualNode } from "@/lib/concept/schema";
import { add, append, dot, link, packet, remove, retext, send, set, truncate, zoom } from "./dsl";
import type { Beat, Cell, Entity, EntityPatch, Ink, LinkEntity, NodeEntity, PanelEntity, Step, Story, Tone } from "./types";

/**
 * Turns a validated Concept (one full snapshot per step) into a narrated
 * Story, so every explanation, curated or generated, plays in the story
 * player in the style of "The Secret Lives of Data".
 *
 * Each concept step becomes a beat whose script moves the scene from the
 * previous snapshot to this one: nodes fade out, change, or appear, panels
 * update their cells or append new ones (keyed panels fade new items in),
 * static edges become lines, and animated edges become messages that travel
 * once, in rounds. A step's focus zooms the camera, and its timing decides
 * whether the scene changes before or after the messages arrive.
 * The step sentence is the caption; notes follow as smaller captions.
 * Everything visual maps through tokens; no text from the concept is used as
 * anything but text.
 */

/** Node radius in size units: a little under the hand-written stories' 5, since generated scenes are denser. */
const NODE_RADIUS = 4;
const MESSAGE_MS = 1200;
/** Pause between a caption appearing and the scene changing, so the sentence is read first. */
const LEAD_IN_MS = 600;
/** Notes longer than this are split into several captions at sentence boundaries. */
const NOTE_CAPTION_CHARS = 200;

const INK_FOR: Record<ColorToken, Ink> = {
  neutral: "steelblue",
  primary: "steelblue",
  secondary: "purple",
  success: "green",
  warning: "orange",
  danger: "red",
};

/** Item colors as text tones; inactive items are muted. */
const TONE_FOR: Record<ColorToken, Tone> = {
  neutral: "normal",
  primary: "focus",
  secondary: "alt",
  success: "good",
  warning: "warn",
  danger: "bad",
};

const toneOf = (item: { color: ColorToken; status: "active" | "inactive" }): Tone =>
  item.status === "inactive" ? "muted" : TONE_FOR[item.color];

/** Concept node, edge, and panel ids may collide with each other; story ids may not. */
const nodeId = (id: string) => `n-${id}`;
const edgeId = (id: string) => `e-${id}`;
const panelId = (id: string) => `p-${id}`;

const toCell = (item: PanelItem): Cell => ({
  text: item.text,
  tone: toneOf(item),
  ...(item.tag ? { tag: item.tag } : {}),
});

/** What the converter needs to know about the whole explanation. */
type Context = {
  arena: Arena;
  frames: Map<string, Frame>;
  /** Laid-out concepts reserve each panel's largest size. */
  reserve: boolean;
  /** Where chart numbers come from, for the note under observed charts. */
  sourcesConsulted: boolean;
};

const formatNumber = (value: number) => String(Number(value.toPrecision(6)));

function chartNote(data: "observed" | "illustrative", sourcesConsulted: boolean): string {
  if (data === "illustrative") return "Illustrative numbers, made up for this example";
  return sourcesConsulted ? "Figures from the supplied material" : "Figures from the AI model's general knowledge, not checked against a source";
}

function toPanel(panel: Panel, ctx: Context): PanelEntity {
  const frame = ctx.frames.get(panel.id);
  const base = {
    kind: "panel" as const,
    id: panelId(panel.id),
    x: (panel.x / ctx.arena.width) * 100,
    y: (panel.y / ctx.arena.height) * 100,
    title: panel.label,
    scale: { x: ctx.arena.width / 100, y: ctx.arena.height / 100 },
    ...(frame && ctx.reserve && !isFramed(panel) ? { box: frame.size } : {}),
  };
  switch (panel.kind) {
    case "log":
      return { ...base, variant: "log", cells: panel.items.map(toCell) };
    case "code":
      return { ...base, variant: "code", cells: panel.lines.map((line) => (line.highlight ? { text: line.text, mark: true } : { text: line.text })) };
    case "table":
      return {
        ...base,
        variant: "table",
        columns: panel.columns,
        rows: panel.rows.map((row) => row.label),
        cells: panel.rows.flatMap((row) => row.cells.map(toCell)),
      };
    case "timeline":
      if (panel.spacing === undefined || frame?.kind !== "timeline") {
        return { ...base, variant: "timeline", cells: panel.items.map(toCell) };
      }
      return {
        ...base,
        variant: "timeline",
        frame,
        cells: panel.items.map((item, i) => ({
          ...toCell(item),
          key: eventKey(item, i),
          meta: { panel: "timeline", lane: item.lane ?? 0, date: item.date ?? "exact", end: typeof item.end === "number" },
        })),
        links: (panel.relations ?? []).map((r) => ({ ...r })),
      };
    case "comparison":
      return {
        ...base,
        variant: "comparison",
        ...(frame ? { frame } : {}),
        cells: panel.criteria.flatMap((criterion) =>
          criterion.cells.map((cell, c) => ({
            text: cell.text,
            tone: toneOf(cell),
            ...(cell.color === "primary" && cell.status === "active" ? { mark: true } : {}),
            key: `${criterion.id}:${c}`,
            meta: { panel: "comparison" as const, criterion: criterion.id, alternative: c, missing: cell.missing },
          })),
        ),
      };
    case "hierarchy":
      return {
        ...base,
        variant: "hierarchy",
        ...(frame ? { frame } : {}),
        cells: panel.items.map((item) => ({
          text: item.text,
          tone: toneOf(item),
          ...(item.color === "primary" && item.status === "active" ? { mark: true } : {}),
          key: item.id,
          meta: { panel: "hierarchy" as const, parent: item.parent },
        })),
        links: panel.links.map((l) => ({ ...l })),
      };
    case "chart":
      return {
        ...base,
        variant: "chart",
        ...(frame ? { frame } : {}),
        note: chartNote(panel.data, ctx.sourcesConsulted),
        cells: panel.series.flatMap((series, s) =>
          series.values.slice(0, panel.revealed).map((value, c) => ({
            text: value === null ? "no data" : formatNumber(value),
            tone: TONE_FOR[series.color],
            ...(panel.highlight === c ? { mark: true } : {}),
            key: `${s}:${c}`,
            meta: { panel: "chart" as const, series: s, category: c, value },
          })),
        ),
      };
  }
}

function toNode(node: VisualNode, arena: Arena): NodeEntity {
  const active = node.status === "active";
  return {
    kind: "node",
    id: nodeId(node.id),
    x: (node.x / arena.width) * 100,
    y: (node.y / arena.height) * 100,
    r: NODE_RADIUS,
    // Inactive nodes are gray, like the original's stopped servers; the label says why.
    fill: active ? INK_FOR[node.color] : "gray",
    // The original draws its leader with a solid outline: here, the node the step is about.
    ring: active && node.color === "primary" ? "solid" : "none",
    shape: node.shape,
    desc: wrapLabel(node.label),
    descAt: "below",
  };
}

function toLink(edge: VisualEdge, ids: (id: string) => string): LinkEntity {
  const line = link(edgeId(edge.id), ids(edge.from), ids(edge.to));
  return edge.label ? { ...line, label: edge.label } : line;
}

/** Fields of `next` that differ from `prev`, as a `set` patch. */
function changes(prev: Entity, next: Entity): EntityPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "kind" || key === "id") continue;
    if (JSON.stringify((prev as Record<string, unknown>)[key]) !== JSON.stringify(value)) patch[key] = value;
  }
  return patch as EntityPatch;
}

/** Turns actions at absolute times into the story's relative `after` delays. */
function sequence(timed: { at: number; step: Step }[]): Step[] {
  let last = 0;
  return [...timed]
    .sort((a, b) => a.at - b.at)
    .map(({ at, step }) => {
      const after = at - last;
      last = at;
      return { ...step, after };
    });
}

type Timed = { at: number; step: Step };

const STAGGER_MS = 150;
const ROUND_STAGGER_MS = 250;
const TWEEN_MS = 500;

/** Story ids for a step's nodes and panels; edges and focus may name either. */
function storyIds(step: ConceptStep) {
  const panels = new Set((step.panels ?? []).map((panel) => panel.id));
  return (id: string) => (panels.has(id) ? panelId(id) : nodeId(id));
}

/** Everything that changes in the scene itself, grouped so the step's timing can order it. */
function sceneChanges(prev: ConceptStep | null, next: ConceptStep, ctx: Context) {
  const removals: Step[] = [];
  const updates: Step[] = [];
  const additions: Step[] = [];
  const appends: Step[] = [];
  const links: Step[] = [];

  const prevIds = prev ? storyIds(prev) : nodeId;
  const nextIds = storyIds(next);
  const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.id, toNode(n, ctx.arena)]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, toNode(n, ctx.arena)]));
  const prevPanels = new Map((prev?.panels ?? []).map((p) => [p.id, toPanel(p, ctx)]));
  const nextPanels = new Map((next.panels ?? []).map((p) => [p.id, toPanel(p, ctx)]));
  const prevLinks = new Map((prev?.edges ?? []).filter((e) => !e.animated).map((e) => [e.id, toLink(e, prevIds)]));
  const nextLinks = new Map(next.edges.filter((e) => !e.animated).map((e) => [e.id, toLink(e, nextIds)]));

  for (const id of prevLinks.keys()) if (!nextLinks.has(id)) removals.push(remove(edgeId(id)));
  for (const id of prevNodes.keys()) if (!nextNodes.has(id)) removals.push(remove(nodeId(id)));
  for (const id of prevPanels.keys()) if (!nextPanels.has(id)) removals.push(remove(panelId(id)));

  // Nodes that stay change in place: positions glide, colors fade.
  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id);
    if (!before) additions.push(add(node));
    else {
      const patch = changes(before, node);
      if (Object.keys(patch).length > 0) updates.push(set(node.id, patch));
    }
  }

  for (const [id, panel] of nextPanels) {
    const before = prevPanels.get(id);
    if (!before) {
      additions.push(add(panel));
      continue;
    }
    const { cells: beforeCells, ...beforeFrame } = before;
    const { cells, ...frame } = panel;
    const patch = changes(beforeFrame as Entity, frame as Entity);
    if (Object.keys(patch).length > 0) updates.push(set(panel.id, patch));
    // Keyed panels swap their cells; kept items stay, new ones fade in.
    if (cells.some((cell) => cell.key !== undefined) || beforeCells.some((cell) => cell.key !== undefined)) {
      if (JSON.stringify(cells) !== JSON.stringify(beforeCells)) appends.push({ do: "cells", of: panel.id, cells });
      continue;
    }
    // Other panels keep their records: changed ones update in place, new ones are appended.
    if (beforeCells.length > cells.length) removals.push(truncate(panel.id, cells.length));
    const kept = Math.min(beforeCells.length, cells.length);
    for (let i = 0; i < kept; i++) {
      const cell = { tone: "normal" as const, tag: "", mark: false, ...cells[i]! };
      const old = { tone: "normal" as const, tag: "", mark: false, ...beforeCells[i]! };
      if (JSON.stringify(cell) !== JSON.stringify(old)) updates.push(retext(panel.id, i, cell));
    }
    for (const cell of cells.slice(kept)) appends.push(append(panel.id, cell));
  }

  for (const [id, line] of nextLinks) {
    const before = prevLinks.get(id);
    const patch = before ? changes(before, line) : null;
    if (!patch) links.push(add(line));
    else if (Object.keys(patch).length > 0) links.push(set(line.id, patch));
  }

  return { removals, updates, additions, appends, links };
}

/** Messages in rounds: each round starts when the previous one has arrived. */
function messageScript(next: ConceptStep, start: number): { timed: Timed[]; end: number } {
  const ids = storyIds(next);
  const rounds = new Map<number, VisualEdge[]>();
  for (const edge of next.edges) {
    if (!edge.animated) continue;
    const round = edge.order ?? 1;
    rounds.set(round, [...(rounds.get(round) ?? []), edge]);
  }
  const timed: Timed[] = [];
  let at = start;
  let end = start;
  for (const round of [...rounds.keys()].sort((a, b) => a - b)) {
    rounds.get(round)!.forEach((edge, i) => {
      const from = next.nodes.find((n) => n.id === edge.from);
      const ink: Ink = from ? (from.status === "active" ? INK_FOR[from.color] : "gray") : "black";
      const look = edge.label ? packet(edge.label) : dot(ink);
      const sentAt = at + i * ROUND_STAGGER_MS;
      timed.push({ at: sentAt, step: send(ids(edge.from), ids(edge.to), look, { duration: MESSAGE_MS }) });
      end = Math.max(end, sentAt + MESSAGE_MS);
    });
    at = end + STAGGER_MS;
  }
  return { timed, end };
}

/** Lays steps out one after another from `at`; returns when the last one has settled. */
function staggered(steps: Step[], at: number, timed: Timed[]): number {
  steps.forEach((step, i) => timed.push({ at: at + i * STAGGER_MS, step }));
  return steps.length ? at + (steps.length - 1) * STAGGER_MS + TWEEN_MS : at;
}

/**
 * Script that turns the scene of `prev` (or an empty stage) into the scene of `next`.
 *
 * `changes_first` (default): the scene changes, then messages travel.
 * `messages_first`: new things appear, every round of messages travels, and
 * only then do receivers change, so a record lands in a log as its message
 * arrives. Nothing changes between rounds.
 */
function transition(prev: ConceptStep | null, next: ConceptStep, ctx: Context): Step[] {
  const timed: Timed[] = [];
  const scene = sceneChanges(prev, next, ctx);
  const ids = storyIds(next);

  const hasMessages = next.edges.some((edge) => edge.animated);
  if (next.timing === "messages_first" && hasMessages) {
    const addsEnd = staggered(scene.additions, 0, timed);
    const linkAt = scene.additions.length ? (scene.additions.length - 1) * STAGGER_MS + 200 : 0;
    const ready = Math.max(addsEnd, staggered(scene.links, linkAt, timed));
    const messages = messageScript(next, ready + 100);
    timed.push(...messages.timed);
    const after = messages.end + 100;
    for (const step of [...scene.removals, ...scene.updates]) timed.push({ at: after, step });
    staggered(scene.appends, after + 100, timed);
  } else {
    for (const step of scene.removals) timed.push({ at: 0, step });
    let settled = 0;
    for (const step of scene.updates) timed.push({ at: 100, step });
    if (scene.updates.length) settled = 100 + TWEEN_MS;
    const addedAt = prev ? 300 : 0;
    settled = Math.max(settled, staggered(scene.additions, addedAt, timed));
    const appendAt = addedAt + scene.additions.length * STAGGER_MS;
    settled = Math.max(settled, staggered(scene.appends, appendAt, timed));
    const linkAt = appendAt + scene.appends.length * STAGGER_MS + 200;
    settled = Math.max(settled, staggered(scene.links, linkAt, timed));
    timed.push(...messageScript(next, settled + 100).timed);
  }

  // The camera moves first, so the reader sees where the step happens, but
  // only once what it zooms onto exists.
  const focus = focusOf(next, ctx)?.map(ids) ?? null;
  const prevFocus = prev ? (focusOf(prev, ctx)?.map(storyIds(prev)) ?? null) : null;
  if (JSON.stringify(focus) !== JSON.stringify(prevFocus)) {
    const appears = timed.filter(({ step }) => step.do === "add" && focus?.includes(step.entity.id)).map(({ at }) => at + 50);
    timed.push({ at: Math.max(0, ...appears), step: zoom(focus) });
  }

  return sequence(timed.map(({ at, step }) => ({ at: at + LEAD_IN_MS, step })));
}

/**
 * Where the camera looks. In laid-out explanations, a step with panels and no
 * nodes (a comparison, a chart, a timeline on its own) zooms onto its panels,
 * so they fill the stage instead of sitting small in the middle.
 */
function focusOf(step: ConceptStep, ctx: Context): string[] | null {
  if (step.focus) return step.focus;
  if (ctx.reserve && step.nodes.length === 0 && (step.panels ?? []).length > 0) return step.panels!.map((p) => p.id);
  return null;
}

/** Notes as captions: whole when short, otherwise in groups of sentences. */
function noteCaptions(notes: string): string[] {
  const text = notes.trim().replace(/\s+/g, " ");
  if (text.length <= NOTE_CAPTION_CHARS) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)\s*/g) ?? [text];
  const captions: string[] = [];
  let current = "";
  for (const sentence of sentences.map((s) => s.trim()).filter(Boolean)) {
    if (current && current.length + 1 + sentence.length > NOTE_CAPTION_CHARS) {
      captions.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) captions.push(current);
  return captions;
}

export type ConceptStoryOptions = {
  /** Under the title, e.g. "AI-generated explanation". */
  subtitle: string;
  /** Optional last caption, e.g. how the explanation was made. */
  closing?: string;
  /** Arena the steps are laid out on. Default: the landscape arena the concept is stored in. */
  arena?: Arena;
  /** Steps laid out on `arena` (see `relayout`); default: the concept's own steps. */
  steps?: ConceptStep[];
};

function contextFor(concept: Concept, steps: ConceptStep[], arena: Arena): Context {
  const reserve = concept.layout !== undefined;
  return { arena, frames: framesFor(steps, arena, reserve), reserve, sourcesConsulted: concept.provenance?.sourcesConsulted ?? false };
}

export function conceptToStory(concept: Concept, options: ConceptStoryOptions): Story {
  const arena = options.arena ?? ARENAS.landscape;
  const steps = options.steps ?? concept.steps;
  const ctx = contextFor(concept, steps, arena);
  // Concept text is plain: `plain` keeps a stray `*` or `[x|y]` in generated text literal.
  const beats: Beat[] = [{ say: concept.description, plain: true, size: "md" }];
  steps.forEach((step, i) => {
    beats.push({ say: step.text, plain: true, run: transition(steps[i - 1] ?? null, step, ctx), step: step.id });
    if (step.notes) for (const caption of noteCaptions(step.notes)) beats.push({ say: caption, plain: true, size: "md", step: step.id });
  });
  if (options.closing) beats.push({ say: options.closing, plain: true, size: "md" });

  return {
    slug: concept.id,
    title: concept.title,
    subtitle: options.subtitle,
    summary: concept.description,
    chapters: [
      { id: "home", title: "Home", beats: [{ title: { heading: concept.title, sub: options.subtitle } }] },
      { id: "explanation", title: "Explanation", beats },
    ],
  };
}

/**
 * The stored landscape story, and a portrait one when the explanation can be
 * laid out again for tall screens. Both have the same beats, so the player
 * can switch between them without losing its place.
 */
export function conceptStories(concept: Concept, options: Omit<ConceptStoryOptions, "arena" | "steps">): { landscape: Story; portrait: Story | null } {
  const portraitSteps = relayout(concept, ARENAS.portrait);
  return {
    landscape: conceptToStory(concept, options),
    portrait: portraitSteps ? conceptToStory(concept, { ...options, arena: ARENAS.portrait, steps: portraitSteps }) : null,
  };
}

/** A one-beat story showing a single concept step, for thumbnails. */
export function stepToStory(step: ConceptStep, concept?: Pick<Concept, "layout" | "provenance"> & { steps: ConceptStep[] }): Story {
  const steps = concept?.steps ?? [step];
  const ctx: Context = {
    arena: ARENAS.landscape,
    frames: framesFor(steps, ARENAS.landscape, concept?.layout !== undefined),
    reserve: concept?.layout !== undefined,
    sourcesConsulted: concept?.provenance?.sourcesConsulted ?? false,
  };
  return {
    slug: "step",
    title: "",
    subtitle: "",
    summary: "",
    chapters: [{ id: "step", title: "", beats: [{ say: " ", run: transition(null, step, ctx) }] }],
  };
}
