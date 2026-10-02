import type { Concept, PanelItem } from "@/lib/concept/schema";

/**
 * A small concept that exercises every panel kind, message rounds, focus, and
 * `messages_first` timing. Used by tests and for visual checks of the player.
 */

const item = (text: string, extra: Partial<PanelItem> = {}): PanelItem => ({ text, tag: "", color: "neutral", status: "active", ...extra });

const client = { id: "client", label: "Client", x: 120, y: 110, shape: "circle", color: "secondary", status: "active" } as const;
const server = { id: "server", label: "Server", x: 380, y: 110, shape: "square", color: "neutral", status: "active" } as const;

const code = (highlight: number) => ({
  kind: "code" as const,
  id: "handler",
  label: "server code",
  x: 250,
  y: 400,
  lines: ["def handle(request):", "    path = request.path", "    if path in cache:", "        return cache[path]", "    page = render(path)", "    return page"].map(
    (text, i) => ({ text, highlight: i === highlight }),
  ),
});

const log = (items: PanelItem[]) => ({ kind: "log" as const, id: "requests", label: "request log", x: 720, y: 110, items });

const memo = {
  kind: "table" as const,
  id: "memo",
  label: "cache",
  x: 720,
  y: 330,
  columns: ["path", "status", "hits"],
  rows: [
    { label: "row 1", cells: [item("/a"), item("200", { color: "success" }), item("1")] },
    { label: "row 2", cells: [item("/b"), item("miss", { color: "warning" }), item("0", { status: "inactive" })] },
  ],
};

const history = {
  kind: "timeline" as const,
  id: "history",
  label: "what happened",
  x: 720,
  y: 520,
  items: [item("first request", { tag: "t=0" }), item("cached", { tag: "t=1", color: "success" }), item("second request", { tag: "t=2" })],
};

export const panelsConcept: Concept = {
  schemaVersion: 2,
  id: "9b1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a99",
  title: "A request, its log, and a cache",
  description: "A test explanation that uses a log, code, a table, and a timeline, with a request and its reply in one step.",
  steps: [
    {
      id: "start",
      text: "A client and a server start with an empty request log.",
      nodes: [client, server],
      edges: [],
      panels: [log([]), code(0)],
    },
    {
      id: "request",
      text: "The client asks for /a, the server replies, and the request is logged.",
      nodes: [client, { ...server, color: "primary" }],
      edges: [
        { id: "req", from: "client", to: "server", label: "GET /a", animated: true },
        { id: "resp", from: "server", to: "client", label: "200 OK", animated: true, order: 2 },
        { id: "write", from: "server", to: "requests", label: "", animated: true, order: 2 },
      ],
      panels: [log([item("GET /a", { tag: "0" })]), code(4)],
      timing: "messages_first",
      notes: "The reply only leaves the server once the request has arrived.",
    },
    {
      id: "cache",
      text: "The server remembers the page in its cache table.",
      nodes: [client, server],
      edges: [],
      panels: [log([item("GET /a", { tag: "0" })]), code(3), memo],
      focus: ["memo"],
    },
    {
      id: "later",
      text: "Later requests reuse the open connection, and the log keeps growing.",
      nodes: [client, server],
      edges: [{ id: "conn", from: "client", to: "server", label: "keep-alive", animated: false }],
      panels: [log([item("GET /a", { tag: "0" }), item("GET /b", { tag: "1", color: "primary" })]), memo, history],
    },
  ],
};
