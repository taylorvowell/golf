#!/usr/bin/env node
/**
 * Pull step 02's probe measurements off the connected Android device.
 *
 *     node scripts/pull-probe-results.mjs            # from apps/mobile
 *     node scripts/pull-probe-results.mjs --json     # machine-readable
 *
 * The spike emits one `SWINGSAGE_PROBE {...}` line to logcat per terminal probe result
 * (`src/spike/record.ts`). This reads them back, keeps the LAST result per probe — a probe can
 * legitimately be re-run, and the newest answer is the one that counts — and prints a table
 * ready to paste into `docs/DECISIONS.md`.
 *
 * Why a script rather than an `adb logcat | grep` in the runbook: the numbers this returns are
 * step 02's Definition of Done and the evidence D5 stops being provisional on. Something that
 * has to be re-derived from memory each time is something that eventually gets re-derived wrong.
 */
import { execFileSync } from "node:child_process";

const PREFIX = "SWINGSAGE_PROBE";
const asJson = process.argv.includes("--json");

function adb(args) {
  try {
    return execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    console.error(`adb failed: ${err.message}`);
    console.error("Is the device connected? `adb devices -l`");
    process.exit(1);
  }
}

const devices = adb(["devices"])
  .split("\n").slice(1)
  .map((l) => l.trim()).filter((l) => l && l.endsWith("device"));

if (!devices.length) {
  console.error("No device. Connect over USB or wireless debugging, then `adb devices -l`.");
  process.exit(1);
}

// -d dumps and exits; ReactNativeJS is where console.log lands from a React Native app.
const log = adb(["logcat", "-d", "-s", "ReactNativeJS"]);

const byProbe = new Map();
for (const line of log.split("\n")) {
  const at = line.indexOf(PREFIX);
  if (at === -1) continue;
  const payload = line.slice(at + PREFIX.length).trim();
  try {
    const parsed = JSON.parse(payload);
    byProbe.set(parsed.probe, parsed); // last wins
  } catch {
    // A logcat line can be truncated mid-JSON when the buffer wraps. Skipping it is right:
    // a half-parsed measurement is worse than a missing one.
  }
}

const results = [...byProbe.values()];

if (!results.length) {
  console.error(
    `No ${PREFIX} lines in logcat.\n` +
    "Either the probes have not been run since the app started, or the log buffer has wrapped.\n" +
    "Run the probes on the device, then re-run this immediately.",
  );
  process.exit(2);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nDevice: ${results[0].device}\n`);
console.log(`${pad("PROBE", 14)}${pad("STATUS", 8)}${pad("VALUE", 10)}${pad("BAR", 8)}DETAIL`);
console.log("-".repeat(96));
for (const r of results) {
  console.log(
    pad(r.probe, 14) +
    pad(r.status.toUpperCase(), 8) +
    pad(r.value ?? "—", 10) +
    pad(r.threshold ?? "—", 8) +
    (r.detail ?? ""),
  );
}

const missing = ["overlay-sync", "seek", "scrub", "capture"].filter((id) => !byProbe.has(id));
if (missing.length) {
  console.log(`\nNot yet answered: ${missing.join(", ")}`);
  console.log("Step 02 cannot close until every probe has a measurement or a recorded reason.");
}
console.log("");
