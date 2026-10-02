import { describe, expect, it } from "vitest";
import { ARENAS, NODE } from "@/lib/concept/constants";
import { placeSteps, relayout, toGeneratedContent, layoutGenerated, type PlaceableStep } from "@/lib/concept/layout";
import { geometryErrors, validateConcept } from "@/lib/concept/validate";
import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { httpVersions } from "@/lib/fixtures/http-versions";
import { incidentTimeline } from "@/lib/fixtures/incident-timeline";

/** Deterministic pseudo-random numbers, so failures reproduce. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const node = (id: string, col: number, row: number, label = id) => ({ id, label, shape: "circle" as const, color: "neutral" as const, status: "active" as const, col, row });

describe("layout engine", () => {
  it("places grid cells in stable positions across steps", () => {
    const steps: PlaceableStep[] = [
      { id: "a", text: "x", nodes: [node("client", 0, 0), node("server", 2, 0)], edges: [] },
      { id: "b", text: "y", nodes: [node("client", 0, 0), node("proxy", 1, 1), node("server", 2, 0)], edges: [{ id: "e", from: "client", to: "proxy", label: "", animated: true }] },
    ];
    const { steps: placed, errors } = placeSteps(steps, "flow", ARENAS.landscape);
    expect(errors).toBe(0);
    const at = (s: number, id: string) => placed[s]!.nodes.find((n) => n.id === id)!;
    expect(at(0, "client")).toMatchObject({ x: at(1, "client").x, y: at(1, "client").y });
    expect(at(0, "client").x).toBeLessThan(at(0, "server").x);
    // Rows go down; a later column is further right.
    expect(at(1, "proxy").y).toBeGreaterThan(at(1, "client").y);
  });

  it("lifts a node out of a connection that would pass through it", () => {
    const steps: PlaceableStep[] = [
      { id: "a", text: "x", nodes: [node("a", 0, 0), node("b", 1, 0), node("c", 2, 0)], edges: [{ id: "ac", from: "a", to: "c", label: "", animated: true }] },
    ];
    const { steps: placed, errors } = placeSteps(steps, "flow", ARENAS.landscape);
    expect(errors).toBe(0);
    const [a, b] = placed[0]!.nodes;
    expect(Math.abs(b!.y - a!.y)).toBeGreaterThan(NODE.radius);
  });

  it("puts peers in a ring in column order", () => {
    const peers = Array.from({ length: 5 }, (_, i) => node(`s${i}`, i, 0));
    const { steps: placed, errors } = placeSteps([{ id: "a", text: "x", nodes: peers, edges: [] }], "ring", ARENAS.landscape);
    expect(errors).toBe(0);
    const top = placed[0]!.nodes.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top.id).toBe("s0");
  });

  it("lays out random grids without geometry errors on both arenas", () => {
    const random = rng(7);
    let failures = 0;
    for (let trial = 0; trial < 60; trial++) {
      const count = 2 + Math.floor(random() * 5);
      const cells = new Set<string>();
      const nodes = Array.from({ length: count }, (_, i) => {
        let col = 0;
        let row = 0;
        do {
          col = Math.floor(random() * 4);
          row = Math.floor(random() * 3);
        } while (cells.has(`${col}:${row}`));
        cells.add(`${col}:${row}`);
        return node(`n${i}`, col, row, random() > 0.7 ? "A rather long label here" : `Node ${i}`);
      });
      const step: PlaceableStep = { id: "s", text: "x", nodes, edges: [] };
      for (const arena of [ARENAS.landscape, ARENAS.portrait]) {
        if (placeSteps([step], "flow", arena).errors > 0) failures += 1;
      }
    }
    expect(failures).toBe(0);
  });

  it("gives panels that never share a step the same place", () => {
    const code = { kind: "code" as const, id: "code", label: "", lines: [{ text: "x = 1", highlight: true }] };
    const later = { kind: "log" as const, id: "log", label: "", items: [{ text: "a", tag: "", color: "neutral" as const, status: "active" as const }] };
    const steps: PlaceableStep[] = [
      { id: "a", text: "x", nodes: [], edges: [], panels: [code] },
      { id: "b", text: "y", nodes: [], edges: [], panels: [later] },
    ];
    const { steps: placed } = placeSteps(steps, "code_beside_data", ARENAS.landscape);
    expect(placed[0]!.panels![0]).toMatchObject({ x: placed[1]!.panels![0]!.x });
  });

  it("re-lays out real explanations from their wire format with valid geometry", () => {
    const wire = toGeneratedContent(binarySearch);
    const { content } = layoutGenerated(wire, "flow");
    expect(validateConcept({ ...binarySearch, ...content, layout: "flow" }).ok).toBe(true);
  });
});

describe("portrait relayout", () => {
  it("lays out version-2 examples on the portrait arena, and leaves version-1 ones alone", () => {
    for (const { concept } of BUNDLED_FIXTURES) {
      const steps = relayout(concept, ARENAS.portrait);
      if (!concept.layout) {
        expect(steps).toBeNull();
        continue;
      }
      expect(steps, concept.title).not.toBeNull();
      expect(geometryErrors(steps!, ARENAS.portrait)).toEqual([]);
      expect(steps!.map((s) => s.id)).toEqual(concept.steps.map((s) => s.id));
      expect(steps!.map((s) => s.text)).toEqual(concept.steps.map((s) => s.text));
    }
  });

  it("falls back (returns null) when the portrait arena cannot hold the content", () => {
    // An eight-column table is 736 units wide; the portrait arena has 568 inside its margins.
    const cell = { text: "1", tag: "", color: "neutral" as const, status: "active" as const };
    const wide = structuredClone(httpVersions);
    wide.steps = wide.steps.map((step) => ({
      ...step,
      panels: [{ kind: "table" as const, id: "t", label: "", x: 500, y: 300, columns: ["a", "b", "c", "d", "e", "f", "g", "h"], rows: [{ label: "", cells: Array(8).fill(cell) }] }],
    }));
    expect(validateConcept(wide).ok).toBe(true);
    expect(relayout(wide, ARENAS.portrait)).toBeNull();
  });

  it("keeps an event at the same place in every step of a growing timeline", () => {
    const steps = relayout(incidentTimeline, ARENAS.portrait)!;
    const xs = new Set(steps.map((s) => s.panels![0]!.x));
    expect(xs.size).toBe(1);
  });
});
