import { z } from "zod";
import {
  ARENA,
  COLOR_TOKENS,
  ID_PATTERN,
  LIMITS,
  NODE_SHAPES,
  NODE_STATUSES,
  SCHEMA_VERSION,
  STEP_TIMINGS,
} from "./constants";

/**
 * Canonical scene contract.
 *
 * One set of Zod definitions is used for AI structured output (via
 * `GeneratedConceptContentSchema`, derived below), server validation, database
 * reads and writes, renderer input, and test fixtures. TypeScript types are
 * inferred from these schemas; there are no hand-written duplicates.
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

export const NodeShapeSchema = z.enum(NODE_SHAPES);
export const NodeStatusSchema = z.enum(NODE_STATUSES);
export const ColorTokenSchema = z.enum(COLOR_TOKENS);

export const VisualNodeSchema = z.strictObject({
  id: entityId,
  label: plainLabel(1),
  // Zod 4 numbers reject NaN and ±Infinity, so these are finite by construction.
  x: z.number().min(0).max(ARENA.width),
  y: z.number().min(0).max(ARENA.height),
  shape: NodeShapeSchema,
  color: ColorTokenSchema,
  status: NodeStatusSchema,
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

/** One record of a log, cell of a table, or event of a timeline. */
export const PanelItemSchema = z.strictObject({
  text: z.string().min(1).max(LIMITS.timelineText.max),
  /** Small label above the item: a log offset or a timeline date. "" for none. */
  tag: z.string().max(LIMITS.itemTag.max),
  color: ColorTokenSchema,
  status: NodeStatusSchema,
});

const panelShape = {
  id: entityId,
  /** Title drawn above the panel; may be empty. */
  label: plainLabel(0),
  /** Center of the panel, in arena units. */
  x: z.number().min(0).max(ARENA.width),
  y: z.number().min(0).max(ARENA.height),
};

export const LogPanelSchema = z.strictObject({
  kind: z.literal("log"),
  ...panelShape,
  items: z.array(PanelItemSchema).max(LIMITS.panelItems.max),
});

export const CodePanelSchema = z.strictObject({
  kind: z.literal("code"),
  ...panelShape,
  lines: z
    .array(z.strictObject({ text: z.string().max(LIMITS.codeLine.max), highlight: z.boolean() }))
    .min(LIMITS.codeLines.min)
    .max(LIMITS.codeLines.max),
});

export const TablePanelSchema = z.strictObject({
  kind: z.literal("table"),
  ...panelShape,
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
});

export const TimelinePanelSchema = z.strictObject({
  kind: z.literal("timeline"),
  ...panelShape,
  items: z.array(PanelItemSchema).max(LIMITS.panelItems.max),
});

export const PanelSchema = z.discriminatedUnion("kind", [LogPanelSchema, CodePanelSchema, TablePanelSchema, TimelinePanelSchema]);

const stepShape = {
  id: entityId,
  text: z.string().min(1).max(LIMITS.stepText.maxChars),
  nodes: z
    .array(VisualNodeSchema)
    .min(LIMITS.nodesPerStep.min)
    .max(LIMITS.nodesPerStep.max),
};

/**
 * `panels`, `focus`, `timing`, and edge `order` were added after the first
 * version; they are optional here, so earlier concepts stay valid.
 */
export const StepSchema = z.strictObject({
  ...stepShape,
  edges: z.array(VisualEdgeSchema).max(LIMITS.edgesPerStep.max),
  notes: z.string().min(1).max(LIMITS.notes.max).optional(),
  panels: z.array(PanelSchema).max(LIMITS.panelsPerStep.max).optional(),
  /** Node or panel ids the camera zooms onto for this step. */
  focus: z.array(entityId).min(1).max(LIMITS.focus.max).optional(),
  /** Default `changes_first`: the scene changes, then messages travel. */
  timing: z.enum(STEP_TIMINGS).optional(),
});

const contentShape = {
  title: z.string().min(LIMITS.title.min).max(LIMITS.title.max),
  description: z.string().min(LIMITS.description.min).max(LIMITS.description.max),
};

/** Model-authored part of a concept: everything except identity and version. */
export const ConceptContentSchema = z.strictObject({
  ...contentShape,
  steps: z.array(StepSchema).min(LIMITS.steps.min).max(LIMITS.steps.max),
});

/** A complete concept as stored in `concepts.content` and given to the player. */
export const ConceptSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.uuid(),
  ...ConceptContentSchema.shape,
});

/**
 * Wire variant for OpenAI Structured Outputs. Strict mode requires every key
 * to be present, so optional fields are required here: `notes` and `focus`
 * may be null, `panels` may be empty, and `timing` and edge `order` always
 * carry a value. `toConceptContent` converts back to the canonical shape,
 * dropping defaults. Everything else is the canonical definition.
 */
export const GeneratedStepSchema = z.strictObject({
  ...stepShape,
  edges: z.array(z.strictObject({ ...edgeShape, order: messageRound })).max(LIMITS.edgesPerStep.max),
  notes: z.string().max(LIMITS.notes.max).nullable(),
  panels: z.array(PanelSchema).max(LIMITS.panelsPerStep.max),
  focus: z.array(entityId).max(LIMITS.focus.max).nullable(),
  timing: z.enum(STEP_TIMINGS),
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
export type Panel = z.infer<typeof PanelSchema>;
export type LogPanel = z.infer<typeof LogPanelSchema>;
export type CodePanel = z.infer<typeof CodePanelSchema>;
export type TablePanel = z.infer<typeof TablePanelSchema>;
export type TimelinePanel = z.infer<typeof TimelinePanelSchema>;
export type Step = z.infer<typeof StepSchema>;
export type ConceptContent = z.infer<typeof ConceptContentSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type GeneratedConceptContent = z.infer<typeof GeneratedConceptContentSchema>;

export function toConceptContent(generated: GeneratedConceptContent): ConceptContent {
  return {
    title: generated.title,
    description: generated.description,
    steps: generated.steps.map(({ notes, panels, focus, timing, edges, ...step }) => ({
      ...step,
      edges: edges.map(({ order, ...edge }) => (order > 1 ? { ...edge, order } : edge)),
      ...(notes && notes.trim().length > 0 ? { notes } : {}),
      ...(panels.length > 0 ? { panels } : {}),
      ...(focus && focus.length > 0 ? { focus } : {}),
      ...(timing !== "changes_first" ? { timing } : {}),
    })),
  };
}

/** The wire shape of canonical content (every key present), for mocks and tests. */
export function toGeneratedContent(content: ConceptContent): GeneratedConceptContent {
  return {
    title: content.title,
    description: content.description,
    steps: content.steps.map(({ notes, panels, focus, timing, edges, ...step }) => ({
      ...step,
      edges: edges.map((edge) => ({ ...edge, order: edge.order ?? 1 })),
      notes: notes ?? null,
      panels: panels ?? [],
      focus: focus ?? null,
      timing: timing ?? "changes_first",
    })),
  };
}

/** Attach application-owned identity and version to model-authored content. */
export function assembleConcept(content: ConceptContent, id: string): Concept {
  return { schemaVersion: SCHEMA_VERSION, id, ...content };
}
