/**
 * Rewrites `schemas/shape-lock.json` from the schemas as they stand, then FAILS on purpose.
 *
 * Same idiom as the analyzer's `pytest --update-golden`: re-locking is the moment you decide a
 * shape change is correct, so it must end with a diff to read rather than a green run to trust.
 */
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vitest", "run", "src/shape-lock.test.ts"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, UPDATE_SHAPE_LOCK: "1" },
});
process.exit(r.status === 0 ? 1 : 0);
