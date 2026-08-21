import { useCallback, useEffect, useRef, type RefObject } from "react";

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
) {
  /** True from the start call until ANY ending settled — the guard that keeps the tap/cap
   * race from double-finalizing one take. */
  const active = useRef(false);

  useEffect(() => {
    if (mode !== "recording" || active.current) return;
    active.current = true;
    void (async () => {
      try {
        // Rate-first: the native side picks the highest offered rate at or below the
        // ceiling and resolves with the rate it actually configured (§02.4). The cap
        // always includes the post-roll allowance — see MAX_TAKE_SEC's comment.
        const started = await camera.current?.startRecording(MAX_FPS_REQUEST, MAX_TAKE_SEC);
        if (started) onPreviewLive?.(started.previewLive);
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
  // and the golfer is out at the ball, where a tone carries and a screen does not.
  useEffect(() => {
    if (mode !== "recording") return;
    const timer = setTimeout(
      playWarningTone,
      (MAX_TAKE_SEC - AUTOSTOP_COUNTDOWN_SEC) * 1000,
    );
    return () => clearTimeout(timer);
  }, [mode]);

  /** The golfer's stop — dock button or shutter remote. Safe to call in any state. */
  const stop = useCallback(async () => {
    if (!active.current) return;
    try {
      const result = await camera.current?.stopRecording();
      active.current = false;
      if (result) {
        dispatch({
          type: "take-ready",
          take: { path: result.path, fps: result.fps, durationMs: result.durationMs },
        });
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
          dispatch({
            type: "take-ready",
            take: { path: ev.path, fps: ev.fps, durationMs: ev.durationMs },
          });
        } else {
          dispatch({ type: "record-failed" });
          onError(ev.error);
        }
      },
      [dispatch, onError],
    );

  return { stop, onRecordingEnded };
}
