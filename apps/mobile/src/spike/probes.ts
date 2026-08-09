/**
 * The three questions step 02 has to answer on real hardware, as data rather than markup.
 *
 * Kept out of the component so they can be asserted without rendering React Native — and,
 * more importantly, so the honesty rule below is enforceable: a probe may only read `pass` when
 * a real measurement is attached to it. A screen that claims PASS with nothing behind it is the
 * single most misleading thing this spike could do, because the whole point of the spike is to
 * tell us whether the framework choice in DECISIONS D5 survives contact with a device.
 */

export type ProbeStatus = "pending" | "blocked-dev-build" | "pass" | "fail";

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
    status: "blocked-dev-build",
    measures: "drift in frames during scrub — target exactly 0",
  },
  {
    id: "seek",
    title: "2 · Frame-exact seeking",
    question: "Does seeking land on the requested frame, not within ~100ms of it?",
    why:
      "iOS needs zero-tolerance seek; Android decodes-and-skips from the preceding sync point. " +
      "Stage 0 already forces GOP 10, which bounds that to 9 frames.",
    status: "blocked-dev-build",
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
