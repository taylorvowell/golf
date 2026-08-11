/**
 * The three questions step 02 has to answer on real hardware, as data rather than markup.
 *
 * Kept out of the component so they can be asserted without rendering React Native — and,
 * more importantly, so the honesty rule below is enforceable: a probe may only read `pass` when
 * a real measurement is attached to it. A screen that claims PASS with nothing behind it is the
 * single most misleading thing this spike could do, because the whole point of the spike is to
 * tell us whether the framework choice in DECISIONS D5 survives contact with a device.
 */

export type ProbeStatus = "pending" | "blocked-dev-build" | "running" | "pass" | "fail";

export interface Measurement {
  /** What was measured, in the unit stated by the probe. */
  value: number;
  /** Which device produced it — a measurement with no device is not a measurement. */
  device: string;
}

export interface Probe {
  id: string;
  title: string;
  question: string;
  why: string;
  status: ProbeStatus;
  /** What "answered" means, in a unit, so the result is falsifiable. */
  measures: string;
  measurement?: Measurement;
  /** Free-form supporting numbers (p50/p95/max, sample counts) shown under the verdict. */
  detail?: string;
}

export const PROBES: Probe[] = [
  {
    id: "overlay-sync",
    title: "1 · Overlay locked to the presented frame",
    question: "Can a drawn overlay be pinned to the exact video frame on screen, during scrub?",
    why:
      "The web player does this with requestVideoFrameCallback. iOS has a clean analogue; the " +
      "Android equivalent is unconfirmed. This is the product's #1 perceived-quality feature — " +
      "if it cannot be done here, the framework choice is wrong.",
    status: "pending",
    measures: "drift in frames during scrub — target exactly 0",
  },
  {
    id: "overlay-ceiling",
    title: "1b · Platform ceiling — acknowledge without drawing",
    question:
      "Can JS acknowledge the presented frame WITHIN that frame, drawing nothing at all?",
    why:
      "D34: probe 1 measured a React state commit, which apps/web abandoned because the commit " +
      "lands after the browser has painted the frame it describes. This removes the renderer " +
      "and the commit entirely and marks synchronously inside the native frame event, so it " +
      "measures the best case the platform allows. It separates 'Expo/RN cannot hold sync' from " +
      "'our renderer is too slow' — the same split the analyzer uses for pose versus sync, and " +
      "for the same reason: debugging both at once is miserable.",
    status: "pending",
    measures: "% of frames NOT exactly locked — target 0",
  },
  {
    id: "seek",
    title: "2 · Frame-exact seeking",
    question: "Does seeking land on the requested frame, not within ~100ms of it?",
    why:
      "iOS needs zero-tolerance seek; Android decodes-and-skips from the preceding sync point. " +
      "Stage 0 already forces GOP 10, which bounds that to 9 frames.",
    status: "pending",
    measures: "requested frame minus presented frame — target exactly 0",
  },
  {
    id: "scrub",
    title: "2b · Overlay locked while scrubbing",
    question: "Does the overlay stay on the right frame while the user drags the scrubber?",
    why:
      "The step file's words are 'during scrub', and scrubbing is the hard case: rapid seeks " +
      "land mid-GOP, the decoder skips forward from a sync point, and frames arrive out of the " +
      "cadence playback establishes. Measuring only playback tests the easy half of the problem.",
    status: "pending",
    measures: "drift in frames while seeking rapidly — target exactly 0",
  },
  {
    id: "scrub-draw-first",
    title: "2c · Scrubbing, overlay drawn BEFORE the seek",
    question: "Does committing the overlay for the target frame first fix scrubbing?",
    why:
      "2b measures the reactive order and cannot work: a seeked frame is displayed on arrival, " +
      "so there is no lead to draw inside (0.0% locked, p95 25 frames). But a scrub already " +
      "KNOWS its target — the app chose it. Drawing first and seeking second takes the JS " +
      "round-trip off the critical path. If this passes, mobile-player needs two overlay " +
      "orders, one for playback and one for scrub, and that is a design input rather than a bug.",
    status: "pending",
    measures: "% of frames NOT exactly locked — target 0",
  },
  {
    id: "remote-seek",
    title: "4 · Frame-exact seek over the NETWORK",
    question: "Does seeking stay frame-exact when the clip streams over HTTP instead of bundling?",
    why:
      "Every probe above measured a video compiled INTO the app. The product streams from object " +
      "storage (D8/D33), which is a different problem: range requests, buffering, and a decoder " +
      "that can stall on the wire rather than on the CPU. mobile-player is built on this path and " +
      "nothing has tested it.",
    status: "pending",
    measures: "requested frame minus presented frame, streaming — target exactly 0",
  },
  {
    id: "artifact-weight",
    title: "5 · Parsing a real analysis.json on the device",
    question: "Can a phone hold and parse the largest real artifact without falling over?",
    why:
      "analysis.json runs 2.8-13.7 MB across the ten fixtures. If the biggest is slow or fatal on " +
      "a mid-range phone the API needs a lean per-view payload — and that is a STEP 07 decision, " +
      "so it has to be measured before the schema is authored rather than after.",
    status: "pending",
    measures: "download + parse milliseconds for the largest fixture",
  },
  {
    id: "high-speed",
    title: "3b · TRUE high-frame-rate capture (CameraX)",
    question: "Can we actually get 120 or 240fps out of this device?",
    why:
      "D37: the S25+ advertises 1080p at 120 AND 240, but VisionCamera v5 opens an ordinary " +
      "capture session and returned 60 for every request without an error. Android exposes those " +
      "rates only through a constrained high-speed session, which CameraX 1.5 wraps. Impact is " +
      "over inside one frame at 60fps — this is the highest-leverage capture decision in the " +
      "product, so it is worth its own native module rather than an accepted limitation.",
    status: "pending",
    measures: "achieved fps from the RECORDED FILE at 120 and 240",
  },
  {
    id: "capture",
    title: "3 · Sustained 60fps capture",
    question: "Does the device actually record at the rate it reports?",
    why:
      "PROJECT_MAIN §2.3 makes 60fps non-negotiable and forbids silently degrading it. " +
      "VisionCamera advertises 30–240fps; advertised is not achieved.",
    status: "pending",
    measures: "achieved fps from the RECORDED FILE — bar 59.5",
  },
];

/**
 * A probe may only claim pass/fail with a measurement attached.
 *
 * This is the invariant the spike exists to protect. Returns the offending probe ids so a test
 * can name them, rather than a bare boolean.
 */
export function unsupportedClaims(probes: readonly Probe[]): string[] {
  return probes
    .filter((p) => (p.status === "pass" || p.status === "fail") && !p.measurement)
    .map((p) => p.id);
}

/** True once every probe has been answered by a real measurement — the step's exit condition. */
export function spikeComplete(probes: readonly Probe[]): boolean {
  return probes.every((p) => (p.status === "pass" || p.status === "fail") && !!p.measurement);
}

/* ------------------------------------------------------------------------------------------ */
/* Verdicts                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Summary of one measured quantity, mirroring the native `FrameStats` payload.
 *
 * Duplicated rather than imported from the native module's types so this file stays importable
 * in a plain Node test process, where `requireNativeView` would throw. The spike's arithmetic
 * has to be testable without a device — that is the only way any of it gets checked on a
 * Windows machine.
 */
export interface StatSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  exactShare: number;
}

/**
 * The bar each probe has to clear, stated once so the UI, the tests and `DECISIONS.md` cannot
 * drift apart.
 *
 * `overlayDrift` and `seekError` are **exactly zero**, not "small". That is D13's stated
 * acceptance criterion and it is not a stylistic choice: a half-frame-late overlay is what a
 * viewer perceives as the drawing sliding off the golfer, and the project has already decided it
 * would rather learn the overlay must be drawn natively than ship a player that is nearly synced.
 */
export const THRESHOLDS = {
  /** Frames. p95 must be 0 — the overlay is locked or it is not. */
  overlayDriftP95: 0,
  /** Frames. A single mis-seek is a failure; the max is the number that matters. */
  seekErrorMax: 0,
  /** Minimum sample count before a verdict means anything. */
  minSamples: 120,
  /** fps. Below this a "60fps" recording is a silent degrade, which §2.3 forbids. */
  captureMinFps: 59.5,
} as const;

export type Verdict = { status: "pass" | "fail"; value: number; detail: string };

/** Not enough samples is its own answer, and it is not a pass. */
function tooFew(stats: StatSummary): string | null {
  return stats.count < THRESHOLDS.minSamples
    ? `only ${stats.count} samples — need ≥${THRESHOLDS.minSamples} before this means anything`
    : null;
}

/**
 * Verdict on overlay drift, judged on **exactly-locked share** rather than on a signed percentile.
 *
 * ## The bug this replaces, because it is the instructive part
 *
 * This used to read `stats.p95 <= 0`. `FrameStats.percentile` sorts **signed** samples, so a run
 * that sat mostly at −1 (overlay one frame BEHIND) produced p95 = 0 and **passed** — while the
 * same numbers reported p50 = −1 and 10.5% exactly locked. It reported PASS on a real S25+ run in
 * which the overlay was on the correct frame 24 times out of 229.
 *
 * A signed percentile cannot express "how far off are we", because being early and being late
 * cancel instead of accumulating. `judgeSeekError` never had this problem — it always used
 * `Math.abs`. The two judges disagreeing about that was the whole defect.
 *
 * `exactShare` is used as the gate because it is the only exported statistic that is unambiguous
 * under a threshold of zero: the overlay is on the right frame, or it is not. The signed spread is
 * still reported, since which DIRECTION the overlay lags is the diagnostic that matters.
 *
 * Note the native side exports no `min`, so the absolute worst case is not reconstructible from a
 * negative-skewed run. That is a real limitation of the instrument and it is why the gate is
 * `exactShare` rather than an absolute max.
 */
export function judgeOverlayDrift(stats: StatSummary): Verdict {
  const short = tooFew(stats);
  const lockedPct = stats.exactShare * 100;
  const detail =
    `n=${stats.count} · p50 ${stats.p50} · p95 ${stats.p95} · max ${stats.max} frames · ` +
    `${lockedPct.toFixed(1)}% exactly locked`;
  if (short) return { status: "fail", value: stats.p95, detail: `${detail} — ${short}` };
  return {
    // Every sample on the right frame, or it is not locked. D13's bar is zero, not "small".
    status: stats.exactShare >= 1 ? "pass" : "fail",
    // The reported value is the share NOT locked, in percent — a number that moves the right way
    // and cannot read as healthy while the overlay is adrift.
    value: Number((100 - lockedPct).toFixed(1)),
    detail,
  };
}

export function judgeSeekError(stats: StatSummary): Verdict {
  const detail = `n=${stats.count} · p50 ${stats.p50} · max ${stats.max} frames`;
  if (stats.count === 0) {
    return { status: "fail", value: 0, detail: `${detail} — no seeks were measured` };
  }
  // D34: this judge did not apply the too-few gate that judgeOverlayDrift does, so a 20-sample
  // run reported a verdict as though it were settled. A threshold that only some judges honour
  // is not a threshold.
  const short = tooFew(stats);
  if (short) return { status: "fail", value: stats.max, detail: `${detail} — ${short}` };
  return {
    status: Math.abs(stats.max) <= THRESHOLDS.seekErrorMax ? "pass" : "fail",
    value: stats.max,
    detail,
  };
}

/**
 * Achieved capture rate from the recorded file, not from what the camera API claimed.
 *
 * Reading it back off the artifact is the only honest version of this measurement: §2.3's rule
 * is that the recorded rate must be the true rate, so the file is the evidence and the API's
 * self-report is not.
 */
/**
 * Parse cost is a budget question, not a correctness one, so this bar is a stated judgement
 * rather than a physical limit: a swing must open in about a second, and a parse that eats most
 * of that leaves nothing for the request, the video and the first paint.
 */
export const ARTIFACT_PARSE_BUDGET_MS = 600;

export function judgeArtifact(bytes: number, downloadMs: number, parseMs: number): Verdict {
  const mb = bytes / 1_000_000;
  const detail =
    `${mb.toFixed(1)} MB · download ${Math.round(downloadMs)}ms · parse ${Math.round(parseMs)}ms ` +
    `· total ${Math.round(downloadMs + parseMs)}ms`;
  if (bytes <= 0) return { status: "fail", value: 0, detail: "artifact did not download" };
  return {
    status: parseMs <= ARTIFACT_PARSE_BUDGET_MS ? "pass" : "fail",
    value: Number(parseMs.toFixed(0)),
    detail,
  };
}

export function judgeCapture(frameCount: number, durationSec: number, requestedFps: number): Verdict {
  if (durationSec <= 0 || frameCount <= 0) {
    return { status: "fail", value: 0, detail: "no recording to measure" };
  }
  const achieved = frameCount / durationSec;
  const detail =
    `${frameCount} frames in ${durationSec.toFixed(2)}s = ${achieved.toFixed(2)} fps ` +
    `(requested ${requestedFps})`;
  return {
    status: achieved >= THRESHOLDS.captureMinFps ? "pass" : "fail",
    value: Number(achieved.toFixed(2)),
    detail,
  };
}
