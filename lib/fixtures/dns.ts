import type { Concept, VisualEdge, VisualNode } from "@/lib/concept/schema";

type Overrides = Partial<Pick<VisualNode, "label" | "color" | "status">>;

const base = {
  laptop: { label: "Your laptop", x: 140, y: 300, shape: "square" },
  resolver: { label: "Recursive resolver", x: 400, y: 300, shape: "circle" },
  root: { label: "Root name server", x: 720, y: 95, shape: "circle" },
  tld: { label: ".com TLD server", x: 840, y: 300, shape: "circle" },
  auth: { label: "example.com name server", x: 720, y: 490, shape: "circle" },
  web: { label: "example.com web server", x: 140, y: 490, shape: "square" },
} as const;

type EntityId = keyof typeof base;

const n = (id: EntityId, overrides: Overrides = {}): VisualNode => ({
  id,
  ...base[id],
  color: "neutral",
  status: "active",
  ...overrides,
});

const done = (id: EntityId) => n(id, { status: "inactive" });

const e = (id: string, from: EntityId, to: EntityId, label: string, animated: boolean): VisualEdge => ({
  id,
  from,
  to,
  label,
  animated,
});

const QUERY = "A example.com?";

export const dnsResolution: Concept = {
  schemaVersion: 1,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a02",
  title: "How DNS finds an address",
  description:
    "Follow one lookup for example.com from your laptop through a recursive resolver, the root, the .com servers, and the domain's own name server, then see why the second lookup is instant.",
  steps: [
    {
      id: "start",
      text: "Your laptop wants to open example.com, but it needs the site's IP address first.",
      notes:
        "Computers connect using IP addresses. DNS, the Domain Name System, translates names like example.com into addresses. The operating system usually forwards the question to a recursive resolver run by an ISP, a company, or a public DNS service.",
      nodes: [n("laptop", { color: "primary" }), n("resolver")],
      edges: [],
    },
    {
      id: "ask-resolver",
      text: "The laptop asks its recursive resolver: what is the IPv4 address (A record) for example.com?",
      nodes: [n("laptop", { color: "primary" }), n("resolver")],
      edges: [e("q1", "laptop", "resolver", QUERY, true)],
    },
    {
      id: "cache-miss",
      text: "The resolver finds no cached answer, so it asks a root name server where to look.",
      notes: "Resolvers ship with a list of root server addresses, so they always know where to start.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        n("root"),
      ],
      edges: [e("q1", "laptop", "resolver", QUERY, false), e("q2", "resolver", "root", QUERY, true)],
    },
    {
      id: "root-referral",
      text: "The root server doesn't know the address, but refers the resolver to the .com servers.",
      notes:
        "Root servers only know which servers are responsible for each top-level domain, such as .com, .org, or .uk. Referrals are answers too: they say who to ask next.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        n("root", { color: "secondary" }),
        n("tld"),
      ],
      edges: [
        e("q1", "laptop", "resolver", QUERY, false),
        e("r1", "root", "resolver", "Referral: .com servers", true),
      ],
    },
    {
      id: "ask-tld",
      text: "The resolver repeats the same question to a .com TLD server.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        done("root"),
        n("tld"),
      ],
      edges: [e("q1", "laptop", "resolver", QUERY, false), e("q3", "resolver", "tld", QUERY, true)],
    },
    {
      id: "tld-referral",
      text: "The .com server refers it to example.com's own authoritative name servers.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        done("root"),
        n("tld", { color: "secondary" }),
        n("auth"),
      ],
      edges: [
        e("q1", "laptop", "resolver", QUERY, false),
        e("r2", "tld", "resolver", "Referral: example.com NS", true),
      ],
    },
    {
      id: "ask-auth",
      text: "The resolver asks the authoritative server, which holds the actual records for example.com.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        done("root"),
        done("tld"),
        n("auth"),
      ],
      edges: [e("q1", "laptop", "resolver", QUERY, false), e("q4", "resolver", "auth", QUERY, true)],
    },
    {
      id: "answer",
      text: "The authoritative server answers with the address and a time-to-live (TTL) of 300 seconds.",
      notes:
        "203.0.113.10 is a reserved documentation address used here as an example. The TTL tells resolvers how long they may reuse the answer before asking again.",
      nodes: [
        n("laptop"),
        n("resolver", { label: "Resolver: cache miss", color: "warning" }),
        done("root"),
        done("tld"),
        n("auth", { color: "success" }),
      ],
      edges: [
        e("q1", "laptop", "resolver", QUERY, false),
        e("a1", "auth", "resolver", "A 203.0.113.10, TTL 300", true),
      ],
    },
    {
      id: "cache-and-reply",
      text: "The resolver caches the answer for 300 seconds and returns the address to your laptop.",
      nodes: [
        n("laptop", { color: "primary" }),
        n("resolver", { label: "Resolver: cached 300 s", color: "success" }),
        done("root"),
        done("tld"),
        done("auth"),
      ],
      edges: [e("a2", "resolver", "laptop", "203.0.113.10", true)],
    },
    {
      id: "connect",
      text: "Now the laptop can open a connection to the web server at 203.0.113.10.",
      notes: "DNS only supplies the address. Opening the HTTPS connection is a separate protocol step.",
      nodes: [
        n("laptop", { color: "primary" }),
        n("resolver", { label: "Resolver: cached 300 s", color: "success" }),
        done("root"),
        done("tld"),
        done("auth"),
        n("web", { color: "success" }),
      ],
      edges: [e("c1", "laptop", "web", "HTTPS to 203.0.113.10", true)],
    },
    {
      id: "cache-hit",
      text: "Takeaway: another lookup within 300 seconds is answered from the resolver's cache, skipping three servers.",
      notes:
        "Caching happens at several levels: browser, operating system, and resolver. Cached answers can be stale until the TTL expires, which is why DNS changes take time to be seen everywhere. Resolvers also cache referrals, so even a different .com name can skip the root.",
      nodes: [
        n("laptop", { color: "primary" }),
        n("resolver", { label: "Resolver: cache hit", color: "success" }),
        done("root"),
        done("tld"),
        done("auth"),
        done("web"),
      ],
      edges: [
        e("q5", "laptop", "resolver", QUERY, false),
        e("a3", "resolver", "laptop", "Cached: 203.0.113.10", true),
      ],
    },
  ],
};
