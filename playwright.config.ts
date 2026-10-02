import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests.
 *
 *   E2E_BASE_URL       app in demo mode (default http://localhost:3000)
 *   E2E_LIVE_BASE_URL  app in live mode pointed at the mock OpenAI server
 *                      (see scripts/mock-openai.ts); live specs skip without it
 *   PW_CHANNEL=chrome  use the installed Chrome instead of Playwright's Chromium
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.PW_CHANNEL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
