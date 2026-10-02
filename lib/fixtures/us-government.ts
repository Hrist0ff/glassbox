import { layoutPlaceable, type PlaceableStep } from "@/lib/concept/layout";
import type { Concept, HierarchyItem, HierarchyPanel } from "@/lib/concept/schema";

/** A hierarchy: membership drawn as structure, with the relation named in a legend. */

const item = (id: string, text: string, parent: string | null): HierarchyItem => ({ id, text, parent, color: "neutral", status: "active" });

const all = {
  gov: item("gov", "Federal government", null),
  leg: item("leg", "Legislative branch", "gov"),
  exe: item("exe", "Executive branch", "gov"),
  jud: item("jud", "Judicial branch", "gov"),
  senate: item("senate", "Senate", "leg"),
  house: item("house", "House of Representatives", "leg"),
  president: item("president", "President", "exe"),
  departments: item("departments", "Executive departments", "exe"),
  supreme: item("supreme", "Supreme Court", "jud"),
  lower: item("lower", "Lower federal courts", "jud"),
} satisfies Record<string, HierarchyItem>;

type Id = keyof typeof all;

const tree = (ids: Id[], focus: Id[] = []): Omit<HierarchyPanel, "x" | "y"> => ({
  kind: "hierarchy",
  id: "branches",
  label: "U.S. federal government",
  style: "tree",
  relation: "part_of",
  items: ids.map((id) => (focus.includes(id) ? { ...all[id], color: "primary" as const } : all[id])),
  links: [],
});

const step = (id: string, text: string, ids: Id[], focus: Id[], notes?: string): PlaceableStep => ({
  id,
  text,
  nodes: [],
  edges: [],
  panels: [tree(ids, focus)],
  ...(notes ? { notes } : {}),
});

const branches: Id[] = ["gov", "leg", "exe", "jud"];

const content = layoutPlaceable(
  {
    title: "How the U.S. federal government is organized",
    description:
      "The three branches of the United States federal government and their main parts. Lines show what each part belongs to, not who gives orders to whom.",
    steps: [
      step("branches", "The U.S. federal government is divided into three branches.", branches, ["leg", "exe", "jud"], "The Constitution gives each branch its own powers: making laws, carrying them out, and judging cases under them."),
      step("congress", "The legislative branch, Congress, has two chambers: the Senate and the House of Representatives.", [...branches, "senate", "house"], ["senate", "house"]),
      step(
        "executive",
        "The executive branch, led by the President, includes the executive departments.",
        [...branches, "senate", "house", "president", "departments"],
        ["president", "departments"],
        "Each executive department, such as the Department of State, is headed by a secretary who belongs to the President's Cabinet.",
      ),
      step(
        "judicial",
        "The judicial branch is the Supreme Court plus the lower federal courts.",
        [...branches, "senate", "house", "president", "departments", "supreme", "lower"],
        ["supreme", "lower"],
      ),
      step(
        "takeaway",
        "Every part belongs to exactly one branch; the lines show membership, not command.",
        [...branches, "senate", "house", "president", "departments", "supreme", "lower"],
        ["leg", "exe", "jud"],
        "The branches also check each other, for example through vetoes and judicial review. Those relationships cross this tree and are left out here.",
      ),
    ],
  },
  "hierarchy",
);

export const usGovernment: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a06",
  ...content,
  layout: "hierarchy",
  provenance: {
    request: { kind: "topic", topic: "How the U.S. federal government is organized", question: "", audience: "Curious beginners", language: "English", depth: "overview" },
    learningGoal: "Know the three branches of the U.S. federal government and the main parts that belong to each.",
    explanationType: "hierarchy",
    representation: "hierarchy",
    sourcesConsulted: false,
    sources: [],
    claims: [],
    scope: "The federal level only, and only the main parts of each branch.",
    omissions: ["Independent agencies", "Checks and balances between the branches", "State governments"],
    simplifications: ["The Vice President and other offices of the executive branch are not shown"],
    uncertainty: [],
    limitations: [],
  },
};
