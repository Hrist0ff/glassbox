import type { Concept, VisualEdge, VisualNode } from "@/lib/concept/schema";

const VALUES = [3, 8, 15, 21, 34, 42, 57] as const;
const CELL_Y = 360;
const cellX = (index: number) => 140 + index * 120;

type CellState = {
  pointer?: string;
  color?: VisualNode["color"];
  status?: VisualNode["status"];
};

/** Build all seven cells; `states` overrides individual indices. */
function cells(states: Record<number, CellState> = {}, discarded: number[] = []): VisualNode[] {
  return VALUES.map((value, index) => {
    const state = states[index] ?? {};
    const label = `[${index}] ${value}${state.pointer ? ` · ${state.pointer}` : ""}`;
    return {
      id: `cell-${index}`,
      label,
      x: cellX(index),
      y: CELL_Y,
      shape: "square",
      color: state.color ?? "neutral",
      status: state.status ?? (discarded.includes(index) ? "inactive" : "active"),
    };
  });
}

/** The target hovers above the element it is being compared with. */
const target = (label: string, aboveIndex = 3, color: VisualNode["color"] = "secondary"): VisualNode => ({
  id: "target",
  label,
  x: cellX(aboveIndex),
  y: 130,
  shape: "circle",
  color,
  status: "active",
});

const compare = (id: string, index: number, label: string, animated: boolean): VisualEdge => ({
  id,
  from: "target",
  to: `cell-${index}`,
  label,
  animated,
});

export const binarySearch: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a03",
  title: "Binary search",
  description:
    "Find 34 in a sorted list of seven numbers by checking the middle and discarding half of the remaining range each time.",
  steps: [
    {
      id: "sorted-list",
      text: "Binary search finds a value in a sorted list by repeatedly halving the range where it could be.",
      notes:
        "The list must already be sorted in ascending order. Each square is one element; the number in brackets is its index.",
      nodes: cells(),
      edges: [],
    },
    {
      id: "target",
      text: "We are looking for 34. At first the whole list, index 0 to 6, could contain it.",
      notes: "'low' and 'high' mark the first and last index of the range that could still hold the target.",
      nodes: [target("Target: 34"), ...cells({ 0: { pointer: "low" }, 6: { pointer: "high" } })],
      edges: [],
    },
    {
      id: "first-middle",
      text: "Check the middle of the range: index 3, which holds 21.",
      notes: "The middle index is (low + high) / 2, rounded down: (0 + 6) / 2 = 3.",
      nodes: [
        target("Target: 34"),
        ...cells({ 0: { pointer: "low" }, 3: { pointer: "mid", color: "primary" }, 6: { pointer: "high" } }),
      ],
      edges: [compare("cmp1", 3, "34 vs 21", true)],
    },
    {
      id: "discard-left",
      text: "34 is larger than 21, so 34 can only be to the right. Discard indices 0 to 3.",
      notes:
        "Because the list is sorted, every element at or left of index 3 is at most 21, so none of them can be 34. One comparison removed four of the seven candidates.",
      nodes: [target("Target: 34"), ...cells({ 4: { pointer: "low" }, 6: { pointer: "high" } }, [0, 1, 2, 3])],
      edges: [],
    },
    {
      id: "second-middle",
      text: "The new range is indices 4 to 6. Its middle, index 5, holds 42.",
      notes: "(4 + 6) / 2 = 5. The target moves over the element it is compared with.",
      nodes: [
        target("Target: 34", 5),
        ...cells(
          { 4: { pointer: "low" }, 5: { pointer: "mid", color: "primary" }, 6: { pointer: "high" } },
          [0, 1, 2, 3],
        ),
      ],
      edges: [compare("cmp2", 5, "34 vs 42", true)],
    },
    {
      id: "discard-right",
      text: "34 is smaller than 42, so discard index 5 and everything to its right.",
      nodes: [target("Target: 34", 5), ...cells({ 4: { pointer: "low, high" } }, [0, 1, 2, 3, 5, 6])],
      edges: [],
    },
    {
      id: "found",
      text: "Only index 4 remains. It holds 34, so the search succeeds after three comparisons.",
      notes: "Had the value been missing, the range would have become empty here and the search would report 'not found'.",
      nodes: [
        target("Target: 34", 4, "success"),
        ...cells({ 4: { pointer: "found", color: "success" } }, [0, 1, 2, 3, 5, 6]),
      ],
      edges: [compare("cmp3", 4, "34 = 34", true)],
    },
    {
      id: "takeaway",
      text: "Takeaway: each comparison halves the range, so n sorted items need about log₂ n checks.",
      notes:
        "A million sorted items need at most about 20 comparisons, while scanning one by one could need a million. A common mistake is running binary search on unsorted data: the discard step assumes order, so it silently returns wrong answers.",
      nodes: [
        target("Found at index 4", 4, "success"),
        ...cells({ 4: { pointer: "found", color: "success" } }, [0, 1, 2, 3, 5, 6]),
      ],
      edges: [compare("cmp3", 4, "34 = 34", false)],
    },
  ],
};
