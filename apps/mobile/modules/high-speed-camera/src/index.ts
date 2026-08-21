import { requireNativeModule } from "expo";

export interface Camera2Capabilities {
  supported: boolean;
  declaresCapability?: boolean;
  /** e.g. "1920x1080@240-240" — straight from CameraCharacteristics. */
  configurations?: string[];
  /** The ORDINARY-session ceiling, for contrast. Measured 60 on the S25+ (D39). */
  normalFpsRanges?: string[];
  reason?: string;
}

/** A candidate ball strike found in a recorded take. */
export interface ImpactCandidate {
  /** Seconds from the start of the clip. */
  timeSec: number;
  /** Relative strength. Only meaningful for ordering candidates within one clip. */
  score: number;
}

interface HighSpeedCameraModule {
  camera2Capabilities(): Promise<Camera2Capabilities>;
  /**
   * Candidate strike times, strongest first.
   *
   * **An empty array is a normal answer** — an indoor mat, wind, a muted take — and callers fall
   * back to a default window rather than surfacing an error. This seeds a window the golfer can
   * slide; it is never a measurement. The real Impact frame comes from the analyzer, which snaps
   * it to the club-head low point and beats any scrubber drag.
   */
  detectImpacts(path: string, limit: number): Promise<ImpactCandidate[]>;
  /**
   * Evenly spaced frames across a take, as JPEG file paths — the review scrubber's filmstrip.
   * An empty array is a normal answer for an unreadable clip; the strip just stays plain.
   */
  clipThumbnails(
    path: string,
    count: number,
    width: number,
  ): Promise<Array<{ path: string; timeSec: number; width: number; height: number }>>;
  /** Remux a window out of a take. No re-encode — milliseconds, and no quality lost. */
  trimClip(path: string, startSec: number, endSec: number): Promise<{ path: string }>;
  /** Remove a recording the flow is finished with (a trimmed-away source, a binned take).
   * Resolves false when the file was already gone — never an error. */
  deleteClip(path: string): Promise<boolean>;
  playRecordSound(start: boolean): Promise<void>;
  playCountdownTick(): Promise<void>;
  playClickSound(): Promise<void>;
}

/**
 * Camera2 constrained-high-speed capture. 1080p at 231fps measured on a Galaxy S25+ (D39).
 *
 * The CameraX and vision-camera paths were both implemented, measured and removed — see the
 * native module's comment. Capability is probed at runtime via `camera2Capabilities`, never
 * assumed: §2.3 forbids degrading silently, and this device is a flagship.
 */
export default requireNativeModule<HighSpeedCameraModule>("HighSpeedCamera");
