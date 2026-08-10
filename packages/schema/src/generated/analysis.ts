/* GENERATED from schemas/analysis.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * Inclusive [from, to] frame indices.
 *
 * @minItems 2
 * @maxItems 2
 */
export type FrameRange = [number, number];
/**
 * Inclusive [from, to] frame indices.
 *
 * @minItems 2
 * @maxItems 2
 */
export type FrameRange1 = [number, number];
/**
 * Inclusive [from, to] frame indices.
 *
 * @minItems 2
 * @maxItems 2
 */
export type FrameRange2 = [number, number];

/**
 * The single contract between the analyzer and every client. Deliberately STRICT on the properties clients depend on and PERMISSIVE on the deep interior of metrics/quality, whose field set legitimately varies by pose model and view — over-specifying those would produce failures that mean nothing. Evolve additively only: new fields, never reordering or repurposing, because a native app cannot be force-updated and old builds keep reading these artifacts for months.
 */
export interface Analysis {
  /**
   * Incremented when the contract changes. Clients must tolerate a HIGHER value than they were built for by ignoring unknown fields.
   */
  schema_version: number;
  video: {
    fps: number;
    frame_count: number;
    width: number;
    height: number;
    view?: "dtl" | "face_on";
    handedness?: "right" | "left";
    source?: {
      path?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  pose: {
    model?: string;
    /**
     * Fixed, append-only order: 33 native, 7 derived, 8 measured, 1 derived-tail. The measured block sits AFTER the derived one so published indices 0-39 keep their meaning.
     *
     * @minItems 49
     */
    keypoint_names: [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      ...string[]
    ];
    frames: {
      f: number;
      kp?: number[][];
      interp?: boolean;
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  };
  /**
   * The eight GolfDB events, strictly ordered by frame.
   */
  events: {
    [k: string]: Event;
  };
  checkpoints?: {
    p: string;
    id?: string;
    label?: string;
    phase?: string;
    /**
     * The GolfDB event this checkpoint coincides with, or null for P6 and P9, which are shaft- and arm-defined and have no event.
     */
    event?: string | null;
    frame: number;
    [k: string]: unknown;
  }[];
  phases?: {
    name: string;
    from: number;
    to: number;
    [k: string]: unknown;
  }[];
  swing_window?: FrameRange;
  playback_window?: FrameRange1;
  playback_pad?: FrameRange2;
  address_span?: FrameRange;
  tempo?: {
    backswing_frames?: number;
    downswing_frames?: number;
    ratio?: number;
    backswing_ms?: number;
    downswing_ms?: number;
    /**
     * Null when tempo is plausible; otherwise the reasons it should not be trusted. Non-empty means the pipeline is flagging its own output and clients must surface that rather than printing the ratio as fact.
     */
    implausible?: string[] | null;
    [k: string]: unknown;
  };
  club?: {
    [k: string]: unknown;
  };
  /**
   * Checkpoint CLASSIFICATIONS only (square/open/closed). Never a fabricated face-angle degree from video — degrees require a launch monitor.
   */
  face?: {
    [k: string]: unknown;
  };
  metrics?: {
    [k: string]: unknown;
  };
  posture?: {
    [k: string]: unknown;
  };
  quality?: {
    [k: string]: unknown;
  };
  quality_raw?: {
    [k: string]: unknown;
  };
  quality_mediapipe?: {
    [k: string]: unknown;
  };
  stage3?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface Event {
  frame: number;
  conf?: number;
  [k: string]: unknown;
}
