import type { z } from "zod";
import { quoteInPassage } from "@/lib/sources/passages";
import { ARENA, LIMITS, NODE, type Arena } from "./constants";
import { eventKey, framesFor, isFramed, stepPanelSize, timelinePoint, type Frame } from "./frames";
import { boxesOverlap, centeredBox, distanceToSegment, insideArena, labelBox as measureLabel, nodeBox } from "./geometry";
import {
  ConceptSchema,
  migrateConcept,
  type ChartPanel,
  type ComparisonPanel,
  type Concept,
  type HierarchyPanel,
  type Panel,
  type Provenance,
  type Step,
  type TimelinePanel,
  type VisualNode,
} from "./schema";

/**
 * Deterministic validation. Pure functions, no I/O.
 *
 * `error` issues block persistence and are sent back to the generator as
 * repair feedback. `warning` issues are heuristics (overlap estimates,
 * unchanged scenes); they are shared with the evaluator and the generator but
 * never block on their own. Passing validation does not prove the scene is
 * readable or accurate.
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

/** Validate a concept of any supported version; older versions are migrated first. */
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

  const parsed = ConceptSchema.safeParse(migrateConcept(input));
  if (!parsed.success) {
    return { ok: false, issues: schemaIssues(parsed.error) };
  }

  const concept = parsed.data;
  const issues = [
    ...checkSteps(concept.steps, { arena: ARENA, reserve: concept.layout !== undefined }),
    ...checkContinuity(concept.steps),
    ...checkProvenance(concept),
  ];
  return issues.some((issue) => issue.severity === "error")
    ? { ok: false, issues }
    : { ok: true, concept, issues };
}

/**
 * Geometry-only check of steps laid out on another arena (the portrait
 * relayout). Returns the errors; an empty list means the layout can be shown.
 */
export function geometryErrors(steps: Step[], arena: Arena): ValidationIssue[] {
  return checkSteps(steps, { arena, reserve: true }).filter(
    (issue) => issue.severity === "error" && GEOMETRY_CODES.has(issue.code),
  );
}

const GEOMETRY_CODES = new Set([
  "node_out_of_bounds",
  "label_out_of_bounds",
  "nodes_too_close",
  "panel_out_of_bounds",
  "panel_overlaps_node",
  "panels_overlap",
  "edge_crosses_node",
]);

function schemaIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 25).map((issue) => ({
    code: issue.code === "unrecognized_keys" ? "unknown_field" : `schema_${issue.code}`,
    severity: "error" as const,
    message: issue.message,
    path: issue.path.join("."),
  }));
}

type Report = (code: string, message: string, path: string, severity?: IssueSeverity) => void;

function checkSteps(steps: Step[], options: { arena: Arena; reserve: boolean }): ValidationIssue[] {
  const { arena } = options;
  // Laid-out concepts measure wide characters; version-1 concepts keep the estimate they were saved with.
  const labelBox = (node: Pick<VisualNode, "x" | "y" | "label">) => measureLabel(node, options.reserve);
  const issues: ValidationIssue[] = [];
  const seenStepIds = new Set<string>();
  const frames = framesFor(steps, arena, options.reserve);

  steps.forEach((step, s) => {
    const at = (suffix: string) => `steps.${s}${suffix ? `.${suffix}` : ""}`;
    const issue: Report = (code, message, path, severity = "error") =>
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
      if (!insideArena(nodeBox(node), ARENA.safeMargin, arena)) {
        issue(
          "node_out_of_bounds",
          `Node "${node.id}" at (${node.x}, ${node.y}) extends outside the ${arena.width}×${arena.height} arena margins.`,
          path,
        );
      } else if (!insideArena(labelBox(node), ARENA.safeMargin, arena)) {
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
            `Nodes "${a.id}" and "${b.id}" are ${Math.round(distance)} units apart; the minimum is ${NODE.minSeparation}.` +
              (a.col !== undefined && a.col === b.col && a.row === b.row ? ` Both are placed in column ${a.col}, row ${a.row}; give each its own cell.` : ""),
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
    const panelBoxes = panels.map((panel) => centeredBox(panel, stepPanelSize(panel, frames.get(panel.id)!, options.reserve)));
    panels.forEach((panel, p) => {
      const path = at(`panels.${p}`);
      if (entityIds.has(panel.id)) {
        issue("duplicate_entity_id", `Entity id "${panel.id}" appears more than once in this step.`, `${path}.id`);
      }
      entityIds.add(panel.id);
      panelsById.set(panel.id, panel);

      const box = panelBoxes[p]!;
      const size = `about ${Math.round(box.x1 - box.x0)}×${Math.round(box.y1 - box.y0)} units`;
      if (!insideArena(box, ARENA.safeMargin, arena)) {
        issue(
          "panel_out_of_bounds",
          `Panel "${panel.id}" (${size}) does not fit in the ${arena.width}×${arena.height} arena. Show less in it, or use fewer panels or nodes.`,
          path,
        );
      }
      for (const node of step.nodes) {
        if (boxesOverlap(box, nodeBox(node), 6) || boxesOverlap(box, labelBox(node), 2)) {
          issue("panel_overlaps_node", `Panel "${panel.id}" (${size}) covers node "${node.id}" or its label. Use fewer rows of nodes, or a smaller panel.`, path);
        }
      }
      for (let q = 0; q < p; q++) {
        if (boxesOverlap(box, panelBoxes[q]!, 6)) {
          issue("panels_overlap", `Panels "${panels[q]!.id}" and "${panel.id}" overlap. Use fewer or smaller panels.`, path);
        }
      }
      checkPanelContent(panel, path, issue, frames.get(panel.id));
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
              `Edge "${edge.id}" passes through node "${other.id}". Put "${other.id}" in a different row or column from the line between "${edge.from}" and "${edge.to}".`,
              path,
            );
          }
        }
      }
    });
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Panel content
// ---------------------------------------------------------------------------

function checkPanelContent(panel: Panel, path: string, issue: Report, frame: Frame | undefined): void {
  const where = `panel "${panel.id}"`;
  switch (panel.kind) {
    case "log":
    case "table": {
      const cells = panel.kind === "log" ? panel.items : panel.rows.flatMap((row) => row.cells);
      for (const cell of cells) {
        if (cell.text.length > LIMITS.cellText.max) {
          issue(
            "cell_text_too_long",
            `"${cell.text}" in ${where} has ${cell.text.length} characters; log records and table cells allow ${LIMITS.cellText.max}.`,
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
      return;
    }
    case "code":
      return;
    case "timeline":
      return checkTimeline(panel, path, issue, frame);
    case "comparison":
      return checkComparison(panel, path, issue, frame);
    case "hierarchy":
      return checkHierarchy(panel, path, issue);
    case "chart":
      return checkChart(panel, path, issue, frame);
  }
}

/**
 * Short text that ends mid-word ("transport-", "no delivery/") was cut to fit
 * and reads as broken. A single token ending in "/" ("src/") is a path, not a cut.
 */
function cutOff(text: string): boolean {
  const t = text.trim();
  if (/[\p{L}\p{N}]-$/u.test(t)) return true;
  return /[\p{L}\p{N}]\/$/u.test(t) && /\s/.test(t);
}

function checkCutOff(texts: string[], where: string, path: string, issue: Report): void {
  for (const text of texts) {
    if (cutOff(text)) issue("text_cut_off", `"${text}" in ${where} looks cut off. Use fewer, whole words.`, path);
  }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

/** A clock time, a year set off by punctuation, or a month and day at the start of event text. */
const DATE_IN_TEXT =
  /^\s*(\d{1,2}:\d{2}\b|\d{4}\s*([:,–-]|$)|(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d{1,2}\b)/i;

function checkTimeline(panel: TimelinePanel, path: string, issue: Report, frame: Frame | undefined): void {
  if (panel.spacing === undefined) return; // version 1: an ordered list of tagged events
  const where = `timeline "${panel.id}"`;
  checkCutOff(panel.items.map((item) => item.text), where, path, issue);
  const lanes = panel.lanes ?? [];
  const ids = panel.items.map((item) => item.id).filter((id): id is string => id !== undefined);
  for (const id of duplicates(ids)) issue("duplicate_event_id", `Event id "${id}" is used twice in ${where}.`, path);
  for (const name of duplicates(lanes)) issue("duplicate_lane", `Lane "${name}" appears twice in ${where}.`, path);

  let previous: number | null = null;
  panel.items.forEach((item, i) => {
    const at = `${path}.items.${i}`;
    if ((item.lane ?? 0) > Math.max(0, lanes.length - 1)) {
      issue("unknown_lane", `Event "${item.text}" is in lane ${item.lane}, but ${where} has ${lanes.length || "no"} lanes.`, at);
    }
    const dated = item.date !== "unknown" && item.date !== "none";
    if (dated && item.tag.trim().length === 0) {
      issue("missing_date", `Event "${item.text}" has no date tag. Give its date, or mark the date unknown (or none, for a stage with no date).`, at);
    }
    if (!dated && DATE_IN_TEXT.test(item.text)) {
      issue(
        "date_in_text",
        `Event "${item.text}" starts with a date or time, but its date is marked ${item.date}. Put the date or time in "tag" (and "at"), set date "exact", and keep only the event in "text".`,
        at,
      );
    }

    if (typeof item.at === "number" && typeof item.end === "number" && item.end < item.at) {
      issue("timeline_end_before_start", `Event "${item.text}" ends before it starts.`, at);
    }
    if (typeof item.at === "number") {
      if (previous !== null && item.at < previous) {
        issue(
          "timeline_order",
          `Event "${item.text}" (at ${item.at}) comes after an event at ${previous}. List events in chronological order.`,
          at,
        );
      }
      previous = item.at;
    }
  });

  if (panel.spacing === "proportional") {
    const unplaced = panel.items.filter((item) => typeof item.at !== "number" || item.date === "unknown" || item.date === "none");
    const distinct = new Set(panel.items.map((item) => item.at)).size;
    if (unplaced.length > 0 || (panel.items.length > 1 && distinct < 2)) {
      issue(
        "timeline_spacing",
        `${where} is spaced to scale, but ${unplaced.length > 0 ? `${unplaced.length} event(s) have no known time` : "every event has the same time"}. Use ordered spacing, or give every event its time.`,
        path,
      );
    }
  }

  // Spaced to scale, events close in time in the same lane would be drawn on top of each other.
  if (panel.spacing === "proportional" && frame?.kind === "timeline") {
    const byLane = new Map<number, { x: number; text: string }[]>();
    panel.items.forEach((item, i) => {
      const lane = item.lane ?? 0;
      byLane.set(lane, [...(byLane.get(lane) ?? []), { x: timelinePoint(frame, eventKey(item, i), lane).x, text: item.text }]);
    });
    for (const events of byLane.values()) {
      events.sort((a, b) => a.x - b.x);
      for (let i = 1; i < events.length; i++) {
        if (events[i]!.x - events[i - 1]!.x < frame.slotWidth * 0.8) {
          issue(
            "timeline_crowded",
            `In ${where}, "${events[i - 1]!.text}" and "${events[i]!.text}" are too close in time to label when spaced to scale. Use ordered spacing, or put them in different lanes.`,
            path,
          );
          break;
        }
      }
    }
  }

  const known = new Set(ids);
  for (const relation of panel.relations ?? []) {
    if (!known.has(relation.from) || !known.has(relation.to)) {
      issue("unknown_relation_event", `A "${relation.type}" relation in ${where} names an event that is not in it.`, path);
    } else if (relation.from === relation.to) {
      issue("self_relation", `A relation in ${where} connects an event to itself.`, path);
    }
  }
}

function checkComparison(panel: ComparisonPanel, path: string, issue: Report, frame: Frame | undefined): void {
  const where = `comparison "${panel.id}"`;
  checkCutOff([...panel.alternatives, ...panel.criteria.flatMap((c) => [c.label, ...c.cells.map((cell) => cell.text)])], where, path, issue);
  for (const name of duplicates(panel.alternatives)) issue("duplicate_alternative", `Alternative "${name}" appears twice in ${where}.`, path);
  for (const id of duplicates(panel.criteria.map((c) => c.id))) issue("duplicate_criterion", `Criterion id "${id}" is used twice in ${where}.`, path);
  if (frame?.kind === "comparison" && frame.alternatives.join("\u0000") !== panel.alternatives.join("\u0000")) {
    issue("comparison_alternatives_changed", `The alternatives of ${where} change between steps. Keep the same alternatives in the same order.`, path);
  }
  panel.criteria.forEach((criterion, r) => {
    const at = `${path}.criteria.${r}`;
    if (criterion.cells.length !== panel.alternatives.length) {
      issue(
        "comparison_shape",
        `Criterion "${criterion.label}" has ${criterion.cells.length} cells but ${where} compares ${panel.alternatives.length} alternatives.`,
        at,
      );
    }
    criterion.cells.forEach((cell, c) => {
      if (cell.missing === null && cell.text.trim().length === 0) {
        issue("comparison_value", `Cell ${c + 1} of "${criterion.label}" is empty. Give the value, or mark it unknown or not applicable.`, at);
      }
      if (cell.missing !== null && cell.text.trim().length > 0) {
        issue("comparison_value", `Cell ${c + 1} of "${criterion.label}" is marked ${cell.missing} but also has a value. Leave its text empty.`, at);
      }
    });
  });
}

function checkHierarchy(panel: HierarchyPanel, path: string, issue: Report): void {
  const where = `hierarchy "${panel.id}"`;
  checkCutOff(panel.items.map((item) => item.text), where, path, issue);
  const ids = panel.items.map((item) => item.id);
  for (const id of duplicates(ids)) issue("duplicate_item_id", `Item id "${id}" is used twice in ${where}.`, path);
  const byId = new Map(panel.items.map((item) => [item.id, item]));
  if (!panel.items.some((item) => item.parent === null)) issue("hierarchy_root", `${where} has no root (an item whose parent is null).`, path);
  for (const item of panel.items) {
    if (item.parent !== null && !byId.has(item.parent)) {
      issue("hierarchy_parent", `Item "${item.text}" names parent "${item.parent}", which is not in ${where} in this step.`, path);
    }
  }
  let depth = 0;
  for (const item of panel.items) {
    let d = 1;
    let cursor = item.parent;
    const seen = new Set([item.id]);
    while (cursor !== null && byId.has(cursor)) {
      if (seen.has(cursor)) {
        issue("hierarchy_cycle", `Items in ${where} form a cycle through "${item.text}".`, path);
        break;
      }
      seen.add(cursor);
      d += 1;
      cursor = byId.get(cursor)!.parent;
    }
    depth = Math.max(depth, d);
  }
  if (depth > LIMITS.hierarchyDepth.max) {
    issue(
      "hierarchy_depth",
      `${where} is ${depth} levels deep; the limit is ${LIMITS.hierarchyDepth.max}. Show a smaller part of the tree (start lower or stop earlier) rather than flattening levels, and say in the description what is left out.`,
      path,
    );
  }
  if (panel.style === "groups" && depth > 2) {
    issue("hierarchy_depth", `${where} uses the groups style, which shows one level inside each group; it is ${depth} levels deep. Use the tree style.`, path);
  }
  for (const link of panel.links) {
    if (!byId.has(link.from) || !byId.has(link.to)) {
      issue("unknown_link_item", `A "${link.type}" link in ${where} names an item that is not in it in this step.`, path);
    } else if (link.from === link.to) {
      issue("self_link", `A link in ${where} connects an item to itself.`, path);
    }
  }
}

function checkChart(panel: ChartPanel, path: string, issue: Report, frame: Frame | undefined): void {
  const where = `chart "${panel.id}"`;
  checkCutOff(panel.categories, where, path, issue);
  // A line chart draws its categories evenly spaced, so points in time (years, months) must be evenly spaced too.
  // Bar charts compare categories, which need not be evenly spaced ("p50", "p90", "p99").
  const numbers = panel.categories.map((c) => c.match(/-?\d+(?:\.\d+)?/g));
  if (panel.chart === "line" && panel.categories.length >= 3 && numbers.every((n) => n?.length === 1)) {
    const values = numbers.map((n) => Number(n![0]));
    const gaps = values.slice(1).map((v, i) => v - values[i]!);
    const increasing = gaps.every((g) => g > 0);
    if (increasing && Math.max(...gaps) > Math.min(...gaps) * 1.1) {
      issue(
        "chart_uneven_categories",
        `${where} spaces the categories ${panel.categories.join(", ")} evenly although their values are not evenly spaced. Use evenly spaced values (for example every 5 years).`,
        path,
      );
    }
  }
  for (const name of duplicates(panel.categories)) issue("duplicate_category", `Category "${name}" appears twice in ${where}.`, path);
  for (const name of duplicates(panel.series.map((s) => s.name))) issue("duplicate_series", `Series "${name}" appears twice in ${where}.`, path);
  if (frame?.kind === "chart" && frame.categories.join("\u0000") !== panel.categories.join("\u0000")) {
    issue("chart_categories_changed", `The categories of ${where} change between steps. Keep them, and reveal values with "revealed".`, path);
  }
  panel.series.forEach((series, i) => {
    if (series.values.length !== panel.categories.length) {
      issue(
        "chart_shape",
        `Series "${series.name}" has ${series.values.length} values but ${where} has ${panel.categories.length} categories. Use null for a missing value.`,
        `${path}.series.${i}`,
      );
    }
  });
  if (panel.series.every((series) => series.values.every((v) => v === null))) {
    issue("chart_empty", `${where} has no values at all.`, path);
  }
  if (panel.revealed > panel.categories.length) {
    issue("chart_revealed", `${where} reveals ${panel.revealed} categories but has ${panel.categories.length}.`, path);
  }
  if (panel.highlight !== null && panel.highlight >= panel.categories.length) {
    issue("chart_highlight", `${where} highlights category ${panel.highlight + 1}, which does not exist.`, path);
  }
}

// ---------------------------------------------------------------------------
// Continuity between steps
// ---------------------------------------------------------------------------

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
      } else if (before && isFramed(before) !== isFramed(panel)) {
        issues.push({
          code: "panel_kind_changed",
          severity: "error",
          message: `Timeline "${panel.id}" sets "spacing" in only some steps. Set it in every step.`,
          path: `steps.${s}.panels.${p}`,
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

    // The last step may hold the end state on purpose, as a summary.
    if (s < steps.length - 1 && sceneSignature(prev) === sceneSignature(curr)) {
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

// ---------------------------------------------------------------------------
// Provenance and claim references
// ---------------------------------------------------------------------------

function checkProvenance(concept: Concept): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, path: string, stepId?: string) =>
    issues.push({ code, severity: "error", message, path, ...(stepId ? { stepId } : {}) });
  const provenance: Provenance | undefined = concept.provenance;
  const claimIds = new Set((provenance?.claims ?? []).map((c) => c.id));

  concept.steps.forEach((step, s) => {
    for (const id of step.claims ?? []) {
      if (!claimIds.has(id)) error("unknown_claim", `Step "${step.id}" cites claim "${id}", which does not exist.`, `steps.${s}.claims`, step.id);
    }
    for (const id of duplicates(step.claims ?? [])) error("duplicate_claim_ref", `Step "${step.id}" cites claim "${id}" twice.`, `steps.${s}.claims`, step.id);
  });
  if (!provenance) return issues;

  for (const id of duplicates(provenance.claims.map((c) => c.id))) error("duplicate_claim", `Claim id "${id}" is used twice.`, "provenance.claims");
  if (provenance.sourcesConsulted !== provenance.sources.length > 0) {
    error("provenance_sources", "sourcesConsulted must be true exactly when sources are attached.", "provenance.sourcesConsulted");
  }
  if (provenance.request.kind === "source" && provenance.sources.length === 0) {
    error("provenance_sources", "An explanation of supplied material must keep that material.", "provenance.sources");
  }
  const passages = new Map(provenance.sources.flatMap((source) => source.passages.map((p) => [p.id, p.text] as const)));
  for (const id of duplicates([...provenance.sources.flatMap((source) => source.passages.map((p) => p.id))])) {
    error("duplicate_passage", `Passage id "${id}" is used twice.`, "provenance.sources");
  }
  provenance.claims.forEach((claim, c) => {
    const path = `provenance.claims.${c}`;
    for (const id of claim.passages) {
      if (!passages.has(id)) error("unknown_passage", `Claim "${claim.id}" cites passage "${id}", which does not exist.`, path);
    }
    if (claim.basis === "source") {
      // Re-checked on every read: a stored claim may only say "the source says" when it really does.
      if (claim.passages.length === 0 || !claim.quote) {
        error("unsupported_claim", `Claim "${claim.id}" is marked as stated in the source but has no excerpt.`, path);
      } else if (!claim.passages.some((id) => quoteInPassage(claim.quote, passages.get(id) ?? ""))) {
        error("quote_not_found", `The excerpt for claim "${claim.id}" is not in the passage it cites.`, path);
      }
    }
    if (claim.basis === "assumption" && claim.passages.length > 0) {
      error("assumption_with_source", `Claim "${claim.id}" is an assumption, so it cannot cite a passage.`, path);
    }
  });
  return issues;
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
