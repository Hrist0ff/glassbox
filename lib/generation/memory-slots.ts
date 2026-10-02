import type { SlotClaim } from "@/lib/data/generation-slots";

/**
 * In-process rate limit and single-flight lease, for running without a
 * database. Same rules as the Postgres functions (per-client hourly limit,
 * global hourly limit, one running generation per client), but the state lives
 * in one server process: it resets on restart and is not shared between
 * serverless instances. Fine for a single local server; deployments should
 * configure Supabase.
 */
export class MemorySlots {
  private events: { clientKey: string; at: number }[] = [];
  private leases = new Map<string, { requestId: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  claim(input: {
    clientKey: string;
    requestId: string;
    clientLimit: number;
    globalLimit: number;
    windowSeconds: number;
    leaseSeconds: number;
  }): SlotClaim {
    const now = this.now();
    const windowMs = input.windowSeconds * 1000;
    const secondsUntil = (ms: number) => Math.max(1, Math.ceil((ms - now) / 1000));
    this.events = this.events.filter((event) => event.at > now - windowMs);

    const lease = this.leases.get(input.clientKey);
    if (lease && lease.expires > now) return { allowed: false, reason: "in_progress", retryAfterSeconds: secondsUntil(lease.expires) };

    const mine = this.events.filter((event) => event.clientKey === input.clientKey);
    if (mine.length >= input.clientLimit) {
      return { allowed: false, reason: "client_rate_limited", retryAfterSeconds: secondsUntil(mine[0]!.at + windowMs) };
    }
    if (this.events.length >= input.globalLimit) {
      return { allowed: false, reason: "global_rate_limited", retryAfterSeconds: secondsUntil(this.events[0]!.at + windowMs) };
    }

    this.events.push({ clientKey: input.clientKey, at: now });
    this.leases.set(input.clientKey, { requestId: input.requestId, expires: now + input.leaseSeconds * 1000 });
    return { allowed: true };
  }

  release(clientKey: string, requestId: string): void {
    if (this.leases.get(clientKey)?.requestId === requestId) this.leases.delete(clientKey);
  }
}
