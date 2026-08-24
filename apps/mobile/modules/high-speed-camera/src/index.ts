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

/**
 * How a strike is picked out of the audio. Nine different discriminators, not nine tunings of
 * one — see the native `SwingClip.Method` for what each measures and why.
 *
 * `swish` ships. It is the only one measured against hand-labelled strike times
 * (`services/analyzer/scripts/audio_truth.json`) rather than judged by watching, and it scored
 * 5/5 where every other method scored 3/5 or worse. That ground truth is FIVE CLIPS, one golfer,
 * one indoor bay — enough to reject the others, nowhere near enough to call any of them accurate
 * in general.
 */
export type ImpactMethod =
  | "swish"
  | "attack"
  | "peak"
  | "hf"
  | "flux"
  | "sharp"
  | "crest"
  | "decay"
  | "ensemble";

export const IMPACT_METHODS: ImpactMethod[] = [
  "swish",
  "attack",
  "peak",
  "hf",
  "flux",
  "sharp",
  "crest",
  "decay",
  "ensemble",
];

/** What each one keys on, for the picker that offers them. */
export const IMPACT_METHOD_LABELS: Record<ImpactMethod, string> = {
  swish: "Swish — HF click with a swing in front of it",
  attack: "Attack — rise vs. background",
  peak: "Peak — plain loudest",
  hf: "HF — high-frequency click",
  flux: "Flux — onset strength",
  sharp: "Sharp — HF attack, weighted by level",
  crest: "Crest — peak over RMS, scale-free",
  decay: "Decay — fast rise AND fast fall",
  ensemble: "Ensemble — what the others agree on",
};

/** A candidate ball strike found in a recorded take. */
export interface ImpactCandidate {
  /** Seconds from the start of the clip. */
  timeSec: number;
  /** Relative strength. Only meaningful for ordering candidates within one clip. */
  score: number;
}

/** A pre-recorded clip standing in for a live take. `__DEV__` only. */
export interface DevClip {
  /** Absolute path, no `file://` scheme — the same shape a real take carries. */
  path: string;
  name: string;
  durationMs: number;
  /** Frames ÷ duration, read off the file — never assumed, and never the capture rate. */
  fps: number;
  /**
   * The rate the SENSOR ran at (`com.android.capture.fps`), or 0 when the file does not say.
   *
   * For a phone slow-motion clip this is 240 while `fps` is 30 — the container's timeline runs
   * eight times slower than the world, so a window measured in file-seconds is a fraction of the
   * action it looks like. Every duration derived from such a clip has to be scaled by
   * `captureFps / fps` or it silently means something else.
   */
  captureFps: number;
  sizeBytes: number;
}

export interface DevClipListing {
  /** Always present, even when empty — an empty drawer has to say where to put files. */
  folder: string;
  clips: DevClip[];
}

interface HighSpeedCameraModule {
  camera2Capabilities(): Promise<Camera2Capabilities>;
  /**
   * Pre-recorded clips a developer pushed to `Android/data/<pkg>/files/dev-clips`.
   *
   * The point is to reach the review screen without standing on a range: a long clip filmed
   * the real way (start, walk out, hit, walk back, stop) is exactly what the mark-the-strike
   * screen exists to cut down, so this exercises the real path rather than a shortcut past it.
   */
  devClips(): Promise<DevClipListing>;
  /**
   * Candidate strike times, strongest first.
   *
   * **An empty array is a normal answer** — an indoor mat, wind, a muted take — and callers fall
   * back to a default window rather than surfacing an error. This seeds a window the golfer can
   * slide; it is never a measurement. The real Impact frame comes from the analyzer, which snaps
   * it to the club-head low point and beats any scrubber drag.
   */
  detectImpacts(
    path: string,
    limit: number,
    method?: ImpactMethod,
    /**
     * Down-weight the first and last five seconds — a golfer filming alone walks out and walks
     * back, so both ends are footsteps and phone handling. A prior, not a filter: an edge strike
     * still wins if nothing in the interior comes close. Default on; switchable so it can be
     * checked against the same clip.
     */
    edgeWeighting?: boolean,
  ): Promise<ImpactCandidate[]>;
  /**
   * Evenly spaced frames across a take, as JPEG file paths — the review scrubber's filmstrip.
   * An empty array is a normal answer for an unreadable clip; the strip just stays plain.
   */
  clipThumbnails(
    path: string,
    count: number,
    width: number,
  ): Promise<Array<{ path: string; timeSec: number; width: number; height: number }>>;
  /**
   * The same strip, at times the caller chooses.
   *
   * The scrub axis is not linear — it spends most of its width on the seconds around impact — so
   * an evenly spaced strip would show a picture that is not the moment its cell selects.
   */
  clipThumbnailsAt(
    path: string,
    timesSec: number[],
    width: number,
  ): Promise<Array<{ path: string; timeSec: number; width: number; height: number }>>;
  /** Remux a window out of a take. No re-encode — milliseconds, and no quality lost. */
  trimClip(path: string, startSec: number, endSec: number): Promise<{ path: string }>;
  /**
   * What an arbitrary clip IS, from its own container — for imports. `captureFps` is the
   * slow-motion truth (`com.android.capture.fps`): 0 means not stamped, an ordinary
   * real-time clip. Never treat 0 as a rate.
   */
  probeClip(path: string): Promise<{ captureFps: number; videoFps: number; durationMs: number }>;
  /** Remove a recording the flow is finished with (a trimmed-away source, a binned take),
   * along with its filmstrip. Resolves false when the file was already gone — never an error. */
  deleteClip(path: string): Promise<boolean>;
  /**
   * Delete takes and filmstrips older than `keepNewerThanMs`, returning bytes reclaimed.
   *
   * Capture leftovers are otherwise permanent: a crash mid-review strands a swing-sized MP4,
   * and every reviewed take writes a dozen JPEGs. Call on capture-screen mount.
   */
  sweepCaptureCache(keepNewerThanMs: number): Promise<number>;
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
