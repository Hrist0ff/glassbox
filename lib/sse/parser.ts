/**
 * Incremental parser for `text/event-stream`, following the WHATWG event
 * stream rules: UTF-8 decoding that survives multi-byte characters split
 * across chunks; LF, CRLF, and CR line endings (including a CR at the end of
 * one chunk and its LF at the start of the next); multi-line `data`;
 * comments; and fields without a colon. An unterminated event at end of
 * stream is discarded, as the spec requires.
 */

export type SseMessage = { event: string; data: string; id?: string };

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buffer = "";
  private dataLines: string[] = [];
  private eventType = "";
  private lastEventId: string | undefined;
  /** Number of comment lines seen (servers use them as heartbeats). */
  comments = 0;

  feed(chunk: Uint8Array | string): SseMessage[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Call once the byte stream has ended. */
  end(): SseMessage[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): SseMessage[] {
    const messages: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      if (ch === "\r" && i === this.buffer.length - 1 && !final) {
        // Might be the first half of CRLF; wait for the next chunk.
        break;
      }
      const line = this.buffer.slice(start, i);
      if (ch === "\r" && this.buffer[i + 1] === "\n") i++;
      start = i + 1;
      const message = this.processLine(line);
      if (message) messages.push(message);
    }
    this.buffer = this.buffer.slice(start);
    if (final) {
      // Spec: data for an event without a terminating blank line is dropped.
      this.buffer = "";
      this.dataLines = [];
      this.eventType = "";
    }
    return messages;
  }

  private processLine(line: string): SseMessage | null {
    if (line === "") {
      if (this.dataLines.length === 0) {
        this.eventType = "";
        return null;
      }
      const message: SseMessage = {
        event: this.eventType || "message",
        data: this.dataLines.join("\n"),
        ...(this.lastEventId !== undefined ? { id: this.lastEventId } : {}),
      };
      this.dataLines = [];
      this.eventType = "";
      return message;
    }
    if (line.startsWith(":")) {
      this.comments++;
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.lastEventId = value;
        break;
      default:
        // `retry` and unknown fields are ignored.
        break;
    }
    return null;
  }
}

/** Server-side framing for one event. JSON.stringify never emits raw newlines. */
export function encodeSseEvent(event: string, data: unknown, id?: number | string): string {
  const json = JSON.stringify(data);
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${json}\n\n`;
}

export const SSE_HEARTBEAT = ": keep-alive\n\n";
