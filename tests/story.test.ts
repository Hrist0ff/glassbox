import { describe, expect, it } from "vitest";
import { captionText, parseCaption } from "@/lib/story/caption";
import { add, append, node, packet, remove, send, set } from "@/lib/story/dsl";
import { cameraAt, compileStory, emptyWorld, LATENCY, liveValue, schedule, scheduleEnd, settle, TWEEN, worldAt } from "@/lib/story/engine";
import { lintStory } from "@/lib/story/lint";
import type { Story } from "@/lib/story/types";
import { STORIES } from "@/lib/stories";

const a = node("a", 20, 50, "steelblue");
const b = node("b", 80, 50, "green");

describe("schedule", () => {
  it("accumulates `after` delays and times `then` steps from arrival", () => {
    const items = schedule([
      add(a),
      add(b, 300),
      send("a", "b", packet("hi"), { after: 100, duration: 1000, then: [set("b", { value: "!" }, 50)] }),
      set("a", { x: 30 }, 200),
    ]);
    expect(items.map((item) => [item.at, item.action.do])).toEqual([
      [0, "add"],
      [300, "add"],
      [400, "send"],
      [600, "set"],
      [1450, "set"],
    ]);
  });

  it("ends after the last arrival or transition", () => {
    expect(scheduleEnd(schedule([send("a", "b", packet("x"))]))).toBe(LATENCY);
    expect(scheduleEnd(schedule([add(a, 700)]))).toBe(700 + TWEEN);
    expect(scheduleEnd([])).toBe(0);
  });
});

describe("worldAt", () => {
  const start = settle(worldAt(emptyWorld(), schedule([add(a), add(b)]), Infinity));

  it("applies only the actions that are due, without touching the snapshot", () => {
    const items = schedule([set("a", { value: "1" }, 100), remove("b", 500)]);
    expect((worldAt(start, items, 50).live.get("a")!.entity as { value?: string }).value).toBeUndefined();
    expect((worldAt(start, items, 100).live.get("a")!.entity as { value?: string }).value).toBe("1");
    // `after` is relative to the previous step: 100 + 500.
    expect(worldAt(start, items, 599).live.get("b")!.dying).toBeNull();
    expect(worldAt(start, items, 600).live.get("b")!.dying).toBe(600);
    expect(start.live.get("b")!.dying).toBeNull();
    expect(settle(worldAt(start, items, Infinity)).live.has("b")).toBe(false);
  });

  it("tweens positions from where they were when the change started", () => {
    const items = schedule([set("a", { x: 60 })]);
    const live = worldAt(start, items, 0).live.get("a")!;
    expect(liveValue(live, "x", 0)).toBe(20);
    expect(liveValue(live, "x", TWEEN / 2)).toBeCloseTo(40);
    expect(liveValue(live, "x", TWEEN)).toBe(60);
  });

  it("appends cells and keeps in-flight messages until they arrive", () => {
    const withLog = settle(worldAt(start, schedule([add({ kind: "log", id: "l", x: 10, y: 10, cells: [] })]), Infinity));
    const items = schedule([send("a", { log: "l", index: "end" }, packet("r"), { then: [append("l", { text: "r" })] })]);
    const mid = worldAt(withLog, items, LATENCY / 2);
    expect(mid.messages).toHaveLength(1);
    expect(mid.live.get("l")!.cells).toHaveLength(0);
    expect(worldAt(withLog, items, LATENCY).live.get("l")!.cells.map((c) => c.text)).toEqual(["r"]);
  });

  it("zooms the camera to the named entities and back", () => {
    const zoomed = worldAt(start, schedule([{ do: "zoom", ids: ["a"], pad: 0 }]), Infinity);
    expect(cameraAt(zoomed, Infinity)).toEqual({ x0: 15, y0: 45, x1: 25, y1: 55 });
    const back = worldAt(settle(zoomed), schedule([{ do: "zoom", ids: null }]), Infinity);
    expect(cameraAt(back, Infinity)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
  });
});

describe("compileStory", () => {
  it("starts every chapter from an empty stage and carries state between beats", () => {
    const story: Story = {
      slug: "t",
      title: "T",
      subtitle: "t",
      summary: "t",
      chapters: [
        { id: "one", title: "One", beats: [{ say: "a", run: [add(a)] }, { say: "b" }] },
        { id: "two", title: "Two", beats: [{ say: "c" }] },
      ],
    };
    const compiled = compileStory(story);
    expect(compiled.chapters.map((c) => c.first)).toEqual([0, 2]);
    expect(compiled.beats[1]!.start.live.has("a")).toBe(true);
    expect(compiled.beats[2]!.start.live.size).toBe(0);
  });
});

describe("parseCaption", () => {
  it("parses emphasis, code, and palette colors", () => {
    expect(parseCaption("A *log* of `GET /` from the [server|steelblue].")).toEqual([
      { kind: "text", text: "A " },
      { kind: "em", text: "log" },
      { kind: "text", text: " of " },
      { kind: "code", text: "GET /" },
      { kind: "text", text: " from the " },
      { kind: "ink", text: "server", ink: "steelblue" },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps unclosed markers and unknown colors as text", () => {
    expect(captionText("2 * 3 and [x|hotpink]")).toBe("2 * 3 and [x|hotpink]");
    expect(parseCaption("<b>hi</b>")).toEqual([{ kind: "text", text: "<b>hi</b>" }]);
  });
});

describe("bundled stories", () => {
  it.each(STORIES.map((story) => [story.slug, story] as const))("%s passes the story linter", (_, story) => {
    expect(lintStory(story)).toEqual([]);
  });

  it("lint reports missing references, wrong fields, and off-stage layouts", () => {
    const broken: Story = {
      slug: "broken",
      title: "B",
      subtitle: "b",
      summary: "b",
      chapters: [
        {
          id: "one",
          title: "One",
          beats: [
            { say: "x", run: [add(a), set("a", { cells: [] } as never), send("a", "ghost", packet("?"))] },
            { say: "[y|hotpink]", run: [add(node("edge", 98, 50, "green"))] },
          ],
        },
      ],
    };
    expect(lintStory(broken)).toEqual([
      'one beat 1: "a" (node) has no field "cells"',
      'one beat 1: "ghost" does not exist',
      'one beat 2: unknown ink "hotpink" in caption',
      'one beat 2: "edge" may be drawn outside the stage (93.0,45.0 → 103.0,55.0)',
    ]);
  });

  it("have unique slugs", () => {
    expect(new Set(STORIES.map((s) => s.slug)).size).toBe(STORIES.length);
  });
});
