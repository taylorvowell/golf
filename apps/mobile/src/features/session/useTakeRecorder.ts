import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import HighSpeedCamera from "../../../modules/high-speed-camera/src";
import type {
  HighSpeedCameraViewProps,
  HighSpeedCameraViewRef,
} from "../../../modules/high-speed-camera/src/HighSpeedCameraView";
import { AUTOSTOP_COUNTDOWN_SEC, MAX_FPS_REQUEST, MAX_TAKE_SEC } from "./captureConstants";
import type { CaptureMode, SessionAction } from "./sessionState";
import { playWarningTone } from "./useRecordSounds";

/**
 * The seam between the reducer's `mode` and the native recorder (capture spec §03, session
 * track step 04). One rule governs everything here: **state only ever claims a file that
 * exists.** The reducer enters `recording` on the golfer's intent, but it only leaves it
 * through `take-ready` (a finalized file) or `record-failed` — both of which originate from
 * the native module's own answers, never from a tap.
 *
 * Three endings, one dispatch site each:
 *  - the golfer stops   → `stop()` here → native `stopRecording` resolves → `take-ready`
 *  - the hard cap fires → native `onRecordingEnded(reason: "cap")`        → `take-ready`
 *  - the camera fails   → start rejection or `onRecordingEnded("error")`  → `record-failed`
 */
export function useTakeRecorder(
  mode: CaptureMode,
  camera: RefObject<HighSpeedCameraViewRef | null>,
  dispatch: (action: SessionAction) => void,
  onError: (message: string) => void,
  /** Told whether the picture stays live during the take — some devices cannot do both. */
  onPreviewLive?: (live: boolean) => void,
  /** The recorder's own start time (device clock), for timers that must match its cap —
   * and the rate the session actually configured, which is what the recording pill shows. */
  onStarted?: (startedAtMs: number, fps: number) => void,
  /** The rate ceiling for the NEXT take — the golfer's pick, or the app's default. */
  maxFps: number = MAX_FPS_REQUEST,
) {
  /** True from the start call until ANY ending settled — the guard that keeps the tap/cap
   * race from double-finalizing one take. */
  const active = useRef(false);

  /** Read at start time through a ref: the ceiling changing between takes must not re-run
   * the start effect — entering the mode is the only trigger (see the effect's deps). */
  const maxFpsRef = useRef(maxFps);
  useEffect(() => {
    maxFpsRef.current = maxFps;
  }, [maxFps]);

  /** The recorder's own start, once it reports one. Drives both take timers. */
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  useEffect(() => {
    if (mode !== "recording") setStartedAtMs(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "recording" || active.current) return;
    active.current = true;
    void (async () => {
      try {
        // Rate-first: the native side picks the highest offered rate at or below the
        // ceiling and resolves with the rate it actually configured (§02.4). The cap
        // always includes the post-roll allowance — see MAX_TAKE_SEC's comment.
        const started = await camera.current?.startRecording(maxFpsRef.current, MAX_TAKE_SEC);
        if (started) {
          onPreviewLive?.(started.previewLive);
          // The recorder's OWN start, not the tap: the ladder can spend seconds finding a
          // configuration the device accepts, and a countdown timed from the tap reaches
          // zero while the take is still running — on the screen whose whole purpose is
          // telling the golfer when the take will end.
          setStartedAtMs(started.startedAtMs);
          onStarted?.(started.startedAtMs, started.fps);
        }
      } catch (e) {
        active.current = false;
        dispatch({ type: "record-failed" });
        onError(e instanceof Error ? e.message : "recording could not start");
      }
    })();
    // The recorder is started by ENTERING the mode; the other props are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Leaving the take, the picture is live again whatever it did during it.
  useEffect(() => {
    if (mode !== "recording") onPreviewLive?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The warning (§01.4.4), fired as the on-screen countdown begins: the take is about to end
  // and the golfer is out at the ball, where a tone carries and a screen does not. Timed from
  // the RECORDER's start for the same reason the countdown is — see `onStarted`.
  useEffect(() => {
    if (mode !== "recording" || startedAtMs === null) return;
    const elapsed = Date.now() - startedAtMs;
    const delay = (MAX_TAKE_SEC - AUTOSTOP_COUNTDOWN_SEC) * 1000 - elapsed;
    if (delay <= 0) return;
    const timer = setTimeout(playWarningTone, delay);
    return () => clearTimeout(timer);
  }, [mode, startedAtMs]);

  /** Mirrors the reducer's mode without re-creating callbacks — read to tell a delivered take
   * from one arriving after the flow already moved on. */
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /**
   * Hand a finalized take to the reducer — or, if the flow already moved on, delete it.
   *
   * The reducer drops a `take-ready` that arrives off `recording` (the tap/cap race), and
   * that drop is correct. What was NOT correct was forgetting the file: a real recording
   * nobody can reach stayed in the cache forever. Every finalized take now ends up either on
   * screen or deleted, never merely dropped.
   */
  const deliverTake = useCallback(
    (path: string, fps: number, durationMs: number) => {
      if (modeRef.current !== "recording") {
        void HighSpeedCamera.deleteClip?.(path);
        return;
      }
      dispatch({ type: "take-ready", take: { path, fps, durationMs } });
    },
    [dispatch],
  );

  /**
   * The golfer's stop — dock button or shutter remote. Safe to call in any state.
   *
   * Deliberately NOT guarded on `active`: that ref is JS's belief about the take, and a
   * remount resets it while the recorder keeps running. Native owns the truth, so Stop always
   * asks it — the worst case is a harmless "not recording" rejection, and the case being
   * prevented is a Stop button that silently does nothing.
   */
  const stop = useCallback(async () => {
    try {
      const result = await camera.current?.stopRecording();
      active.current = false;
      if (result) {
        deliverTake(result.path, result.fps, result.durationMs);
      } else {
        // The ref was gone (view unmounted mid-take) — nothing was finalized.
        dispatch({ type: "record-failed" });
      }
    } catch {
      active.current = false;
      // Either the cap won the race (its `take-ready` already moved the mode, making this a
      // no-op) or the take is genuinely dead — and then the screen MUST come back to idle: a
      // Stop button that swallows a failure leaves "Recording…" frozen on a closed file,
      // which is how the HAL wedge locked the whole screen on 2026-08-20.
      dispatch({ type: "record-failed" });
    }
  }, [camera, dispatch]);

  /** The endings JS did not ask for: the hard cap elapsing, or the camera dying mid-take. */
  const onRecordingEnded: NonNullable<HighSpeedCameraViewProps["onRecordingEnded"]> =
    useCallback(
      (e) => {
        active.current = false;
        const ev = e.nativeEvent;
        if (ev.reason === "cap") {
          deliverTake(ev.path, ev.fps, ev.durationMs);
        } else {
          dispatch({ type: "record-failed" });
          onError(ev.error);
        }
      },
      [deliverTake, dispatch, onError],
    );

  return { stop, onRecordingEnded };
}
