import { entityBox, FULL_BOX, unionBox, type Box } from "./geometry";
import type { Action, Anchor, Beat, Cell, Entity, Look, Step, Story } from "./types";

/**
 * Timeline engine for stories.
 *
 * A beat's script is flattened into timed actions. The scene at time `t`
 * (ms since the beat started) is a pure function of the beat's starting
 * snapshot and the actions due by `t`, so replaying, skipping to the end, and
 * jumping between chapters never depend on what was on screen before.
 * Animated values (positions, camera, fades) are stored as tweens and
 * evaluated at render time.
 */

/** Default message travel time, as in the original. */
export const LATENCY = 1000;
/** Duration of position, size, and camera transitions. */
export const TWEEN = 500;
/** Fade-out duration for removed entities. */
export const FADE = 400;

export type Tween = { from: number; to: number; at: number };
type TweenKey = "x" | "y" | "r" | "index";
const TWEEN_KEYS: readonly TweenKey[] = ["x", "y", "r", "index"];

export type LiveCell = Cell & { born: number };

export type Live = {
  entity: Entity;
  born: number;
  /** Time the entity was removed; it fades out and is dropped at the next beat. */
  dying: number | null;
  tweens: Partial<Record<TweenKey, Tween>>;
  /** Current cells of a log or card; empty for other kinds. */
  cells: LiveCell[];
  timer: { start: number; duration: number } | null;
};

export type Message = { key: number; from: Anchor; to: Anchor; look: Look; sent: number; arrives: number };

export type World = {
  /** Insertion-ordered, which is also drawing order within a kind. */
  live: Map<string, Live>;
  messages: Message[];
  camera: { from: Box; to: Box; at: number };
};

export type Scheduled = { at: number; action: Action; key: number };

export function emptyWorld(): World {
  return { live: new Map(), messages: [], camera: { from: FULL_BOX, to: FULL_BOX, at: -Infinity } };
}

/** D3 v3's default "cubic-in-out", which the original used for every transition. */
export function ease(p: number): number {
  const t = p * 2;
  return t <= 1 ? (t * t * t) / 2 : ((t - 2) * (t - 2) * (t - 2) + 2) / 2;
}

export function progress(t: number, at: number, duration: number): number {
  if (t <= at) return 0;
  if (t >= at + duration) return 1;
  return (t - at) / duration;
}

export function tweenValue(tween: Tween | undefined, settled: number, t: number): number {
  if (!tween) return settled;
  return tween.from + (tween.to - tween.from) * ease(progress(t, tween.at, TWEEN));
}

/** Current value of an animated numeric field. */
export function liveValue(live: Live, key: TweenKey, t: number): number {
  const settled = (live.entity as Record<string, unknown>)[key];
  return tweenValue(live.tweens[key], typeof settled === "number" ? settled : 0, t);
}

export function cameraAt(world: World, t: number): Box {
  const { from, to, at } = world.camera;
  const p = ease(progress(t, at, TWEEN));
  return {
    x0: from.x0 + (to.x0 - from.x0) * p,
    y0: from.y0 + (to.y0 - from.y0) * p,
    x1: from.x1 + (to.x1 - from.x1) * p,
    y1: from.y1 + (to.y1 - from.y1) * p,
  };
}

/** Flatten a beat's script into actions with absolute times, in run order. */
export function schedule(steps: readonly Step[] = []): Scheduled[] {
  const out: Scheduled[] = [];
  const walk = (list: readonly Step[], start: number) => {
    let t = start;
    for (const step of list) {
      t += step.after ?? 0;
      out.push({ at: t, action: step, key: out.length });
      if (step.do === "send" && step.then) walk(step.then, t + (step.duration ?? LATENCY));
    }
  };
  walk(steps, 0);
  return out.sort((a, b) => a.at - b.at || a.key - b.key);
}

/** Time at which everything a schedule starts has finished moving. */
export function scheduleEnd(items: readonly Scheduled[]): number {
  let end = 0;
  for (const { at, action } of items) {
    const until =
      action.do === "send"
        ? at + (action.duration ?? LATENCY)
        : action.do === "timer"
          ? at + action.duration
          : action.do === "remove"
            ? at + FADE
            : at + TWEEN;
    end = Math.max(end, until);
  }
  return end;
}

/** Entities whose cells can be appended to, changed, and truncated. */
export const hasCells = (entity: Entity): entity is Extract<Entity, { cells: Cell[] }> =>
  entity.kind === "log" || entity.kind === "card" || entity.kind === "panel";

const cellsOf = (entity: Entity): readonly Cell[] => (hasCells(entity) ? entity.cells : []);

/** The entity with its current cells, for measuring. */
export function currentEntity(live: Live): Entity {
  return hasCells(live.entity) ? { ...live.entity, cells: live.cells } : live.entity;
}

function cloneWorld(world: World): World {
  return { live: new Map(world.live), messages: [...world.messages], camera: world.camera };
}

/** Copy-on-write access to a live entity. */
function touch(world: World, id: string): Live | null {
  const live = world.live.get(id);
  if (!live) return null;
  const copy = { ...live, tweens: { ...live.tweens }, cells: [...live.cells] };
  world.live.set(id, copy);
  return copy;
}

function resolveIndex(index: number, length: number): number {
  return index < 0 ? length + index : index;
}

function apply(world: World, { at, action, key }: Scheduled): void {
  switch (action.do) {
    case "add": {
      const { entity } = action;
      world.live.delete(entity.id);
      world.live.set(entity.id, {
        entity,
        born: at,
        dying: null,
        tweens: {},
        cells: cellsOf(entity).map((cell) => ({ ...cell, born: at })),
        timer: null,
      });
      return;
    }
    case "remove":
      for (const id of action.ids) {
        const live = touch(world, id);
        if (live && live.dying === null) live.dying = at;
      }
      return;
    case "set": {
      const live = touch(world, action.id);
      if (!live) return;
      for (const field of TWEEN_KEYS) {
        const to = action.patch[field];
        if (typeof to === "number") live.tweens[field] = { from: liveValue(live, field, at), to, at };
      }
      live.entity = { ...live.entity, ...action.patch } as Entity;
      return;
    }
    case "append": {
      const live = touch(world, action.to);
      if (live) live.cells.push(...action.cells.map((cell) => ({ ...cell, born: at })));
      return;
    }
    case "cell": {
      const live = touch(world, action.of);
      if (!live) return;
      const i = resolveIndex(action.index, live.cells.length);
      const cell = live.cells[i];
      if (cell) live.cells[i] = { ...cell, ...action.patch };
      return;
    }
    case "truncate": {
      const live = touch(world, action.of);
      if (live) live.cells = live.cells.slice(0, action.keep);
      return;
    }
    case "send":
      world.messages.push({
        key,
        from: action.from,
        to: action.to,
        look: action.look,
        sent: at,
        arrives: at + (action.duration ?? LATENCY),
      });
      return;
    case "zoom": {
      let to = FULL_BOX;
      if (action.ids) {
        const boxes = action.ids.flatMap((id) => {
          const live = world.live.get(id);
          const box = live ? entityBox(currentEntity(live)) : null;
          return box ? [box] : [];
        });
        const union = unionBox(boxes);
        const pad = action.pad ?? 2;
        if (union) to = { x0: union.x0 - pad, y0: union.y0 - pad, x1: union.x1 + pad, y1: union.y1 + pad };
      }
      world.camera = { from: cameraAt(world, at), to, at };
      return;
    }
    case "timer": {
      const live = touch(world, action.id);
      if (live) live.timer = { start: at, duration: action.duration };
      return;
    }
  }
}

/** The scene `t` ms into a beat that started from `start`. */
export function worldAt(start: World, items: readonly Scheduled[], t: number): World {
  const world = cloneWorld(start);
  for (const item of items) {
    if (item.at > t) break;
    apply(world, item);
  }
  return world;
}

/** The finished state of a beat, used as the next beat's starting snapshot. */
export function settle(world: World): World {
  const live = new Map<string, Live>();
  for (const [id, entry] of world.live) {
    if (entry.dying !== null) continue;
    live.set(id, {
      entity: entry.entity,
      born: -Infinity,
      dying: null,
      tweens: {},
      cells: entry.cells.map((cell) => ({ ...cell, born: -Infinity })),
      timer: null,
    });
  }
  return { live, messages: [], camera: { from: world.camera.to, to: world.camera.to, at: -Infinity } };
}

export type CompiledBeat = {
  chapter: number;
  beat: Beat;
  items: Scheduled[];
  /** Time at which the beat's script has finished, in ms. */
  end: number;
  start: World;
};

export type CompiledStory = {
  beats: CompiledBeat[];
  chapters: { id: string; title: string; first: number }[];
};

/** Precompute every beat's schedule and starting snapshot. Each chapter starts from an empty stage. */
export function compileStory(story: Story): CompiledStory {
  const beats: CompiledBeat[] = [];
  const chapters: CompiledStory["chapters"] = [];
  story.chapters.forEach((chapter, c) => {
    chapters.push({ id: chapter.id, title: chapter.title, first: beats.length });
    let world = emptyWorld();
    for (const beat of chapter.beats) {
      const items = schedule(beat.run);
      beats.push({ chapter: c, beat, items, end: scheduleEnd(items), start: world });
      world = settle(worldAt(world, items, Infinity));
    }
  });
  return { beats, chapters };
}
