import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Deployment-wide rate limit and single-flight lease, backed by Postgres
 * functions (see the migrations). Works across serverless instances because
 * the state lives in the database, not in process memory.
 *
 * There are no accounts, so per-visitor limits key on a pseudonymous client
 * key (see `lib/generation/client-key.ts`).
 */

const ClaimRowSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(["ok", "in_progress", "client_rate_limited", "global_rate_limited"]),
  retry_after_seconds: z.number().int(),
});

export type SlotClaim =
  | { allowed: true }
  | { allowed: false; reason: "in_progress" | "client_rate_limited" | "global_rate_limited"; retryAfterSeconds: number };

export async function claimGenerationSlot(
  admin: SupabaseClient,
  input: { clientKey: string; requestId: string; clientLimit: number; globalLimit: number; windowSeconds: number; leaseSeconds: number },
): Promise<SlotClaim> {
  const { data, error } = await admin.rpc("claim_generation_slot", {
    p_client_key: input.clientKey,
    p_request_id: input.requestId,
    p_client_limit: input.clientLimit,
    p_global_limit: input.globalLimit,
    p_window_seconds: input.windowSeconds,
    p_lease_seconds: input.leaseSeconds,
  });
  if (error) throw new Error(`claim_generation_slot failed${error.code ? ` (${error.code})` : ""}`);
  const row = ClaimRowSchema.parse(Array.isArray(data) ? data[0] : data);
  if (row.allowed) return { allowed: true };
  if (row.reason === "ok") throw new Error("claim_generation_slot returned an inconsistent row");
  return { allowed: false, reason: row.reason, retryAfterSeconds: Math.max(1, row.retry_after_seconds) };
}

export async function releaseGenerationSlot(admin: SupabaseClient, clientKey: string, requestId: string): Promise<void> {
  // Bounded: the lease expires on its own if this call cannot complete.
  const { error } = await admin
    .rpc("release_generation_slot", { p_client_key: clientKey, p_request_id: requestId })
    .abortSignal(AbortSignal.timeout(5_000));
  if (error) throw new Error("release_generation_slot failed");
}
