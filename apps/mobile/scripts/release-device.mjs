#!/usr/bin/env node
/**
 * Build the RELEASE APK, prove the bundle is fresh, and put it on the phone.
 *
 *   pnpm --filter mobile phone:release            # uses the first connected non-emulator device
 *   ADB_SERIAL=10.0.1.123:38367 pnpm --filter mobile phone:release
 *
 * This is the release sibling of dev-device.mjs, and it exists because gradle's JS bundling
 * task has gone "up-to-date" past real code changes (2026-08-23): a batch of UI fixes shipped
 * inside last week's bundle, and every symptom read as "my change has no effect". Three
 * guarantees, in order:
 *
 *   1. A fresh stamp is WRITTEN INTO src/platform/buildStamp.ts before the build (and the
 *      file restored after) — a changed source input is the only thing the bundling task
 *      reliably honours; deleting its outputs just restores them from the build cache.
 *   2. The APK's bundle is grepped for that stamp AFTER the build. No stamp → the build is
 *      stale → the script DIES instead of installing.
 *   3. Install is `-r` over the existing app (same debug-keystore signature, so app data and
 *      Google sign-in survive), then force-stop + relaunch — a release build has no reload
 *      gesture, so the relaunch IS the reload.
 *
 * ANDROID_SDK_ROOT is stripped from the environment (the standing machine fault: its value
 * contains its own name and AGP dies on it).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MOBILE = join(import.meta.dirname, "..");
const ANDROID = join(MOBILE, "android");
const APK = join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
const PACKAGE = "com.swingsage.spike";

const STALE_BUNDLE_OUTPUTS = [
  // Whole directories, and the build runs --no-build-cache: deleting files alone loses to the
  // build cache (it restores them), and a source-input change alone loses to the bundle
  // task's coarse input tracking. Missing outputs + no cache to restore from = must execute.
  join(ANDROID, "app", "build", "generated", "assets", "react"),
  join(ANDROID, "app", "build", "intermediates", "assets", "release"),
];

function die(msg) {
  console.error(`release-device: ${msg}`);
  process.exit(1);
}

function device() {
  if (process.env.ADB_SERIAL) return process.env.ADB_SERIAL;
  const rows = execFileSync("adb", ["devices"], { encoding: "utf-8" })
    .split(/\r?\n/)
    .filter((l) => l.endsWith("\tdevice") && !l.startsWith("emulator-"));
  if (!rows.length) {
    die("no phone connected — run `node scripts/adb-phone.mjs` from the repo root first");
  }
  return rows[0].split("\t")[0];
}

const serial = device();
const stamp = `build-${Date.now()}`;
console.log(`device ${serial} | stamp ${stamp}`);

// 1. The stamp is a SOURCE change, because that is the only input gradle's bundling task
// reliably honours — deleting its outputs just restores them from the build cache (proven
// 2026-08-23, twice in one evening).
const STAMP_FILE = join(MOBILE, "src", "platform", "buildStamp.ts");
const stampDefault = readFileSync(STAMP_FILE, "utf-8");
const STAMP_LINE = 'export const BUILD_STAMP: string = "dev";';
if (!stampDefault.includes(STAMP_LINE)) {
  die(`${STAMP_FILE} is not in its committed "dev" state — restore it before building`);
}
// The WHOLE line, never a bare '"dev"' — that matched the docstring's first mention instead
// and left BUILD_STAMP untouched, so every build tripped its own staleness check.
writeFileSync(
  STAMP_FILE,
  stampDefault.replace(STAMP_LINE, `export const BUILD_STAMP: string = "${stamp}";`),
);

// Belt on top of the braces: the cached outputs go too.
for (const p of STALE_BUNDLE_OUTPUTS) rmSync(p, { force: true, recursive: true });

// 2. Build. .env supplies the EXPO_PUBLIC_* set.
const env = { ...process.env };
delete env.ANDROID_SDK_ROOT;
console.log("building (gradlew assembleRelease)…");
try {
  // Absolute path through the platform shell explicitly — bare `gradlew` resolves differently
  // depending on which shell Node inherits (cmd vs a POSIX sh), and both wrong ways are silent.
  const gradleArgs = ["assembleRelease", "--no-build-cache"];
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/c", join(ANDROID, "gradlew.bat"), ...gradleArgs], {
      cwd: ANDROID, env, stdio: "inherit",
    });
  } else {
    execFileSync(join(ANDROID, "gradlew"), gradleArgs, {
      cwd: ANDROID, env, stdio: "inherit",
    });
  }
} finally {
  // The working tree never keeps a per-build stamp — restore before anything can commit it.
  writeFileSync(STAMP_FILE, stampDefault);
}

// 3. The tripwire: the shipped bundle must be NEWER than every source file that feeds it.
//
// By timestamp, not by a marker string: a release bundle is Hermes BYTECODE, and while plain
// literals usually survive into its string table, the stamp's did not — the check failed
// against bundles that provably carried the new code (2026-08-23). Mtime is the property that
// actually matters ("was this JS rebuilt after I edited") and no compiler can eat it.
if (!existsSync(APK)) die(`build finished but no APK at ${APK}`);
const newestSource = execFileSync("python", ["-c", [
  "import os, sys",
  "root = sys.argv[1]",
  "newest = 0.0; name = ''",
  "skip = {'node_modules', '.expo', 'android', 'ios', '__tests__'}",
  "for base, dirs, files in os.walk(root):",
  "    dirs[:] = [d for d in dirs if d not in skip]",
  "    for f in files:",
  "        if not f.endswith(('.ts', '.tsx', '.js', '.jsx', '.json')): continue",
  "        p = os.path.join(base, f)",
  "        m = os.path.getmtime(p)",
  "        if m > newest: newest, name = m, p",
  "print(f'{newest}|{name}')",
].join("\n"), join(MOBILE, "src")], { encoding: "utf-8" }).trim();
const [newestMs, newestName] = newestSource.split("|");
const bundleMs = execFileSync("python", ["-c", [
  "import sys, zipfile, datetime",
  `z = zipfile.ZipFile(r'${APK.replaceAll("\\", "/")}')`,
  "i = z.getinfo('assets/index.android.bundle')",
  "print(datetime.datetime(*i.date_time).timestamp())",
].join("\n")], { encoding: "utf-8" }).trim();
// Zip stores 2-second-granular local time; 120s of slack absorbs that and any clock skew,
// while still catching a bundle from a previous build session.
if (Number(bundleMs) + 120 < Number(newestMs)) {
  die(`STALE BUNDLE: the APK's JS predates ${newestName}. The bundling task was skipped — ` +
      "do not install this. (Delete android/app/build and rerun.)");
}
console.log("bundle verified fresh");

// 4. On the phone, running.
execFileSync("adb", ["-s", serial, "install", "-r", APK], { stdio: "inherit" });
execFileSync("adb", ["-s", serial, "shell", "am", "force-stop", PACKAGE]);
execFileSync("adb", ["-s", serial, "shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"], { stdio: "ignore" });
console.log(`installed and relaunched on ${serial}`);
