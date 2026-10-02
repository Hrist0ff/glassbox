import { describe, expect, it } from "vitest";
import { streamGeneration } from "@/lib/generation/client";
import type { GenerationEvent, GenerationEventInput } from "@/lib/sse/events";
import { encodeSseEvent, SSE_HEARTBEAT, SseParser } from "@/lib/sse/parser";

const encoder = new TextEncoder();

function parseInChunks(bytes: Uint8Array, splits: number[]) {
  const parser = new SseParser();
  const out = [];
  let last = 0;
  for (const split of [...splits, bytes.length]) {
    out.push(...parser.feed(bytes.slice(last, split)));
    last = split;
  }
  out.push(...parser.end());
  return out;
}

describe("SseParser", () => {
  const stream =
    `: hello\n\n` +
    encodeSseEvent("progress", { message: "Checking node references — ✓ 日本語 🚀" }, 1) +
    `event: multi\ndata: line one\ndata: line two\n\n` +
    `data:no-space\n\n` +
    `event: failed\r\nid: 7\r\ndata: {"x":1}\r\n\r\n`;
  const bytes = encoder.encode(stream);
  const expected = [
    { event: "progress", data: JSON.stringify({ message: "Checking node references — ✓ 日本語 🚀" }), id: "1" },
    { event: "multi", data: "line one\nline two", id: "1" },
    { event: "message", data: "no-space", id: "1" },
    { event: "failed", data: '{"x":1}', id: "7" },
  ];

  it("parses a stream delivered in one chunk", () => {
    expect(parseInChunks(bytes, [])).toEqual(expected);
  });

  it("parses identically for every possible two-chunk split, including inside UTF-8 sequences and CRLF", () => {
    for (let split = 1; split < bytes.length; split++) {
      expect(parseInChunks(bytes, [split])).toEqual(expected);
    }
  });

  it("parses identically when delivered one byte at a time", () => {
    expect(parseInChunks(bytes, Array.from({ length: bytes.length - 1 }, (_, i) => i + 1))).toEqual(expected);
  });

  it("counts comment heartbeats and ignores them as events", () => {
    const parser = new SseParser();
    expect(parser.feed(SSE_HEARTBEAT + SSE_HEARTBEAT)).toEqual([]);
    expect(parser.comments).toBe(2);
  });

  it("discards an unterminated event at end of stream", () => {
    const parser = new SseParser();
    expect(parser.feed("event: completed\ndata: {}\n")).toEqual([]);
    expect(parser.end()).toEqual([]);
  });

  it("handles bare CR line endings", () => {
    const parser = new SseParser();
    expect(parser.feed("data: a\r\r")).toEqual([]); // trailing CR could be half of CRLF
    expect(parser.end()).toEqual([{ event: "message", data: "a" }]);
  });
});

// ---------------------------------------------------------------------------

const ev = (event: GenerationEventInput, seq: number) =>
  encodeSseEvent(event.type, { ...event, requestId: "req-1", seq }, seq);

function sseResponse(chunks: string[], init: { status?: number; contentType?: string } = {}) {
  const bytes = encoder.encode(chunks.join(""));
  // Re-chunk at awkward places to simulate the network.
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": init.contentType ?? "text/event-stream; charset=utf-8" },
  });
}

const fetchReturning = (response: Response) => (async () => response) as unknown as typeof fetch;

describe("streamGeneration (client)", () => {
  it("delivers typed events in order and stops at a terminal failure", async () => {
    const events: GenerationEvent[] = [];
    const end = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      fetchImpl: fetchReturning(
        sseResponse([
          ev({ type: "started", mode: "live", topic: "Raft", maxAttempts: 3 }, 0),
          SSE_HEARTBEAT,
          ev({ type: "progress", stage: "plan", state: "running", message: "Planning" }, 1),
          ev({ type: "failed", code: "rejected", message: "No draft passed", retryable: true, reasons: ["bad edge"] }, 2),
          // Anything after a terminal event is ignored.
          ev({ type: "progress", stage: "plan", state: "done", message: "late" }, 3),
        ]),
      ),
    });
    expect(events.map((e) => e.type)).toEqual(["started", "progress", "failed"]);
    expect(end).toMatchObject({ kind: "terminal", event: { type: "failed", code: "rejected" } });
  });

  it("returns the JSON error for non-streaming HTTP failures without reading events", async () => {
    const end = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: () => {
        throw new Error("no events expected");
      },
      fetchImpl: fetchReturning(
        Response.json({ error: { code: "rate_limited", message: "Limit", retryAfterSeconds: 60 } }, { status: 429 }),
      ),
    });
    expect(end).toEqual({ kind: "http_error", status: 429, error: { code: "rate_limited", message: "Limit", retryAfterSeconds: 60 } });
  });

  it("reports a stream that ends without a terminal event", async () => {
    const end = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      fetchImpl: fetchReturning(sseResponse([ev({ type: "started", mode: "live", topic: "Raft", maxAttempts: 3 }, 0)])),
    });
    expect(end).toEqual({ kind: "ended_early" });
  });

  it("rejects out-of-order sequence numbers", async () => {
    const end = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      fetchImpl: fetchReturning(
        sseResponse([
          ev({ type: "started", mode: "live", topic: "Raft", maxAttempts: 3 }, 1),
          ev({ type: "progress", stage: "plan", state: "running", message: "x" }, 1),
        ]),
      ),
    });
    expect(end).toMatchObject({ kind: "protocol_error" });
  });

  it("rejects a non-SSE success response", async () => {
    const end = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      fetchImpl: fetchReturning(new Response("<html>", { headers: { "Content-Type": "text/html" } })),
    });
    expect(end).toMatchObject({ kind: "protocol_error" });
  });

  it("reports user cancellation and a stalled connection", async () => {
    const hanging = (async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      )) as unknown as typeof fetch;

    const cancel = new AbortController();
    const pending = streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: cancel.signal,
      onEvent: () => undefined,
      fetchImpl: hanging,
    });
    setTimeout(() => cancel.abort(), 10);
    expect(await pending).toEqual({ kind: "aborted", reason: "cancelled" });

    const stalled = await streamGeneration({
      topic: "Raft",
      idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      fetchImpl: hanging,
      limits: { stallMs: 20, totalMs: 1_000 },
    });
    expect(stalled).toEqual({ kind: "aborted", reason: "stalled" });
  });
});
