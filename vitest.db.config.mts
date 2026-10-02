import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Database tests run against a real Supabase instance (local `supabase start`
 * by default) to verify Row Level Security, grants, and the rate-limit RPCs.
 *
 *   supabase start && npm run test:db
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    env: loadEnv(mode, process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 30_000,
  },
}));
