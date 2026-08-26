/* GENERATED from schemas/source-manifest.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * The authoritative record of what a clip IS, written by the client that recorded or imported it and uploaded beside the source bytes — because the facts it carries (capture rate, slow-motion factor, trim boundaries) otherwise depend on a container tag surviving a phone-side remux, and MediaMuxer drops `com.android.capture.fps` (the 2,445-frame slow-mo incident class).
 *
 * THE AUTHORITY RULE: the analyzer may consume `source` and `trim` — the capture-clock and timeline facts. It must NEVER read anything under `client_detection` as an impact measurement: audio candidates and the user's window are how the CLIENT chose what to upload, not evidence about where Impact is. There is deliberately no field on this object that names an impact time as a measurement; the analyzer locates Impact from the pixels and audio it analyzes itself.
 *
 * Written from the ORIGINAL asset before the remux, then updated with the remux's actual boundaries. A server may receive uploads with no manifest at all (older clients) — every consumer falls back to container tags, never worse than today.
 */
export interface SourceManifest {
  /**
   * Version of this manifest shape, starting at 1. Additive evolution only.
   */
  source_manifest_version: number;
  source: SourceFacts;
  trim?: TrimFacts;
  client_detection?: ClientDetection;
}
/**
 * Facts about the ORIGINAL asset, read before any remux could lose them.
 *
 * This interface was referenced by `SourceManifest`'s JSON-Schema
 * via the `definition` "sourceFacts".
 */
export interface SourceFacts {
  /**
   * The original container's own duration, in file (presentation) milliseconds.
   */
  container_duration_ms: number;
  /**
   * The container's frame clock — frames per FILE second (~30 for a phone slow-mo, the capture rate for a real-time recording).
   */
  presentation_fps: number;
  /**
   * What the sensor actually did. 0 when unknown — never guessed. For a real-time recording it equals presentation_fps.
   */
  capture_fps: number;
  /**
   * How sure the client is of capture_fps, 0–1. Omitted means the source speaks for itself (a recorder config is definitionally certain).
   */
  capture_fps_confidence?: number;
  /**
   * Where capture_fps came from: the asset's own metadata tag, the recorder configuration that produced it, a client-side probe, or nowhere.
   */
  capture_fps_source: "device_metadata" | "recorder_config" | "probe" | "unknown";
  /**
   * File seconds per real second — capture_fps / presentation_fps. Absent or 1 for a real-time clip.
   */
  slowmo_factor?: number;
  width?: number;
  height?: number;
  /**
   * The video codec name when the client could read it (e.g. "h264", "hevc").
   */
  codec?: string;
  /**
   * Whether the original carried an audio track — the audio-first impact seed depends on it.
   */
  audio_present?: boolean;
}
/**
 * What the client cut, requested vs. actually written — a keyframe-aligned remux starts EARLIER than asked (PREVIOUS_SYNC), so the requested window and the produced file disagree by design and both are recorded. All `_pts_ms` fields are on the ORIGINAL file's presentation timeline. Absent entirely when the upload is the untouched original (the whole-clip fallback).
 *
 * This interface was referenced by `SourceManifest`'s JSON-Schema
 * via the `definition` "trimFacts".
 */
export interface TrimFacts {
  /**
   * The window's start in REAL milliseconds from the start of the source.
   */
  requested_real_start_ms?: number;
  requested_real_end_ms?: number;
  /**
   * Slack added to each end beyond the window the golfer saw (SAVE_PAD_S), in real ms.
   */
  pad_real_ms?: number;
  /**
   * The start handed to the cutter, in file milliseconds (real ms × slowmo_factor).
   */
  requested_file_start_pts_ms: number;
  requested_file_end_pts_ms: number;
  /**
   * The first sample the muxer actually wrote, in source-file milliseconds. At most requested_file_start_pts_ms (the keyframe seek goes backward).
   */
  actual_remux_start_pts_ms?: number;
  /**
   * The last sample the muxer actually wrote, in source-file milliseconds.
   */
  actual_remux_end_pts_ms?: number;
}
/**
 * How the client chose the window — context for telemetry and debugging, NEVER an input to analysis. Nothing in here is an impact measurement (the authority rule above).
 *
 * This interface was referenced by `SourceManifest`'s JSON-Schema
 * via the `definition` "clientDetection".
 */
export interface ClientDetection {
  /**
   * What the on-device audio detector heard, strongest first — non-authoritative metadata.
   */
  audio_candidates?: AudioCandidate[];
  /**
   * The audio detector that seeded the window (e.g. "swish").
   */
  method: string;
  /**
   * Version tag of the detector thresholds in force when the window was chosen.
   */
  threshold_version: string;
  /**
   * The seed's confidence class — the WP-005 go/no-go telemetry.
   */
  audio_confidence?: "confident" | "ambiguous" | "none";
  /**
   * Whether a visual trim fallback chose the window (deferred WP-005; always false until it exists).
   */
  visual_fallback_used?: boolean;
  /**
   * The window sanity check's score — how much activity the chosen window contains.
   */
  window_motion_confidence?: number;
  /**
   * True when the golfer moved the mark by hand instead of accepting the seed.
   */
  user_adjusted_window?: boolean;
}
/**
 * This interface was referenced by `SourceManifest`'s JSON-Schema
 * via the `definition` "audioCandidate".
 */
export interface AudioCandidate {
  /**
   * Candidate time in REAL milliseconds on the source timeline.
   */
  real_ms: number;
  /**
   * The detector's own score — comparable within one method+threshold_version only.
   */
  score: number;
}
