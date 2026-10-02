import { PALETTE } from "./palette";
import type { Concept, Step, VisualEdge, VisualNode } from "./schema";

/**
 * Plain-text descriptions of scenes and of the change between two scenes.
 * Used for the visible "What changed" list, the text alternative to the
 * visualization, and screen-reader announcements.
 */

export type SceneChange =
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "changed"; text: string }
  | { kind: "message"; text: string };

const nodeName = (node: VisualNode) => node.label.trim();

function edgeName(edge: VisualEdge, nodes: Map<string, VisualNode>): string {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const route = `${from ? nodeName(from) : edge.from} → ${to ? nodeName(to) : edge.to}`;
  return edge.label.trim() ? `${route} (“${edge.label.trim()}”)` : route;
}

/**
 * What changed from `prev` to `curr`, one entry per entity, most important
 * first: messages in flight, entities that appear, entities that change,
 * entities that leave, then connections.
 */
export function describeChanges(prev: Step | undefined, curr: Step): SceneChange[] {
  if (!prev) return [];
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const currNodes = new Map(curr.nodes.map((n) => [n.id, n]));
  const messages: SceneChange[] = [];
  const added: SceneChange[] = [];
  const changed: SceneChange[] = [];
  const removed: SceneChange[] = [];
  const connections: SceneChange[] = [];

  for (const node of curr.nodes) {
    const before = prevNodes.get(node.id);
    if (!before) {
      added.push({ kind: "added", text: `${nodeName(node)} appears` });
      continue;
    }
    const relabeled = before.label.trim() !== node.label.trim();
    const notes: string[] = [];
    if (before.status !== node.status) notes.push(`now ${node.status}`);
    if (before.color !== node.color && node.status === "active" && !relabeled) notes.push(`marked ${PALETTE[node.color].word}`);
    if (before.shape !== node.shape) notes.push(`now a ${node.shape}`);
    if (before.x !== node.x || before.y !== node.y) notes.push("moves");
    if (!relabeled && notes.length === 0) continue;
    const head = relabeled ? `${nodeName(before)} → ${nodeName(node)}` : nodeName(node);
    changed.push({ kind: "changed", text: notes.length ? `${head} (${notes.join(", ")})` : head });
  }
  for (const node of prev.nodes) {
    if (!currNodes.has(node.id)) removed.push({ kind: "removed", text: `${nodeName(node)} leaves` });
  }

  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
  const currEdgeIds = new Set(curr.edges.map((e) => e.id));
  for (const edge of curr.edges) {
    const before = prevEdges.get(edge.id);
    if (edge.animated && (!before || !before.animated)) {
      messages.push({ kind: "message", text: edgeName(edge, currNodes) });
    } else if (!before) {
      connections.push({ kind: "added", text: `New connection ${edgeName(edge, currNodes)}` });
    } else if (before.label.trim() !== edge.label.trim()) {
      connections.push({ kind: "changed", text: `Connection relabeled: ${edgeName(edge, currNodes)}` });
    }
  }
  for (const edge of prev.edges) {
    if (!currEdgeIds.has(edge.id)) {
      connections.push({ kind: "removed", text: `${edgeName(edge, prevNodes)} ends` });
    }
  }

  return [...messages, ...added, ...changed, ...removed, ...connections];
}

export function describeNode(node: VisualNode): string {
  return `${nodeName(node)}: ${node.shape}, ${node.status === "active" ? PALETTE[node.color].word : "inactive (dimmed)"}`;
}

export function describeEdge(edge: VisualEdge, step: Step): string {
  const nodes = new Map(step.nodes.map((n) => [n.id, n]));
  return `${edgeName(edge, nodes)}${edge.animated ? ", message in transit" : ""}`;
}

/** Stable 1-based number per entity, by first appearance across the concept. */
export function entityNumbers(concept: Concept): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const step of concept.steps) {
    for (const node of step.nodes) {
      if (!numbers.has(node.id)) numbers.set(node.id, numbers.size + 1);
    }
  }
  return numbers;
}
