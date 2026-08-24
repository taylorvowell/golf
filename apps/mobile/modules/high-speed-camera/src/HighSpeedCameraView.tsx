import { requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/** Why a take ended without `stopRecording` being called. */
export type RecordingEndReason = "cap" | "error";

export interface RecordingResult {
  /** `file://`-less absolute path in the app cache — the untrimmed take. */
  path: string;
  /** The rate the session was CONFIGURED at, never the rate that was asked for. */
  fps: number;
  durationMs: number;
  bytes: number;
}

export interface HighSpeedCameraViewProps {
  /** CONTROL_ZOOM_RATIO, clamped natively to the device's real range. */
  zoom: number;
  /** Fires once per camera open with that lens's real zoom range — drive the UI from this,
   * never from a hardcoded set of stops. `min === max` means the lens cannot zoom. */
  onZoomRange?: (event: { nativeEvent: { min: number; max: number } }) => void;
  /**
   * A take that ended without anyone calling `stopRecording` — the hard cap elapsing, or the
   * camera failing mid-recording.
   *
   * There is no polling alternative: JS cannot see the recorder's own duration limit fire, and a
   * capture screen still saying "Recording…" after the file closed is the worst available failure.
   * On `reason: "cap"` the payload also carries the full `RecordingResult`.
   */
  onRecordingEnded?: (
    event: {
      nativeEvent:
        | ({ reason: "cap" } & RecordingResult)
        | { reason: "error"; error: string };
    },
  ) => void;
  /**
   * The rate and size this lens will actually record at, fired once the camera is probed
   * (and again on a lens change). `highSpeed: false` means the lens cannot record a take at
   * all — the front camera on essentially every Android.
   *
   * `rates` is every fixed high-speed rate the chosen size offers, highest first — the
   * SELECTABLE truth, so a rate picker lists what the device will really do and nothing else.
   * Optional because an installed native build may predate it; treat absent as "no choice".
   */
  onCaptureConfig?: (event: {
    nativeEvent: {
      fps: number;
      width: number;
      height: number;
      highSpeed: boolean;
      rates?: number[];
    };
  }) => void;
  /** The take handle (`startRecording`/`stopRecording`) — methods live on the VIEW because
   * the take shares the preview's camera device; see `HighSpeedCameraViewRef`. */
  ref?: Ref<HighSpeedCameraViewRef>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Methods callable through a ref on the mounted view.
 *
 * On the view rather than the module because the take shares the preview's camera device and its
 * surface — a module-level record would need a second `CameraDevice`, and two owners of one camera
 * is the failure that made recording black the picture out.
 */
export interface HighSpeedCameraViewRef {
  /**
   * Start a take at the highest rate at or below `maxFps` the OPEN lens actually offers.
   *
   * Rejects rather than degrading when the lens publishes no high-speed configuration — §2.3, and
   * the front lens is exactly that case. Resolves with the configured rate so the FPS pill shows
   * what the device gave, not what was requested.
   */
  startRecording(
    maxFps: number,
    maxSeconds: number,
  ): Promise<{
    fps: number;
    width: number;
    height: number;
    maxSeconds: number;
    /**
     * False when the device would not configure a session carrying BOTH the preview and the
     * recorder, so the take runs recorder-only and the picture is frozen until it ends. The
     * swing still records at full rate — but the screen must say so rather than showing a
     * still frame that reads as a crash.
     */
    previewLive: boolean;
    /**
     * When the recorder actually started (device clock), not when Record was tapped.
     *
     * The capture ladder can spend seconds finding a configuration the device accepts, so a
     * countdown timed from the tap reaches zero while the take is still running.
     */
    startedAtMs: number;
  }>;
  /** End the take by tap. The hard cap ends it through `onRecordingEnded` instead. */
  stopRecording(): Promise<RecordingResult>;
}

/**
 * The live Camera2 capture surface (Android) — preview AND recording on one device.
 *
 * **The back lens, always** (Taylor, 2026-08-20): high-speed capture is a rear-sensor feature, so
 * a front-facing mode could only ever have framed a swing, never recorded one.
 *
 * Mount ONLY behind granted CAMERA and RECORD_AUDIO permissions; the native side assumes both.
 * Recording reconfigures this same session as a constrained high-speed one carrying both the
 * preview and the recorder surface, so the picture stays live at the capture rate.
 */
// Cast because `requireNativeView`'s return type cannot express view-ref methods — the
// interface above is the contract the native `View { AsyncFunction … }` block implements.
export default requireNativeView(
  "HighSpeedCamera",
) as ComponentType<HighSpeedCameraViewProps>;
