/* GENERATED from schemas/source-timing.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * The authoritative map between the artifact's public frame identity (normalized native-rate CFR indices — `video.frame_id_space`) and what the camera actually observed. One sidecar per analysed video, `out/<stem>/source_timing.json`, referenced from `analysis.json` as `video.source_map`.
 *
 * v2 runs on EVERY path including the slow-motion retime: PTS are mapped against the clip's REAL clock (source PTS × pts_scale, the same -itsscale multiplier ffmpeg applied before the CFR resample), so the mapping and the normalized clip always describe the same timeline. v1 skipped retimed clips entirely.
 *
 * Same additive-only discipline as analysis.schema.json: nothing here may be removed, retyped, or newly required.
 */
export interface SourceTiming {
  /**
   * 2 since the retime-aware rewrite. Clients must tolerate a higher value by ignoring unknown fields.
   */
  schema_version: number;
  /**
   * The container's claimed rate (r_frame_rate), on the SOURCE clock — 30 for a phone slow-mo written at 30, whatever the sensor did.
   */
  nominal_fps: number;
  /**
   * The realised average rate (avg_frame_rate), on the SOURCE clock.
   */
  avg_fps: number;
  time_base: string;
  start_time_s: number;
  /**
   * Container duration on the SOURCE clock — the slowed length for a slow-mo. Multiply by pts_scale for the real duration.
   */
  duration_s: number;
  has_audio: boolean;
  audio_sample_rate: number | null;
  audio_codec: string | null;
  /**
   * The multiplier that puts source timestamps on the world's clock — ffmpeg's -itsscale factor for a retimed slow-mo (30/240 = 0.125 for the classic 8×), 1.0 for a real-time clip. Observations are mapped on the SCALED clock, which is the normalized clip's clock. Absent in v1 (implies 1.0 — v1 never wrote a retimed sidecar).
   */
  pts_scale?: number;
  /**
   * What the sensor did, when known — the retime decision's input, mirrored from analysis.json video.source. 0 = unknown / real-time.
   */
  capture_fps?: number;
  /**
   * Where capture_fps came from — the derivation behind every real_capture_time_us below. The manifest is the authority (D10); the container tag is the fallback the phone-side remux is known to drop.
   */
  capture_fps_source?: "manifest" | "container_tag" | "none";
  /**
   * How many GENUINE camera observations exist — len(observations), never the normalized frame count.
   */
  distinct_observation_count: number;
  observations: SourceObservation[];
}
/**
 * This interface was referenced by `SourceTiming`'s JSON-Schema
 * via the `definition` "observation".
 */
export interface SourceObservation {
  /**
   * Index in the ORIGINAL upload's presentation order.
   */
  source_frame: number;
  /**
   * The container's own timestamp for this frame, UNSCALED — the source clock, exactly as demuxed.
   */
  source_pts_s: number;
  /**
   * When the sensor observed this frame, microseconds from the clip's first frame, on the WORLD clock: (source_pts − first_pts) × pts_scale. For a real-time clip this is simply the rebased PTS; for a retimed slow-mo it is the honest instant — comparable directly with normalized_frame / video.fps. Derivation is capture_fps_source. Absent in v1.
   */
  real_capture_time_us?: number;
  /**
   * The normalized CFR frames that display this observation. Empty when the resample dropped it (still a real observation); longer than 1 when a slow source frame was duplicated up. The union over all observations is exactly [0, frame_count), each index once, in order.
   */
  normalized_frames: number[];
  is_duplicate_group: boolean;
}
