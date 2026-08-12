/**
 * Gate 3, without a phone: the MOBILE overlay's own geometry, drawn over the analyzer's burn-in.
 *
 * The project's verification strategy splits "the stick figure looks wrong" into pose (Gate 1) and
 * sync (Gate 2), then requires the client overlay to match the Gate 1 burn-in at the same frame
 * (Gate 3). Gate 1 already drew frame N's skeleton onto frame N's pixels **in the process that
 * computed them**, so sync cannot be a variable there — which means any disagreement between this
 * output and the burn-in is a port bug in the mobile renderer, and nothing else.
 *
 * What it draws is not a re-implementation. It imports the same `apps/mobile` modules the phone
 * runs — `keypointIndex`, `BONES`, `buildTrace`, `cutAt`, `orientationHold`, `resolveAngle`,
 * `simplify`, `dashSegments` — and lays their output over the real frame. A bone list that drifted,
 * an index map read from the wrong place, a trace re-cut at the wrong boundary or a simplification
 * that moved the line would all show here as green not sitting on the burn-in's colours.
 *
 * It cannot check what only the device can: that React commits the overlay on the frame that is
 * actually on the glass. That is the sync panel's `Overlay drift` line, on the phone.
 *
 * ## Usage
 *
 *   pnpm exec tsx scripts/checkoverlay.ts services/analyzer/out/swing1 [frame ...]
 *     --angles N     also draw the first N drawable angle fields (default 0 — 25 arcs is noise)
 *     --stages k=f,… hand-corrected boundaries, e.g. `--stages impact=143`, since corrections live
 *                    in the database rather than in the artifact this script reads from disk
 *     --stage PX     the stage width the view count is costed at (default 360, a phone)
 *     --true-colour  draw in the overlay's real palette instead of the diff hairline
 *     --variant KEY  force a club solution instead of `defaultClubVar` (`--variant list` prints them)
 *     --smoothing K  force a trace smoothing method instead of `savgol`
 *
 * By default it draws every layer as a **thin magenta hairline**, because the burn-in already uses
 * the same green/yellow/cyan and two identical drawings on top of each other cannot be told from
 * one. A hairline riding down the middle of the burn-in's thick bone is a pass you can see; a
 * hairline beside it is the port bug.
 *
 * Writes `checkoverlay_<stem>.html` into the same directory, plus one
 * `checkoverlay_<stem>_f<frame>.png` per frame — the same overlay composited onto the burn-in, so
 * the sheet is readable by anything that can open an image and not only by a browser.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import sharp from "sharp";
import type { Analysis } from "@swingsage/schema/contract";

import {
  MIN_CONF,
  keypointIndex,
  resolveAngle,
} from "../apps/mobile/src/features/player/overlay/geometry";
import {
  ORIENT_PAIRS,
  buildTraceFor,
  orientationHold,
  selectedClub,
  traceSpans,
} from "../apps/mobile/src/features/player/overlay/model";
import {
  arcSegments,
  dashSegments,
  polylineSegments,
  shortestSweep,
  simplify,
  unit,
  type Segment,
} from "../apps/mobile/src/features/player/overlay/paths";
import {
  BONES,
  HIDE_JOINT,
  SIDE_COLOR,
  TRACE_COLOR,
} from "../apps/mobile/src/features/player/overlay/skeleton";
import { DEFAULT_SMOOTHING, cutAt } from "../apps/mobile/src/features/player/overlay/traceSmoothing";
import { defaultClubVar } from "../apps/mobile/src/features/player/overlay/clubVariants";

const dir = resolve(process.argv[2] ?? "");
if (!dir || !existsSync(join(dir, "analysis.json"))) {
  console.error("usage: tsx scripts/checkoverlay.ts <out/stem> [frame ...]");
  process.exit(2);
}

const stem = basename(dir);
const analysis = JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8")) as Analysis;
const idx = keypointIndex(analysis);

/**
 * The burn-in if it exists, the normalized clip otherwise.
 *
 * Preferring `overlay.mp4` is the whole point — laying the mobile geometry over the analyzer's own
 * drawing is a stronger check than laying it over bare pixels, because agreement is then visible
 * rather than judged.
 */
const burnIn = join(dir, "overlay.mp4");
const source = existsSync(burnIn) ? burnIn : join(dir, "normalized.mp4");

const argv = process.argv.slice(3);
const flag = (name: string, fallback: number): number => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const v = argv[at + 1] === "all" ? Number.MAX_SAFE_INTEGER : Number(argv[at + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const ANGLE_LIMIT = flag("--angles", 0);
/**
 * The width the view count is costed at.
 *
 * `simplify` runs in STAGE pixels on the phone, not video pixels, and the difference is a factor of
 * three on a 1080-wide clip — costing it here in video pixels would report three times the views
 * the device actually draws and make the one number this step owes an answer for wrong in the
 * pessimistic direction.
 */
const STAGE_W = flag("--stage", 360);
const TRUE_COLOUR = argv.includes("--true-colour");

/**
 * Overrides for the two choices the DESKTOP persists in localStorage — globally, not per swing.
 *
 * That persistence is why "the phone looks different from what we had" is a question this script
 * has to be able to answer: the browser draws whatever was last picked in the Debug Menu, while a
 * fresh client draws `defaultClubVar` + `savgol`. Comparing them needs both to be nameable here.
 */
const variantArg = argv.includes("--variant") ? argv[argv.indexOf("--variant") + 1] : null;
const smoothingArg = argv.includes("--smoothing") ? argv[argv.indexOf("--smoothing") + 1] : null;

/**
 * Hand-corrected boundaries, passed in rather than fetched.
 *
 * They live in Postgres, not in `analysis.json` — deliberately, since the artifact is rewritten
 * wholesale by every re-analysis — and this script reads a directory rather than a running server.
 * Naming them on the command line keeps the check honest about the fact that the phone merges
 * something this sheet cannot see by itself.
 */
const stageArg = argv[argv.indexOf("--stages") + 1];
const phaseOverrides: Record<string, number> = {};
if (argv.includes("--stages") && stageArg) {
  for (const pair of stageArg.split(",")) {
    const [k, v] = pair.split("=");
    if (k && Number.isFinite(Number(v))) phaseOverrides[k] = Number(v);
  }
}
/** The diff hairline. Nothing in the analyzer's palette is near it. */
const DIFF = "#FF2FD0";

/**
 * Frame numbers, which are the bare arguments — minus any that is a flag's VALUE.
 *
 * `... 150 --angles 3` otherwise reads `3` as a second frame and quietly renders frame 3 of the
 * approach beside the one that was asked for. It looked like a rendering bug in the harness rather
 * than an argument bug, which is exactly the kind of confusion a verification tool must not add.
 */
const consumed = new Set<number>();
argv.forEach((a, i) => {
  // `--true-colour` takes no value; the rest take the argument after them.
  if (a.startsWith("--") && a !== "--true-colour") consumed.add(i + 1);
});
const explicit = argv
  .filter((a, i) => !a.startsWith("--") && !consumed.has(i))
  .map(Number)
  .filter(Number.isFinite);
const events = analysis.events as unknown as Record<string, { frame: number }> | undefined;
const frames = explicit.length
  ? explicit
  : ["address", "top", "impact"]
      .map((n) => events?.[n]?.frame)
      .filter((f): f is number => typeof f === "number");

if (!frames.length) {
  console.error(`${stem}: no events and no frames given — nothing to draw`);
  process.exit(2);
}

const W = analysis.video.width;
const H = analysis.video.height;

if (variantArg === "list") {
  const v = analysis.club?.variants ?? {};
  console.log(`${stem}: default ${defaultClubVar(analysis)}`);
  for (const [k, d] of Object.entries(v)) {
    const cov = Object.entries(d.coverage ?? {})
      .map(([seg, f]) => `${seg} ${Math.round((f as number) * 100)}%`)
      .join("  ");
    const pts =
      (d.trace?.backswing?.length ?? 0) +
      (d.trace?.downswing?.length ?? 0) +
      (d.trace?.followthrough?.length ?? 0);
    console.log(`  ${k.padEnd(22)} ${String(pts).padStart(4)} trace pts   ${cov}`);
  }
  process.exit(0);
}

// The variant the player actually draws, not `primary` — the same call the overlay makes, unless
// this run is deliberately comparing one.
const club = (() => {
  const c = analysis.club;
  if (!c) return null;
  if (!variantArg || variantArg === "primary") return variantArg ? c : selectedClub(analysis);
  const v = c.variants?.[variantArg];
  if (!v) {
    console.error(`${stem}: no variant ${variantArg} — try --variant list`);
    process.exit(2);
  }
  return { ...c, frames: v.frames, trace: v.trace, trace_frames: v.trace_frames, coverage: v.coverage };
})();
const spans = traceSpans(analysis, phaseOverrides);
const method = (smoothingArg ?? DEFAULT_SMOOTHING) as typeof DEFAULT_SMOOTHING;
const pieces = buildTraceFor(club, analysis, spans, method);
const tracks = orientationHold(analysis, idx);
// Every drawable angle, so a port bug in `resolve()`'s chain/feet/club branches has somewhere to
// show. The phone draws a selection; the check draws all of them.
const angleFields = (analysis.metrics?.angle_fields ?? [])
  .filter((f) => f.geom)
  .slice(0, ANGLE_LIMIT);

/** Extracted frames live here for the life of the run; `grab` writes into it. */
const tmp = mkdtempSync(join(tmpdir(), "checkoverlay-"));

void main();

async function main() {
try {
  const built = frames.map((f) => card(f));
  const out = join(dir, `checkoverlay_${stem}.html`);
  writeFileSync(out, page(built.map((b) => b.html)), "utf8");
  console.log(`${stem}: ${frames.length} frame(s) -> ${out}`);
  console.log(
    `  source ${basename(source)}${source === burnIn ? " (Gate 1 burn-in)" : " (no burn-in found — bare pixels)"}`,
  );
  // Naming the solution is not decoration: the first pass of this port drew `primary` while the web
  // player drew a variant, and the only visible symptom was a differently-shaped line.
  console.log(
    `  club solution ${club ? (variantArg ?? defaultClubVar(analysis)) : "none (analysed --no-club)"}` +
      `   smoothing ${method}`,
  );
  const pinned = Object.entries(phaseOverrides);
  if (pinned.length) {
    console.log(`  boundaries pinned ${pinned.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  // Sequential rather than Promise.all: three 1080x1920 composites at once is enough memory
  // pressure to matter, and the run is not waiting on anything else.
  for (const b of built) {
    const png = join(dir, `checkoverlay_${stem}_f${b.frame}.png`);
    await sharp(b.jpegPath)
      .composite([{ input: Buffer.from(svgLayer(b.svg)), top: 0, left: 0 }])
      .png()
      .toFile(png);
    console.log(
      `  f${b.frame}: ${b.views} views (${b.traceViews} trace), ` +
        `${b.drawn} angles drawn / ${b.abstained} abstained -> ${basename(png)}`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
}

/** The vector layer alone, transparent, for compositing over the real frame. */
function svgLayer(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

interface Card {
  frame: number;
  html: string;
  svg: string;
  jpegPath: string;
  views: number;
  traceViews: number;
  drawn: number;
  abstained: number;
}

/** One frame: the picture, with the mobile overlay's segments on top. */
function card(frame: number): Card {
  const jpegPath = grab(frame);
  const jpeg = readFileSync(jpegPath).toString("base64");
  const parts: string[] = [];
  let views = 0;

  const col = (real: string) => (TRUE_COLOUR ? real : DIFF);
  const hair = (real: number) => (TRUE_COLOUR ? real : Math.max(1.5, W / 540));

  const push = (segs: readonly Segment[], color: string, width: number, opacity = 1) => {
    views += segs.length;
    for (const s of segs) {
      parts.push(
        `<line x1="${s.a[0].toFixed(2)}" y1="${s.a[1].toFixed(2)}" x2="${s.b[0].toFixed(2)}" ` +
          `y2="${s.b[1].toFixed(2)}" stroke="${color}" stroke-width="${width}" ` +
          `stroke-linecap="round" opacity="${opacity}"/>`,
      );
    }
  };
  const dot = (x: number, y: number, r: number, color: string) => {
    views += 1;
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${color}"/>`);
  };

  // ---- trace, first in the stack, exactly as SwingOverlay orders it
  const peak = Math.max(2.5, W / 200);
  let traceViews = 0;
  for (const key of ["followthrough", "backswing", "downswing"] as const) {
    if (TRACE_COLOR[key] === "rgba(255,255,255,0)") continue;
    for (const piece of pieces[key] ?? []) {
      const cut = cutAt(piece, frame);
      if (!cut || cut.length < 2) continue;
      // Simplify in STAGE space and map the surviving points back, so the count below is the
      // phone's and the drawing stays in video pixels where the burn-in is.
      const k = STAGE_W / W;
      const kept = new Set(
        simplify(cut.map(([x, y]) => [x * k, y * k] as [number, number]), 0.6).map(
          ([x, y]) => `${x},${y}`,
        ),
      );
      const thin = cut.filter(([x, y]) => kept.has(`${x * k},${y * k}`));
      const segs =
        key === "backswing" || piece.bridge
          ? dashSegments(thin, peak * 1.25, peak * 2.1)
          : polylineSegments(thin);
      traceViews += segs.length;
      push(segs, col(TRACE_COLOR[key]), hair(key === "downswing" ? peak * 1.25 : peak));
    }
  }

  // ---- club
  const cf = club?.frames?.[frame];
  if (cf?.shaft?.length === 2) {
    push(
      [
        {
          a: [cf.shaft[0][0] * W, cf.shaft[0][1] * H],
          b: [cf.shaft[1][0] * W, cf.shaft[1][1] * H],
        },
      ],
      col("#F1F5F9"),
      hair(Math.max(2, W / 200)),
      cf.conf < 0.35 ? 0.45 : 1,
    );
  }
  if (cf?.butt) dot(cf.butt[0] * W, cf.butt[1] * H, Math.max(3, W / 190), col("#FDE68A"));
  if (cf?.head) {
    views += 1;
    parts.push(
      `<circle cx="${(cf.head[0] * W).toFixed(2)}" cy="${(cf.head[1] * H).toFixed(2)}" ` +
        `r="${Math.max(6, W / 110)}" fill="none" stroke="${col("#FB7185")}" stroke-width="2.5"/>`,
    );
  }

  // ---- orientation rods
  const bodyPx = (analysis.metrics?.body_height_norm || 0.4) * H;
  const fr = analysis.pose.frames[frame];
  ORIENT_PAIRS.forEach(([ln, rn], pi) => {
    const a = fr?.kp[idx[ln]];
    const b = fr?.kp[idx[rn]];
    if (!a || !b || a[2] < MIN_CONF || b[2] < MIN_CONF) return;
    const dir2 = tracks[pi]?.dir[frame];
    if (dir2 === undefined || Number.isNaN(dir2)) return;
    const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H;
    const span = Math.hypot(bx - ax, by - ay);
    const half = span / 2 + span * 0.5;
    const ux = Math.cos(dir2), uy = Math.sin(dir2);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const weak = !!tracks[pi].held[frame] || Math.min(a[2], b[2]) < 0.4 || span < bodyPx * 0.06;
    push(
      [{ a: [mx - ux * half, my - uy * half], b: [mx + ux * half, my + uy * half] }],
      col(weak ? "rgba(239,68,68,0.6)" : "#EF4444"),
      hair(Math.max(3, W / 220)),
    );
  });

  // ---- skeleton
  const stroke = Math.max(2, W / 160);
  const omit = new Set(["left_pinky|left_index", "right_pinky|right_index"]);
  if (fr) {
    for (const [a, b, side] of BONES) {
      if (omit.has(`${a}|${b}`)) continue;
      const pa = fr.kp[idx[a]];
      const pb = fr.kp[idx[b]];
      if (!pa || !pb || pa[2] <= 0 || pb[2] <= 0) continue;
      push([{ a: [pa[0] * W, pa[1] * H], b: [pb[0] * W, pb[1] * H] }], col(SIDE_COLOR[side]), hair(stroke));
    }
    analysis.pose.keypoint_names.forEach((n, i) => {
      const p = fr.kp[i];
      if (!p || p[2] <= 0 || HIDE_JOINT.test(n)) return;
      const side = n.startsWith("left_") ? "L" : n.startsWith("right_") ? "R" : "M";
      dot(p[0] * W, p[1] * H, hair(Math.max(2.5, W / 190)), col(SIDE_COLOR[side]));
    });
  }

  // ---- angles
  const labels: string[] = [];
  const scale = Math.min(W, H);
  let abstained = 0;
  for (const spec of angleFields) {
    const r = resolveAngle(
      spec,
      analysis,
      idx,
      frame,
      (club?.frames?.[frame]?.head ?? null) as [number, number] | null,
    );
    if (!r) {
      abstained += 1;
      continue;
    }
    const U = unit(r.u.x * W, r.u.y * H);
    const V = unit(r.v.x * W, r.v.y * H);
    if (!U || !V) {
      abstained += 1;
      continue;
    }
    const ox = r.origin.x * W, oy = r.origin.y * H;
    const refLen = scale * 0.14;
    const uLen = r.uDashed ? refLen : Math.hypot(r.u.x * W, r.u.y * H);
    const vLen = r.vDashed ? refLen : Math.hypot(r.v.x * W, r.v.y * H);
    const arcR = Math.min(scale * 0.075, uLen * 0.62, vLen * 0.62);
    const a0 = Math.atan2(U[1], U[0]);
    const sweep = shortestSweep(a0, Math.atan2(V[1], V[0]));
    push([{ a: [ox, oy], b: [ox + U[0] * uLen, oy + U[1] * uLen] }], col("#FB923C"), 2, 0.95);
    push([{ a: [ox, oy], b: [ox + V[0] * vLen, oy + V[1] * vLen] }], col("#FB923C"), 2, 0.6);
    push(arcSegments(ox, oy, arcR, a0, sweep, 12), col("#FB923C"), 2, 0.95);
    labels.push(`${spec.field} ${r.value.toFixed(1)}°`);
  }

  const svg = parts.join("\n    ");
  return {
    frame,
    svg,
    jpegPath,
    views,
    traceViews,
    drawn: labels.length,
    abstained,
    html: `<figure>
  <figcaption>frame ${frame}${eventName(frame)} — ${views} views (${traceViews} trace) · ${labels.length} angles drawn, ${abstained} abstained</figcaption>
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <image href="data:image/jpeg;base64,${jpeg}" x="0" y="0" width="${W}" height="${H}"/>
    ${svg}
  </svg>
  <p>${labels.join(" · ") || "no angle resolved on this frame"}</p>
</figure>`,
  };
}

function eventName(frame: number): string {
  for (const [name, ev] of Object.entries(events ?? {})) {
    if (ev.frame === frame) return ` (${name.replace(/_/g, " ")})`;
  }
  return "";
}

/**
 * One frame, extracted to a JPEG on disk.
 *
 * `select=eq(n\,F)` counts DECODED frames from zero, which is the same index `analysis.json` uses
 * because Stage 0 normalized the clip to CFR. On a variable-frame-rate source it would not be, and
 * this check would silently compare frame N's overlay against frame N±k's pixels — the exact class
 * of error the whole gate structure exists to separate out.
 */
function grab(frame: number): string {
  const path = join(tmp, `f${frame}.jpg`);
  execFileSync(
    "ffmpeg",
    // `-fps_mode passthrough`, not `-vsync 0`: ffmpeg 9 removed the latter outright, and the
    // failure is an unrecognised-option abort rather than a wrong frame — loud, at least.
    ["-hide_banner", "-loglevel", "error", "-y", "-i", source,
     "-vf", `select=eq(n\\,${frame})`, "-fps_mode", "passthrough", "-frames:v", "1", "-q:v", "2", path],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return path;
}

function page(cards: string[]): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>checkoverlay — ${stem}</title>
<style>
  body { background:#080a0d; color:#f7f8f5; font:13px system-ui, sans-serif; margin:24px; }
  h1 { font-size:16px; }
  .grid { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start; }
  figure { margin:0; max-width:420px; }
  svg { width:100%; height:auto; background:#000; border-radius:8px; }
  figcaption { color:#a3e635; font-weight:600; margin-bottom:6px; }
  p { color:#7e8691; }
  .note { color:#7e8691; max-width:70ch; line-height:1.5; }
</style>
<h1>checkoverlay — ${stem}</h1>
<p class="note">
  The <strong>mobile</strong> overlay's own geometry, drawn over
  <code>${basename(source)}</code>${source === burnIn ? " — the analyzer's Gate 1 burn-in" : ""}.
  Gate 1 drew frame N's pose onto frame N's pixels in the process that computed them, so a
  disagreement here is a port bug in the client and nothing else. What this cannot check is whether
  the phone commits the overlay on the frame actually on the glass — that is the sync panel's
  <em>Overlay drift</em> line, on the device.
</p>
<div class="grid">
${cards.join("\n")}
</div>`;
}
