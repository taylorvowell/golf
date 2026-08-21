#!/usr/bin/env node
/**
 * One command that puts the CURRENT code on a device and guarantees it actually loads.
 *
 *   node scripts/dev-device.mjs            # phone, JS only  (or: pnpm --filter mobile phone)
 *   node scripts/dev-device.mjs --native   # rebuild + install first (Kotlin / app.json changed)
 *   node scripts/dev-device.mjs --emulator # the swingsage AVD instead of the S25+
 *
 * It exists because "white screen, won't connect" has three unrelated causes on this machine
 * and guessing between them has cost real time twice:
 *
 *   1. **Metro hangs.** It keeps LISTENING and keeps ACCEPTING connections while serving
 *      nothing, so every port check says "up" and the device says ECONNREFUSED. The only
 *      truthful probe is the BODY of `/status` (`packager-status:running`). This script kills
 *      and restarts a Metro that listens but does not answer.
 *   2. **A freshly `adb install`ed dev client has no server URL** and sits on
 *      `DevLauncherActivity` — the white screen. It has to be launched with the dev-client
 *      deep link naming the LAN address; nothing on the device can guess it.
 *   3. **Port 8081 is squatted** by another project's `qstash dev` log server, bound to
 *      `127.0.0.1` specifically, which beats Metro's wildcard bind for loopback traffic. That
 *      is why SwingSage's Metro lives on 8082 — see METRO_PORT.
 *
 * Native code is the ONE thing this cannot hot-reload. Fast Refresh ships JS only, so a change
 * under `modules/*&#47;android/**.kt` or in `app.json` needs `--native`; everything else is a save.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * NOT 8081. Another project's `qstash dev` binds `127.0.0.1:8081`, and a specific-address bind
 * wins over Metro's `0.0.0.0` for loopback traffic — so the emulator (which reaches the host
 * through loopback) silently talks to the wrong server and shows a white screen, while the
 * phone on the LAN address is fine. Moving SwingSage off the contested port fixes both without
 * touching the other project. Change it here and in `scripts/env-probe.mjs` together.
 */
const METRO_PORT = 8082;

const MOBILE_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APK = join(MOBILE_DIR, "android/app/build/outputs/apk/debug/app-debug.apk");
/** Metro's console, captured rather than discarded — see spawnDetachedMetro. */
const METRO_LOG = join(MOBILE_DIR, ".expo/metro-console.log");

const args = process.argv.slice(2);
const wantsNative = args.includes("--native");
const wantsEmulator = args.includes("--emulator");
/**
 * Restart Metro even though it answers.
 *
 * "It stopped hot refreshing" is a Metro that is still serving `/status` and has lost the
 * client's HMR socket — the health check cannot see it, so the only cure is to bounce the
 * bundler and relaunch. A native build forces this too, for its own reason.
 */
const wantsRestart = args.includes("--restart");

const sh = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const quiet = (cmd, argv, opts = {}) => {
  try {
    return sh(cmd, argv, opts);
  } catch {
    return "";
  }
};

const step = (msg) => console.log(`\n[36m▸ ${msg}[0m`);
const ok = (msg) => console.log(`  [32m✓[0m ${msg}`);
const die = (msg) => {
  console.error(`\n[31m✗ ${msg}[0m`);
  process.exit(1);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The 10.x address phones reach this PC on. Never localhost — that is the emulator's own loopback. */
function lanAddress() {
  for (const iface of Object.values(networkInterfaces()).flat()) {
    if (iface && iface.family === "IPv4" && !iface.internal && iface.address.startsWith("10.")) {
      return iface.address;
    }
  }
  return null;
}

/** Metro, or something else wearing its port. Only the BODY settles it. */
async function metroServing(host) {
  try {
    const res = await fetch(`http://${host}:${METRO_PORT}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

function pidsOnPort(port) {
  const out = quiet("netstat", ["-ano"]);
  return [
    ...new Set(
      out
        .split("\n")
        .filter((l) => l.includes("LISTENING") && l.includes(`:${port} `))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter(Boolean),
    ),
  ];
}

/**
 * @param force Restart Metro even if it currently answers. Always true after a native build:
 *   `expo prebuild --clean` deletes and regenerates the whole `android/` tree and gradle writes
 *   thousands more files under it, and a watcher storm of that size is what wedges Metro on this
 *   machine — it keeps listening and stops answering, minutes after a build rather than hours
 *   into a session. Restarting a Metro that has just watched a native build is cheaper than
 *   diagnosing the hang again.
 */
async function ensureMetro(lan, { force = false } = {}) {
  step(`Metro on :${METRO_PORT}`);
  if (!force && (await metroServing(lan))) {
    ok(`already serving on ${lan}:${METRO_PORT}`);
    return;
  }

  // Listening but not answering is the hang. Kill it — a hung Metro never recovers on its own.
  const held = pidsOnPort(METRO_PORT);
  if (held.length) {
    const why = !force
      ? "/status is silent — restarting"
      : wantsNative
        ? "restarting after the native build"
        : "restarting on request";
    console.log(`  port held by pid ${held.join(", ")}; ${why}`);
    // Real Windows flags: `//PID` is a git-bash escaping habit, and from Node it reaches
    // taskkill literally — which errors, quiet() eats it, and the hung Metro survives every
    // "restart" while the new one fails to bind (2026-08-20, cost a device round-trip).
    for (const pid of held) quiet("taskkill", ["/PID", pid, "/T", "/F"]);
    await sleep(1500);
    const survivors = pidsOnPort(METRO_PORT);
    if (survivors.length) {
      die(`pid ${survivors.join(", ")} still holds :${METRO_PORT} after taskkill — kill it by hand`);
    }
  }

  spawnDetachedMetro();

  // 120s, not 50: a cold start right after a prebuild's watcher storm can take longer than
  // Metro's own ~75s first build, and giving up early reads as "Metro is broken" when it is
  // merely slow.
  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    if (await metroServing(lan)) {
      ok(`serving on ${lan}:${METRO_PORT}`);
      return;
    }
  }
  die(`Metro did not come up on :${METRO_PORT}. Check ${METRO_LOG}`);
}

/**
 * Metro, started so that it OUTLIVES whoever started it.
 *
 * `spawn(detached)` alone is not enough on Windows: a child stays inside the caller's job
 * object, so when the calling shell is cleaned up — which an automation harness does after
 * every command — the job is killed and Metro dies with it. That is why Metro kept vanishing
 * between commands (2026-08-21). `cmd /c start` hands the process to the shell to launch,
 * which puts it outside the job, and output goes to a log file rather than being discarded so
 * a startup failure is diagnosable instead of silent.
 */
function spawnDetachedMetro() {
  mkdirSync(dirname(METRO_LOG), { recursive: true });
  // The redirect target is RELATIVE and unquoted. Node escapes embedded quotes onto the
  // command line, then the inner `cmd /c` strips only the outer pair, so a quoted absolute
  // path arrived as `\C:\...\metro-console.log\` and the command never ran at all — silently,
  // for the full 120 s timeout, pointing at a log that was never created. `cwd` is already
  // MOBILE_DIR, so a relative target needs no quoting and no escaping.
  const logArg = relative(MOBILE_DIR, METRO_LOG).replace(/\\/g, "/");
  const cmd =
    `npx expo start --dev-client --host lan --port ${METRO_PORT} > ${logArg} 2>&1`;
  const child = spawn("cmd", ["/c", "start", "/min", "", "cmd", "/c", cmd], {
    cwd: MOBILE_DIR,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  // A spawn failure is asynchronous and, with no listener, an uncaught exception AFTER
  // unref — invisible where it matters.
  child.on("error", (e) => die(`could not start Metro: ${e.message}`));
  child.unref();
}

/** The adb serial to talk to. Both transports of the same phone can be attached at once, so
 * every adb call in this repo names its target — a bare `adb shell` is a coin flip. */
function resolveTarget() {
  const lines = quiet("adb", ["devices", "-l"]).split("\n").slice(1);
  const serials = lines
    .filter((l) => /\sdevice(\s|$)/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);
  if (!serials.length) die("No adb device. Phone: turn on Wireless debugging and `adb connect IP:PORT`.");

  if (wantsEmulator) {
    const emu = serials.find((s) => s.startsWith("emulator-"));
    return emu ?? die("No emulator attached. Start the swingsage AVD first (RUNBOOK §13).");
  }
  // Prefer the ip:port transport over the mDNS alias — they are the same phone, but the
  // ip:port form is the one every other command in this repo and the probe reports.
  const phone = serials.find((s) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s));
  return phone ?? serials.find((s) => !s.startsWith("emulator-")) ?? die("No phone attached.");
}

/**
 * `android/` is prebuild OUTPUT, and gradle alone never re-reads `app.json` — a permission
 * added there but never prebuilt ships an APK without it, and Android then DENIES the
 * permission request instantly with no prompt (this exact drift shipped a mic-less build on
 * 2026-08-20). A hash stamp of `app.json` decides when the expensive `prebuild --clean` is
 * actually owed, so Kotlin-only rebuilds stay incremental.
 */
function prebuildIfConfigChanged() {
  // In `.expo/`, NOT `android/`: `prebuild --clean` deletes the whole android tree, so a
  // stamp kept there is lost to any out-of-band prebuild (the RUNBOOK tells you to run one)
  // and to every fresh clone, buying a needless full prebuild each time.
  const stampFile = join(MOBILE_DIR, ".expo/prebuild-hash");
  // app.json AND the config plugins it loads. Hashing app.json alone missed a plugin edit
  // entirely — the generated manifest changes while the gate says "not stale", which is the
  // exact drift class this stamp exists to catch.
  const sources = [join(MOBILE_DIR, "app.json"), ...pluginFiles()];
  const hash = createHash("sha256");
  for (const f of sources) hash.update(readFileSync(f));
  const digest = hash.digest("hex");
  const stale =
    !existsSync(stampFile) ||
    readFileSync(stampFile, "utf8").trim() !== digest ||
    // A tree that was never generated (fresh clone) is stale whatever the stamp says.
    !existsSync(join(MOBILE_DIR, "android/app/build.gradle"));
  if (!stale) return;
  step("Native config changed since last prebuild — regenerating android/ (--clean)");
  sh("npx", ["expo", "prebuild", "-p", "android", "--clean"], {
    cwd: MOBILE_DIR, stdio: "inherit", shell: true,
  });
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, digest);
  ok("prebuilt");
}

/** Every config plugin `app.json` can pull in — their CONTENTS decide the manifest too. */
function pluginFiles() {
  const dir = join(MOBILE_DIR, "plugins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".ts"))
    .sort()
    .map((f) => join(dir, f));
}

function buildAndInstall(target) {
  prebuildIfConfigChanged();
  step("Native rebuild (Kotlin / app.json changed)");
  const env = { ...process.env };
  // Its value contains its own name, so AGP dies with a message that names nothing.
  delete env.ANDROID_SDK_ROOT;
  // Multi-ABI on purpose: a phone-only build leaves an arm64-only APK that installs on the
  // x86_64 emulator and then dies in SoLoader — "the app keeps closing" with no other clue.
  // `shell: true` is REQUIRED: Node 20+ refuses to execFile a .bat/.cmd directly (EINVAL,
  // CVE-2024-27980) and the error names the path, not the reason.
  sh(join(MOBILE_DIR, "android/gradlew.bat"), [
    "assembleDebug",
    "-PreactNativeArchitectures=arm64-v8a,x86_64",
  ], { cwd: join(MOBILE_DIR, "android"), env, stdio: "inherit", shell: true });
  ok("built");

  step(`Installing on ${target}`);
  sh("adb", ["-s", target, "install", "-r", APK], { stdio: "inherit" });
  ok("installed");
}

/**
 * Force Metro to BUILD the bundle before any device asks for it. The dev client's fetch times
 * out around 60s while a cold full build takes ~75s on this machine, and the client then
 * boots a stale cached bundle — or a white screen — while every probe says Metro is healthy
 * (the 2026-08-20 white page, and the lost hour on the same trap the day before). A warmed
 * graph answers the device in low seconds, so the race cannot happen.
 */
async function warmBundle() {
  step("Warming Metro's bundle graph");
  try {
    const res = await fetch(
      `http://127.0.0.1:${METRO_PORT}/apps/mobile/index.bundle?platform=android&dev=true`,
      { signal: AbortSignal.timeout(180_000) },
    );
    if (!res.ok) die(`Metro answered ${res.status} for the bundle — check start.log`);
    await res.arrayBuffer();
    ok("bundle serves");
  } catch (e) {
    die(`Bundle build did not finish in 180s (${e?.message}) — check apps/mobile/.expo/dev/logs/start.log`);
  }
}

async function launch(target, lan) {
  step(`Launching against ${lan}:${METRO_PORT}`);
  const url = encodeURIComponent(`http://${lan}:${METRO_PORT}`);
  sh("adb", [
    "-s",
    target,
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `swingsage://expo-development-client/?url=${url}`,
  ]);

  // Landing on DevLauncherActivity instead of MainActivity IS the white screen — report it
  // rather than claiming success.
  for (let i = 0; i < 10; i += 1) {
    await sleep(1500);
    const acts = quiet("adb", ["-s", target, "shell", "dumpsys", "activity", "activities"]);
    if (acts.includes("com.swingsage.spike/.MainActivity")) {
      ok("app is on MainActivity — bundle loaded");
      return;
    }
  }
  die("Still on the dev launcher. Metro is serving, so the device could not reach it: check " +
      "both are on the same Wi-Fi and that no VPN is on the phone.");
}

// Windows-only by construction: netstat/taskkill/`cmd /c start`/gradlew.bat. Said plainly
// rather than crashing inside `spawn("cmd")` on another OS.
if (process.platform !== "win32") {
  die("dev-device.mjs is Windows-only (netstat/taskkill/cmd/gradlew.bat) — see docs/RUNBOOK.md §13.");
}

const lan = lanAddress() ?? die("No 10.x LAN address on this PC — phones cannot reach Metro.");
const target = resolveTarget();
console.log(`SwingSage → ${target}  (this PC: ${lan})`);

// Build FIRST, then Metro. The other order leaves a Metro that was healthy when it was checked
// and wedged by the time the app asks it for a bundle — which reads as "it lost connection
// again" and is the single most repeated failure in this project's dev loop.
if (wantsNative) buildAndInstall(target);
await ensureMetro(lan, { force: wantsNative || wantsRestart });
await warmBundle();
await launch(target, lan);

console.log(
  `\nJS and TS edits now Fast Refresh — no reinstall. Only a change under ` +
    `modules/*/android/**.kt or app.json needs --native again.\n`,
);
