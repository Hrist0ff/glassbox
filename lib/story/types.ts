import type { PanelKind } from "@/lib/concept/constants";
import type { Frame } from "@/lib/concept/frames";

/**
 * Story format for the full-screen, narrated player (`components/story`).
 *
 * Modeled on "The Secret Lives of Data": a story is a list of chapters, each
 * chapter a list of beats, and each beat shows one sentence while a short,
 * timed script changes the scene (add a node, send a message, append a log
 * record, zoom the camera). The reader presses Continue between beats.
 *
 * Stories are plain data, never code: every visual property is a token that
 * the renderer maps through `palette.ts`.
 *
 * Coordinates are in a 0–100 domain on both axes, mapped to the stage's
 * width and height. Sizes (radius, cell size) and font sizes are in "size
 * units": the smaller of the two axis scales, so circles stay round.
 */

/** Fill and text colors. Mapped to concrete colors in `palette.ts`. */
export type Ink = "steelblue" | "green" | "red" | "orange" | "purple" | "gray" | "black";

/** Text tone for log cells, card lines, and panel cells. */
export type Tone = "normal" | "pending" | "muted" | "focus" | "good" | "bad" | "warn" | "alt";

/**
 * Outline of a node. `solid` and `dashed` follow Raft's leader and candidate
 * conventions from the original visualization.
 */
export type Ring = "none" | "solid" | "dashed";

export type NodeEntity = {
  kind: "node";
  id: string;
  /** Center, in domain units. */
  x: number;
  y: number;
  /** Radius in size units. Default 5. */
  r?: number;
  fill: Ink;
  ring?: Ring;
  /** Default circle. Squares stand for data, such as array cells, in converted explanations. */
  shape?: "circle" | "square";
  /** Short text drawn inside the shape (a few characters). */
  value?: string;
  /** Monospace lines drawn above or below the node. */
  desc?: string[];
  descAt?: "above" | "below";
};

/** What a cell of a converted panel stands for; read by the panel renderers. */
export type CellMeta =
  | { panel: "timeline"; lane: number; date: "exact" | "approximate" | "unknown" | "none"; end: boolean }
  | { panel: "comparison"; criterion: string; alternative: number; missing: "unknown" | "not_applicable" | null }
  | { panel: "hierarchy"; parent: string | null }
  | { panel: "chart"; series: number; category: number; value: number | null };

/** One record in a log, or one line in a card. */
export type Cell = {
  text: string;
  tone?: Tone;
  /** Small label above a log cell, usually its offset. */
  tag?: string;
  /** Highlighted line, e.g. the line of code being run. */
  mark?: boolean;
  /** Identity across steps in panels whose items are matched by key (timeline events, hierarchy items, …). */
  key?: string;
  meta?: CellMeta;
};

/** A sequence of boxed records, like a Raft or Kafka log. */
export type LogEntity = {
  kind: "log";
  id: string;
  /** Top-left corner of the first cell, in domain units. */
  x: number;
  y: number;
  /** Cell width and height in size units. Defaults 7 × 6. */
  cellW?: number;
  cellH?: number;
  dir?: "row" | "column";
  /** Monospace label drawn before the first cell. */
  label?: string;
  cells: Cell[];
};

/** A small pointer under (row logs) or beside (column logs) one log cell. */
export type CursorEntity = {
  kind: "cursor";
  id: string;
  log: string;
  /** Cell index the cursor points at. May equal the log length (the next free slot). */
  index: number;
  label?: string;
  ink: Ink;
};

/** A boxed block of monospace lines, e.g. the text of an HTTP request. */
export type CardEntity = {
  kind: "card";
  id: string;
  /** Center, in domain units. */
  x: number;
  y: number;
  /** Font size in size units. Default 5. */
  font?: number;
  cells: Cell[];
};

/** Free-standing text label. */
export type TextEntity = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  ink?: Ink;
  /** Font size in size units. Default 7. */
  font?: number;
  anchor?: "start" | "middle" | "end";
};

/** A thin line between two entities, e.g. an open connection. */
export type LinkEntity = {
  kind: "link";
  id: string;
  from: string;
  to: string;
  dashed?: boolean;
  /** Short monospace label at the middle of the line. */
  label?: string;
};

/**
 * Data shown next to the nodes in converted explanations: a log, code, a
 * table, or a timeline. Unlike the size-unit entities above, a panel fills an
 * exact box whose size follows from its content (arena units, see
 * `panelSize` in lib/concept/geometry.ts), stretched with the stage like
 * node positions, so what the validator checked is what is drawn.
 */
export type PanelEntity = {
  kind: "panel";
  id: string;
  variant: PanelKind;
  /** Center, in domain units. */
  x: number;
  y: number;
  title: string;
  /** Tables only: column headings, and row headings ("" for none). */
  columns?: string[];
  rows?: string[];
  /** Records, events, lines of code, table cells row by row, or the keyed items of the other panels. */
  cells: Cell[];
  /**
   * Stable drawing of a timeline (version 2), comparison, hierarchy, or
   * chart, built from everything the panel shows across the explanation.
   */
  frame?: Frame;
  /** Reserved size in arena units for a laid-out log, code, or table panel; content starts at its top-left. */
  box?: { width: number; height: number };
  /** Arena units per domain unit. Default 10 × 6 (the landscape arena). */
  scale?: { x: number; y: number };
  /** Typed links between items, by key: timeline relations, hierarchy cross-links. */
  links?: { from: string; to: string; type: string }[];
  /** One line under a chart saying where its numbers come from. */
  note?: string;
};

export type Entity = NodeEntity | LogEntity | CursorEntity | CardEntity | TextEntity | LinkEntity | PanelEntity;
export type EntityKind = Entity["kind"];

/** Fields that `set` may change. Which ones apply depends on the entity kind. */
export type EntityPatch = Partial<
  Omit<NodeEntity, "kind" | "id"> &
    Omit<LogEntity, "kind" | "id" | "cells"> &
    Omit<CursorEntity, "kind" | "id" | "log"> &
    Omit<TextEntity, "kind" | "id"> &
    Omit<LinkEntity, "kind" | "id"> &
    Omit<PanelEntity, "kind" | "id" | "variant" | "cells">
>;

/** Where a message starts or ends: an entity's center, or one cell of a log. */
export type Anchor = string | { log: string; index: number | "end" };

export type Look =
  /** A colored dot; hollow dots are replies, as in the original. */
  | { shape: "dot"; ink: Ink; hollow?: boolean }
  /** A small boxed label that travels, e.g. "GET /". */
  | { shape: "packet"; text: string; ink?: Ink };

export type Action =
  | { do: "add"; entity: Entity }
  | { do: "remove"; ids: string[] }
  | { do: "set"; id: string; patch: EntityPatch }
  | { do: "append"; to: string; cells: Cell[] }
  /** Change one cell of a log or card. A negative index counts from the end. */
  | { do: "cell"; of: string; index: number; patch: Partial<Cell> }
  /** Remove cells from the end of a log or card, keeping the first `keep`. */
  | { do: "truncate"; of: string; keep: number }
  /** Replace a panel's cells; cells whose `key` was already shown keep their age, new ones fade in. */
  | { do: "cells"; of: string; cells: Cell[] }
  | {
      do: "send";
      from: Anchor;
      to: Anchor;
      look: Look;
      /** Travel time in ms. Default `LATENCY`. */
      duration?: number;
      /** Steps that run when the message arrives, timed from arrival. */
      then?: Step[];
    }
  /** Fit the camera to these entities, or back to the whole stage with `null`. */
  | { do: "zoom"; ids: string[] | null; pad?: number }
  /** Draw a filling arc inside a node for `duration` ms, e.g. "processing". */
  | { do: "timer"; id: string; duration: number };

/** An action, run `after` ms after the previous step in the same list starts. */
export type Step = Action & { after?: number };

export type Beat = {
  /** Caption at the bottom of the stage. Supports `*em*`, `` `code` `` and `[text|ink]`. */
  say?: string;
  /** Show `say` exactly as written, without caption markup. Used for generated text. */
  plain?: boolean;
  /** Caption size: `lg` is the original's h2, `md` its h3. Default `lg`. */
  size?: "lg" | "md";
  /** Centered title card, used to open chapters. */
  title?: { heading: string; sub?: string };
  /** Reference links shown under the caption. */
  links?: { text: string; href: string }[];
  run?: Step[];
  /** `auto` moves on as soon as the script finishes. Default `click`. */
  next?: "click" | "auto";
  /** Id of the explanation step this beat belongs to (converted explanations), for step-level tools. */
  step?: string;
};

export type Chapter = {
  /** Used as the URL hash, so readers can link to a chapter. */
  id: string;
  title: string;
  beats: Beat[];
};

export type Story = {
  slug: string;
  title: string;
  subtitle: string;
  /** One sentence for the index page and metadata. */
  summary: string;
  chapters: Chapter[];
};
