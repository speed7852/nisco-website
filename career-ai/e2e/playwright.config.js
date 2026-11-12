import { defineConfig } from "@playwright/test";
import { API_ORIGIN, APP_ORIGIN } from "./e2e.config.js";

const ci = Boolean(process.env.CI);

// One browser, one worker, no retries: the journey is a single ordered story against one fresh
// database, and a retry would hide flakiness instead of exposing it.
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: ci
    ? [["list"], ["github"], ["junit", { outputFile: "test-results/junit.xml" }], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: APP_ORIGIN,
    browserName: "chromium",
    // Fixed so dates and number formats render identically on every machine.
    locale: "en-GB",
    timezoneId: "UTC",
  },
  webServer: [
    {
      command: "node scripts/start-worker.js",
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: "node scripts/serve-frontend.js",
      url: `${APP_ORIGIN}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
