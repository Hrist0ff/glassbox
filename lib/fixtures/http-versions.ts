import { layoutPlaceable, type PlaceableStep } from "@/lib/concept/layout";
import type { ComparisonCell, ComparisonPanel, Concept } from "@/lib/concept/schema";

/**
 * A comparison: three alternatives against explicit criteria, revealed one
 * row at a time. One cell is "not applicable"; nothing is scored or ranked.
 */

const v = (text: string): ComparisonCell => ({ text, missing: null, color: "neutral", status: "active" });
const na = (): ComparisonCell => ({ text: "", missing: "not_applicable", color: "neutral", status: "active" });

const rows = {
  year: { id: "year", label: "First standardized", unit: "", cells: [v("1997"), v("2015"), v("2022")] },
  transport: { id: "transport", label: "Runs over", unit: "", cells: [v("TCP"), v("TCP"), v("QUIC over UDP")] },
  multiplex: { id: "multiplex", label: "Many requests at once", unit: "", cells: [v("No"), v("Yes, as streams"), v("Yes, as streams")] },
  loss: { id: "loss", label: "A lost packet stalls", unit: "", cells: [v("Its request"), v("All streams"), v("Only its stream")] },
  headers: { id: "headers", label: "Header compression", unit: "", cells: [v("None"), v("HPACK"), v("QPACK")] },
  push: { id: "push", label: "Server push", unit: "", cells: [na(), v("Defined, rarely used"), v("Defined, rarely used")] },
} satisfies Record<string, ComparisonPanel["criteria"][number]>;

type Row = keyof typeof rows;

const table = (shown: Row[], focus: Row | null = null): Omit<ComparisonPanel, "x" | "y"> => ({
  kind: "comparison",
  id: "versions",
  label: "HTTP versions",
  alternatives: ["HTTP/1.1", "HTTP/2", "HTTP/3"],
  criteria: shown.map((id) =>
    id === focus ? { ...rows[id], cells: rows[id].cells.map((cell) => ({ ...cell, color: "primary" as const })) } : rows[id],
  ),
});

const step = (id: string, text: string, shown: Row[], focus: Row | null, notes?: string): PlaceableStep => ({
  id,
  text,
  nodes: [],
  edges: [],
  panels: [table(shown, focus)],
  ...(notes ? { notes } : {}),
});

const content = layoutPlaceable(
  {
    title: "HTTP/1.1, HTTP/2, and HTTP/3 compared",
    description:
      "The three versions of HTTP carry the same requests and responses. This compares how each one moves them, criterion by criterion, without ranking them.",
    steps: [
      step("years", "Three versions of HTTP carry the same requests and responses, standardized years apart.", ["year"], "year", "HTTP/1.1 was first published as RFC 2068 in 1997, HTTP/2 as RFC 7540 in 2015, and HTTP/3 as RFC 9114 in 2022."),
      step("transport", "HTTP/1.1 and HTTP/2 run over TCP; HTTP/3 runs over QUIC, which uses UDP.", ["year", "transport"], "transport"),
      step(
        "multiplex",
        "HTTP/2 and HTTP/3 send many requests over one connection at once, as separate streams.",
        ["year", "transport", "multiplex"],
        "multiplex",
        "HTTP/1.1 handles one request at a time per connection, so browsers open several connections instead.",
      ),
      step(
        "loss",
        "A lost packet stalls every HTTP/2 stream, because TCP delivers bytes strictly in order.",
        ["year", "transport", "multiplex", "loss"],
        "loss",
        "QUIC tracks each stream separately, so in HTTP/3 a lost packet delays only the stream it belonged to.",
      ),
      step("headers", "HTTP/2 and HTTP/3 compress headers; HTTP/1.1 sends them as plain text.", ["year", "transport", "multiplex", "loss", "headers"], "headers"),
      step(
        "push",
        "Server push exists only in the newer versions, and is rarely used.",
        ["year", "transport", "multiplex", "loss", "headers", "push"],
        "push",
        "HTTP/1.1 has no server push, so that cell says not applicable rather than no.",
      ),
      step(
        "takeaway",
        "Each version keeps HTTP's meaning and changes how messages travel; none is simply best.",
        ["year", "transport", "multiplex", "loss", "headers", "push"],
        null,
        "Which one helps depends on the network: the newer versions matter most on lossy connections and pages with many requests.",
      ),
    ],
  },
  "comparison",
);

export const httpVersions: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a05",
  ...content,
  layout: "comparison",
  provenance: {
    request: { kind: "topic", topic: "HTTP/1.1 vs HTTP/2 vs HTTP/3", question: "", audience: "Web developers", language: "English", depth: "standard" },
    learningGoal: "Know how the three HTTP versions differ in moving the same requests, without treating one as best everywhere.",
    explanationType: "comparison",
    representation: "comparison",
    sourcesConsulted: false,
    sources: [],
    claims: [],
    scope: "What the standards define; not performance numbers, which depend on networks and implementations.",
    omissions: ["Connection setup and TLS handshakes in detail", "Prioritization"],
    simplifications: ["One word per cell where the standards say more"],
    uncertainty: [],
    limitations: [],
  },
};
