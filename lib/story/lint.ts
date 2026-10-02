import { INK } from "./palette";
import { currentEntity, emptyWorld, schedule, settle, worldAt, type World } from "./engine";
import { entityBox, monoHeight, monoWidth, SIZE, type Box } from "./geometry";
import type { Action, Anchor, Entity, EntityKind, Story } from "./types";

/**
 * Static checks for a story: unique chapter ids, references to entities that
 * exist when the action runs, fields that fit the entity kind, caption markup,
 * links, and a conservative check that everything is drawn inside the stage.
 */

const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const INK_SPAN = /\[[^\]|]+\|([a-z]+)\]/g;

const PATCH_FIELDS: Record<EntityKind, readonly string[]> = {
  node: ["x", "y", "r", "fill", "ring", "shape", "value", "desc", "descAt"],
  log: ["x", "y", "cellW", "cellH", "dir", "label"],
  cursor: ["index", "label", "ink"],
  card: ["x", "y", "font"],
  text: ["x", "y", "text", "ink", "font", "anchor"],
  link: ["from", "to", "dashed", "label"],
  panel: ["x", "y", "title", "columns", "rows", "frame", "box", "scale", "links", "note"],
};

/** Upper bound of everything drawn for an entity, including labels, in domain units. */
export function footprint(entity: Entity, world: World): Box | null {
  const box = entityBox(entity);
  switch (entity.kind) {
    case "node": {
      if (!box || !entity.desc?.length) return box;
      const width = monoWidth(Math.max(...entity.desc.map((line) => line.length)), SIZE.descFont);
      const height = monoHeight(entity.desc.length + 0.5, SIZE.descFont);
      const x0 = Math.min(box.x0, entity.x - width / 2);
      const x1 = Math.max(box.x1, entity.x + width / 2);
      return entity.descAt === "below" ? { x0, x1, y0: box.y0, y1: box.y1 + height } : { x0, x1, y0: box.y0 - height, y1: box.y1 };
    }
    case "log": {
      if (!box) return null;
      const tags = entity.cells.some((cell) => cell.tag !== undefined) ? monoHeight(1, (entity.cellH ?? SIZE.cellH) * 1.05) : 0;
      const label = entity.label && entity.dir !== "column" ? monoWidth(entity.label.length + 1, 6) : 0;
      return { ...box, x0: box.x0 - label, y0: box.y0 - tags };
    }
    case "cursor": {
      const target = world.live.get(entity.log)?.entity;
      if (!target || target.kind !== "log") return null;
      const h = target.cellH ?? SIZE.cellH;
      const w = target.cellW ?? SIZE.cellW;
      const x = target.x + (entity.index + 0.5) * w;
      const y = target.y + h + 3 + (entity.label ? monoHeight(1.5, 7) : 0);
      return { x0: x - 1.5, y0: target.y + h, x1: x + 1.5, y1: y };
    }
    default:
      return box;
  }
}

/**
 * `bounds: false` skips the worst-case "stays on stage" check, for stories
 * converted from generated explanations, whose layout was validated against
 * the old arena instead.
 */
export function lintStory(story: Story, options: { bounds?: boolean } = {}): string[] {
  const checkBounds = options.bounds ?? true;
  const issues: string[] = [];
  const chapterIds = new Set<string>();

  for (const chapter of story.chapters) {
    if (!ID.test(chapter.id)) issues.push(`chapter id "${chapter.id}" is not URL-safe`);
    if (chapterIds.has(chapter.id)) issues.push(`duplicate chapter id "${chapter.id}"`);
    chapterIds.add(chapter.id);
    if (chapter.beats.length === 0) issues.push(`${chapter.id}: no beats`);

    let world = emptyWorld();
    chapter.beats.forEach((beat, b) => {
      const where = `${chapter.id} beat ${b + 1}`;
      if (!beat.say && !beat.title) issues.push(`${where}: needs a caption or a title`);
      for (const match of (beat.plain ? "" : (beat.say ?? "")).matchAll(INK_SPAN)) {
        if (!Object.hasOwn(INK, match[1]!)) issues.push(`${where}: unknown ink "${match[1]}" in caption`);
      }
      for (const link of beat.links ?? []) {
        if (!link.href.startsWith("https://")) issues.push(`${where}: link "${link.text}" must use https`);
      }

      const items = schedule(beat.run);
      // Check each action against the scene as it is just before the action runs.
      items.forEach((item, i) => {
        const before = worldAt(world, items.slice(0, i), Infinity);
        for (const problem of checkAction(item.action, before)) issues.push(`${where}: ${problem}`);
      });

      const after = worldAt(world, items, Infinity);
      for (const [id, live] of after.live) {
        if (!checkBounds || live.dying !== null) continue;
        const entity = currentEntity(live);
        const box = footprint(entity, after);
        if (box && (box.x0 < 0 || box.y0 < 0 || box.x1 > 100 || box.y1 > 100)) {
          const f = (n: number) => n.toFixed(1);
          issues.push(`${where}: "${id}" may be drawn outside the stage (${f(box.x0)},${f(box.y0)} → ${f(box.x1)},${f(box.y1)})`);
        }
      }
      world = settle(after);
    });
  }
  return issues;
}

function checkAction(action: Action, world: World): string[] {
  const alive = (id: string) => {
    const live = world.live.get(id);
    return live && live.dying === null ? live : null;
  };
  const need = (id: string, kinds?: EntityKind[]) => {
    const live = alive(id);
    if (!live) return [`"${id}" does not exist`];
    if (kinds && !kinds.includes(live.entity.kind)) return [`"${id}" is a ${live.entity.kind}, expected ${kinds.join(" or ")}`];
    return [];
  };
  const anchor = (a: Anchor) => {
    if (typeof a === "string") return need(a, ["node", "card", "text", "log", "panel"]);
    const problems = need(a.log, ["log"]);
    const live = alive(a.log);
    if (live && typeof a.index === "number" && (a.index < 0 || a.index >= live.cells.length)) {
      problems.push(`"${a.log}" has no cell ${a.index}`);
    }
    return problems;
  };

  switch (action.do) {
    case "add": {
      const { entity } = action;
      const problems: string[] = [];
      if (!ID.test(entity.id)) problems.push(`id "${entity.id}" is not a plain identifier`);
      if (alive(entity.id)) problems.push(`"${entity.id}" is added twice`);
      if (entity.kind === "cursor") problems.push(...need(entity.log, ["log"]));
      if (entity.kind === "link") problems.push(...need(entity.from), ...need(entity.to));
      return problems;
    }
    case "remove":
      return action.ids.flatMap((id) => need(id));
    case "set": {
      const live = alive(action.id);
      if (!live) return [`"${action.id}" does not exist`];
      const allowed = PATCH_FIELDS[live.entity.kind];
      return Object.keys(action.patch)
        .filter((key) => !allowed.includes(key))
        .map((key) => `"${action.id}" (${live.entity.kind}) has no field "${key}"`);
    }
    case "append":
      return need(action.to, ["log", "card", "panel"]);
    case "cell": {
      const problems = need(action.of, ["log", "card", "panel"]);
      const live = alive(action.of);
      if (live) {
        const index = action.index < 0 ? live.cells.length + action.index : action.index;
        if (index < 0 || index >= live.cells.length) problems.push(`"${action.of}" has no cell ${action.index}`);
      }
      return problems;
    }
    case "truncate":
      return need(action.of, ["log", "card", "panel"]);
    case "cells":
      return need(action.of, ["panel"]);
    case "send":
      return [...anchor(action.from), ...anchor(action.to)];
    case "zoom":
      return (action.ids ?? []).flatMap((id) => need(id));
    case "timer":
      return need(action.id, ["node"]);
  }
}
