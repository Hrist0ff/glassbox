import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { simpleSize } from "@/lib/concept/frames";
import { centeredBox } from "@/lib/concept/geometry";
import { layoutGenerated, toGeneratedContent } from "@/lib/concept/layout";
import { GeneratedConceptContentSchema, type Concept, type Step } from "@/lib/concept/schema";
import { validateConcept } from "@/lib/concept/validate";
import { cameraAt, compileStory, worldAt } from "@/lib/story/engine";
import { conceptToStory } from "@/lib/story/from-concept";
import { lintStory } from "@/lib/story/lint";
import { panelsConcept } from "./fixtures/panels-concept";

const options = { subtitle: "Test" };
const clone = (): Concept => structuredClone(panelsConcept);
const codes = (concept: Concept) => (validateConcept(concept).ok ? [] : validateConcept(concept).issues.filter((i) => i.severity === "error").map((i) => i.code));

describe("panels in the scene contract", () => {
  it("accepts a concept with every panel kind, message rounds, focus, and timing", () => {
    const result = validateConcept(panelsConcept);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("round-trips through the strict wire format (no coordinates) and the layout engine", () => {
    const wire = toGeneratedContent(panelsConcept);
    expect(GeneratedConceptContentSchema.parse(wire)).toEqual(wire);
    expect(JSON.stringify(wire)).not.toMatch(/"x":|"y":/);
    const { content } = layoutGenerated(wire, "code_beside_data");
    // Everything but positions survives; positions are recomputed and valid.
    const strip = (step: Step) => ({
      ...step,
      nodes: step.nodes.map(({ id, label, shape, color, status }) => ({ id, label, shape, color, status })),
      panels: step.panels?.map(({ x: _x, y: _y, ...panel }) => (void [_x, _y], panel)),
    });
    const original = panelsConcept.steps.map(strip);
    const back = content.steps.map(strip);
    expect(back.map((s) => s.panels?.map((p) => p.id))).toEqual(original.map((s) => s.panels?.map((p) => p.id)));
    expect(back[1]!.nodes).toEqual(original[1]!.nodes);
    expect(back[1]!.edges).toEqual(original[1]!.edges);
    expect(validateConcept({ ...panelsConcept, ...content, layout: "code_beside_data" }).ok).toBe(true);
    expect(() => zodTextFormat(GeneratedConceptContentSchema, "concept_scenes")).not.toThrow();
  });

  it("rejects panels that leave the arena, cover a node, or overlap", () => {
    const outside = clone();
    outside.steps[0]!.panels![0]!.x = 980;
    expect(codes(outside)).toContain("panel_out_of_bounds");

    const covering = clone();
    covering.steps[0]!.panels![1]!.y = 140; // code panel over the nodes
    expect(codes(covering)).toContain("panel_overlaps_node");

    const stacked = clone();
    stacked.steps[2]!.panels![2]!.y = 150; // table over the log
    expect(codes(stacked)).toContain("panels_overlap");
  });

  it("checks table shape, cell text, focus, and empty scenes", () => {
    const ragged = clone();
    const table = ragged.steps[2]!.panels![2]!;
    if (table.kind !== "table") throw new Error("expected a table");
    table.rows[0]!.cells.pop();
    expect(codes(ragged)).toContain("table_shape");

    const wordy = clone();
    const log = wordy.steps[1]!.panels![0]!;
    if (log.kind !== "log") throw new Error("expected a log");
    log.items[0]!.text = "a very long record";
    expect(codes(wordy)).toContain("cell_text_too_long");

    const lost = clone();
    lost.steps[2]!.focus = ["nowhere"];
    expect(codes(lost)).toContain("unknown_focus");

    const empty = clone();
    empty.steps[3] = { ...empty.steps[3]!, nodes: [], panels: [], edges: [] };
    expect(codes(empty)).toContain("empty_scene");
  });

  it("lets messages start or end at a panel, but not at an unknown id", () => {
    const bad = clone();
    bad.steps[1]!.edges[2]!.to = "ghost";
    expect(codes(bad)).toContain("unknown_edge_endpoint");
  });
});

describe("panels in the story player", () => {
  const story = conceptToStory(panelsConcept, options);
  const compiled = compileStory(story);
  const stepBeats = compiled.beats.filter((b) => b.chapter === 1 && b.beat.run !== undefined);
  const end = (i: number) => worldAt(stepBeats[i]!.start, stepBeats[i]!.items, Infinity);

  it("converts into a story that only refers to things on stage", () => {
    expect(lintStory(story, { bounds: false })).toEqual([]);
  });

  it("appends records and moves the highlighted line instead of redrawing", () => {
    const request = stepBeats[1]!;
    const actions = request.items.map((item) => item.action.do);
    expect(actions).toContain("append");
    expect(actions).not.toContain("remove");
    const handler = end(1).live.get("p-handler")!;
    expect(handler.cells.map((c) => Boolean(c.mark))).toEqual([false, false, false, false, true, false]);
    expect(end(1).live.get("p-requests")!.cells.map((c) => c.text)).toEqual(["GET /a"]);
  });

  it("sends replies after requests arrive, and changes the scene after messages in messages_first steps", () => {
    const items = stepBeats[1]!.items;
    const sends = items.filter((i) => i.action.do === "send");
    const request = sends.find((i) => i.action.do === "send" && i.action.to === "n-server")!;
    const reply = sends.find((i) => i.action.do === "send" && i.action.to === "n-client")!;
    expect(reply.at).toBeGreaterThanOrEqual(request.at + 1200);
    const lastArrival = Math.max(...sends.map((s) => s.at + 1200));
    const record = items.find((i) => i.action.do === "append")!;
    expect(record.at).toBeGreaterThan(lastArrival);
  });

  it("zooms onto the focused panel and back out", () => {
    const table = panelsConcept.steps[2]!.panels![2]!;
    const box = centeredBox(table, simpleSize(table));
    const camera = cameraAt(end(2), Infinity);
    expect(camera.x0).toBeLessThan(box.x0 / 10);
    expect(camera.x1).toBeGreaterThan(box.x1 / 10);
    expect(camera.x1 - camera.x0).toBeLessThan(60);
    expect(cameraAt(end(3), Infinity)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
  });

  it("removes and adds whole panels, and draws static edges to stay", () => {
    const world = end(3);
    const alive = (id: string) => world.live.get(id)?.dying === null;
    expect(alive("p-handler")).toBe(false);
    expect(alive("p-history")).toBe(true);
    expect(alive("e-conn")).toBe(true);
    expect(world.live.get("p-history")!.cells.map((c) => c.tag)).toEqual(["t=0", "t=1", "t=2"]);
  });
});
