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
    id: "capture",
    title: "3 · Sustained 60fps capture",
    question: "Does the device actually record at the rate it reports?",
    why:
      "PROJECT_MAIN §2.3 makes 60fps non-negotiable and forbids silently degrading it. " +
      "VisionCamera advertises 30–240fps; advertised is not achieved.",
    status: "blocked-dev-build",
    measures: "achieved fps and dropped-frame count over a 10s recording",
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

export function judgeOverlayDrift(stats: StatSummary): Verdict {
  const short = tooFew(stats);
  const detail =
    `n=${stats.count} · p50 ${stats.p50} · p95 ${stats.p95} · max ${stats.max} frames · ` +
    `${(stats.exactShare * 100).toFixed(1)}% exactly locked`;
  if (short) return { status: "fail", value: stats.p95, detail: `${detail} — ${short}` };
  return {
    status: stats.p95 <= THRESHOLDS.overlayDriftP95 ? "pass" : "fail",
    value: stats.p95,
    detail,
  };
}

export function judgeSeekError(stats: StatSummary): Verdict {
  const detail = `n=${stats.count} · p50 ${stats.p50} · max ${stats.max} frames`;
  if (stats.count === 0) {
    return { status: "fail", value: 0, detail: `${detail} — no seeks were measured` };
  }
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
