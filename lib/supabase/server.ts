import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig, supabaseSecretKey } from "@/lib/env";

/** There are no accounts, so no client keeps or refreshes a session. */
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/**
 * Anonymous client: every query runs under Row Level Security as `anon`, so
 * only public rows are visible. Returns null when Supabase is not configured.
 */
export function createPublicClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  if (!config) return null;
  return createClient(config.url, config.publishableKey, NO_SESSION);
}

/**
 * Privileged client that bypasses Row Level Security, for inserts and the
 * rate-limit functions. Server-only.
 */
export function createAdminClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  const secret = supabaseSecretKey();
  if (!config || !secret) return null;
  return createClient(config.url, secret, NO_SESSION);
}
