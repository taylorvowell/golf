import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end harness for the web client.
 *
 * Scope note: this is a REAL end-to-end path, not a mocked one. It drives a browser against the
 * running Next.js server, which reads Postgres and streams video off disk — so a green run means
 * the whole chain works, and a red one can mean any link in it. That is the intended trade. The
 * unit tests in `src/**\/*.test.ts` cover the pure logic (frame windows, trace smoothing, score
 * display) where a precise failure location matters more.
 *
 * Requires Docker Postgres up (`docker compose up -d` from the repo root) and at least one
 * analysed swing in the database. See docs/RUNBOOK.md.
 */
export default defineConfig({
  testDir: "./e2e",
  // Fail the run rather than silently pass if someone leaves a `test.only` in.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker: the tests share a dev server and a database, and parallel workers racing over
  // the same swing rows produce flakes that look like product bugs.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // 127.0.0.1, not localhost — see the RUNBOOK. Next's dev server binds 0.0.0.0 and the
    // localhost→::1 resolution on Windows intermittently misses it.
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    // Next's first compile on a cold .next is slow, and this budget is for that, not for a hang.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
