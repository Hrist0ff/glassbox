import { describe, expect, it } from "vitest";
import { createGenerationStream } from "@/lib/generation/stream";
import { runDemoPipeline } from "@/lib/pipeline/demo";
import { GenerationEventSchema, type GenerationEvent } from "@/lib/sse/events";
import { SseParser } from "@/lib/sse/parser";

/** Reads a stream to completion, recording each event and when it arrived. */
async function collect(body: ReadableStream<Uint8Array>, onEvent?: (e: GenerationEvent) => void) {
  const reader = body.getReader();
  const parser = new SseParser();
  const events: GenerationEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    const messages = done ? parser.end() : parser.feed(value);
    for (const m of messages) {
      const event = GenerationEventSchema.parse(JSON.parse(m.data));
      expect(m.event).toBe(event.type);
      events.push(event);
      onEvent?.(event);
    }
    if (done) break;
  }
  return { events, heartbeats: parser.comments };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createGenerationStream", () => {
  it("sends completed only after the save resolves, as the last event, with increasing seq", async () => {
    const save = deferred();
    let saved = false;
    const stream = createGenerationStream({
      requestId: "r1",
      deadlineMs: 5_000,
      run: async ({ emit }) => {
        emit({ type: "started", mode: "live", topic: "t", maxAttempts: 3 });
        emit({ type: "progress", stage: "persist", state: "running", message: "Saving" });
        await save.promise;
        saved = true;
        return { type: "completed", conceptId: "c1", url: "/concept/c1", attempts: 1, persisted: true, demo: false };
      },
    });

    setTimeout(() => save.resolve(), 30);
    const { events } = await collect(stream.body, (event) => {
      if (event.type === "completed") expect(saved).toBe(true);
    });
    expect(events.map((e) => e.type)).toEqual(["started", "progress", "completed"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(new Set(events.map((e) => e.requestId))).toEqual(new Set(["r1"]));
    await stream.settled;
  });

  it("drops terminal events emitted by the worker and turns exceptions into a failed event", async () => {
    let settledWith: GenerationEvent | undefined;
    const stream = createGenerationStream({
      requestId: "r2",
      deadlineMs: 5_000,
      run: async ({ emit }) => {
        emit({ type: "completed", conceptId: "x", url: "/x", attempts: 1, persisted: true, demo: false });
        throw new Error("boom");
      },
      onSettled: (terminal) => {
        settledWith = terminal;
      },
    });
    const { events } = await collect(stream.body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "failed", code: "internal", seq: 0 });
    await stream.settled;
    expect(settledWith).toMatchObject({ type: "failed" });
  });

  it("emits heartbeats while work is pending", async () => {
    const stream = createGenerationStream({
      requestId: "r3",
      deadlineMs: 5_000,
      heartbeatMs: 10,
      run: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return { type: "failed", code: "timeout", message: "x", retryable: true };
      },
    });
    const { heartbeats } = await collect(stream.body);
    expect(heartbeats).toBeGreaterThanOrEqual(2);
  });

  it("aborts the work when the reader cancels, and still runs cleanup", async () => {
    let aborted = false;
    let cleaned = false;
    const stream = createGenerationStream({
      requestId: "r4",
      deadlineMs: 5_000,
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ type: "failed", code: "cancelled", message: "x", retryable: true });
          });
        }),
      onSettled: () => {
        cleaned = true;
      },
    });
    const reader = stream.body.getReader();
    await reader.cancel();
    await stream.settled;
    expect(aborted).toBe(true);
    expect(cleaned).toBe(true);
  });

  it("aborts the work when the deadline passes", async () => {
    const stream = createGenerationStream({
      requestId: "r5",
      deadlineMs: 20,
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ type: "failed", code: "timeout", message: "late", retryable: true }));
        }),
    });
    const { events } = await collect(stream.body);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "timeout" });
  });

  it("aborts the work when the HTTP request is aborted", async () => {
    const request = new AbortController();
    const stream = createGenerationStream({
      requestId: "r6",
      deadlineMs: 5_000,
      requestSignal: request.signal,
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ type: "failed", code: "cancelled", message: "x", retryable: true }));
        }),
    });
    setTimeout(() => request.abort(), 10);
    const { events } = await collect(stream.body);
    expect(events.at(-1)).toMatchObject({ code: "cancelled" });
  });
});

describe("stream robustness", () => {
  it("clips over-long text (e.g. a 400-character reviewer summary) so clients accept every event", async () => {
    const summary = "x".repeat(400);
    const stream = createGenerationStream({
      requestId: "long",
      deadlineMs: 5_000,
      run: async ({ emit }) => {
        emit({ type: "progress", stage: "evaluate", state: "done", message: `Review passed. ${summary}` });
        emit({ type: "attempt", attempt: 1, maxAttempts: 3, outcome: "rejected", reasons: Array(12).fill("y".repeat(900)) });
        return { type: "failed", code: "rejected", message: "z".repeat(2000), retryable: true, reasons: ["r".repeat(999)] };
      },
    });
    // `collect` parses every event with the client schema and would throw on a violation.
    const { events } = await collect(stream.body);
    expect(events.map((e) => e.type)).toEqual(["progress", "attempt", "failed"]);
    expect(events[0]).toMatchObject({ message: expect.stringMatching(/^Review passed\. x+…$/) });
  });

  it("still sends a terminal event and cleans up when the work ignores the deadline", async () => {
    let cleaned = false;
    const stream = createGenerationStream({
      requestId: "hung",
      deadlineMs: 20,
      abortGraceMs: 30,
      run: () => new Promise(() => undefined), // e.g. a database call that never returns
      onSettled: () => {
        cleaned = true;
      },
    });
    const { events } = await collect(stream.body);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "timeout" });
    await stream.settled;
    expect(cleaned).toBe(true);
  });
});

describe("demo pipeline", () => {
  it("produces a stream the client schema accepts", async () => {
    const stream = createGenerationStream({
      requestId: "demo-1",
      deadlineMs: 5_000,
      run: async ({ emit }) => {
        emit({ type: "started", mode: "demo", topic: "binary search", maxAttempts: 0 });
        return runDemoPipeline("binary search", emit);
      },
    });
    const { events } = await collect(stream.body);
    expect(events.at(-1)).toMatchObject({ type: "completed", url: "/demo/binary-search", persisted: false });
  });

  it("opens a matching fixture without claiming persistence", async () => {
    const events: unknown[] = [];
    const terminal = await runDemoPipeline("Explain DNS please", (e) => events.push(e));
    expect(terminal).toMatchObject({ type: "completed", url: "/demo/dns-resolution", persisted: false, demo: true });
    expect(JSON.stringify(events)).toMatch(/No AI model is called/);
  });

  it("explains its limits for other topics", async () => {
    const terminal = await runDemoPipeline("Quantum chromodynamics", () => undefined);
    expect(terminal).toMatchObject({ type: "failed", code: "unsupported_topic", retryable: false });
  });
});
