import { describe, expect, it } from "vitest";
import { clientKey } from "@/lib/generation/client-key";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientKey", () => {
  it("uses the first x-forwarded-for address and never contains the raw IP", () => {
    const key = clientKey(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "secret");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(key).toBe(clientKey(headers({ "x-forwarded-for": "203.0.113.7" }), "secret"));
  });

  it("separates clients and depends on the server secret", () => {
    const a = clientKey(headers({ "x-forwarded-for": "203.0.113.7" }), "secret");
    expect(clientKey(headers({ "x-forwarded-for": "203.0.113.8" }), "secret")).not.toBe(a);
    expect(clientKey(headers({ "x-forwarded-for": "203.0.113.7" }), "other")).not.toBe(a);
  });

  it("falls back to x-real-ip, then to one shared bucket", () => {
    expect(clientKey(headers({ "x-real-ip": "198.51.100.2" }), "s")).toBe(clientKey(headers({ "x-forwarded-for": "198.51.100.2" }), "s"));
    expect(clientKey(headers({}), "s")).toBe(clientKey(headers({ "x-forwarded-for": " " }), "s"));
  });
});
