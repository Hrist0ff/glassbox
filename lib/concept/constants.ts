/**
 * Application-owned constants for the scene contract.
 *
 * These numbers are shared by the Zod schema, the deterministic validator, the
 * SVG renderer, the generator prompt, and the docs. Change them here only.
 */

/**
 * Version 2 adds the representations (comparison, hierarchy, chart, richer
 * timelines), semantic placement (`col`/`row`), claim references, and
 * provenance. Every version-1 concept is a valid version-2 concept once its
 * version number is updated; see `migrateConcept` in schema.ts.
 */
export const SCHEMA_VERSION = 2 as const;
export const LEGACY_SCHEMA_VERSIONS = [1] as const;

/** Logical arena. Node coordinates are node centers in these units. */
export const ARENA = {
  width: 1000,
  height: 600,
  /** Nothing (node, label) may be drawn closer than this to the arena edge. */
  safeMargin: 16,
} as const;

export type Arena = { width: number; height: number };

/**
 * Stored explanations are laid out on the landscape arena. On portrait
 * screens, explanations with semantic placement are laid out again on the
 * portrait arena at render time (and fall back to landscape if that fails).
 */
export const ARENAS = {
  landscape: { width: ARENA.width, height: ARENA.height },
  portrait: { width: 600, height: 1000 },
} as const satisfies Record<string, Arena>;

/** Fixed node geometry, in arena units. */
export const NODE = {
  /** Circle radius, and half the side length of a square. */
  radius: 32,
  /** Corner radius used when drawing squares. */
  squareCorner: 10,
  /** Centers of two nodes in the same step must be at least this far apart. */
  minSeparation: 88,
} as const;

/**
 * Node labels are drawn below the node in up to two lines. Widths are
 * estimated with a fixed average glyph width; see `lib/concept/geometry.ts`.
 */
export const LABEL = {
  fontSize: 16,
  lineHeight: 19,
  /** Conservative average glyph advance at `fontSize`, in arena units. */
  charWidth: 8.6,
  /** Gap between the node boundary and the first label line. */
  gap: 8,
  maxLines: 2,
  /** A line longer than this is hard-broken (only happens for very long words). */
  maxLineChars: 22,
} as const;

export const EDGE_LABEL = {
  fontSize: 13,
  charWidth: 7.3,
  paddingX: 8,
  height: 22,
} as const;

/**
 * Conservative zone for node centers in which *any* valid label fits inside
 * the arena. The generator is told to stay inside it; the validator checks
 * the exact per-label bounds, which are never stricter than this zone.
 */
export const SAFE_ZONE = {
  minX: 120,
  maxX: 880,
  minY: 60,
  maxY: 500,
} as const;

export const LIMITS = {
  topic: { min: 3, max: 120 },
  title: { min: 3, max: 80 },
  description: { min: 10, max: 280 },
  stepText: { maxWords: 20, maxChars: 160 },
  notes: { max: 600 },
  /**
   * Static views (a comparison, a chart) can be complete in two steps; the
   * planner asks for more when the explanation type needs them.
   */
  steps: { min: 2, max: 12 },
  /** A step may have no nodes when it shows panels; every step shows at least one node or panel. */
  nodesPerStep: { min: 0, max: 8 },
  edgesPerStep: { max: 12 },
  panelsPerStep: { max: 3 },
  /** Records in a log, events on a timeline. */
  panelItems: { max: 10 },
  /** Text of one log record or table cell; timeline events may be longer. */
  cellText: { max: 12 },
  timelineText: { max: 24 },
  /** Fits a date and time such as "Jul 20, 20:17". */
  itemTag: { max: 16 },
  codeLines: { min: 1, max: 14 },
  codeLine: { max: 44 },
  /** Eight columns fit a byte or a small bit array (Bloom filters, bitmaps). */
  tableColumns: { min: 1, max: 8 },
  /** Eight rows fit a small array listed one element per row. */
  tableRows: { min: 1, max: 8 },
  /** Ids the camera may zoom onto in one step. */
  focus: { max: 4 },
  /** Messages in one step travel in up to this many rounds (1 = first). */
  messageRounds: { max: 4 },
  label: { max: 30 },
  id: { max: 40 },
  /** Semantic placement of nodes: grid column (or position around a ring) and row. */
  grid: { columns: 8, rows: 5 },

  // ---- Representations (version 2) ----
  timelineLanes: { max: 4 },
  timelineRelations: { max: 6 },
  /** Short unit for a proportional timeline's axis, such as "years". */
  unit: { max: 16 },
  comparisonAlternatives: { min: 2, max: 4 },
  comparisonCriteria: { min: 1, max: 6 },
  /** Alternatives, criteria, comparison cells, and hierarchy items (two short lines). */
  comparisonText: { max: 32 },
  hierarchyItems: { min: 1, max: 12 },
  /** Taxonomies nest deeply (vertebrates → jawed → bony → lobe-finned → tetrapods → amniotes). */
  hierarchyDepth: { max: 6 },
  hierarchyLinks: { max: 6 },
  chartCategories: { min: 2, max: 8 },
  chartSeries: { min: 1, max: 3 },
  /** Category names under a chart's x axis. */
  chartCategory: { max: 12 },
  chartAxisLabel: { max: 24 },
  /** Absolute value of any chart value. */
  chartValue: { max: 1e12 },

  // ---- Provenance and sources ----
  claimsPerStep: { max: 4 },
  claims: { max: 24 },
  claimText: { max: 240 },
  /** A verbatim excerpt that supports a claim. */
  quote: { max: 240 },
  assumptions: { max: 6 },
  /** Pasted material, in characters after normalization. */
  sourceText: { min: 80, max: 16_000 },
  /** Passages are paragraphs, split further when long. */
  passage: { max: 700 },
  passages: { max: 60 },
  /** Optional question that narrows what to visualize in pasted material. */
  question: { max: 160 },
  audience: { max: 80 },
  listItem: { max: 200 },

  /** UTF-8 bytes of the serialized concept JSON (including the source it was made from). */
  payloadBytes: 160_000,
  /** UTF-8 bytes of a POST /api/generate request body, by kind. */
  requestBodyBytes: 2_048,
  sourceRequestBytes: 72_000,
  exploreRequestBytes: 240_000,
  /** Text written by "Explain this step" and "Make it simpler". */
  supplementText: { max: 900 },
} as const;

/** Stable identifiers: letters, digits, `_` and `-`; must start with a letter or digit. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const NODE_SHAPES = ["circle", "square"] as const;

/**
 * Panels show data next to the nodes: a log of records, lines of code, a
 * table, or a timeline of events. Their size follows from their content
 * (see `panelLayout` in geometry.ts); coordinates are the panel center.
 */
export const PANEL_KINDS = ["log", "code", "table", "timeline", "comparison", "hierarchy", "chart"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * Panel geometry in arena units, shared by the validator, the layout engine,
 * and the renderer. `horizontal` drawings are used on the landscape arena,
 * `vertical` ones on the portrait arena (see `ARENAS`).
 */
export const PANEL = {
  title: 24,
  record: { width: 72, height: 44, tag: 18 },
  code: { gutter: 34, charWidth: 9.6, lineHeight: 24, padding: 10, minChars: 12 },
  table: { column: 92, rowLabel: 92, header: 30, row: 34 },
  /** 10 events × 92 = 920 units: a full timeline fits the arena's usable width. */
  timeline: {
    spacing: 92,
    date: 20,
    axis: 16,
    text: 40,
    /** Lane names drawn left of the lanes. */
    laneLabel: 96,
    /** Arcs that show typed relations between events. */
    relations: 28,
    /** A proportional timeline is at least this many slots wide, so events can be spaced to scale. */
    minProportionalSlots: 8,
    /** Portrait: one row per event, a date column, and a column per lane (narrower when there are more lanes). */
    vertical: { row: 56, date: 84, laneWidths: [300, 220, 150, 110], header: 24, relations: 30 },
  },
  comparison: {
    horizontal: { label: 170, column: 150, header: 46, row: 40 },
    vertical: { label: 132, column: 108, header: 52, row: 48 },
  },
  hierarchy: {
    /** Relation legend under the drawing ("Lines mean: is part of"). */
    legend: 22,
    /** Room on the right of stacked drawings (outlines, stacked groups) for cross-links between rows. */
    linkGutter: 80,
    tree: { slot: 132, level: 86, box: { width: 118, height: 44 } },
    /** Outlines: one row per item; boxes keep `width` however deep they are indented. */
    outline: { row: 42, indent: 30, width: 300 },
    groups: { width: 190, gap: 14, header: 38, chip: 40, padding: 10, stackedWidth: 380 },
  },
  chart: {
    /** `labels` holds the category names and the x-axis title; `legend` the series and where the numbers come from. */
    horizontal: { axis: 76, slot: 84, plot: 230, labels: 54, legend: 26 },
    vertical: { axis: 64, slot: 60, plot: 250, labels: 58, legend: 44 },
  },
} as const;

/**
 * How positions are computed. The planner picks one; application code turns
 * semantic placement (node grid cells, ring order, panel order) into positions.
 */
export const LAYOUT_STRATEGIES = ["flow", "ring", "code_beside_data", "timeline", "comparison", "hierarchy", "chart"] as const;
export type LayoutStrategy = (typeof LAYOUT_STRATEGIES)[number];

export const LAYOUT_MEANING: Record<LayoutStrategy, string> = {
  flow: "entities in a grid of columns and rows, left to right in the order a request or process moves (also a row of array cells, or layers)",
  ring: "peers in a ring, in the order of their column number",
  code_beside_data: "a code panel beside the table or log it changes, with any entities above",
  timeline: "a timeline across the arena, with any actors above it",
  comparison: "a comparison matrix in the middle, with any entities above it",
  hierarchy: "a tree or grouped structure in the middle, with any entities above it",
  chart: "a chart in the middle, with any entities above it",
};

/** What the explanation is fundamentally about; it decides the representation. */
export const EXPLANATION_TYPES = ["mechanism", "chronology", "comparison", "hierarchy", "decision", "quantitative"] as const;
export type ExplanationType = (typeof EXPLANATION_TYPES)[number];

export const REPRESENTATIONS = [
  "actors_and_messages",
  "code_trace",
  "data_structure",
  "timeline",
  "comparison",
  "hierarchy",
  "chart",
] as const;
export type Representation = (typeof REPRESENTATIONS)[number];

/** Representations that suit each explanation type. Checked deterministically after planning. */
export const REPRESENTATIONS_FOR_TYPE: Record<ExplanationType, readonly Representation[]> = {
  mechanism: ["actors_and_messages", "code_trace", "data_structure", "hierarchy"],
  chronology: ["timeline", "actors_and_messages"],
  comparison: ["comparison", "chart"],
  hierarchy: ["hierarchy"],
  decision: ["hierarchy", "comparison", "actors_and_messages"],
  quantitative: ["chart", "data_structure"],
};

/** Layouts that fit each representation. */
export const LAYOUTS_FOR_REPRESENTATION: Record<Representation, readonly LayoutStrategy[]> = {
  actors_and_messages: ["flow", "ring"],
  code_trace: ["code_beside_data"],
  data_structure: ["flow", "code_beside_data"],
  timeline: ["timeline"],
  comparison: ["comparison"],
  hierarchy: ["hierarchy"],
  chart: ["chart"],
};

/** The panel each representation is built around (none: nodes and messages carry it). */
export const PANEL_FOR_REPRESENTATION: Record<Representation, readonly PanelKind[] | null> = {
  actors_and_messages: null,
  code_trace: ["code"],
  data_structure: ["log", "table"],
  timeline: ["timeline"],
  comparison: ["comparison"],
  hierarchy: ["hierarchy"],
  chart: ["chart"],
};

export const DEPTHS = ["overview", "standard", "detailed"] as const;
export type Depth = (typeof DEPTHS)[number];

/** Offered in the form; the planner also accepts other languages typed into the topic. */
export const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Italian",
  "Dutch",
  "Polish",
  "Bulgarian",
  "Ukrainian",
  "Turkish",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
  "Hindi",
  "Arabic",
] as const;

/** Where a claim comes from. Only `source` claims are backed by a located excerpt. */
export const CLAIM_BASES = ["source", "interpretation", "assumption"] as const;
export type ClaimBasis = (typeof CLAIM_BASES)[number];

export const TIMELINE_SPACING = ["ordered", "proportional"] as const;
/** `unknown`: the event has a date that is not known. `none`: a stage of a process, with no date at all. */
export const DATE_PRECISION = ["exact", "approximate", "unknown", "none"] as const;
/** Typed links between timeline events; time order alone never implies them. */
export const TIMELINE_RELATIONS = ["causes", "enables", "responds_to"] as const;

/** What a line from a child up to its parent means. */
export const HIERARCHY_RELATIONS = ["part_of", "kind_of", "reports_to", "member_of"] as const;
export const HIERARCHY_STYLES = ["tree", "groups"] as const;
/** Static cross-links in a hierarchy; never drawn as traveling messages. */
export const HIERARCHY_LINKS = ["depends_on", "uses", "related_to"] as const;

export const CHART_TYPES = ["bar", "line"] as const;
/** Observed data comes from the supplied material; illustrative data is a made-up example. */
export const CHART_DATA = ["observed", "illustrative"] as const;

export const COMPARISON_MISSING = ["unknown", "not_applicable"] as const;

/** How a beat's event relates to what came before. Time order alone is "sequence". */
export const BEAT_CONNECTIONS = ["sequence", "causes", "enables", "communication", "contrast", "none"] as const;

/** When a step's node and panel changes appear relative to its messages. */
export const STEP_TIMINGS = ["changes_first", "messages_first"] as const;
export const NODE_STATUSES = ["active", "inactive"] as const;

/**
 * Semantic color tokens. The renderer maps each token to application-owned
 * colors; generated content never supplies a raw color, class, or style.
 */
export const COLOR_TOKENS = [
  "neutral",
  "primary",
  "secondary",
  "success",
  "warning",
  "danger",
] as const;

export const COLOR_MEANING: Record<(typeof COLOR_TOKENS)[number], string> = {
  neutral: "ordinary entity with no special role in this step",
  primary: "the entity the current step is about",
  secondary: "a contrasting or supporting role",
  success: "completed, agreed, found, or healthy",
  warning: "pending, contested, or waiting",
  danger: "failed, rejected, or conflicting",
};
