import { layoutPlaceable, type PlaceableStep } from "@/lib/concept/layout";
import type { Concept, TimelineItem, TimelinePanel } from "@/lib/concept/schema";

/**
 * A timeline with parallel lanes, durations, proportional spacing, and typed
 * relations. The incident is invented for illustration, and its provenance
 * says so; its point is that closeness in time is not causation.
 */

type Item = TimelineItem & { id: string };

const ev = (id: string, tag: string, text: string, lane: number, at: number, extra: Partial<TimelineItem> = {}): Item => ({
  id,
  text,
  tag,
  lane,
  at,
  date: "exact",
  color: "neutral",
  status: "active",
  ...extra,
});

const all = {
  deploy: ev("deploy", "14:00", "Deploy v2.3 runs", 2, 0, { end: 2 }),
  disk: ev("disk", "14:04", "Disk fills up", 1, 4),
  errors: ev("errors", "14:05", "Error rate rises", 0, 5),
  alert: ev("alert", "14:07", "On-call paged", 2, 7),
  rollback: ev("rollback", "14:12", "Deploy rolled back", 2, 12),
  cleanup: ev("cleanup", "14:20", "Old logs deleted", 1, 20),
  recovery: ev("recovery", "14:21", "Errors stop", 0, 21),
} satisfies Record<string, Item>;

type Id = keyof typeof all;

const timeline = (ids: Id[], options: { focus?: Id[]; dim?: Id[]; relations?: TimelinePanel["relations"] } = {}): Omit<TimelinePanel, "x" | "y"> => ({
  kind: "timeline",
  id: "incident",
  label: "Checkout outage (illustrative)",
  lanes: ["Website", "Database", "Team"],
  spacing: "proportional",
  unit: "min after 14:00",
  items: ids.map((id) => ({
    ...all[id],
    ...(options.focus?.includes(id) ? { color: "primary" as const } : {}),
    ...(options.dim?.includes(id) ? { status: "inactive" as const } : {}),
  })),
  ...(options.relations ? { relations: options.relations } : {}),
});

const step = (id: string, text: string, panel: ReturnType<typeof timeline>, extra: Partial<PlaceableStep> = {}): PlaceableStep => ({
  id,
  text,
  nodes: [],
  edges: [],
  panels: [panel],
  claims: ["a1"],
  ...extra,
});

const content = layoutPlaceable(
  {
    title: "Reading an incident timeline",
    description:
      "An invented website outage, minute by minute, in three lanes. It shows why the event just before a failure is not necessarily its cause.",
    steps: [
      step("deploy", "At 14:00 the team deploys version 2.3; the deploy finishes two minutes later.", timeline(["deploy"], { focus: ["deploy"] }), {
        notes: "The bar shows how long the deploy ran. Events are spaced to scale: the axis counts minutes after 14:00.",
      }),
      step("disk", "At 14:04 the database's disk fills up.", timeline(["deploy", "disk"], { focus: ["disk"] }), {
        notes: "Nobody notices yet: this happens in a different lane from the deploy.",
      }),
      step("errors", "At 14:05 the website's error rate rises.", timeline(["deploy", "disk", "errors"], { focus: ["errors"] }), {
        notes: "The deploy ended three minutes earlier, so it is the obvious suspect. Being close in time is not evidence of cause.",
      }),
      step(
        "alert",
        "At 14:07 an alert pages the on-call engineer, in response to the errors.",
        timeline(["deploy", "disk", "errors", "alert"], { focus: ["alert"], relations: [{ from: "errors", to: "alert", type: "responds_to" }] }),
      ),
      step(
        "rollback",
        "Rolling back the deploy at 14:12 does not stop the errors.",
        timeline(["deploy", "disk", "errors", "alert", "rollback"], {
          focus: ["rollback"],
          relations: [{ from: "errors", to: "alert", type: "responds_to" }],
        }),
        { notes: "If the deploy had caused the errors, undoing it should have helped." },
      ),
      step(
        "cleanup",
        "Deleting old logs frees disk space at 14:20, and errors stop a minute later.",
        timeline(["deploy", "disk", "errors", "alert", "rollback", "cleanup", "recovery"], {
          focus: ["cleanup", "recovery"],
          relations: [
            { from: "errors", to: "alert", type: "responds_to" },
            { from: "cleanup", to: "recovery", type: "causes" },
          ],
        }),
      ),
      step(
        "takeaway",
        "The full disk caused the errors; the deploy only happened to come first.",
        timeline(["deploy", "disk", "errors", "alert", "rollback", "cleanup", "recovery"], {
          focus: ["disk", "errors"],
          dim: ["deploy", "rollback"],
          relations: [
            { from: "disk", to: "errors", type: "causes" },
            { from: "errors", to: "alert", type: "responds_to" },
            { from: "cleanup", to: "recovery", type: "causes" },
          ],
        }),
        { notes: "Arcs show only relations that were established: the rollback test ruled out the deploy, and freeing space fixed the errors." },
      ),
    ],
  },
  "timeline",
);

export const incidentTimeline: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a04",
  ...content,
  layout: "timeline",
  provenance: {
    request: { kind: "topic", topic: "How to read an incident timeline", question: "", audience: "Anyone who reads incident reports", language: "English", depth: "standard" },
    learningGoal: "See that the event just before a failure is not necessarily its cause, and how evidence separates the two.",
    explanationType: "chronology",
    representation: "timeline",
    sourcesConsulted: false,
    sources: [],
    claims: [
      { id: "a1", text: "The company, times, and events are invented for illustration.", basis: "assumption", passages: [], quote: "" },
    ],
    scope: "One illustrative outage; real incident reviews involve more evidence and more people.",
    omissions: ["How the disk filled up", "How the team decided what to try"],
    simplifications: ["Each lane shows only the events this story needs"],
    uncertainty: [],
    limitations: [],
  },
};
