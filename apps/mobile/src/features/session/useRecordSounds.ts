import { useEffect, useRef } from "react";
import { requireOptionalNativeModule } from "expo";

import { getAppPrefs, useAppPrefs } from "../settings/appPrefs";
import type { CaptureMode } from "./sessionState";

interface RecordSoundModule {
  playRecordSound(start: boolean): Promise<void>;
  playCountdownTick(): Promise<void>;
  playClickSound(): Promise<void>;
}

/** Resolved optionally so iOS and Jest no-op instead of throwing at import time. */
const HighSpeedCamera = requireOptionalNativeModule<RecordSoundModule>("HighSpeedCamera");

/**
 * Every call is `?.`-guarded per METHOD, not just per module: the dev loop can pair a fresh
 * JS bundle with a not-yet-reinstalled APK whose module lacks the newer functions, and that
 * mismatch must degrade to silence — it once surfaced as "undefined is not a function" the
 * moment recording started.
 */

/** The countdown's quiet 3-2-1 tick — needs BOTH toggles: its own, under the master one. */
export function playCountdownTick(): void {
  const prefs = getAppPrefs();
  if (!prefs.recordSounds || !prefs.countdownTicks) return;
  void HighSpeedCamera?.playCountdownTick?.();
}

/**
 * The "about three seconds left" cue (capture spec §01.4.4) — the take is nearing its hard
 * cap with no shot detected. Reuses the ACK two-tone: distinct from the countdown's single
 * beep and both record cues, and the press-ack it shares a sound with played twenty seconds
 * earlier. A dedicated tone can land with the audio polish pass.
 */
export function playWarningTone(): void {
  const prefs = getAppPrefs();
  if (!prefs.recordSounds) return;
  void HighSpeedCamera?.playClickSound?.();
}

/**
 * The audible record cue — the system camera's own start/stop sounds, gated by the Settings
 * toggle. Keyed on entering and leaving `recording` so a cancelled countdown stays silent:
 * nothing was recorded, so nothing should say it was. The enabled flag rides in a ref so a
 * toggle flip never re-fires the transition effect.
 */
export function useRecordSounds(mode: CaptureMode) {
  const [{ recordSounds }] = useAppPrefs();
  const enabledRef = useRef(recordSounds);
  useEffect(() => {
    enabledRef.current = recordSounds;
  }, [recordSounds]);

  const prev = useRef(mode);
  useEffect(() => {
    const was = prev.current;
    prev.current = mode;
    if (!enabledRef.current) return;
    if (mode === "countdown" && was === "idle") {
      // The press acknowledgment — the golfer hears their click land before the countdown.
      // (With delay 0 there is no countdown; the record cue itself is the acknowledgment.)
      void HighSpeedCamera?.playClickSound?.();
    } else if (mode === "idle" && was === "countdown") {
      // Countdown cancelled — the stop-recording cue doubles as "we are not recording".
      void HighSpeedCamera?.playRecordSound?.(false);
    } else if (mode === "recording" && was !== "recording") {
      void HighSpeedCamera?.playRecordSound?.(true);
    } else if (was === "recording" && mode !== "recording") {
      void HighSpeedCamera?.playRecordSound?.(false);
    }
  }, [mode]);
}
