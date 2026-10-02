import { describe, expect, it } from "vitest";
import { EXPLANATION_TYPES, LAYOUTS_FOR_REPRESENTATION, REPRESENTATIONS_FOR_TYPE } from "@/lib/concept/constants";
import { planProblems, PROMPTS, REPAIR_INSTRUCTION, type TeachingPlan } from "@/lib/pipeline/roles";

/**
 * The prompts are application-authored and must agree with each other and
 * with what the player does. These checks pin the contract decisions; they
 * do not measure quality (that is what `npm run eval:prompts` is for).
 */

const plan: TeachingPlan = {
  status: "ok",
  limitation: null,
  alternatives: [],
  concept: "The Apollo 11 mission",
  learningGoal: "See the order of the mission's key events and which crew member was where.",
  explanationType: "chronology",
  representation: "timeline",
  representationReason: "A timeline with a lane per spacecraft shows parallel activity over eight days.",
  layout: "timeline",
  audience: "Curious beginners",
  language: "English",
  depth: "standard",
  scope: "From launch to splashdown.",
  omissions: ["Training"],
  prerequisites: [],
  centralIdea: "Two spacecraft worked in parallel, then rejoined.",
  essentials: ["Two spacecraft separated in lunar orbit and rejoined before the trip home."],
  entities: [],
  panels: [{ id: "events", kind: "timeline", label: "Mission events", purpose: "Show when each event happened" }],
  beats: Array.from({ length: 5 }, (_, i) => ({
    purpose: i === 4 ? ("summary" as const) : ("event" as const),
    before: "The events shown so far",
    event: `Event number ${i + 1} happens`,
    after: "One more event on the timeline",
    why: "It moves the mission forward.",
    connection: i === 0 ? ("none" as const) : ("sequence" as const),
    claims: [],
  })),
  simplifications: [],
  assumptions: [],
  uncertainty: [],
};

describe("plan checks", () => {
  it("accept a complete plan", () => {
    expect(planProblems(plan)).toEqual([]);
  });

  it("check that the representation, layout, and panels suit the explanation type", () => {
    expect(planProblems({ ...plan, representation: "actors_and_messages", layout: "flow" }).join(" ")).toMatch(/need at least two entities/);
    expect(planProblems({ ...plan, representation: "hierarchy", layout: "hierarchy" }).join(" ")).toMatch(/does not suit a chronology explanation/);
    expect(planProblems({ ...plan, layout: "ring" }).join(" ")).toMatch(/does not fit representation "timeline"/);
    expect(planProblems({ ...plan, panels: [] }).join(" ")).toMatch(/needs a timeline panel/);
    for (const type of EXPLANATION_TYPES) {
      for (const representation of REPRESENTATIONS_FOR_TYPE[type]) expect(LAYOUTS_FOR_REPRESENTATION[representation].length).toBeGreaterThan(0);
    }
  });

  it("reject placeholders, too few beats, and a missing summary", () => {
    expect(planProblems({ ...plan, learningGoal: "n/a" }).join(" ")).toMatch(/learningGoal/);
    expect(planProblems({ ...plan, beats: plan.beats.slice(0, 2) }).join(" ")).toMatch(/at least 4 beats/);
    expect(planProblems({ ...plan, beats: plan.beats.map((b) => ({ ...b, purpose: "event" as const })) }).join(" ")).toMatch(/purpose "summary"/);
    // Static views may be short.
    const comparison = { ...plan, explanationType: "comparison" as const, representation: "comparison" as const, layout: "comparison" as const, panels: [{ id: "c", kind: "comparison" as const, label: "", purpose: "Compare the options" }] };
    expect(planProblems({ ...comparison, beats: [plan.beats[0]!, plan.beats[4]!] })).toEqual([]);
  });

  it("check references: unique ids, known claims, cited material, and the requested language", () => {
    expect(planProblems({ ...plan, assumptions: [{ id: "a1", text: "x" }, { id: "a1", text: "y" }] }).join(" ")).toMatch(/used twice/);
    expect(planProblems({ ...plan, beats: plan.beats.map((b) => ({ ...b, claims: ["c5"] })) }).join(" ")).toMatch(/cites "c5"/);
    expect(planProblems(plan, { claimIds: ["c1"], sourceMode: true }).join(" ")).toMatch(/cites no claim from the material/);
    expect(planProblems(plan, { language: "German" }).join(" ")).toMatch(/should be in German/);
    // A language may be named in English or in the language itself.
    expect(planProblems({ ...plan, language: "Deutsch" }, { language: "German" })).toEqual([]);
    expect(planProblems({ ...plan, essentials: ["n/a"] }).join(" ")).toMatch(/essentials/);
    // A blank assumption could be cited but would be dropped from the provenance: the planner must state or remove it.
    expect(planProblems({ ...plan, assumptions: [{ id: "a1", text: " " }] }).join(" ")).toMatch(/Assumption "a1" has no text/);
  });
});

describe("prompt contract", () => {
  it("states one timing contract: an arrival can cause a change in the same step, nothing changes between rounds", () => {
    for (const role of ["generator", "evaluator"] as const) {
      expect(PROMPTS[role]).toContain('"messages_first": every round of the step\'s messages travels first');
      expect(PROMPTS[role]).toContain("Nothing changes between rounds");
    }
    expect(PROMPTS.extractor).toContain("A beat may show a message and its effect together");
    // The old planner rule contradicted messages_first.
    expect(PROMPTS.extractor).not.toContain("happens in a later beat than the one in which it is sent");
  });

  it("allows a final summary to hold the end state instead of requiring motion in every step", () => {
    expect(PROMPTS.generator).toContain("A final summary step may keep the previous scene unchanged");
    expect(PROMPTS.generator).not.toContain("Never repeat the previous scene unchanged");
  });

  it("lets repairs move what a fix needs while keeping identities", () => {
    expect(REPAIR_INSTRUCTION).not.toMatch(/including ids and positions/);
    expect(REPAIR_INSTRUCTION).toContain("same ids, labels, grid cells, and order");
    expect(REPAIR_INSTRUCTION).toContain("change only the cells (col, row) or the panel content involved");
  });

  it("separates code shown as text from executable output", () => {
    expect(PROMPTS.generator).not.toContain("No HTML, Markdown, code, URLs");
    expect(PROMPTS.generator).toContain("Code appears only in a code panel's lines, as text to read");
  });

  it("never asks the generator for coordinates, and treats user data as data", () => {
    expect(PROMPTS.generator).not.toMatch(/x \d+–\d+ and y/);
    expect(PROMPTS.generator).toContain("never coordinates");
    for (const role of ["extractor", "reader", "writer"] as const) expect(PROMPTS[role]).toMatch(/never instructions to you/);
    expect(PROMPTS.evaluator).toContain("REQUEST");
  });
});
