import { describe, expect, it } from "vitest";
import { ARENAS } from "@/lib/concept/constants";
import { chartScale, framesFor, timelinePoint, type TimelineFrame } from "@/lib/concept/frames";
import { panelFromGenerated, panelToGenerated, type ChartPanel, type ComparisonPanel, type Concept, type HierarchyPanel, type TimelinePanel } from "@/lib/concept/schema";
import { validateConcept } from "@/lib/concept/validate";
import { compoundInterest } from "@/lib/fixtures/compound-interest";
import { httpVersions } from "@/lib/fixtures/http-versions";
import { incidentTimeline } from "@/lib/fixtures/incident-timeline";
import { usGovernment } from "@/lib/fixtures/us-government";
import { compileStory, worldAt } from "@/lib/story/engine";
import { conceptStories, conceptToStory } from "@/lib/story/from-concept";
import { relayout } from "@/lib/concept/layout";
import { lintStory } from "@/lib/story/lint";

const errorCodes = (concept: Concept) => {
  const result = validateConcept(concept);
  return result.ok ? [] : result.issues.filter((i) => i.severity === "error").map((i) => i.code);
};
/** Edit the panel of every step in a copy of a one-panel example (a JSON copy: the examples share objects between steps). */
function edit<P>(concept: Concept, change: (panel: P, step: number) => void): Concept {
  const copy = JSON.parse(JSON.stringify(concept)) as Concept;
  copy.steps.forEach((step, s) => change(step.panels![0] as P, s));
  return copy;
}
const last = <P,>(concept: Concept) => concept.steps.at(-1)!.panels![0] as P;

describe("timelines", () => {
  it("rejects events out of chronological order, unknown lanes, and missing dates", () => {
    expect(errorCodes(edit<TimelinePanel>(incidentTimeline, (p) => p.items.reverse()))).toContain("timeline_order");
    expect(errorCodes(edit<TimelinePanel>(incidentTimeline, (p) => (p.items[0]!.lane = 3)))).toContain("unknown_lane");
    expect(errorCodes(edit<TimelinePanel>(incidentTimeline, (p) => (p.items[0]!.tag = "")))).toContain("missing_date");
    // An explicitly unknown date needs no tag.
    expect(errorCodes(edit<TimelinePanel>(incidentTimeline, (p) => Object.assign(p.items[0]!, { tag: "", date: "unknown", at: undefined, spacing: "ordered" })))).not.toContain(
      "missing_date",
    );
  });

  it("rejects dates written into event text instead of the date field, and allows undated stages", () => {
    const inText = edit<TimelinePanel>(incidentTimeline, (p) => {
      p.spacing = "ordered";
      p.items = p.items.map((item) => ({ ...item, text: `${item.tag} ${item.text}`.slice(0, 24), tag: "", date: "unknown", at: undefined, end: undefined }));
    });
    expect(errorCodes(inText)).toContain("date_in_text");
    // Words that merely start like a month, and plain numbers, are not dates.
    const words = edit<TimelinePanel>(incidentTimeline, (p) => {
      p.spacing = "ordered";
      p.relations = [];
      p.items = p.items.map((item, i) => ({ ...item, text: ["Separate 2 teams", "Marketing 3 regions", "404 errors rise", "2048 users join"][i % 4]!, tag: "", date: "none", at: undefined, end: undefined }));
    });
    expect(errorCodes(words)).not.toContain("date_in_text");
    const stages = edit<TimelinePanel>(incidentTimeline, (p) => {
      p.spacing = "ordered";
      p.relations = [];
      p.items = p.items.map((item) => ({ ...item, tag: "", date: "none", at: undefined, end: undefined }));
    });
    expect(errorCodes(stages)).toEqual([]);
  });

  it("drops time positions the generator gave to undated events", () => {
    const wire = panelToGenerated(last<TimelinePanel>(incidentTimeline));
    if (wire.kind !== "timeline") throw new Error("expected a timeline");
    const back = panelFromGenerated({ ...wire, items: wire.items.map((item) => ({ ...item, date: "none" as const, tag: "", at: 3, end: 4 })) });
    expect(back.kind === "timeline" && back.items.every((item) => item.at === undefined && item.end === undefined)).toBe(true);
  });

  it("allows proportional spacing only when every event has a known time", () => {
    const unknown = edit<TimelinePanel>(incidentTimeline, (p) => {
      delete p.items[0]!.at;
    });
    expect(errorCodes(unknown)).toContain("timeline_spacing");
    const ordered = edit<TimelinePanel>(unknown, (p) => (p.spacing = "ordered"));
    expect(errorCodes(ordered)).toEqual([]);
  });

  it("rejects to-scale spacing that would draw same-lane events on top of each other", () => {
    const crowded = edit<TimelinePanel>(incidentTimeline, (p) => {
      const rollback = p.items.find((item) => item.id === "rollback");
      if (rollback) rollback.at = 7.5; // half a minute after the page, in the same lane
    });
    expect(errorCodes(crowded)).toContain("timeline_crowded");
    expect(errorCodes(incidentTimeline)).toEqual([]);
  });

  it("checks relations name events in the panel", () => {
    expect(errorCodes(edit<TimelinePanel>(incidentTimeline, (p, s) => s === 6 && p.relations!.push({ from: "ghost", to: "disk", type: "causes" })))).toContain(
      "unknown_relation_event",
    );
  });

  it("places events to scale, shares slots for simultaneous events, and keeps positions as it grows", () => {
    const frame = framesFor(incidentTimeline.steps, ARENAS.landscape, true).get("incident") as TimelineFrame;
    expect(frame.spacing).toBe("proportional");
    const x = (key: string, lane: number) => timelinePoint(frame, key, lane).x;
    // 14:04 and 14:05 are one minute apart; 14:05 and 14:07 two: spacing follows time.
    expect(x("alert", 2) - x("errors", 0)).toBeCloseTo(2 * (x("errors", 0) - x("disk", 1)), 5);

    const simultaneous = JSON.parse(JSON.stringify(last<TimelinePanel>(incidentTimeline))) as TimelinePanel;
    simultaneous.spacing = "ordered";
    simultaneous.items[2]!.at = simultaneous.items[1]!.at; // "errors" at the same time as "disk", in another lane
    const ordered = framesFor([{ panels: [simultaneous] }], ARENAS.landscape, true).get("incident") as TimelineFrame;
    expect(ordered.positions.errors).toBe(ordered.positions.disk);
  });
});

describe("comparisons", () => {
  it("requires one cell per alternative, and a value or an explicit missing mark", () => {
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p) => p.criteria[0]!.cells.pop()))).toContain("comparison_shape");
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p) => (p.criteria[0]!.cells[0]!.text = "")))).toContain("comparison_value");
    expect(
      errorCodes(edit<ComparisonPanel>(httpVersions, (p, s) => s === 6 && (p.criteria[5]!.cells[0] = { ...p.criteria[5]!.cells[0]!, text: "No" }))),
    ).toContain("comparison_value");
  });

  it("rejects text cut off mid-word", () => {
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p) => (p.criteria[0]!.cells[0]!.text = "no transport-")))).toContain("text_cut_off");
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p) => (p.criteria[0]!.cells[0]!.text = "HTTP/1.1")))).not.toContain("text_cut_off");
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p) => (p.criteria[0]!.cells[0]!.text = "no delivery/")))).toContain("text_cut_off");
    // A path is not a cut.
    expect(errorCodes(edit<HierarchyPanel>(usGovernment, (p) => (p.items[1]!.text = "src/")))).not.toContain("text_cut_off");
  });

  it("keeps the same alternatives in every step", () => {
    expect(errorCodes(edit<ComparisonPanel>(httpVersions, (p, s) => s === 2 && p.alternatives.reverse()))).toContain("comparison_alternatives_changed");
  });

  it("reveals criteria without moving earlier rows", () => {
    const story = conceptToStory(httpVersions, { subtitle: "t" });
    const compiled = compileStory(story);
    const beats = compiled.beats.filter((b) => b.beat.step && b.beat.run);
    const first = worldAt(beats[0]!.start, beats[0]!.items, Infinity).live.get("p-versions")!;
    const second = worldAt(beats[1]!.start, beats[1]!.items, Infinity).live.get("p-versions")!;
    expect(first.cells.map((c) => c.key)).toEqual(["year:0", "year:1", "year:2"]);
    expect(second.cells.map((c) => c.key)).toEqual(["year:0", "year:1", "year:2", "transport:0", "transport:1", "transport:2"]);
    // Kept cells keep their age (no fade-in again); new ones fade in during the step.
    expect(second.cells[0]!.born).toBe(-Infinity);
    expect(second.cells[3]!.born).toBeGreaterThan(0);
  });
});

describe("hierarchies", () => {
  it("rejects missing parents, cycles, no root, and groups deeper than one level", () => {
    expect(errorCodes(edit<HierarchyPanel>(usGovernment, (p) => (p.items[1]!.parent = "nowhere")))).toContain("hierarchy_parent");
    expect(errorCodes(edit<HierarchyPanel>(usGovernment, (p) => (p.items[0]!.parent = p.items[1]!.id)))).toEqual(expect.arrayContaining(["hierarchy_root"]));
    const cycle = edit<HierarchyPanel>(usGovernment, (p) => {
      p.items.push({ id: "x", text: "X", parent: "y", color: "neutral", status: "active" }, { id: "y", text: "Y", parent: "x", color: "neutral", status: "active" });
    });
    expect(errorCodes(cycle)).toContain("hierarchy_cycle");
    expect(errorCodes(edit<HierarchyPanel>(usGovernment, (p) => (p.style = "groups")))).toContain("hierarchy_depth");
  });

  it("draws membership as structure: lines and boxes, never messages", () => {
    const story = conceptToStory(usGovernment, { subtitle: "t" });
    const sends = story.chapters.flatMap((c) => c.beats.flatMap((b) => (b.run ?? []).filter((s) => s.do === "send")));
    expect(sends).toEqual([]);
  });

  it("keeps a deep taxonomy's real nesting and fits it; wide trees become outlines", () => {
    const chain = ["Vertebrates", "Jawed vertebrates", "Bony vertebrates", "Lobe-finned", "Tetrapods", "Amniotes"];
    const deep = edit<HierarchyPanel>(usGovernment, (p) => {
      p.relation = "kind_of";
      p.items = chain.map((text, i) => ({ id: `t${i}`, text, parent: i === 0 ? null : `t${i - 1}`, color: "neutral" as const, status: "active" as const }));
      p.items.push({ id: "fish", text: "Ray-finned fish", parent: "t2", color: "neutral", status: "active" });
    });
    const laidOut = { ...deep, steps: relayout(deep, ARENAS.landscape)! };
    expect(laidOut.steps).toBeTruthy();
    expect(errorCodes(laidOut)).toEqual([]);
    expect(framesFor(laidOut.steps, ARENAS.landscape, true).get("branches")!.size.height).toBeLessThan(ARENAS.landscape.height - 32);
    expect(relayout(deep, ARENAS.portrait)).not.toBeNull();
    const wide = edit<HierarchyPanel>(usGovernment, (p) => {
      p.items = [p.items[0]!, ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, text: `Leaf ${i}`, parent: p.items[0]!.id, color: "neutral" as const, status: "active" as const }))];
    });
    expect(framesFor(wide.steps, ARENAS.landscape, true).get("branches")).toMatchObject({ style: "outline" });
  });

  it("draws trees as outlines on the portrait arena", () => {
    const frames = framesFor(usGovernment.steps, ARENAS.portrait, true);
    expect(frames.get("branches")).toMatchObject({ kind: "hierarchy", style: "outline" });
    expect(framesFor(usGovernment.steps, ARENAS.landscape, true).get("branches")).toMatchObject({ style: "tree" });
  });
});

describe("charts", () => {
  it("validates values per category, missing values, reveal, and highlight", () => {
    expect(errorCodes(edit<ChartPanel>(compoundInterest, (p) => p.series[0]!.values.pop()))).toContain("chart_shape");
    expect(errorCodes(edit<ChartPanel>(compoundInterest, (p) => p.series.forEach((s) => (s.values = s.values.map(() => null)))))).toContain("chart_empty");
    expect(errorCodes(edit<ChartPanel>(compoundInterest, (p) => (p.highlight = 7)))).toContain("chart_highlight");
    expect(errorCodes(edit<ChartPanel>(compoundInterest, (p, s) => s === 1 && (p.categories = [...p.categories].reverse())))).toContain("chart_categories_changed");
    // A missing value is allowed and stays missing (never drawn as zero).
    const gap = edit<ChartPanel>(compoundInterest, (p) => (p.series[0]!.values[3] = null));
    expect(errorCodes(gap)).toEqual([]);
    const cells = conceptToStory(gap, { subtitle: "t" }).chapters[1]!.beats.flatMap((b) => (b.run ?? []).flatMap((s) => (s.do === "cells" ? s.cells : [])));
    expect(cells.find((c) => c.key === "0:3")).toMatchObject({ text: "no data", meta: { value: null } });
  });

  it("rejects unevenly spaced points in time on a line chart, but not bar categories", () => {
    const uneven = edit<ChartPanel>(compoundInterest, (p) => (p.categories = ["0", "1", "2", "12", "120", "240", "360"]));
    expect(errorCodes(uneven)).toContain("chart_uneven_categories");
    expect(errorCodes(compoundInterest)).toEqual([]);
    const bars = edit<ChartPanel>(uneven, (p) => (p.chart = "bar"));
    expect(errorCodes(bars)).not.toContain("chart_uneven_categories");
  });

  it("uses one axis for every value the chart ever shows", () => {
    expect(chartScale([1000, 4321.94])).toEqual({ min: 0, max: 6000, ticks: [0, 2000, 4000, 6000] });
    expect(chartScale([-3, 7]).ticks).toEqual([-5, 0, 5, 10]);
  });

  it("labels where the numbers come from", () => {
    const story = conceptToStory(compoundInterest, { subtitle: "t" });
    const add = story.chapters[1]!.beats.flatMap((b) => b.run ?? []).find((s) => s.do === "add" && s.entity.kind === "panel");
    expect(add && add.do === "add" && add.entity.kind === "panel" && add.entity.note).toMatch(/Illustrative/);
    const observed = edit<ChartPanel>(compoundInterest, (p) => (p.data = "observed"));
    const note = conceptToStory(observed, { subtitle: "t" }).chapters[1]!.beats.flatMap((b) => b.run ?? []).find((s) => s.do === "add" && s.entity.kind === "panel");
    expect(note && note.do === "add" && note.entity.kind === "panel" && note.entity.note).toMatch(/general knowledge, not checked/);
  });
});

describe("conversion to the player", () => {
  it("produces landscape and portrait stories with the same beats, steps, and captions", () => {
    for (const concept of [incidentTimeline, httpVersions, usGovernment, compoundInterest]) {
      const { landscape, portrait } = conceptStories(concept, { subtitle: "t", closing: "c" });
      expect(portrait).not.toBeNull();
      const shape = (s: typeof landscape) => s.chapters.map((c) => c.beats.map((b) => [b.say, b.step ?? null]));
      expect(shape(portrait!)).toEqual(shape(landscape));
      expect(lintStory(landscape, { bounds: false })).toEqual([]);
      expect(lintStory(portrait!, { bounds: false })).toEqual([]);
    }
  });

  it("zooms panel-only steps of laid-out explanations onto their panels", () => {
    const story = conceptToStory(httpVersions, { subtitle: "t" });
    const firstStep = story.chapters[1]!.beats.find((b) => b.step)!;
    expect(firstStep.run!.some((s) => s.do === "zoom" && s.ids?.includes("p-versions"))).toBe(true);
  });
});
