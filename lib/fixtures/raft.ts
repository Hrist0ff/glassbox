import type { Concept, VisualEdge, VisualNode } from "@/lib/concept/schema";

const POS = {
  s1: { x: 500, y: 95 },
  s2: { x: 700, y: 235 },
  s3: { x: 625, y: 455 },
  s4: { x: 375, y: 455 },
  s5: { x: 300, y: 235 },
} as const;

type ServerId = keyof typeof POS;

function server(
  id: ServerId,
  label: string,
  color: VisualNode["color"] = "neutral",
  status: VisualNode["status"] = "active",
): VisualNode {
  return { id, label, ...POS[id], shape: "circle", color, status };
}

const edge = (id: string, from: ServerId, to: ServerId, label: string, animated: boolean): VisualEdge => ({
  id,
  from,
  to,
  label,
  animated,
});

const offlineS5 = server("s5", "S5 offline", "danger", "inactive");

export const raftLeaderElection: Concept = {
  schemaVersion: 2,
  id: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
  title: "Raft leader election (simplified)",
  description:
    "How five Raft servers pick a single leader with randomized timeouts and majority votes. Covers elections only: log replication and commit safety are out of scope.",
  steps: [
    {
      id: "followers",
      text: "Five servers start as followers. Each waits to hear from a leader before its own timer runs out.",
      notes:
        "This story covers only how Raft picks a leader. Every server has an election timer set to a random duration (for example 150–300 ms); hearing from a leader resets it. The term is a logical clock that increases with each election.",
      nodes: [
        server("s1", "S1 follower (term 1)"),
        server("s2", "S2 follower (term 1)"),
        server("s3", "S3 follower (term 1)"),
        server("s4", "S4 follower (term 1)"),
        server("s5", "S5 follower (term 1)"),
      ],
      edges: [],
    },
    {
      id: "crash",
      text: "S5 crashes. Raft can still elect a leader as long as a majority, three of five, are reachable.",
      notes:
        "A majority of five servers is three. Any two majorities share at least one server, which is what later stops two leaders from winning the same term.",
      nodes: [
        server("s1", "S1 follower (term 1)"),
        server("s2", "S2 follower (term 1)"),
        server("s3", "S3 follower (term 1)"),
        server("s4", "S4 follower (term 1)"),
        offlineS5,
      ],
      edges: [],
    },
    {
      id: "timeout",
      text: "S3's timer expires first. It becomes a candidate, increases the term to 2, and votes for itself.",
      notes:
        "Randomized timeouts make it likely that one server times out well before the others, which lowers the chance that several candidates split the vote.",
      nodes: [
        server("s1", "S1 follower (term 1)"),
        server("s2", "S2 follower (term 1)"),
        server("s3", "S3 candidate (term 2)", "warning"),
        server("s4", "S4 follower (term 1)"),
        offlineS5,
      ],
      edges: [],
    },
    {
      id: "request-votes",
      text: "S3 sends RequestVote messages for term 2 to every other server, including the offline S5.",
      notes: "The message to S5 is simply lost. S3 does not need every server, only a majority.",
      nodes: [
        server("s1", "S1 follower (term 1)"),
        server("s2", "S2 follower (term 1)"),
        server("s3", "S3 candidate (term 2)", "warning"),
        server("s4", "S4 follower (term 1)"),
        offlineS5,
      ],
      edges: [
        edge("rv1", "s3", "s1", "RequestVote (term 2)", true),
        edge("rv2", "s3", "s2", "RequestVote (term 2)", true),
        edge("rv4", "s3", "s4", "RequestVote (term 2)", true),
        edge("rv5", "s3", "s5", "RequestVote (lost)", true),
      ],
    },
    {
      id: "votes",
      text: "S1 and S2 grant their votes. Once they arrive, S3 will hold three of five: a majority.",
      notes:
        "Each server votes for at most one candidate per term, first come first served. Full Raft also refuses votes to candidates whose log is behind; this story leaves logs out. S4's reply is still in flight, and S3 no longer needs it.",
      nodes: [
        server("s1", "S1 voted S3 (term 2)", "success"),
        server("s2", "S2 voted S3 (term 2)", "success"),
        server("s3", "S3 candidate (term 2)", "warning"),
        server("s4", "S4 follower (term 2)"),
        offlineS5,
      ],
      edges: [
        edge("vote1", "s1", "s3", "Vote granted", true),
        edge("vote2", "s2", "s3", "Vote granted", true),
      ],
    },
    {
      id: "leader",
      text: "With three of five votes, a majority, S3 becomes leader for term 2 and sends heartbeats.",
      notes:
        "Heartbeats are AppendEntries messages that carry no log entries. In full Raft the same message type also replicates the log, which this story does not cover.",
      nodes: [
        server("s1", "S1 follower (term 2)"),
        server("s2", "S2 follower (term 2)"),
        server("s3", "S3 leader (term 2)", "primary"),
        server("s4", "S4 follower (term 2)"),
        offlineS5,
      ],
      edges: [
        edge("hb1", "s3", "s1", "Heartbeat", true),
        edge("hb2", "s3", "s2", "Heartbeat", true),
        edge("hb4", "s3", "s4", "Heartbeat", true),
      ],
    },
    {
      id: "heartbeats",
      text: "Each heartbeat resets a follower's election timer, so no follower starts a competing election.",
      notes:
        "The leader keeps sending heartbeats more often than the shortest election timeout. If heartbeats stop because the leader fails, a follower times out and a new election begins with a higher term.",
      nodes: [
        server("s1", "S1 timer reset", "secondary"),
        server("s2", "S2 timer reset", "secondary"),
        server("s3", "S3 leader (term 2)", "primary"),
        server("s4", "S4 timer reset", "secondary"),
        offlineS5,
      ],
      edges: [
        edge("hb1", "s3", "s1", "Heartbeat", true),
        edge("hb2", "s3", "s2", "Heartbeat", true),
        edge("hb4", "s3", "s4", "Heartbeat", true),
      ],
    },
    {
      id: "recover",
      text: "S5 restarts, still on term 1. The leader's heartbeat for term 2 is on its way.",
      notes:
        "When the heartbeat arrives, S5 sees a higher term than its own, adopts term 2, and becomes a follower. That is how a stale server rejoins without disrupting the current leader.",
      nodes: [
        server("s1", "S1 follower (term 2)"),
        server("s2", "S2 follower (term 2)"),
        server("s3", "S3 leader (term 2)", "primary"),
        server("s4", "S4 follower (term 2)"),
        server("s5", "S5 restarted (term 1)"),
      ],
      edges: [
        edge("hb1", "s3", "s1", "Heartbeat", false),
        edge("hb2", "s3", "s2", "Heartbeat", false),
        edge("hb4", "s3", "s4", "Heartbeat", false),
        edge("hb5", "s3", "s5", "Heartbeat (term 2)", true),
      ],
    },
    {
      id: "takeaway",
      text: "Takeaway: one vote per server per term, plus majority wins, means at most one leader per term.",
      notes:
        "S5 has now received the heartbeat and follows S3 in term 2. This is Raft's Election Safety property. It does not by itself guarantee that committed log entries survive leader changes; full Raft adds log replication rules and a voting restriction for that. Elections can also fail when votes split, in which case servers time out again with new random timeouts.",
      nodes: [
        server("s1", "S1 follower (term 2)"),
        server("s2", "S2 follower (term 2)"),
        server("s3", "S3 leader (term 2)", "success"),
        server("s4", "S4 follower (term 2)"),
        server("s5", "S5 follower (term 2)"),
      ],
      edges: [
        edge("hb1", "s3", "s1", "Heartbeat", false),
        edge("hb2", "s3", "s2", "Heartbeat", false),
        edge("hb4", "s3", "s4", "Heartbeat", false),
        edge("hb5", "s3", "s5", "Heartbeat", false),
      ],
    },
  ],
};
