import { z } from "zod";
import {
  ARENA,
  CHART_DATA,
  CHART_TYPES,
  CLAIM_BASES,
  COLOR_TOKENS,
  COMPARISON_MISSING,
  DATE_PRECISION,
  DEPTHS,
  EXPLANATION_TYPES,
  HIERARCHY_LINKS,
  HIERARCHY_RELATIONS,
  HIERARCHY_STYLES,
  ID_PATTERN,
  LAYOUT_STRATEGIES,
  LIMITS,
  NODE_SHAPES,
  NODE_STATUSES,
  REPRESENTATIONS,
  SCHEMA_VERSION,
  STEP_TIMINGS,
  TIMELINE_RELATIONS,
  TIMELINE_SPACING,
} from "./constants";

/**
 * Canonical scene contract.
 *
 * One set of Zod definitions is used for AI structured output (the wire
 * variants below), server validation, browser reads and writes, renderer
 * input, and test fixtures. TypeScript types are inferred from these schemas;
 * there are no hand-written duplicates.
 *
 * The schema covers structure, types, allowlists, and size limits. Rules that
 * need cross-field context (word counts, references, geometry, identity across
 * steps) live in `validate.ts` so they can report precise, actionable issues.
 */

const entityId = z
  .string()
  .min(1)
  .max(LIMITS.id.max)
  .regex(ID_PATTERN, "Use letters, digits, '_' or '-' and start with a letter or digit");

const plainLabel = (min: number) => z.string().min(min).max(LIMITS.label.max);
const shortText = (max: number, min = 0) => z.string().min(min).max(max);

export const NodeShapeSchema = z.enum(NODE_SHAPES);
export const NodeStatusSchema = z.enum(NODE_STATUSES);
export const ColorTokenSchema = z.enum(COLOR_TOKENS);

/** Semantic placement: a grid column (or a position around a ring) and a row. */
const gridColumn = z.number().int().min(0).max(LIMITS.grid.columns - 1);
const gridRow = z.number().int().min(0).max(LIMITS.grid.rows - 1);

const nodeShape = {
  id: entityId,
  label: plainLabel(1),
  shape: NodeShapeSchema,
  color: ColorTokenSchema,
  status: NodeStatusSchema,
};

export const VisualNodeSchema = z.strictObject({
  ...nodeShape,
  // Zod 4 numbers reject NaN and ±Infinity, so these are finite by construction.
  x: z.number().min(0).max(ARENA.width),
  y: z.number().min(0).max(ARENA.height),
  /** Where the layout engine placed the node; absent in version-1 concepts, whose positions were written directly. */
  col: gridColumn.optional(),
  row: gridRow.optional(),
});

const edgeShape = {
  id: entityId,
  /** A node or a panel. */
  from: entityId,
  to: entityId,
  /** May be empty when the arrow alone is clear. */
  label: plainLabel(0),
  animated: z.boolean(),
};
/** Messages travel in rounds: round 2 starts when round 1 has arrived, so a reply can follow its request. */
const messageRound = z.number().int().min(1).max(LIMITS.messageRounds.max);

export const VisualEdgeSchema = z.strictObject({ ...edgeShape, order: messageRound.optional() });

const itemShape = {
  text: z.string().min(1).max(LIMITS.timelineText.max),
  /** Small label above the item: a log offset or a timeline date. "" for none. */
  tag: z.string().max(LIMITS.itemTag.max),
  color: ColorTokenSchema,
  status: NodeStatusSchema,
};

/** One record of a log or cell of a table. */
export const PanelItemSchema = z.strictObject(itemShape);

const panelPosition = {
  /** Center of the panel, in arena units. */
  x: z.number().min(0).max(ARENA.width),
  y: z.number().min(0).max(ARENA.height),
};

const panelHead = {
  id: entityId,
  /** Title drawn above the panel; may be empty. */
  label: plainLabel(0),
};

// ---- Panels whose content is the same on the wire and in storage ----------

const logShape = { kind: z.literal("log"), ...panelHead, items: z.array(PanelItemSchema).max(LIMITS.panelItems.max) };

const codeShape = {
  kind: z.literal("code"),
  ...panelHead,
  lines: z
    .array(z.strictObject({ text: z.string().max(LIMITS.codeLine.max), highlight: z.boolean() }))
    .min(LIMITS.codeLines.min)
    .max(LIMITS.codeLines.max),
};

const tableShape = {
  kind: z.literal("table"),
  ...panelHead,
  columns: z.array(z.string().min(1).max(LIMITS.cellText.max)).min(LIMITS.tableColumns.min).max(LIMITS.tableColumns.max),
  rows: z
    .array(
      z.strictObject({
        /** Row heading; "" for none. */
        label: z.string().max(LIMITS.cellText.max),
        cells: z.array(PanelItemSchema).min(LIMITS.tableColumns.min).max(LIMITS.tableColumns.max),
      }),
    )
    .min(LIMITS.tableRows.min)
    .max(LIMITS.tableRows.max),
};

/** Alternatives (columns) evaluated against criteria (rows). There is deliberately no score or winner field. */
export const ComparisonCellSchema = z.strictObject({
  /** The value as shown, including its number; "" when `missing` is set. */
  text: shortText(LIMITS.comparisonText.max),
  /** Set when the value is unknown or does not apply; the cell then says so instead of showing a value. */
  missing: z.enum(COMPARISON_MISSING).nullable(),
  color: ColorTokenSchema,
  status: NodeStatusSchema,
});

const comparisonShape = {
  kind: z.literal("comparison"),
  ...panelHead,
  alternatives: z
    .array(shortText(LIMITS.comparisonText.max, 1))
    .min(LIMITS.comparisonAlternatives.min)
    .max(LIMITS.comparisonAlternatives.max),
  criteria: z
    .array(
      z.strictObject({
        id: entityId,
        label: shortText(LIMITS.comparisonText.max, 1),
        /** One unit for the whole row, such as "ms" or "USD"; "" when values have no unit. */
        unit: shortText(LIMITS.unit.max),
        cells: z.array(ComparisonCellSchema).min(LIMITS.comparisonAlternatives.min).max(LIMITS.comparisonAlternatives.max),
      }),
    )
    .max(LIMITS.comparisonCriteria.max),
};

export const HierarchyItemSchema = z.strictObject({
  id: entityId,
  text: shortText(LIMITS.comparisonText.max, 1),
  /** null for a root. */
  parent: entityId.nullable(),
  color: ColorTokenSchema,
  status: NodeStatusSchema,
});

const hierarchyShape = {
  kind: z.literal("hierarchy"),
  ...panelHead,
  /** `tree` for organizations and taxonomies; `groups` draws each root as a box holding its children. */
  style: z.enum(HIERARCHY_STYLES),
  /** What a child-to-parent line means, the same for the whole panel. */
  relation: z.enum(HIERARCHY_RELATIONS),
  items: z.array(HierarchyItemSchema).min(LIMITS.hierarchyItems.min).max(LIMITS.hierarchyItems.max),
  links: z
    .array(z.strictObject({ from: entityId, to: entityId, type: z.enum(HIERARCHY_LINKS) }))
    .max(LIMITS.hierarchyLinks.max),
};

const chartValue = z.number().min(-LIMITS.chartValue.max).max(LIMITS.chartValue.max);

const chartShape = {
  kind: z.literal("chart"),
  ...panelHead,
  chart: z.enum(CHART_TYPES),
  /** `observed`: values from supplied material. `illustrative`: an invented example, labeled as such. */
  data: z.enum(CHART_DATA),
  categories: z
    .array(shortText(LIMITS.chartCategory.max, 1))
    .min(LIMITS.chartCategories.min)
    .max(LIMITS.chartCategories.max),
  xLabel: shortText(LIMITS.chartAxisLabel.max),
  yLabel: shortText(LIMITS.chartAxisLabel.max),
  /** One unit for every value, such as "%" or "USD"; "" for plain counts. */
  unit: shortText(LIMITS.unit.max),
  series: z
    .array(
      z.strictObject({
        name: shortText(LIMITS.chartAxisLabel.max, 1),
        color: ColorTokenSchema,
        /** One value per category; null when the value is missing. */
        values: z.array(chartValue.nullable()).min(LIMITS.chartCategories.min).max(LIMITS.chartCategories.max),
      }),
    )
    .min(LIMITS.chartSeries.min)
    .max(LIMITS.chartSeries.max),
  /** How many leading categories show their values in this step. */
  revealed: z.number().int().min(0).max(LIMITS.chartCategories.max),
  /** Category index to emphasize in this step, or null. */
  highlight: z.number().int().min(0).max(LIMITS.chartCategories.max - 1).nullable(),
};

// ---- Timelines: version-2 fields are optional in storage, so version-1 timelines stay valid ----

const timelineExtras = {
  /** Stable event identity, used by relations. */
  id: entityId,
  /** Index into the panel's lanes. */
  lane: z.number().int().min(0).max(LIMITS.timelineLanes.max - 1),
  /** Position on the panel's time scale (for example a year, or minutes since start). */
  at: z.number().min(-1e9).max(1e9),
  /** End of a duration, on the same scale. */
  end: z.number().min(-1e9).max(1e9),
  date: z.enum(DATE_PRECISION),
};

export const TimelineItemSchema = z.strictObject({
  ...itemShape,
  id: timelineExtras.id.optional(),
  lane: timelineExtras.lane.optional(),
  at: timelineExtras.at.optional(),
  end: timelineExtras.end.optional(),
  date: timelineExtras.date.optional(),
});

const timelineRelation = z.strictObject({ from: entityId, to: entityId, type: z.enum(TIMELINE_RELATIONS) });
const laneNames = z.array(shortText(LIMITS.comparisonText.max, 1)).max(LIMITS.timelineLanes.max);

export const LogPanelSchema = z.strictObject({ ...logShape, ...panelPosition });
export const CodePanelSchema = z.strictObject({ ...codeShape, ...panelPosition });
export const TablePanelSchema = z.strictObject({ ...tableShape, ...panelPosition });
export const TimelinePanelSchema = z.strictObject({
  kind: z.literal("timeline"),
  ...panelHead,
  ...panelPosition,
  items: z.array(TimelineItemSchema).max(LIMITS.panelItems.max),
  /** Parallel actors or workstreams; absent or empty for a single lane. */
  lanes: laneNames.optional(),
  /** `ordered` (the default) spaces events evenly; `proportional` spaces them by `at`, and needs every `at`. */
  spacing: z.enum(TIMELINE_SPACING).optional(),
  unit: shortText(LIMITS.unit.max).optional(),
  relations: z.array(timelineRelation).max(LIMITS.timelineRelations.max).optional(),
});
export const ComparisonPanelSchema = z.strictObject({ ...comparisonShape, ...panelPosition });
export const HierarchyPanelSchema = z.strictObject({ ...hierarchyShape, ...panelPosition });
export const ChartPanelSchema = z.strictObject({ ...chartShape, ...panelPosition });

export const PanelSchema = z.discriminatedUnion("kind", [
  LogPanelSchema,
  CodePanelSchema,
  TablePanelSchema,
  TimelinePanelSchema,
  ComparisonPanelSchema,
  HierarchyPanelSchema,
  ChartPanelSchema,
]);

const stepShape = {
  id: entityId,
  text: z.string().min(1).max(LIMITS.stepText.maxChars),
};

/**
 * `panels`, `focus`, `timing`, edge `order`, and `claims` were added after the
 * first version; they are optional here, so earlier concepts stay valid.
 */
export const StepSchema = z.strictObject({
  ...stepShape,
  nodes: z.array(VisualNodeSchema).min(LIMITS.nodesPerStep.min).max(LIMITS.nodesPerStep.max),
  edges: z.array(VisualEdgeSchema).max(LIMITS.edgesPerStep.max),
  notes: z.string().min(1).max(LIMITS.notes.max).optional(),
  panels: z.array(PanelSchema).max(LIMITS.panelsPerStep.max).optional(),
  /** Node or panel ids the camera zooms onto for this step. */
  focus: z.array(entityId).min(1).max(LIMITS.focus.max).optional(),
  /** Default `changes_first`: the scene changes, then messages travel. */
  timing: z.enum(STEP_TIMINGS).optional(),
  /** Claims (from the provenance) that this step shows or relies on. */
  claims: z.array(entityId).min(1).max(LIMITS.claimsPerStep.max).optional(),
});

// ---------------------------------------------------------------------------
// Provenance: what the explanation was made from
// ---------------------------------------------------------------------------

export const SourcePassageSchema = z.strictObject({ id: entityId, text: z.string().min(1).max(LIMITS.passage.max) });

/** Material the reader supplied. Only pasted text is supported. */
export const SourceSchema = z.strictObject({
  id: entityId,
  kind: z.literal("pasted_text"),
  title: shortText(LIMITS.title.max, 1),
  passages: z.array(SourcePassageSchema).min(1).max(LIMITS.passages.max),
});

export const ClaimSchema = z.strictObject({
  id: entityId,
  text: shortText(LIMITS.claimText.max, 1),
  /**
   * `source`: stated in the supplied material, with an excerpt the server
   * located in the cited passage. `interpretation`: drawn from the material
   * but not stated in it. `assumption`: added to make the explanation work.
   */
  basis: z.enum(CLAIM_BASES),
  passages: z.array(entityId).max(3),
  /** Verbatim excerpt for `source` claims; "" otherwise. */
  quote: shortText(LIMITS.quote.max),
});

const listOf = (max: number) => z.array(shortText(LIMITS.listItem.max, 1)).max(max);

export const RequestInfoSchema = z.strictObject({
  /** `example`: another example made from a saved explanation. */
  kind: z.enum(["topic", "source", "example"]),
  /** The topic, or a short title for supplied material. */
  topic: shortText(LIMITS.question.max, 1),
  /** Optional question that narrowed supplied material; "" for none. */
  question: shortText(LIMITS.question.max),
  audience: shortText(LIMITS.audience.max),
  language: shortText(40),
  depth: z.enum(DEPTHS),
});

export const ProvenanceSchema = z.strictObject({
  request: RequestInfoSchema,
  learningGoal: shortText(240, 1),
  explanationType: z.enum(EXPLANATION_TYPES),
  representation: z.enum(REPRESENTATIONS),
  /** False when the explanation comes only from the model's general knowledge. */
  sourcesConsulted: z.boolean(),
  sources: z.array(SourceSchema).max(1),
  claims: z.array(ClaimSchema).max(LIMITS.claims.max + LIMITS.assumptions.max + 1),
  scope: shortText(300),
  omissions: listOf(5),
  simplifications: listOf(6),
  uncertainty: listOf(4),
  /** Contradictions and gaps in the supplied material, shown rather than silently resolved. */
  limitations: listOf(6),
});

const contentShape = {
  title: z.string().min(LIMITS.title.min).max(LIMITS.title.max),
  description: z.string().min(LIMITS.description.min).max(LIMITS.description.max),
};

/** Model-authored part of a concept, after layout: everything except identity, version, and provenance. */
export const ConceptContentSchema = z.strictObject({
  ...contentShape,
  steps: z.array(StepSchema).min(LIMITS.steps.min).max(LIMITS.steps.max),
});

/** A complete concept as stored in the browser library and given to the player. */
export const ConceptSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.uuid(),
  ...ConceptContentSchema.shape,
  /** How positions were computed; absent when they were written directly (version 1). */
  layout: z.enum(LAYOUT_STRATEGIES).optional(),
  provenance: ProvenanceSchema.optional(),
});

/**
 * Supplementary content a reader asked for on one step of an explanation:
 * an explanation of the step, a simpler version, or another example. Kept
 * beside the explanation (never merged into it) and labeled as such.
 */
const supplementBase = {
  id: z.uuid(),
  /** The explanation the supplement belongs to. */
  conceptId: z.uuid(),
  stepId: entityId,
  createdAt: z.string().max(40),
};
const supplementText = { text: z.string().min(1).max(LIMITS.supplementText.max), claims: z.array(entityId).max(LIMITS.claimsPerStep.max) };

export const SupplementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("explain"), ...supplementBase, ...supplementText }),
  z.strictObject({ kind: z.literal("simplify"), ...supplementBase, ...supplementText }),
  z.strictObject({ kind: z.literal("example"), ...supplementBase, concept: ConceptSchema }),
]);
export type Supplement = z.infer<typeof SupplementSchema>;

/**
 * Upgrade an older stored concept to the current version. Version 2 only
 * added optional fields, so a version-1 concept needs just its new number.
 * Anything else is returned unchanged for the validator to reject.
 */
export function migrateConcept(input: unknown): unknown {
  if (input && typeof input === "object" && (input as { schemaVersion?: unknown }).schemaVersion === 1) {
    return { ...(input as object), schemaVersion: SCHEMA_VERSION };
  }
  return input;
}

// ---------------------------------------------------------------------------
// Wire format for the generator (OpenAI Structured Outputs, strict mode)
// ---------------------------------------------------------------------------

/**
 * Strict mode requires every key, so optional fields are required here and
 * nullable or empty when unused. The generator never writes coordinates: it
 * places nodes on a grid (`col`, `row`) and the layout engine
 * (`lib/concept/layout.ts`) computes positions from real component sizes.
 */
export const GeneratedNodeSchema = z.strictObject({ ...nodeShape, col: gridColumn, row: gridRow });

export const GeneratedTimelineItemSchema = z.strictObject({
  ...itemShape,
  id: timelineExtras.id,
  lane: timelineExtras.lane,
  at: timelineExtras.at.nullable(),
  end: timelineExtras.end.nullable(),
  date: timelineExtras.date,
});

export const GeneratedPanelSchema = z.discriminatedUnion("kind", [
  z.strictObject(logShape),
  z.strictObject(codeShape),
  z.strictObject(tableShape),
  z.strictObject({
    kind: z.literal("timeline"),
    ...panelHead,
    items: z.array(GeneratedTimelineItemSchema).max(LIMITS.panelItems.max),
    lanes: laneNames,
    spacing: z.enum(TIMELINE_SPACING),
    unit: shortText(LIMITS.unit.max),
    relations: z.array(timelineRelation).max(LIMITS.timelineRelations.max),
  }),
  z.strictObject(comparisonShape),
  z.strictObject(hierarchyShape),
  z.strictObject(chartShape),
]);

export const GeneratedStepSchema = z.strictObject({
  ...stepShape,
  nodes: z.array(GeneratedNodeSchema).min(LIMITS.nodesPerStep.min).max(LIMITS.nodesPerStep.max),
  edges: z.array(z.strictObject({ ...edgeShape, order: messageRound })).max(LIMITS.edgesPerStep.max),
  notes: z.string().max(LIMITS.notes.max).nullable(),
  panels: z.array(GeneratedPanelSchema).max(LIMITS.panelsPerStep.max),
  focus: z.array(entityId).max(LIMITS.focus.max).nullable(),
  timing: z.enum(STEP_TIMINGS),
  claims: z.array(entityId).max(LIMITS.claimsPerStep.max),
});

export const GeneratedConceptContentSchema = z.strictObject({
  ...contentShape,
  steps: z.array(GeneratedStepSchema).min(LIMITS.steps.min).max(LIMITS.steps.max),
});

export type NodeShape = z.infer<typeof NodeShapeSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type ColorToken = z.infer<typeof ColorTokenSchema>;
export type VisualNode = z.infer<typeof VisualNodeSchema>;
export type VisualEdge = z.infer<typeof VisualEdgeSchema>;
export type PanelItem = z.infer<typeof PanelItemSchema>;
export type TimelineItem = z.infer<typeof TimelineItemSchema>;
export type ComparisonCell = z.infer<typeof ComparisonCellSchema>;
export type HierarchyItem = z.infer<typeof HierarchyItemSchema>;
export type Panel = z.infer<typeof PanelSchema>;
export type LogPanel = z.infer<typeof LogPanelSchema>;
export type CodePanel = z.infer<typeof CodePanelSchema>;
export type TablePanel = z.infer<typeof TablePanelSchema>;
export type TimelinePanel = z.infer<typeof TimelinePanelSchema>;
export type ComparisonPanel = z.infer<typeof ComparisonPanelSchema>;
export type HierarchyPanel = z.infer<typeof HierarchyPanelSchema>;
export type ChartPanel = z.infer<typeof ChartPanelSchema>;
export type Step = z.infer<typeof StepSchema>;
export type ConceptContent = z.infer<typeof ConceptContentSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type RequestInfo = z.infer<typeof RequestInfoSchema>;
export type GeneratedNode = z.infer<typeof GeneratedNodeSchema>;
export type GeneratedPanel = z.infer<typeof GeneratedPanelSchema>;
export type GeneratedStep = z.infer<typeof GeneratedStepSchema>;
export type GeneratedConceptContent = z.infer<typeof GeneratedConceptContentSchema>;

/** A panel without its position, as the generator writes it and the layout engine places it. */
export type UnplacedPanel = DistributiveOmit<Panel, "x" | "y">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A wire-format panel in canonical form: nulls dropped, defaults removed. */
export function panelFromGenerated(panel: GeneratedPanel): UnplacedPanel {
  if (panel.kind !== "timeline") return panel;
  const { lanes, spacing, unit, relations, items, ...rest } = panel;
  return {
    ...rest,
    // An undated or unknown-date event is never placed by time, so a position the generator gave it is dropped.
    items: items.map(({ at, end, ...item }) => {
      const dated = item.date === "exact" || item.date === "approximate";
      return { ...item, ...(at === null || !dated ? {} : { at }), ...(end === null || !dated ? {} : { end }) };
    }),
    ...(lanes.length > 0 ? { lanes } : {}),
    spacing,
    ...(unit ? { unit } : {}),
    ...(relations.length > 0 ? { relations } : {}),
  };
}

/** The wire shape of a canonical panel (every key present), for mocks and tests. */
export function panelToGenerated(panel: UnplacedPanel | Panel): GeneratedPanel {
  const { x: _x, y: _y, ...rest } = panel as Panel;
  void _x;
  void _y;
  if (rest.kind !== "timeline") return rest as GeneratedPanel;
  return {
    kind: "timeline",
    id: rest.id,
    label: rest.label,
    items: rest.items.map((item, i) => ({
      text: item.text,
      tag: item.tag,
      color: item.color,
      status: item.status,
      id: item.id ?? `e${i + 1}`,
      lane: item.lane ?? 0,
      at: item.at ?? null,
      end: item.end ?? null,
      date: item.date ?? (item.tag ? "exact" : "unknown"),
    })),
    lanes: rest.lanes ?? [],
    spacing: rest.spacing ?? "ordered",
    unit: rest.unit ?? "",
    relations: rest.relations ?? [],
  };
}

/** Attach application-owned identity and version to laid-out content. */
export function assembleConcept(
  content: ConceptContent,
  id: string,
  extra: { layout?: Concept["layout"]; provenance?: Provenance } = {},
): Concept {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    ...content,
    ...(extra.layout ? { layout: extra.layout } : {}),
    ...(extra.provenance ? { provenance: extra.provenance } : {}),
  };
}

