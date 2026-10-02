import { add, append, cursor, dot, log, node, packet, records, remove, retext, send, set, text, timer, tone, truncate } from "@/lib/story/dsl";
import type { Cell, Step, Story, Tone } from "@/lib/story/types";

/**
 * Kafka, from the log up: offsets, producers, consumers, partitions,
 * consumer groups, replication, and leader failover.
 */

const record = (value: string, offset: number, cellTone?: Tone): Cell =>
  cellTone ? { text: value, tag: String(offset), tone: cellTone } : { text: value, tag: String(offset) };

/** Tone a range of cells in one go. */
const toneAll = (of: string, from: number, to: number, value: Tone, after = 0): Step[] =>
  Array.from({ length: to - from + 1 }, (_, i) => tone(of, from + i, value, i === 0 ? after : 0));

/** A consumer reading cells `from..to` of `logId` one by one, moving its cursor. */
function readRange(logId: string, consumer: string, cursorId: string, from: number, to: number, ink: "orange" | "purple" | "steelblue", gap = 450): Step[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    send({ log: logId, index: from + i }, consumer, dot(ink), {
      after: i === 0 ? 0 : gap,
      duration: 700,
      then: [set(cursorId, { index: from + i + 1 })],
    }),
  );
}

/** Three brokers stacked on the left, each with a copy of one partition. */
const BROKER_X = 24;
const LOG_X = 36;
const ROW = { 1: 22, 2: 50, 3: 78 } as const;
const broker = (n: 1 | 2 | 3, desc: string[] = [`broker ${n}`], extra: Parameters<typeof node>[4] = {}) =>
  node(`k${n}`, BROKER_X, ROW[n], "steelblue", { desc, ...extra });
const replica = (n: 1 | 2 | 3, cells: Cell[]) => log(`l${n}`, LOG_X, ROW[n] - 3, cells, { label: "P0" });
const producer = (x = 8, y = 50) => node("p", x, y, "green", { desc: ["producer"] });

/** Follower `n` fetches from leader `leader`; the reply appends `cell` to the follower's copy. */
const replicate = (n: 2 | 3 | 1, leader: 1 | 2, cell: Cell, after = 0, then: Step[] = []): Step =>
  send(`k${n}`, `k${leader}`, dot("red", true), {
    after,
    duration: 700,
    then: [send(`k${leader}`, `k${n}`, dot("red"), { after: 100, duration: 700, then: [append(`l${n}`, cell), ...then] })],
  });

const committed = (count: number) => records(Array.from({ length: count }, (_, i) => `o${i + 1}`), { firstOffset: 0 });

export const kafka: Story = {
  slug: "kafka",
  title: "Kafka",
  subtitle: "A Distributed Commit Log",
  summary: "Logs, offsets, partitions, consumer groups, and replication: how Kafka moves streams of records between systems.",
  chapters: [
    {
      id: "home",
      title: "Home",
      beats: [{ title: { heading: "Kafka", sub: "A Distributed Commit Log" } }],
    },
    {
      id: "log",
      title: "What is a Log?",
      beats: [
        { title: { heading: "So what is Kafka?", sub: "Let's start with a log..." } },
        {
          say: "Kafka is built around one simple idea: the *log*.",
          run: [add(log("log", 29, 36, [])), append("log", { text: "+3" }, 500), append("log", { text: "-1" }, 500), append("log", { text: "+5" }, 500)],
        },
        {
          say: "Not a file of error messages, but an ordered list of *records*.",
          run: [append("log", { text: "+2" }, 300), append("log", { text: "-4" }, 500)],
        },
        {
          say: "New records are always added to the end. Records that are already written never change.",
          run: [append("log", { text: "+6" }, 300)],
        },
        {
          say: "Each record has a position number called its *offset*, counting up from 0.",
          run: Array.from({ length: 6 }, (_, i) => retext("log", i, { tag: String(i) }, i === 0 ? 0 : 150)),
        },
        {
          say: "To use the log, an app reads it from the start and applies each record in order.",
          run: [add(node("a", 36, 74, "steelblue", { value: "0", desc: ["app A"], descAt: "below" })), add(cursor("ca", "log", 0, "steelblue", "A"), 400)],
        },
        {
          say: "Reading every record rebuilds the current value: 3, 2, 7, 9, 5, 11.",
          run: [3, 2, 7, 9, 5, 11].map((value, i) =>
            send({ log: "log", index: i }, "a", dot("steelblue"), {
              after: i === 0 ? 0 : 750,
              duration: 600,
              then: [set("a", { value: String(value) }), set("ca", { index: i + 1 })],
            }),
          ),
        },
        {
          say: "A second app reading the same log ends up with exactly the same value.",
          run: [
            add(node("b", 64, 74, "steelblue", { value: "0", desc: ["app B"], descAt: "below" })),
            add(cursor("cb", "log", 0, "steelblue", "B"), 300),
            ...[3, 2, 7, 9, 5, 11].map((value, i) =>
              send({ log: "log", index: i }, "b", dot("steelblue"), {
                after: i === 0 ? 400 : 300,
                duration: 450,
                then: [set("b", { value: String(value) }), set("cb", { index: i + 1 })],
              }),
            ),
          ],
        },
        { say: "Kafka stores streams of records in logs like this one, spread over many servers." },
      ],
    },
    {
      id: "producers",
      title: "Producers & Topics",
      beats: [
        { title: { heading: "Producers & Topics" } },
        {
          say: "A Kafka server is called a [broker|steelblue].",
          run: [add(node("k", 30, 50, "steelblue", { desc: ["broker 1"] }), 300)],
        },
        {
          say: "Brokers keep records in named logs called *topics*. Here is a topic named `orders`.",
          run: [add(log("orders", 46, 47, [], { label: "orders" }), 300)],
        },
        {
          say: "Apps that write records are called [producers|green].",
          run: [add(producer(9, 50), 300)],
        },
        {
          say: "A producer sends a record to the broker, which appends it to the end of the topic...",
          run: [send("p", "k", packet("o1", "green"), { duration: 1000, then: [append("orders", record("o1", 0))] })],
        },
        {
          say: "...and replies with the record's offset, so the producer knows it's stored.",
          run: [send("k", "p", packet("offset 0"), { after: 200, duration: 1000 })],
        },
        {
          say: "Many producers can write to the same topic at the same time.",
          run: [
            set("p", { y: 30 }),
            add(node("p2", 9, 70, "green", { desc: ["producer"] }), 300),
            send("p", "k", packet("o2", "green"), { after: 700, duration: 900, then: [append("orders", record("o2", 1))] }),
            send("p2", "k", packet("o3", "green"), { after: 250, duration: 900, then: [append("orders", record("o3", 2))] }),
            send("p", "k", packet("o4", "green"), { after: 450, duration: 900, then: [append("orders", record("o4", 3))] }),
          ],
        },
        {
          say: "Records stay on disk after they're read. They're kept for a set time, 7 days by default, and then deleted.",
          size: "md",
        },
        {
          say: "Only ever writing to the end of a file is something disks do very fast. It's a big part of why Kafka is fast.",
          size: "md",
        },
      ],
    },
    {
      id: "consumers",
      title: "Consumers & Offsets",
      beats: [
        { title: { heading: "Consumers & Offsets" } },
        {
          say: "Here's our `orders` topic again, with six records in it.",
          run: [
            add(producer(8, 28)),
            add(node("k", 24, 28, "steelblue", { desc: ["broker 1"] })),
            add(log("orders", 38, 25, committed(6), { label: "orders", cellW: 6 }), 300),
          ],
        },
        {
          say: "Apps that read records are called [consumers|orange].",
          run: [add(node("ca", 50, 74, "orange", { desc: ["consumer A"], descAt: "below" }), 300)],
        },
        {
          say: "A consumer reads in order, and keeps track of the next offset it will read.",
          run: [add(cursor("cur-a", "orders", 0, "orange", "A"), 300)],
        },
        {
          say: "It asks the broker for records from that offset...",
          run: [send("ca", "k", packet("fetch from 0", "orange"), { duration: 1100 })],
        },
        {
          say: "...and gets a batch of them back.",
          run: readRange("orders", "ca", "cur-a", 0, 2, "orange", 250),
        },
        {
          say: "Then it *commits* its offset, which saves its position in Kafka.",
          run: [send("ca", "k", packet("commit 3", "orange"), { duration: 1100, then: [set("k", { desc: ["broker 1", "A is at 3"] })] })],
        },
        {
          say: "If the consumer crashes and restarts, it picks up from the offset it committed.",
          run: [
            set("ca", { fill: "gray" }, 200),
            set("ca", { fill: "orange" }, 1300),
            send("ca", "k", packet("fetch from 3", "orange"), {
              after: 500,
              duration: 1000,
              then: [
                ...readRange("orders", "ca", "cur-a", 3, 5, "orange", 250),
                send("ca", "k", packet("commit 6", "orange"), { after: 1100, duration: 1000, then: [set("k", { desc: ["broker 1", "A is at 6"] })] }),
              ],
            }),
          ],
        },
        {
          say: "Reading doesn't remove anything, so a second consumer can read the same records.",
          run: [
            add(node("cb", 80, 74, "purple", { desc: ["consumer B"], descAt: "below" })),
            add(cursor("cur-b", "orders", 0, "purple", "B"), 300),
            ...readRange("orders", "cb", "cur-b", 0, 5, "purple", 250).map((s, i) => (i === 0 ? { ...s, after: 600 } : s)),
          ],
        },
        {
          say: "Each consumer moves at its own pace. A slow one falls behind without slowing anyone else down.",
          size: "md",
          run: [
            send("p", "k", packet("o7", "green"), { duration: 700, then: [append("orders", record("o7", 6))] }),
            send("p", "k", packet("o8", "green"), { after: 500, duration: 700, then: [append("orders", record("o8", 7))] }),
            send("p", "k", packet("o9", "green"), { after: 500, duration: 700, then: [append("orders", record("o9", 8))] }),
            ...readRange("orders", "ca", "cur-a", 6, 8, "orange", 500).map((s, i) => (i === 0 ? { ...s, after: 300 } : s)),
            send({ log: "orders", index: 6 }, "cb", dot("purple"), { after: 900, duration: 1400, then: [set("cur-b", { index: 7 })] }),
          ],
        },
        {
          say: "A consumer can even move its offset back to re-read old records, for example after fixing a bug.",
          size: "md",
          run: [set("cur-b", { index: 0 }, 300), ...readRange("orders", "cb", "cur-b", 0, 3, "purple", 200).map((s, i) => (i === 0 ? { ...s, after: 800 } : s))],
        },
      ],
    },
    {
      id: "partitions",
      title: "Partitions",
      beats: [
        { title: { heading: "Partitions" } },
        {
          say: "A single log on a single broker can only grow so big and handle so much traffic.",
          run: [add(producer()), add(node("k1", BROKER_X, 50, "steelblue", { desc: ["broker 1"] })), add(log("orders", LOG_X, 47, committed(5), { label: "orders" }), 300)],
        },
        {
          say: "So a topic is split into *partitions*: separate logs that can live on different brokers.",
          run: [
            remove("orders"),
            set("k1", { y: ROW[1] }, 300),
            add(broker(2), 500),
            add(broker(3), 200),
            add(log("p0", LOG_X, ROW[1] - 3, [], { label: "P0" }), 300),
            add(log("p1", LOG_X, ROW[2] - 3, [], { label: "P1" }), 100),
            add(log("p2", LOG_X, ROW[3] - 3, [], { label: "P2" }), 100),
          ],
        },
        {
          say: "When a record has a *key*, the producer picks its partition by hashing the key.",
          run: [
            send("p", "k2", packet("key=ana"), { duration: 900, then: [append("p1", record("ana", 0))] }),
            send("p", "k1", packet("key=bob"), { after: 700, duration: 900, then: [append("p0", record("bob", 0))] }),
            send("p", "k2", packet("key=ana"), { after: 700, duration: 900, then: [append("p1", record("ana", 1))] }),
          ],
        },
        {
          say: "So all records with the same key land in the same partition, in the order they were sent.",
          size: "md",
          run: [
            send("p", "k3", packet("key=cy"), { duration: 900, then: [append("p2", record("cy", 0))] }),
            send("p", "k2", packet("key=ana"), { after: 600, duration: 900, then: [append("p1", record("ana", 2))] }),
            send("p", "k1", packet("key=bob"), { after: 600, duration: 900, then: [append("p0", record("bob", 1))] }),
            ...toneAll("p1", 0, 2, "focus", 2300),
          ],
        },
        {
          say: "Each partition counts its own offsets, so order is only guaranteed *within* a partition, not across them.",
          size: "md",
          run: toneAll("p1", 0, 2, "normal"),
        },
        {
          say: "Records without a key are spread across the partitions to balance the load.",
          size: "md",
          run: [
            send("p", "k1", packet("no key"), { duration: 900, then: [append("p0", record("x", 2))] }),
            send("p", "k3", packet("no key"), { after: 500, duration: 900, then: [append("p2", record("x", 1))] }),
            send("p", "k3", packet("no key"), { after: 500, duration: 900, then: [append("p2", record("x", 2))] }),
          ],
        },
        {
          say: "More partitions let more brokers share the writes, and more consumers share the reads.",
          size: "md",
        },
      ],
    },
    {
      id: "groups",
      title: "Consumer Groups",
      beats: [
        { title: { heading: "Consumer Groups" } },
        {
          say: "Let's hide the brokers and look at just the three partitions.",
          run: [
            add(log("g0", 16, 22, committed(5), { label: "P0", cellW: 6 })),
            add(log("g1", 16, 47, committed(5), { label: "P1", cellW: 6 }), 150),
            add(log("g2", 16, 72, committed(5), { label: "P2", cellW: 6 }), 150),
          ],
        },
        {
          say: "To read faster, consumers join a *consumer group* and split the partitions between them.",
          size: "md",
          run: [
            add(node("c1", 80, 37, "orange", { desc: ["c1: P0 P1"] }), 300),
            add(node("c2", 80, 75, "orange", { desc: ["c2: P2"] }), 300),
          ],
        },
        {
          say: "Each partition is read by exactly one consumer in the group.",
          run: [0, 1, 2, 3, 4].flatMap((i) => [
            send({ log: "g0", index: i }, "c1", dot("orange"), { after: i === 0 ? 0 : 250, duration: 800 }),
            send({ log: "g1", index: i }, "c1", dot("orange"), { after: 150, duration: 800 }),
            send({ log: "g2", index: i }, "c2", dot("orange"), { after: 150, duration: 800 }),
          ]),
        },
        {
          say: "When a new consumer joins, the group *rebalances* and the partitions are shared out again.",
          size: "md",
          run: [
            add(node("c3", 80, 50, "orange", { desc: ["c3: P1"] }), 200),
            set("c1", { y: 25, desc: ["c1: P0"] }, 600),
            ...[0, 1, 2].flatMap((i) => [
              send({ log: "g0", index: 4 }, "c1", dot("orange"), { after: i === 0 ? 900 : 300, duration: 800 }),
              send({ log: "g1", index: 4 }, "c3", dot("orange"), { after: 100, duration: 800 }),
              send({ log: "g2", index: 4 }, "c2", dot("orange"), { after: 100, duration: 800 }),
            ]),
          ],
        },
        {
          say: "If a consumer fails, its partitions are handed to the others.",
          run: [
            set("c3", { fill: "gray" }, 200),
            remove("c3", 900),
            set("c1", { y: 37, desc: ["c1: P0 P1"] }, 300),
            send({ log: "g1", index: 4 }, "c1", dot("orange"), { after: 700, duration: 800 }),
            send({ log: "g0", index: 4 }, "c1", dot("orange"), { after: 200, duration: 800 }),
          ],
        },
        {
          say: "A group can't use more consumers than there are partitions. Any extra consumers sit idle.",
          size: "md",
          run: [
            add(node("c3", 80, 50, "orange", { desc: ["c3: P1"] })),
            set("c1", { y: 25, desc: ["c1: P0"] }, 300),
            add(node("c4", 58, 92, "orange", { desc: ["c4: idle"] }), 700),
          ],
        },
        {
          say: "A different group, say for analytics, reads the same partitions with its own offsets.",
          size: "md",
          run: [
            remove("c4"),
            add(node("an", 58, 92, "purple", { desc: ["analytics"] }), 500),
            ...[0, 1].flatMap((round) =>
              (["g0", "g1", "g2"] as const).map((g, i) =>
                send({ log: g, index: round }, "an", dot("purple"), { after: round === 0 && i === 0 ? 600 : 200, duration: 900 }),
              ),
            ),
          ],
        },
      ],
    },
    {
      id: "replication",
      title: "Replication",
      beats: [
        { title: { heading: "Replication" } },
        {
          say: "What happens if a broker's disk fails? Every partition stored on it is lost.",
          run: [
            add(producer()),
            add(node("k1", BROKER_X, 50, "steelblue", { desc: ["broker 1"] })),
            add(log("l1", LOG_X, 47, committed(3), { label: "P0" }), 300),
            set("k1", { fill: "gray" }, 1300),
            ...toneAll("l1", 0, 2, "muted"),
          ],
        },
        {
          say: "So Kafka copies each partition to several brokers. Each copy is called a *replica*.",
          run: [
            set("k1", { fill: "steelblue", y: ROW[1] }, 200),
            set("l1", { y: ROW[1] - 3 }),
            ...toneAll("l1", 0, 2, "normal"),
            add(broker(2), 500),
            add(replica(2, committed(3))),
            add(broker(3), 300),
            add(replica(3, committed(3))),
          ],
        },
        {
          say: "One replica is the *leader*, and the others are *followers*.",
          run: [
            set("k1", { ring: "solid", desc: ["broker 1", "leader"] }, 200),
            set("k2", { desc: ["broker 2", "follower"] }, 300),
            set("k3", { desc: ["broker 3", "follower"] }, 100),
          ],
        },
        {
          say: "Producers always write to the leader. The new record isn't committed yet, so it's shown in red.",
          size: "md",
          run: [send("p", "k1", packet("o4", "green"), { duration: 1000, then: [append("l1", record("o4", 3, "pending"))] })],
        },
        {
          say: "Followers keep fetching from the leader and add new records to their own copy.",
          run: [replicate(2, 1, record("o4", 3, "pending")), replicate(3, 1, record("o4", 3, "pending"), 150)],
        },
        {
          say: "Replicas that are fully caught up form the *in-sync replicas*, or ISR.",
          run: [add(text("isr", 86, 50, "ISR: 1 2 3"), 200)],
        },
        {
          say: "When every in-sync replica has the record, it's *committed*.",
          run: [
            send("k3", "k1", dot("red", true), { duration: 700 }),
            send("k2", "k1", dot("red", true), {
              after: 100,
              duration: 700,
              then: [
                tone("l1", 3, "normal"),
                send("k1", "k2", dot("red"), { after: 300, duration: 700, then: [tone("l2", 3, "normal")] }),
                send("k1", "k3", dot("red"), { after: 100, duration: 700, then: [tone("l3", 3, "normal")] }),
              ],
            }),
          ],
        },
        {
          say: "Only then does the leader confirm the write, if the producer asked for `acks=all`.",
          run: [send("k1", "p", packet("ack"), { duration: 1000 })],
        },
        {
          say: "The point up to which records are committed is called the *high watermark*.",
          run: [add(cursor("hw", "l1", 4, "black", "HW"), 200)],
        },
        {
          say: "A new record arrives, but the high watermark doesn't move until it's been replicated.",
          size: "md",
          run: [send("p", "k1", packet("o5", "green"), { duration: 1000, then: [append("l1", record("o5", 4, "pending"))] })],
        },
        {
          say: "Consumers only read below the high watermark, so they never see a record that could still disappear.",
          size: "md",
          run: [
            add(node("c", 88, 22, "orange", { desc: ["consumer"] })),
            ...[0, 1, 2, 3].map((i) => send({ log: "l1", index: i }, "c", dot("orange"), { after: i === 0 ? 600 : 300, duration: 800 })),
          ],
        },
        {
          say: "A follower that falls too far behind is dropped from the ISR, so it can't hold up commits.",
          size: "md",
          run: [
            set("k3", { desc: ["broker 3", "too slow"] }),
            set("isr", { text: "ISR: 1 2" }, 600),
            replicate(2, 1, record("o5", 4, "pending"), 600, [
              send("k2", "k1", dot("red", true), {
                after: 200,
                duration: 700,
                then: [tone("l1", 4, "normal"), set("hw", { index: 5 }), tone("l2", 4, "normal", 800)],
              }),
            ]),
          ],
        },
      ],
    },
    {
      id: "failover",
      title: "Broker Failure",
      beats: [
        { title: { heading: "Broker Failure" } },
        {
          say: "Here's our partition again. Broker 1 leads, and record o5 isn't committed yet.",
          size: "md",
          run: [
            add(producer()),
            add(broker(1, ["broker 1", "leader"], { ring: "solid" })),
            add(replica(1, [...committed(4), record("o5", 4, "pending")])),
            add(broker(2, ["broker 2", "follower"]), 200),
            add(replica(2, committed(4))),
            add(broker(3, ["broker 3", "follower"]), 200),
            add(replica(3, committed(4))),
            add(cursor("hw", "l1", 4, "black", "HW"), 300),
            add(text("isr", 86, 50, "ISR: 1 2 3"), 200),
          ],
        },
        {
          say: "Let's crash the leader and see what happens.",
          run: [set("k1", { fill: "gray", ring: "none", desc: ["broker 1", "down"] }, 300), remove("hw"), ...toneAll("l1", 0, 4, "muted")],
        },
        {
          say: "The cluster's [controller|black] notices that broker 1 is gone...",
          run: [add(node("ctl", 86, 22, "black", { desc: ["controller"] }), 200), timer("ctl", 1200, 400), set("isr", { text: "ISR: 2 3" }, 1200)],
        },
        {
          say: "...and makes another in-sync replica, broker 2, the new leader.",
          run: [
            send("ctl", "k2", packet("lead P0"), {
              duration: 1100,
              then: [set("k2", { ring: "solid", desc: ["broker 2", "leader"] }), add(cursor("hw2", "l2", 4, "black", "HW"), 300)],
            }),
          ],
        },
        {
          say: "Every committed record is on broker 2, so none of them are lost.",
          run: toneAll("l2", 0, 3, "focus", 200),
        },
        {
          say: "Record o5 was never committed, so it's gone. But the producer never got an ack for it, so it sends it again.",
          size: "md",
          run: [
            ...toneAll("l2", 0, 3, "normal"),
            send("p", "k2", packet("o5", "green"), { after: 300, duration: 1000, then: [append("l2", record("o5", 4, "pending"))] }),
          ],
        },
        {
          say: "Broker 3 fetches it, the record commits, and the producer gets its ack.",
          run: [
            replicate(3, 2, record("o5", 4, "pending"), 0, [
              send("k3", "k2", dot("red", true), {
                after: 200,
                duration: 700,
                then: [
                  tone("l2", 4, "normal"),
                  set("hw2", { index: 5 }),
                  tone("l3", 4, "normal", 300),
                  send("k2", "p", packet("ack"), { duration: 1000 }),
                ],
              }),
            ]),
          ],
        },
        {
          say: "When broker 1 comes back, it first throws away anything that was never committed...",
          run: [set("k1", { fill: "steelblue", desc: ["broker 1", "follower"] }, 200), ...toneAll("l1", 0, 3, "normal", 400), truncate("l1", 4, 900)],
        },
        {
          say: "...then catches up from the new leader and rejoins the ISR.",
          run: [replicate(1, 2, record("o5", 4), 200, [set("isr", { text: "ISR: 1 2 3" }, 300)])],
        },
      ],
    },
    {
      id: "recap",
      title: "Recap",
      beats: [
        { title: { heading: "Recap" } },
        {
          say: "Kafka is a log: producers append records to the end, and the records stay there, in order.",
          size: "md",
          run: [
            add(producer(10, 50)),
            add(node("k", 28, 50, "steelblue", { desc: ["broker"] })),
            add(log("orders", 40, 47, [])),
            add(node("c", 92, 50, "orange", { desc: ["consumer"] })),
            add(cursor("cur", "orders", 0, "orange"), 200),
            ...[0, 1, 2].map((i) =>
              send("p", "k", packet(`o${i + 1}`, "green"), {
                after: i === 0 ? 500 : 700,
                duration: 800,
                then: [
                  append("orders", record(`o${i + 1}`, i)),
                  send({ log: "orders", index: i }, "c", dot("orange"), { after: 300, duration: 800, then: [set("cur", { index: i + 1 })] }),
                ],
              }),
            ),
          ],
        },
        { say: "Topics are split into partitions, so they can spread over many brokers.", size: "md" },
        { say: "Consumers keep track of their own offsets, and consumer groups share partitions between members.", size: "md" },
        { say: "Replication keeps every partition safe when a broker fails.", size: "md" },
        {
          say: "Want to go deeper?",
          size: "md",
          links: [
            { text: "Apache Kafka documentation", href: "https://kafka.apache.org/documentation/" },
            {
              text: "The Log, by Jay Kreps",
              href: "https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying",
            },
            { text: "The Secret Lives of Data: Raft", href: "https://thesecretlivesofdata.com/raft/" },
          ],
        },
      ],
    },
  ],
};
