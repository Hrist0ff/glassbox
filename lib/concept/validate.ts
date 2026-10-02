import type { z } from "zod";
import { ARENA, LIMITS, NODE } from "./constants";
import {
  boxesOverlap,
  distanceToSegment,
  insideArena,
  labelBox,
  nodeBox,
  panelBox,
} from "./geometry";
import { ConceptSchema, type Concept, type Panel, type Step, type VisualNode } from "./schema";

/**
 * Deterministic validation. Pure functions, no I/O.
 *
 * `error` issues block persistence and are sent back to the generator as
 * repair feedback. `warning` issues are heuristics (overlap estimates,
 * unchanged scenes); they are shared with the evaluator and the generator but
 * never block on their own. Passing validation does not prove the scene is
 * readable or technically accurate.
 */

export type IssueSeverity = "error" | "warning";

export type ValidationIssue = {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** JSON path into the concept, e.g. `steps.2.nodes.0.x`. */
  path?: string;
  stepId?: string;
};

export type ValidationResult =
  | { ok: true; concept: Concept; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Word-counting rule for step text: trim, then count maximal runs of
 * non-whitespace characters. Punctuation stays attached to its word,
 * hyphenated and dotted tokens ("up-to-date", "example.com") count once, and a
 * symbol surrounded by spaces ("→") counts as a word.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

export function validateConcept(input: unknown): ValidationResult {
  const bytes = utf8Bytes(input);
  if (bytes > LIMITS.payloadBytes) {
    return {
      ok: false,
      issues: [
        {
          code: "payload_too_large",
          severity: "error",
          message: `Concept is ${bytes} bytes; the limit is ${LIMITS.payloadBytes}. Use fewer steps, nodes, or shorter notes.`,
        },
      ],
    };
  }

  const parsed = ConceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: schemaIssues(parsed.error) };
  }

  const concept = parsed.data;
  const issues = [...checkSteps(concept.steps), ...checkContinuity(concept.steps)];
  return issues.some((issue) => issue.severity === "error")
    ? { ok: false, issues }
    : { ok: true, concept, issues };
}

function schemaIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 25).map((issue) => ({
    code: issue.code === "unrecognized_keys" ? "unknown_field" : `schema_${issue.code}`,
    severity: "error" as const,
    message: issue.message,
    path: issue.path.join("."),
  }));
}

function checkSteps(steps: Step[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenStepIds = new Set<string>();

  steps.forEach((step, s) => {
    const at = (suffix: string) => `steps.${s}${suffix ? `.${suffix}` : ""}`;
    const issue = (code: string, message: string, path: string, severity: IssueSeverity = "error") =>
      issues.push({ code, severity, message, path, stepId: step.id });

    if (seenStepIds.has(step.id)) {
      issue("duplicate_step_id", `Step id "${step.id}" is used more than once.`, at("id"));
    }
    seenStepIds.add(step.id);

    const words = countWords(step.text);
    if (words === 0) issue("blank_text", "Step text is blank.", at("text"));
    if (words > LIMITS.stepText.maxWords) {
      issue(
        "step_text_too_long",
        `Step text has ${words} words; the limit is ${LIMITS.stepText.maxWords}. Move detail into notes.`,
        at("text"),
      );
    }

    // Node and edge ids share one namespace within a step.
    const entityIds = new Set<string>();
    const nodesById = new Map<string, VisualNode>();
    step.nodes.forEach((node, n) => {
      const path = at(`nodes.${n}`);
      if (entityIds.has(node.id)) {
        issue("duplicate_entity_id", `Entity id "${node.id}" appears more than once in this step.`, `${path}.id`);
      }
      entityIds.add(node.id);
      nodesById.set(node.id, node);

      if (node.label.trim().length === 0) issue("blank_label", "Node label is blank.", `${path}.label`);
      if (!insideArena(nodeBox(node))) {
        issue(
          "node_out_of_bounds",
          `Node "${node.id}" at (${node.x}, ${node.y}) extends outside the ${ARENA.width}×${ARENA.height} arena margins.`,
          path,
        );
      } else if (!insideArena(labelBox(node))) {
        issue(
          "label_out_of_bounds",
          `The label of node "${node.id}" would be drawn outside the arena. Move the node inward or shorten the label.`,
          path,
        );
      }
    });

    for (let i = 0; i < step.nodes.length; i++) {
      for (let j = i + 1; j < step.nodes.length; j++) {
        const a = step.nodes[i]!;
        const b = step.nodes[j]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < NODE.minSeparation) {
          issue(
            "nodes_too_close",
            `Nodes "${a.id}" and "${b.id}" are ${Math.round(distance)} units apart; the minimum is ${NODE.minSeparation}.`,
            at(`nodes.${j}`),
          );
        } else if (
          boxesOverlap(labelBox(a), labelBox(b), 2) ||
          boxesOverlap(labelBox(a), nodeBox(b)) ||
          boxesOverlap(labelBox(b), nodeBox(a))
        ) {
          issue(
            "label_overlap",
            `The labels of "${a.id}" and "${b.id}" are estimated to overlap a label or node.`,
            at(`nodes.${j}`),
            "warning",
          );
        }
      }
    }

    const panels = step.panels ?? [];
    const panelsById = new Map<string, Panel>();
    const panelBoxes = panels.map((panel) => panelBox(panel));
    panels.forEach((panel, p) => {
      const path = at(`panels.${p}`);
      if (entityIds.has(panel.id)) {
        issue("duplicate_entity_id", `Entity id "${panel.id}" appears more than once in this step.`, `${path}.id`);
      }
      entityIds.add(panel.id);
      panelsById.set(panel.id, panel);

      const box = panelBoxes[p]!;
      const size = `about ${Math.round(box.x1 - box.x0)}×${Math.round(box.y1 - box.y0)} units`;
      if (!insideArena(box)) {
        issue(
          "panel_out_of_bounds",
          `Panel "${panel.id}" (${size}, centered at ${panel.x}, ${panel.y}) extends outside the ${ARENA.width}×${ARENA.height} arena. Move it inward or show less in it.`,
          path,
        );
      }
      for (const node of step.nodes) {
        if (boxesOverlap(box, nodeBox(node), 6) || boxesOverlap(box, labelBox(node), 2)) {
          issue("panel_overlaps_node", `Panel "${panel.id}" (${size}) covers node "${node.id}" or its label. Move one of them.`, path);
        }
      }
      for (let q = 0; q < p; q++) {
        if (boxesOverlap(box, panelBoxes[q]!, 6)) {
          issue("panels_overlap", `Panels "${panels[q]!.id}" and "${panel.id}" overlap. Move one of them.`, path);
        }
      }

      const cells = panel.kind === "log" ? panel.items : panel.kind === "table" ? panel.rows.flatMap((row) => row.cells) : [];
      for (const cell of cells) {
        if (cell.text.length > LIMITS.cellText.max) {
          issue(
            "cell_text_too_long",
            `"${cell.text}" in panel "${panel.id}" has ${cell.text.length} characters; log records and table cells allow ${LIMITS.cellText.max}.`,
            path,
          );
        }
      }
      if (panel.kind === "table") {
        panel.rows.forEach((row, r) => {
          if (row.cells.length !== panel.columns.length) {
            issue(
              "table_shape",
              `Row ${r + 1} of table "${panel.id}" has ${row.cells.length} cells but the table has ${panel.columns.length} columns.`,
              `${path}.rows.${r}`,
            );
          }
        });
      }
    });

    if (step.nodes.length === 0 && panels.length === 0) {
      issue("empty_scene", "The step shows nothing: add at least one node or panel.", at("nodes"));
    }

    for (const id of step.focus ?? []) {
      if (!nodesById.has(id) && !panelsById.has(id)) {
        issue("unknown_focus", `Focus names "${id}", which is not a node or panel in this step.`, at("focus"));
      }
    }

    const messages = step.edges.filter((edge) => edge.animated);
    const rounds = new Set(messages.map((edge) => edge.order ?? 1));
    for (let round = 2; round <= Math.max(1, ...rounds); round++) {
      if (!rounds.has(round - 1)) {
        issue("message_round_gap", `Messages are sent in round ${round} but none in round ${round - 1}.`, at("edges"), "warning");
      }
    }
    if (step.timing === "messages_first" && messages.length === 0) {
      issue("timing_without_messages", `Timing is "messages_first" but no message travels in this step.`, at("timing"), "warning");
    }

    const connections = new Set<string>();
    step.edges.forEach((edge, e) => {
      const path = at(`edges.${e}`);
      if (entityIds.has(edge.id)) {
        issue("duplicate_entity_id", `Entity id "${edge.id}" appears more than once in this step.`, `${path}.id`);
      }
      entityIds.add(edge.id);

      // Messages may also start or end at a panel, e.g. a record appended to a log.
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      if (!from && !panelsById.has(edge.from)) {
        issue("unknown_edge_endpoint", `Edge "${edge.id}" starts at "${edge.from}", which is not a node or panel in this step.`, `${path}.from`);
      }
      if (!to && !panelsById.has(edge.to)) {
        issue("unknown_edge_endpoint", `Edge "${edge.id}" ends at "${edge.to}", which is not a node or panel in this step.`, `${path}.to`);
      }
      if (!edge.animated && (edge.order ?? 1) > 1) {
        issue("order_without_message", `Edge "${edge.id}" has order ${edge.order} but is not a message (animated is false).`, path, "warning");
      }
      if (edge.from === edge.to) {
        issue("self_edge", `Edge "${edge.id}" connects "${edge.from}" to itself; self-edges are not supported.`, path);
      }
      const key = `${edge.from}->${edge.to}`;
      if (connections.has(key)) {
        issue("duplicate_connection", `More than one edge goes from "${edge.from}" to "${edge.to}".`, path);
      }
      connections.add(key);

      if (from && to && from !== to) {
        for (const other of step.nodes) {
          if (other.id === from.id || other.id === to.id) continue;
          if (distanceToSegment(other, from, to) < NODE.radius + 4) {
            issue(
              "edge_crosses_node",
              `Edge "${edge.id}" passes through node "${other.id}". Move "${other.id}" away from the line between "${edge.from}" and "${edge.to}", or move the endpoints.`,
              path,
            );
          }
        }
      }
    });
  });

  return issues;
}

/** Identity conventions between adjacent steps. */
function checkContinuity(steps: Step[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let s = 1; s < steps.length; s++) {
    const prev = steps[s - 1]!;
    const curr = steps[s]!;
    const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
    const currNodes = new Map(curr.nodes.map((n) => [n.id, n]));
    const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
    const prevPanels = new Map((prev.panels ?? []).map((p) => [p.id, p]));

    (curr.panels ?? []).forEach((panel, p) => {
      const before = prevPanels.get(panel.id);
      if (before && before.kind !== panel.kind) {
        issues.push({
          code: "panel_kind_changed",
          severity: "error",
          message: `Panel "${panel.id}" is a ${before.kind} in step "${prev.id}" but a ${panel.kind} here. Use a new id for a different panel.`,
          path: `steps.${s}.panels.${p}.kind`,
          stepId: curr.id,
        });
      }
    });

    curr.edges.forEach((edge, e) => {
      const before = prevEdges.get(edge.id);
      if (before && (before.from !== edge.from || before.to !== edge.to)) {
        issues.push({
          code: "edge_identity_changed",
          severity: "error",
          message: `Edge id "${edge.id}" connects ${before.from}→${before.to} in step "${prev.id}" but ${edge.from}→${edge.to} here. Use a new id for a different connection.`,
          path: `steps.${s}.edges.${e}`,
          stepId: curr.id,
        });
      }
    });

    curr.nodes.forEach((node, n) => {
      const before = prevNodes.get(node.id);
      if (before) {
        if (before.shape !== node.shape) {
          issues.push({
            code: "node_shape_changed",
            severity: "warning",
            message: `Node "${node.id}" changes shape from ${before.shape} to ${node.shape}.`,
            path: `steps.${s}.nodes.${n}.shape`,
            stepId: curr.id,
          });
        }
        return;
      }
      // A new id whose label matches a node that just disappeared is almost
      // always the same entity with a broken id; the player would animate it
      // as a removal plus an unrelated addition.
      const vanished = prev.nodes.find(
        (p) => !currNodes.has(p.id) && p.label.trim().toLowerCase() === node.label.trim().toLowerCase(),
      );
      if (vanished) {
        issues.push({
          code: "node_identity_changed",
          severity: "error",
          message: `Node "${node.id}" looks like "${vanished.id}" from the previous step (same label). Keep the original id for the same entity.`,
          path: `steps.${s}.nodes.${n}.id`,
          stepId: curr.id,
        });
      }
    });

    if (sceneSignature(prev) === sceneSignature(curr)) {
      issues.push({
        code: "unchanged_scene",
        severity: "warning",
        message: `Step "${curr.id}" shows exactly the same scene as the previous step.`,
        path: `steps.${s}`,
        stepId: curr.id,
      });
    }
  }

  return issues;
}

function sceneSignature(step: Step): string {
  const nodes = [...step.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => [n.id, n.label, n.x, n.y, n.shape, n.color, n.status].join("|"));
  const edges = [...step.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => [e.id, e.from, e.to, e.label, e.animated, e.order ?? 1].join("|"));
  return `${nodes.join(";")}#${edges.join(";")}#${JSON.stringify([step.panels ?? [], step.focus ?? null, step.timing ?? null])}`;
}

/** Validate a stored or bundled concept before rendering. */
export function parseStoredConcept(
  content: unknown,
  expectedId: string,
): { ok: true; concept: Concept } | { ok: false; reason: string } {
  const result = validateConcept(content);
  if (!result.ok) {
    const first = result.issues[0];
    return { ok: false, reason: first ? `${first.code}: ${first.message}` : "invalid content" };
  }
  if (result.concept.id !== expectedId) {
    return { ok: false, reason: "content id does not match record id" };
  }
  return { ok: true, concept: result.concept };
}

export function formatIssuesForPrompt(issues: ValidationIssue[], limit = 20): string {
  return issues
    .slice(0, limit)
    .map((i) => `- [${i.severity}] ${i.code}${i.path ? ` at ${i.path}` : ""}: ${i.message}`)
    .join("\n");
}
