import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The authorization-boundary suite (src/db/rls.test.ts) needs DATABASE_URL, and it is written to
// FAIL rather than skip without one — a security test that silently skips still reports green.
// Node 22 loads .env natively, so this needs no dotenv dependency.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The RLS suite shares one database and moves a coach relationship through its states, so
    // parallel files would race each other's fixtures and produce failures that look like policy
    // bugs. The pure-logic suites are fast enough that serialising costs nothing.
    fileParallelism: false,
  },
});
