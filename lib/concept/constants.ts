/**
 * Application-owned constants for the scene contract.
 *
 * These numbers are shared by the Zod schema, the deterministic validator, the
 * SVG renderer, the generator prompt, and the docs. Change them here only.
 */

export const SCHEMA_VERSION = 1 as const;

/** Logical arena. Node coordinates are node centers in these units. */
export const ARENA = {
  width: 1000,
  height: 600,
  /** Nothing (node, label) may be drawn closer than this to the arena edge. */
  safeMargin: 16,
} as const;

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
  steps: { min: 4, max: 12 },
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
  /** UTF-8 bytes of the serialized concept JSON. */
  payloadBytes: 64_000,
  /** UTF-8 bytes of the POST /api/generate request body. */
  requestBodyBytes: 2_048,
} as const;

/** Stable identifiers: letters, digits, `_` and `-`; must start with a letter or digit. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const NODE_SHAPES = ["circle", "square"] as const;

/**
 * Panels show data next to the nodes: a log of records, lines of code, a
 * table, or a timeline of events. Their size follows from their content
 * (see `panelLayout` in geometry.ts); coordinates are the panel center.
 */
export const PANEL_KINDS = ["log", "code", "table", "timeline"] as const;

/** Panel geometry in arena units, shared by the validator and the renderer. */
export const PANEL = {
  title: 24,
  record: { width: 72, height: 44, tag: 18 },
  code: { gutter: 34, charWidth: 9.6, lineHeight: 24, padding: 10, minChars: 12 },
  table: { column: 92, rowLabel: 92, header: 30, row: 34 },
  /** 10 events × 92 = 920 units: a full timeline fits the arena's usable width. */
  timeline: { spacing: 92, date: 20, axis: 16, text: 40 },
} as const;

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
