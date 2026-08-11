import { THRESHOLDS, type Probe } from "./probes";

/**
 * Make a probe result survive the screen it was drawn on.
 *
 * Step 02's Definition of Done is **measured numbers per device, recorded in `DECISIONS.md`**.
 * Until now the numbers existed only as React state rendered to a phone: background the app,
 * reload the bundle or let the screen doze and they were gone, and the only way to capture one
 * was to photograph the phone and re-type it. Re-typing a measurement is how a measurement
 * becomes wrong.
 *
 * `console.log` reaches logcat as `ReactNativeJS`, so one structured line per result is all this
 * needs — no dependency, which matters because this harness is deliberately disposable
 * (`mobile-app-shell` deletes `src/spike/` wholesale). Adding `expo-file-system` to scaffolding
 * that is scheduled for deletion would be the same class of debt this exists to remove.
 *
 * Pull them with `node scripts/pull-probe-results.mjs`.
 */

/** Grep anchor. Deliberately unmistakable — logcat is a busy channel. */
export const PROBE_LOG_PREFIX = "SWINGSAGE_PROBE";

export interface RecordedResult {
  probe: string;
  status: Probe["status"];
  /** The measured value in the probe's own stated unit. */
  value: number | null;
  unit: string;
  device: string;
  detail: string | null;
  /** The bar this probe had to clear, emitted alongside so a log line is self-contained. */
  threshold: number | null;
  at: string;
}

function thresholdFor(probeId: string): number | null {
  if (probeId === "overlay-sync" || probeId === "scrub") return THRESHOLDS.overlayDriftP95;
  if (probeId === "seek") return THRESHOLDS.seekErrorMax;
  if (probeId === "capture") return THRESHOLDS.captureMinFps;
  return null;
}

/**
 * Emit one result.
 *
 * A probe with no measurement is still emitted, with `value: null` and its status. That is
 * deliberate: "probe 3 is blocked on a dev build" is a finding, and a log that silently omits the
 * probes that did not answer reads as though they all did — the same honesty rule `probes.ts`
 * enforces on the screen.
 */
export function recordResult(probe: Probe): RecordedResult {
  const result: RecordedResult = {
    probe: probe.id,
    status: probe.status,
    value: probe.measurement?.value ?? null,
    unit: probe.measures,
    device: probe.measurement?.device ?? "unknown",
    detail: probe.detail ?? null,
    threshold: thresholdFor(probe.id),
    at: new Date().toISOString(),
  };
  console.log(`${PROBE_LOG_PREFIX} ${JSON.stringify(result)}`);
  return result;
}
