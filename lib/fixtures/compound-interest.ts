import { layoutPlaceable, type PlaceableStep } from "@/lib/concept/layout";
import type { ChartPanel, Concept } from "@/lib/concept/schema";

/**
 * A chart with illustrative, exactly computed numbers: $1,000 at 5% a year,
 * simple versus compound (once a year), revealed five years at a time.
 */

const YEARS = [0, 5, 10, 15, 20, 25, 30];
const simple = YEARS.map((y) => 1000 + 50 * y);
const compound = YEARS.map((y) => Math.round(1000 * 1.05 ** y * 100) / 100);

const chart = (revealed: number, highlight: number | null): Omit<ChartPanel, "x" | "y"> => ({
  kind: "chart",
  id: "balance",
  label: "Balance of $1,000 at 5% a year",
  chart: "line",
  data: "illustrative",
  categories: YEARS.map(String),
  xLabel: "Years after depositing",
  yLabel: "Balance",
  unit: "USD",
  series: [
    { name: "Simple interest", color: "secondary", values: simple },
    { name: "Compound interest", color: "primary", values: compound },
  ],
  revealed,
  highlight,
});

const step = (id: string, text: string, revealed: number, highlight: number | null, notes?: string): PlaceableStep => ({
  id,
  text,
  nodes: [],
  edges: [],
  panels: [chart(revealed, highlight)],
  claims: ["a1"],
  ...(notes ? { notes } : {}),
});

const content = layoutPlaceable(
  {
    title: "Why compound interest pulls ahead",
    description:
      "An illustrative calculation: $1,000 earning 5% a year with simple interest and with interest compounded once a year, over 30 years.",
    steps: [
      step("start", "Both accounts start with $1,000 and earn 5% a year.", 1, 0, "Simple interest pays 5% of the original $1,000 every year. Compound interest pays 5% of the current balance, interest included."),
      step("ten", "After 10 years: $1,500 with simple interest, about $1,629 with compound interest.", 3, 2),
      step("twenty", "After 20 years the gap is wider: $2,000 versus about $2,653.", 5, 4, "Simple interest adds the same $50 every year, so its line is straight."),
      step("thirty", "After 30 years compound interest has reached about $4,322, against $2,500.", 7, 6),
      step(
        "takeaway",
        "Compounding earns interest on earlier interest, so the gap keeps widening over time.",
        7,
        null,
        "These numbers are computed for illustration; real accounts have different rates, fees, and compounding schedules.",
      ),
    ],
  },
  "chart",
);

export const compoundInterest: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a07",
  ...content,
  layout: "chart",
  provenance: {
    request: { kind: "topic", topic: "Simple vs compound interest", question: "", audience: "Curious beginners", language: "English", depth: "overview" },
    learningGoal: "See why compound interest grows faster than simple interest, and why the gap widens over time.",
    explanationType: "quantitative",
    representation: "chart",
    sourcesConsulted: false,
    sources: [],
    claims: [
      { id: "a1", text: "A 5% yearly rate on $1,000, compounded once a year, with no fees, withdrawals, or taxes.", basis: "assumption", passages: [], quote: "" },
    ],
    scope: "One deposit over 30 years; no further deposits.",
    omissions: ["Inflation", "Monthly or continuous compounding"],
    simplifications: ["Balances are shown every five years"],
    uncertainty: [],
    limitations: [],
  },
};
