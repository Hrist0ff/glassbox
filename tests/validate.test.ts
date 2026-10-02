import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/concept/constants";
import { wrapLabel } from "@/lib/concept/geometry";
import type { Concept } from "@/lib/concept/schema";
import { countWords, parseStoredConcept, validateConcept } from "@/lib/concept/validate";
import { BUNDLED_FIXTURES } from "@/lib/fixtures";
import { raftLeaderElection } from "@/lib/fixtures/raft";

const clone = (c: Concept): Concept => structuredClone(c);
const codes = (input: unknown) => {
  const result = validateConcept(input);
  return { ok: result.ok, codes: result.issues.map((i) => i.code), issues: result.issues };
};

describe("bundled fixtures", () => {
  it.each(BUNDLED_FIXTURES.map((f) => [f.slug, f.concept] as const))("%s passes validation without warnings", (_, concept) => {
    const result = validateConcept(concept);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("uses distinct visual stories (different entity sets)", () => {
    const signatures = BUNDLED_FIXTURES.map((f) =>
      [...new Set(f.concept.steps.flatMap((s) => s.nodes.map((n) => n.id)))].sort().join(","),
    );
    expect(new Set(signatures).size).toBe(BUNDLED_FIXTURES.length);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated tokens and ignores surrounding space", () => {
    expect(countWords("  one two\tthree\nfour  ")).toBe(4);
    expect(countWords("up-to-date example.com → done")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});

describe("schema-level rejections", () => {
  it("rejects a wrong schema version", () => {
    const c = { ...clone(raftLeaderElection), schemaVersion: 2 };
    expect(codes(c).ok).toBe(false);
  });

  it("rejects unknown fields anywhere", () => {
    const c = clone(raftLeaderElection) as unknown as { steps: Array<{ nodes: Array<Record<string, unknown>> }> };
    c.steps[0]!.nodes[0]!.onClick = "alert(1)";
    expect(codes(c).codes).toContain("unknown_field");

    const top = { ...clone(raftLeaderElection), html: "<script>" };
    expect(codes(top).codes).toContain("unknown_field");
  });

  it("rejects colors and shapes outside the allowlist", () => {
    const c = clone(raftLeaderElection) as unknown as { steps: Array<{ nodes: Array<Record<string, unknown>> }> };
    c.steps[0]!.nodes[0]!.color = "#ff0000";
    c.steps[0]!.nodes[1]!.shape = "hexagon";
    const result = codes(c);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["steps.0.nodes.0.color", "steps.0.nodes.1.shape"]),
    );
  });

  it("rejects non-finite coordinates", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1001]) {
      const c = clone(raftLeaderElection);
      c.steps[0]!.nodes[0]!.x = bad;
      expect(codes(c).ok).toBe(false);
    }
  });

  it("enforces step, node, edge, and label count limits", () => {
    const tooFewSteps = clone(raftLeaderElection);
    tooFewSteps.steps = tooFewSteps.steps.slice(0, LIMITS.steps.min - 1);
    expect(codes(tooFewSteps).ok).toBe(false);

    const tooManySteps = clone(raftLeaderElection);
    tooManySteps.steps = Array.from({ length: LIMITS.steps.max + 1 }, (_, i) => ({
      ...tooManySteps.steps[0]!,
      id: `s${i}`,
    }));
    expect(codes(tooManySteps).ok).toBe(false);

    const tooManyNodes = clone(raftLeaderElection);
    tooManyNodes.steps[0]!.nodes = Array.from({ length: LIMITS.nodesPerStep.max + 1 }, (_, i) => ({
      ...tooManyNodes.steps[0]!.nodes[0]!,
      id: `n${i}`,
    }));
    expect(codes(tooManyNodes).ok).toBe(false);

    const noNodes = clone(raftLeaderElection);
    noNodes.steps[0]!.nodes = [];
    expect(codes(noNodes).ok).toBe(false);

    const longLabel = clone(raftLeaderElection);
    longLabel.steps[0]!.nodes[0]!.label = "x".repeat(LIMITS.label.max + 1);
    expect(codes(longLabel).ok).toBe(false);
  });

  it("rejects oversized payloads before parsing", () => {
    const c = clone(raftLeaderElection) as unknown as Record<string, unknown>;
    c.description = "x".repeat(LIMITS.payloadBytes);
    expect(codes(c).codes).toEqual(["payload_too_large"]);
  });
});

describe("semantic rejections", () => {
  it("rejects step text over 20 words", () => {
    const c = clone(raftLeaderElection);
    c.steps[0]!.text = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ");
    expect(codes(c).codes).toContain("step_text_too_long");
  });

  it("rejects invalid edge endpoints", () => {
    const c = clone(raftLeaderElection);
    c.steps[3]!.edges[0]!.to = "ghost";
    expect(codes(c).codes).toContain("unknown_edge_endpoint");
  });

  it("rejects self-edges and duplicate connections", () => {
    const c = clone(raftLeaderElection);
    const step = c.steps[3]!;
    step.edges.push({ id: "loop", from: "s1", to: "s1", label: "", animated: false });
    step.edges.push({ ...step.edges[0]!, id: "rv1-dup" });
    const result = codes(c).codes;
    expect(result).toContain("self_edge");
    expect(result).toContain("duplicate_connection");
  });

  it("rejects duplicate step ids and duplicate entity ids within a step", () => {
    const c = clone(raftLeaderElection);
    c.steps[1]!.id = c.steps[0]!.id;
    c.steps[0]!.nodes[1]!.id = c.steps[0]!.nodes[0]!.id;
    const result = codes(c).codes;
    expect(result).toContain("duplicate_step_id");
    expect(result).toContain("duplicate_entity_id");
  });

  it("rejects edges whose id collides with a node id in the same step", () => {
    const c = clone(raftLeaderElection);
    c.steps[3]!.edges[0]!.id = "s2";
    expect(codes(c).codes).toContain("duplicate_entity_id");
  });

  it("rejects scenes outside the arena margins", () => {
    const nodeOut = clone(raftLeaderElection);
    nodeOut.steps[0]!.nodes[0]!.x = 10;
    expect(codes(nodeOut).codes).toContain("node_out_of_bounds");

    const labelOut = clone(raftLeaderElection);
    labelOut.steps[0]!.nodes[0]!.y = 545; // node fits, label below it does not
    expect(codes(labelOut).codes).toContain("label_out_of_bounds");
  });

  it("rejects nodes closer than the minimum separation", () => {
    const c = clone(raftLeaderElection);
    c.steps[0]!.nodes[1]!.x = c.steps[0]!.nodes[0]!.x + 40;
    c.steps[0]!.nodes[1]!.y = c.steps[0]!.nodes[0]!.y;
    expect(codes(c).codes).toContain("nodes_too_close");
  });

  it("rejects an edge that passes through another node", () => {
    const c = clone(raftLeaderElection);
    // s1 (500,95) → s4 (375,455) with s5 moved onto that line.
    const step = c.steps.find((s) => s.id === "request-votes")!;
    step.edges = [{ id: "x", from: "s1", to: "s4", label: "", animated: false }];
    const s5 = step.nodes.find((n) => n.id === "s5")!;
    s5.x = 437;
    s5.y = 275;
    expect(codes(c).issues.find((i) => i.code === "edge_crosses_node")?.severity).toBe("error");
  });

  it("rejects an edge id reused for a different connection in the next step", () => {
    const c = clone(raftLeaderElection);
    // hb1 is s3→s1 in step "leader"; reuse it for s3→s2 in "heartbeats".
    const heartbeats = c.steps.find((s) => s.id === "heartbeats")!;
    heartbeats.edges = heartbeats.edges.filter((e) => e.id !== "hb2");
    heartbeats.edges[0]!.to = "s2";
    expect(codes(c).codes).toContain("edge_identity_changed");
  });

  it("rejects a renamed id for what is clearly the same entity", () => {
    const c = clone(raftLeaderElection);
    c.steps[1]!.nodes[0]!.id = "server-1"; // same label as s1 in step 0, s1 vanished
    expect(codes(c).codes).toContain("node_identity_changed");
  });

  it("reports an unchanged scene as a warning, not an error", () => {
    const c = clone(raftLeaderElection);
    c.steps[1] = { ...structuredClone(c.steps[0]!), id: "repeat", text: "Same picture, new words." };
    c.steps[2]!.nodes[4] = structuredClone(c.steps[0]!.nodes[4]!);
    const result = validateConcept(c);
    expect(result.issues.find((i) => i.code === "unchanged_scene")?.severity).toBe("warning");
  });
});

describe("parseStoredConcept", () => {
  it("rejects content whose id does not match the expected id", () => {
    const result = parseStoredConcept(raftLeaderElection, "00000000-0000-4000-8000-000000000000");
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON shapes", () => {
    expect(parseStoredConcept({ steps: "nope" }, raftLeaderElection.id).ok).toBe(false);
    expect(parseStoredConcept(null, raftLeaderElection.id).ok).toBe(false);
  });
});

describe("wrapLabel", () => {
  it("never produces more than two lines for valid labels", () => {
    const samples = ["S1", "aaaa bbbbbbbbbbbbbbbb cccccccc", "x".repeat(30), "Recursive resolver", "a b c d e f g h i j k l m n o"];
    for (const label of samples) {
      expect(wrapLabel(label).length).toBeLessThanOrEqual(2);
    }
  });
});
