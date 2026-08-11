#!/usr/bin/env node
/**
 * Regenerates `assets/frameclock.mp4`, the reference clip the step 02 spike measures against.
 *
 * Run with:  node scripts/make-frame-clip.mjs       (from apps/mobile, ffmpeg on PATH)
 *
 * The clip is committed, so this is not part of any build. It exists because an asset nobody can
 * regenerate is an asset nobody can trust: the properties below are load-bearing for the
 * measurement, and this file is the record of what they are and why.
 *
 *   60 fps, CFR      The whole product assumes `frame = round(t * fps)` is exact. A VFR clip
 *                    makes that false and would make the spike measure the clip, not the player.
 *   GOP 10           Matches Stage 0's encoder setting, chosen originally so browser scrubbing
 *                    stays responsive. On Android it also bounds decode-and-skip seeking to at
 *                    most 9 frames, which is exactly the worst case probe 2 needs to exercise.
 *   Frame number     Burned in, large. Makes drift verifiable by eye and on a screen recording,
 *                    not only through the numbers the native module reports. Same principle as
 *                    the analyzer's Gate 1 burn-in: draw the truth onto the pixels it describes.
 *   Sweeping bar     Advances exactly 1/599 of the width per frame, so a one-frame error is a
 *                    visible ~1.2px step rather than something only arithmetic can catch.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FRAMES = 600;
const FPS = 60;
const WIDTH = 720;
const HEIGHT = 1280;

const here = fileURLToPath(new URL(".", import.meta.url));
const out = join(here, "..", "assets", "frameclock.mp4");

// Windows font paths. Swap these if regenerating elsewhere — nothing else is platform-specific.
const BOLD = "C\\:/Windows/Fonts/arialbd.ttf";
const REGULAR = "C\\:/Windows/Fonts/arial.ttf";

// The sweeping bar is a separate input composited by `overlay`, not a `drawbox`: drawbox
// evaluates its geometry once at init and has no per-frame eval, so a frame-indexed x expression
// silently fails to configure. `overlay` takes eval=frame and does move.
const sweep = `[0:v][1:v]overlay=x='(W-w)*n/${FRAMES - 1}':y=0:eval=frame[bg]`;
const labels = [
  `[bg]drawtext=fontfile='${BOLD}':text='%{n}':fontsize=180:fontcolor=0xf7f8f5:x=(w-text_w)/2:y=(h-text_h)/2-120`,
  `drawtext=fontfile='${REGULAR}':text='frame':fontsize=48:fontcolor=0x7e8691:x=(w-text_w)/2:y=(h/2)+90`,
  `drawtext=fontfile='${REGULAR}':text='%{pts\\:hms}':fontsize=44:fontcolor=0x8b7bff:x=(w-text_w)/2:y=h-160[out]`,
].join(",");
const filter = `${sweep};${labels}`;

// ffmpeg 9 dropped -filter_script; the replacement is the `-/optname file` read-from-file form.
// Writing the graph to a file also sidesteps Windows shell quoting of the `C:` in font paths.
const scratch = mkdtempSync(join(tmpdir(), "frameclip-"));
const graphFile = join(scratch, "graph.txt");
writeFileSync(graphFile, filter);

execFileSync(
  "ffmpeg",
  [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x0b0e13:s=${WIDTH}x${HEIGHT}:r=${FPS}`,
    "-f", "lavfi", "-i", `color=c=0xa3e635:s=12x${HEIGHT}:r=${FPS}`,
    "-/filter_complex", graphFile,
    "-map", "[out]",
    "-t", String(FRAMES / FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
    "-g", "10", "-keyint_min", "10", "-sc_threshold", "0",
    "-r", String(FPS), "-fps_mode", "cfr",
    out,
  ],
  { stdio: "inherit" },
);

console.log(`wrote ${out} — ${FRAMES} frames @ ${FPS}fps, GOP 10`);
