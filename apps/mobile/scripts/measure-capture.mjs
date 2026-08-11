#!/usr/bin/env node
/**
 * The verdict for probe 3, computed from the recorded FILE rather than from the camera API.
 *
 *     node scripts/measure-capture.mjs                    # pulls the newest recording and counts
 *
 * §2.3 forbids silently degrading capture rate, so "did it record at 60?" cannot be answered by
 * the thing that was asked to record at 60. VisionCamera will accept `fps: 60` on a format that
 * cannot sustain it, and a clip that claims 60 while delivering 47 reaches the analyzer as a video
 * whose every frame timestamp is wrong — every event frame derived from it would be wrong with it,
 * and nothing about the file would look broken.
 *
 * So: pull the artifact, count the frames ffmpeg can actually decode, divide by the real duration.
 * Same discipline as the analyzer's own verification — the artifact is the evidence.
 *
 * Needs `ffprobe` on PATH (it is, the analyzer uses it) and a device on `adb`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The rate to judge against. §2.3's floor is 60, but the probe also records at 120 and 240, and
 * each clip must be judged against its OWN request — a device that sustains 60 and silently
 * halves 240 has told us two different things, and one bar would hide the second.
 */
const expectArg = process.argv.indexOf("--expect");
const EXPECT_FPS = expectArg > -1 ? parseFloat(process.argv[expectArg + 1]) : 60;
/** Same 0.5fps slack the 59.5 bar encodes, scaled to whatever was asked for. */
const MIN_FPS = EXPECT_FPS - 0.5;

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

const positional = process.argv.slice(2).find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
let devicePath = positional;

if (!devicePath) {
  // VisionCamera writes to the app's cache dir. Newest .mp4 wins.
  const listing = sh("adb", [
    "shell", "run-as", "com.swingsage.spike",
    "sh", "-c", "'ls -t cache/*.mp4 2>/dev/null | head -1'",
  ]);
  if (!listing) {
    console.error(
      "No recording found in the app's cache.\n" +
      "Run probe 3 (Record 10s) on the device first, then re-run this.",
    );
    process.exit(2);
  }
  devicePath = listing;
}

const dir = mkdtempSync(join(tmpdir(), "swingsage-capture-"));
const local = join(dir, "capture.mp4");

// run-as + cat, because the app's cache dir is not readable by adb pull directly.
execFileSync("sh", ["-c",
  `adb shell run-as com.swingsage.spike cat '${devicePath}' > '${local.replace(/\\/g, "/")}'`,
]);

const duration = parseFloat(sh("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", local,
]));
// -count_frames is slow but it is the only count that is not the container's own claim.
const frames = parseInt(sh("ffprobe", [
  "-v", "error", "-select_streams", "v:0", "-count_frames",
  "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", local,
]).replace(/,/g, ""), 10);
const claimed = sh("ffprobe", [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=r_frame_rate,width,height", "-of", "csv=p=0", local,
]);

const achieved = frames / duration;
const pass = achieved >= MIN_FPS;

console.log(`\nfile        ${devicePath}`);
console.log(`stream      ${claimed}`);
console.log(`duration    ${duration.toFixed(3)}s`);
console.log(`frames      ${frames}  (decoded, not the container's claim)`);
console.log(`achieved    ${achieved.toFixed(2)} fps`);
console.log(`requested   ${EXPECT_FPS} fps`);
console.log(`bar         ${MIN_FPS} fps`);
console.log(`\n${pass ? "PASS" : "FAIL"} — ${pass
  ? "records at the rate it reports"
  : `SILENT DEGRADE: ${(MIN_FPS - achieved).toFixed(2)} fps short of a requested ${EXPECT_FPS}`}\n`);

process.exit(pass ? 0 : 1);
