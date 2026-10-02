import type {
  Action,
  Anchor,
  CardEntity,
  Cell,
  CursorEntity,
  Entity,
  EntityPatch,
  Ink,
  LinkEntity,
  LogEntity,
  Look,
  NodeEntity,
  Step,
  TextEntity,
  Tone,
} from "./types";

/**
 * Small constructors for writing stories by hand. They only build plain story
 * data; `after` is the delay in ms from the previous step in the same list.
 */

const step = (action: Action, after: number): Step => ({ ...action, after });

type Extra<T, K extends keyof T> = Partial<Omit<T, "kind" | "id" | K>>;

export const node = (id: string, x: number, y: number, fill: Ink, extra: Extra<NodeEntity, "x" | "y" | "fill"> = {}): NodeEntity => ({
  kind: "node",
  id,
  x,
  y,
  fill,
  ...extra,
});

export const log = (id: string, x: number, y: number, cells: Cell[], extra: Extra<LogEntity, "x" | "y" | "cells"> = {}): LogEntity => ({
  kind: "log",
  id,
  x,
  y,
  cells,
  ...extra,
});

export const card = (id: string, x: number, y: number, cells: Cell[], extra: Extra<CardEntity, "x" | "y" | "cells"> = {}): CardEntity => ({
  kind: "card",
  id,
  x,
  y,
  cells,
  ...extra,
});

export const text = (id: string, x: number, y: number, value: string, extra: Extra<TextEntity, "x" | "y" | "text"> = {}): TextEntity => ({
  kind: "text",
  id,
  x,
  y,
  text: value,
  ...extra,
});

export const cursor = (id: string, logId: string, index: number, ink: Ink, label?: string): CursorEntity =>
  label === undefined ? { kind: "cursor", id, log: logId, index, ink } : { kind: "cursor", id, log: logId, index, ink, label };

export const link = (id: string, from: string, to: string, dashed = false): LinkEntity => ({ kind: "link", id, from, to, dashed });

/** Cells from texts, optionally tagged with offsets counting from `firstOffset`. */
export function records(texts: string[], options: { tone?: Tone; firstOffset?: number } = {}): Cell[] {
  return texts.map((value, i) => ({
    text: value,
    ...(options.tone ? { tone: options.tone } : {}),
    ...(options.firstOffset !== undefined ? { tag: String(options.firstOffset + i) } : {}),
  }));
}

/** Card lines; a line may carry a tone as `[text, tone]`. */
export const lines = (...items: (string | [string, Tone])[]): Cell[] =>
  items.map((item) => (typeof item === "string" ? { text: item } : { text: item[0], tone: item[1] }));

export const packet = (value: string, ink?: Ink): Look => (ink ? { shape: "packet", text: value, ink } : { shape: "packet", text: value });
export const dot = (ink: Ink, hollow = false): Look => (hollow ? { shape: "dot", ink, hollow } : { shape: "dot", ink });

export const add = (entity: Entity, after = 0) => step({ do: "add", entity }, after);
export const remove = (ids: string | string[], after = 0) => step({ do: "remove", ids: typeof ids === "string" ? [ids] : ids }, after);
export const set = (id: string, patch: EntityPatch, after = 0) => step({ do: "set", id, patch }, after);
export const append = (to: string, cells: Cell | Cell[], after = 0) =>
  step({ do: "append", to, cells: Array.isArray(cells) ? cells : [cells] }, after);
export const tone = (of: string, index: number, value: Tone, after = 0) => step({ do: "cell", of, index, patch: { tone: value } }, after);
export const retext = (of: string, index: number, patch: Partial<Cell>, after = 0) => step({ do: "cell", of, index, patch }, after);
export const truncate = (of: string, keep: number, after = 0) => step({ do: "truncate", of, keep }, after);
export const zoom = (ids: string[] | null, after = 0, pad?: number) =>
  step(pad === undefined ? { do: "zoom", ids } : { do: "zoom", ids, pad }, after);
export const timer = (id: string, duration: number, after = 0) => step({ do: "timer", id, duration }, after);

export const send = (from: Anchor, to: Anchor, look: Look, options: { after?: number; duration?: number; then?: Step[] } = {}): Step => {
  const { after = 0, duration, then } = options;
  return step(
    { do: "send", from, to, look, ...(duration !== undefined ? { duration } : {}), ...(then ? { then } : {}) },
    after,
  );
};
