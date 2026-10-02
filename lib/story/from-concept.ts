import { ARENA } from "@/lib/concept/constants";
import { wrapLabel } from "@/lib/concept/geometry";
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
 * (logs, code, tables, timelines) update their cells or append new ones,
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

/** Concept node, edge, and panel ids may collide with each other; story ids may not. */
const nodeId = (id: string) => `n-${id}`;
const edgeId = (id: string) => `e-${id}`;
const panelId = (id: string) => `p-${id}`;

const toCell = (item: PanelItem): Cell => ({
  text: item.text,
  tone: item.status === "inactive" ? "muted" : TONE_FOR[item.color],
  ...(item.tag ? { tag: item.tag } : {}),
});

function toPanel(panel: Panel): PanelEntity {
  const base = {
    kind: "panel" as const,
    id: panelId(panel.id),
    x: (panel.x / ARENA.width) * 100,
    y: (panel.y / ARENA.height) * 100,
    title: panel.label,
  };
  switch (panel.kind) {
    case "log":
    case "timeline":
      return { ...base, variant: panel.kind, cells: panel.items.map(toCell) };
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
  }
}

function toNode(node: VisualNode): NodeEntity {
  const active = node.status === "active";
  return {
    kind: "node",
    id: nodeId(node.id),
    x: (node.x / ARENA.width) * 100,
    y: (node.y / ARENA.height) * 100,
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
function sceneChanges(prev: ConceptStep | null, next: ConceptStep) {
  const removals: Step[] = [];
  const updates: Step[] = [];
  const additions: Step[] = [];
  const appends: Step[] = [];
  const links: Step[] = [];

  const prevIds = prev ? storyIds(prev) : nodeId;
  const nextIds = storyIds(next);
  const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.id, toNode(n)]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, toNode(n)]));
  const prevPanels = new Map((prev?.panels ?? []).map((p) => [p.id, toPanel(p)]));
  const nextPanels = new Map((next.panels ?? []).map((p) => [p.id, toPanel(p)]));
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

  // Panels that stay keep their records: changed ones update in place, new ones are appended.
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
 * `messages_first`: new things appear, messages travel, and only then do
 * receivers change, so a record lands in a log as its message arrives.
 */
function transition(prev: ConceptStep | null, next: ConceptStep): Step[] {
  const timed: Timed[] = [];
  const scene = sceneChanges(prev, next);
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
  const focus = next.focus?.map(ids) ?? null;
  const prevFocus = prev?.focus?.map(storyIds(prev)) ?? null;
  if (JSON.stringify(focus) !== JSON.stringify(prevFocus)) {
    const appears = timed.filter(({ step }) => step.do === "add" && focus?.includes(step.entity.id)).map(({ at }) => at + 50);
    timed.push({ at: Math.max(0, ...appears), step: zoom(focus) });
  }

  return sequence(timed.map(({ at, step }) => ({ at: at + LEAD_IN_MS, step })));
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
};

export function conceptToStory(concept: Concept, options: ConceptStoryOptions): Story {
  // Concept text is plain: `plain` keeps a stray `*` or `[x|y]` in generated text literal.
  const beats: Beat[] = [{ say: concept.description, plain: true, size: "md" }];
  concept.steps.forEach((step, i) => {
    beats.push({ say: step.text, plain: true, run: transition(concept.steps[i - 1] ?? null, step) });
    if (step.notes) for (const caption of noteCaptions(step.notes)) beats.push({ say: caption, plain: true, size: "md" });
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

/** A one-beat story showing a single concept step, for thumbnails. */
export function stepToStory(step: ConceptStep): Story {
  return {
    slug: "step",
    title: "",
    subtitle: "",
    summary: "",
    chapters: [{ id: "step", title: "", beats: [{ say: " ", run: transition(null, step) }] }],
  };
}
