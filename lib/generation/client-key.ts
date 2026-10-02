import { createHmac } from "node:crypto";

/**
 * Pseudonymous key for per-visitor rate limits, now that there are no
 * accounts: an HMAC of the client IP, so raw addresses are never stored.
 *
 * The IP comes from `x-forwarded-for`, which Vercel sets itself. A server
 * reachable without such a proxy cannot trust that header, so a client could
 * spread its requests over many keys; the global hourly limit still caps
 * total cost.
 */
export function clientKey(headers: Headers, secret: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex");
}
