#!/usr/bin/env node
/**
 * What is actually running, right now.
 *
 * This exists because "what can I look at right now?" is a question about the RUNNING SYSTEM and
 * every other source of truth in this repo describes the repository. Without it each session
 * re-derives the same facts — the phone's wireless-debugging address, whether Postgres is up,
 * which port Metro is on, whether a provider is enabled — by scanning, grepping and guessing.
 *
 * Wired as a SessionStart hook (`.claude/settings.json`), so the answer is in context before the
 * first question rather than after the first wrong assumption. Run it by hand any time:
 *
 *     node scripts/env-probe.mjs
 *
 * Three rules it must keep:
 *   * **Read-only.** It starts nothing, installs nothing, and changes no state.
 *   * **Fast.** Every probe is parallel with a short timeout; a slow answer at session start is
 *     a tax on every session. Budget is ~3s total.
 *   * **No secrets, ever.** Env vars are reported as set / empty / missing — never their values.
 *     `.claude/hooks/guard-secret-exposure.mjs` blocks reading .env files for the same reason.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (cmd, args, ms = 2500) =>
  new Promise((res) => {
    const child = execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, stdout) =>
      res(err && !stdout ? null : String(stdout).trim()),
    );
    child.on("error", () => res(null));
  });

const portOpen = (host, port, ms = 700) =>
  new Promise((res) => {
    const s = net.createConnection({ host, port, timeout: ms });
    s.on("connect", () => (s.destroy(), res(true)));
    s.on("error", () => (s.destroy(), res(false)));
    s.on("timeout", () => (s.destroy(), res(false)));
  });

/**
 * Outstanding human tasks, read out of `docs/HANDOFF.md`.
 *
 * Injected rather than looked up, for the same reason the phone's address is: a hand-off that
 * lives in a document nobody opens gets re-asked, and a task that is already DONE gets asked for
 * a second time. Both happened before this existed — Claude sent Taylor to the Google Cloud
 * Console to create an OAuth client that had been created days earlier and was recorded in
 * ENVIRONMENT.md the whole time.
 *
 * Only OPEN and BLOCKED rows print. DONE rows stay in the file as the answer to "did we already
 * do this?", and are read there.
 */
function handoffs() {
  const file = join(ROOT, "docs/HANDOFF.md");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const below = text.split("PROBE-READS-BELOW")[1];
  if (!below) return null;
  const rows = [];
  for (const line of below.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const [status, what] = cells;
    if (status === "OPEN" || status === "BLOCKED") rows.push({ status, what });
  }
  return rows;
}

/** set | empty | missing — never the value. */
function envKeys(relPath, keys) {
  const file = join(ROOT, relPath);
  if (!existsSync(file)) return keys.map((k) => `${k}=NO FILE`);
  const text = readFileSync(file, "utf8");
  return keys.map((k) => {
    const m = new RegExp(`^${k}=(.*)$`, "m").exec(text);
    return `${k}=${m ? (m[1].trim() ? "set" : "empty") : "missing"}`;
  });
}

const lines = [];
const say = (s) => lines.push(s);

const [devices, docker, lanIp, web, metro] = await Promise.all([
  run("adb", ["devices", "-l"]),
  run("docker", ["ps", "--format", "{{.Names}} {{.Status}}"]),
  run("node", ["-e", "const n=require('os').networkInterfaces();for(const a of Object.values(n).flat())if(a&&a.family==='IPv4'&&!a.internal&&a.address.startsWith('10.'))console.log(a.address)"]),
  portOpen("127.0.0.1", 3000),
  portOpen("127.0.0.1", 8081),
]);

say("## Running system (scripts/env-probe.mjs)");

// --- phone -------------------------------------------------------------------------------
const attached = (devices ?? "")
  .split("\n")
  .slice(1)
  .filter((l) => l.trim() && !l.startsWith("*"))
  .map((l) => l.trim());
const online = attached.filter((l) => /\sdevice(\s|$)/.test(l));
if (online.length) {
  const addrs = online.map((l) => l.split(/\s+/)[0]);
  say(`- phone: CONNECTED — ${addrs.join(", ")}`);
  const target = addrs.find((a) => /:\d+$/.test(a)) ?? addrs[0];
  const app = await run("adb", ["-s", target, "shell", "pm", "list", "packages", "com.swingsage.spike"]);
  const pid = await run("adb", ["-s", target, "shell", "pidof", "com.swingsage.spike"]);
  say(`  app com.swingsage.spike: ${app ? "installed" : "NOT installed"}${pid ? `, running pid ${pid}` : ", not running"}`);
} else if (attached.length) {
  say(`- phone: listed but NOT authorised — ${attached.join(" | ")}`);
} else {
  say("- phone: not connected. Turn on Wireless debugging on the S25+, read the IP:PORT off the");
  say("  main Wireless debugging screen (NOT the pairing dialog's port), then `adb connect IP:PORT`.");
  say("  Pairing survives reboots; the PORT changes, so it has to be read off the phone each time.");
  say("  mDNS discovery does not find this device — do not spend time on `adb mdns services`.");
}

// --- machine + services ------------------------------------------------------------------
say(`- this PC on the LAN: ${lanIp || "no 10.x address found"} (phones reach the API here, never localhost)`);
say(`- next dev :3000 ${web ? "UP" : "down"}   metro :8081 ${metro ? "UP" : "down"}`);

const containers = (docker ?? "").split("\n").filter((l) => l.toLowerCase().includes("golf"));
say(`- docker: ${containers.length ? containers.join("; ") : "no golf containers running (`docker compose up -d`)"}`);

// --- env presence, never values -----------------------------------------------------------
say(`- apps/web/.env: ${envKeys("apps/web/.env", ["DATABASE_URL", "APP_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "AUTH_ALLOWED_EMAILS", "DEV_USER_EMAIL"]).join("  ")}`);
say(`- apps/mobile/.env: ${envKeys("apps/mobile/.env", ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_API_BASE_URL", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"]).join("  ")}`);

// --- outstanding human tasks ---------------------------------------------------------------
const pending = handoffs();
if (pending?.length) {
  say(`- waiting on Taylor (docs/HANDOFF.md) — do NOT ask for anything that is not listed here,`);
  say(`  and do NOT re-ask for a DONE row in that file:`);
  for (const r of pending) say(`    ${r.status === "OPEN" ? "OPEN   " : "BLOCKED"}  ${r.what}`);
} else if (pending) {
  say("- waiting on Taylor: nothing open (docs/HANDOFF.md)");
}

say("- fixed facts that a probe cannot discover are in docs/ENVIRONMENT.md — read it before");
say("  scanning the network, guessing a port, or checking a vendor dashboard.");

console.log(lines.join("\n"));
