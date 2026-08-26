import type {
  ClientDetection,
  SourceFacts,
  SourceManifest,
  TrimFacts,
} from "@swingsage/schema/contract";

import type { ImpactMethod } from "../../../modules/high-speed-camera/src";
import { SEED_THRESHOLD_VERSION, type ImpactSeed } from "./reviewWindow";

/**
 * Builders for the source manifest — the authoritative record of what a clip IS, written by
 * the client and uploaded beside the bytes (`@swingsage/schema` `source-manifest`).
 *
 * Why this exists: capture rate and slow-motion truth used to depend on the
 * `com.android.capture.fps` container tag, and the phone-side MediaMuxer remux DROPS it — so
 * a trimmed Samsung slow-mo arrived server-side as forty seconds of 30fps video and
 * normalized to ~2,445 frames (the 2026-08-26 incident class). The manifest records those
 * facts from the one place they are certain — the recorder's own configuration, or the
 * ORIGINAL container before the remux — and the server prefers it over tags forever after.
 *
 * Everything here is pure on purpose: the step-02 fixture matrix pins these functions
 * directly, with no camera, no picker and no upload in the loop.
 *
 * THE AUTHORITY RULE (from the schema): `source` and `trim` are for the analyzer;
 * `client_detection` is telemetry about how the client chose the window and must never be
 * read as an impact measurement — which is why nothing below ever records the golfer's mark
 * itself, only whether they moved it.
 */

export const SOURCE_MANIFEST_VERSION = 1;

/** Source facts for a take THIS APP recorded — the recorder's configuration, definitionally
 *  certain, which is why no confidence field is attached. The app records real-time video
 *  (frame rate == capture rate; slow motion is a playback treatment, never an encoding). */
export function recordedSourceFacts(take: {
  fps: number;
  durationMs: number;
  width?: number;
  height?: number;
}): SourceFacts {
  const facts: SourceFacts = {
    container_duration_ms: take.durationMs,
    presentation_fps: take.fps,
    capture_fps: take.fps,
    capture_fps_source: "recorder_config",
    slowmo_factor: 1,
    // The recorder is configured H.264 with an audio track (audio is the ONLY signal that can
    // locate impact — see the recorder's own comment), so both are facts, not probes.
    codec: "h264",
    audio_present: true,
  };
  if (take.width && take.height) {
    facts.width = take.width;
    facts.height = take.height;
  }
  return facts;
}

/** What `probeClip` read off an imported clip's ORIGINAL container. */
export interface ImportProbe {
  captureFps: number;
  videoFps: number;
  durationMs: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

/**
 * Source facts for an IMPORTED clip, from the original container — read before the trim that
 * would lose them. An unstamped clip states `capture_fps: 0` + `"unknown"` rather than
 * guessing: the analyzer treats that exactly as it treats a missing tag today, never worse.
 */
export function importedSourceFacts(
  probe: ImportProbe,
  /** The picker's own duration, used when the probe could not read one. */
  fallbackDurationMs = 0,
): SourceFacts {
  const presentation = probe.videoFps > 0 ? probe.videoFps : 30;
  const stamped = probe.captureFps > presentation && probe.videoFps > 0;
  const facts: SourceFacts = {
    container_duration_ms: probe.durationMs > 0 ? probe.durationMs : fallbackDurationMs,
    presentation_fps: presentation,
    capture_fps: stamped ? probe.captureFps : 0,
    capture_fps_source: stamped ? "device_metadata" : "unknown",
  };
  if (stamped) facts.slowmo_factor = probe.captureFps / presentation;
  if (probe.width && probe.height) {
    facts.width = probe.width;
    facts.height = probe.height;
  }
  if (probe.hasAudio !== undefined) facts.audio_present = probe.hasAudio;
  return facts;
}

/**
 * The trim block. The window arrives in FILE seconds (every review surface works in the
 * file's own clock); the real-seconds fields are derived through the slow-mo factor so the
 * server can reason about actual swing time without re-deriving the mapping.
 */
export function trimFacts(args: {
  /** The padded window handed to the cutter, in file seconds. */
  fileStartSec: number;
  fileEndSec: number;
  /** The pad that was applied to each end, in FILE seconds (what actually happened). */
  padFileSec: number;
  /** File seconds per real second — 1 for anything this app records. */
  slowMoFactor: number;
  /** The boundaries the muxer reported, in source-file ms. Absent on an older native build. */
  actualStartPtsMs?: number;
  actualEndPtsMs?: number;
}): TrimFacts {
  const slowMo = Math.max(1, args.slowMoFactor);
  const facts: TrimFacts = {
    requested_file_start_pts_ms: args.fileStartSec * 1000,
    requested_file_end_pts_ms: args.fileEndSec * 1000,
    requested_real_start_ms: (args.fileStartSec / slowMo) * 1000,
    requested_real_end_ms: (args.fileEndSec / slowMo) * 1000,
    pad_real_ms: (args.padFileSec / slowMo) * 1000,
  };
  if (args.actualStartPtsMs !== undefined && args.actualEndPtsMs !== undefined) {
    facts.actual_remux_start_pts_ms = args.actualStartPtsMs;
    facts.actual_remux_end_pts_ms = args.actualEndPtsMs;
  }
  return facts;
}

/**
 * The detection block, from the seed the review ran on. Candidates are re-expressed in REAL
 * milliseconds (the schema's unit) through the slow-mo factor. A null seed (detection never
 * ran, or an upstream flow kept its own) yields a block that says only what is known.
 */
export function detectionFacts(args: {
  method: ImpactMethod;
  seed: ImpactSeed | null;
  slowMoFactor: number;
  userAdjusted: boolean;
  /** `windowActivityConfidence`'s answer for the SAVED window, when computed. */
  windowActivity?: number | null;
}): ClientDetection {
  const slowMo = Math.max(1, args.slowMoFactor);
  const facts: ClientDetection = {
    method: args.method,
    threshold_version: SEED_THRESHOLD_VERSION,
    user_adjusted_window: args.userAdjusted,
    visual_fallback_used: false,
  };
  if (args.seed) {
    facts.audio_confidence = args.seed.confidence;
    facts.audio_candidates = args.seed.candidates.map((c) => ({
      real_ms: (c.timeSec / slowMo) * 1000,
      score: c.score,
    }));
  }
  if (args.windowActivity !== undefined && args.windowActivity !== null) {
    facts.window_motion_confidence = args.windowActivity;
  }
  return facts;
}

/** Assemble the manifest. `trim`/`client_detection` are optional by schema — a whole-clip
 *  fallback upload legitimately has neither. */
export function buildSourceManifest(args: {
  source: SourceFacts;
  trim?: TrimFacts;
  detection?: ClientDetection;
}): SourceManifest {
  const manifest: SourceManifest = {
    source_manifest_version: SOURCE_MANIFEST_VERSION,
    source: args.source,
  };
  if (args.trim) manifest.trim = args.trim;
  if (args.detection) manifest.client_detection = args.detection;
  return manifest;
}

/**
 * The preflight budgets — MIRRORS of the server guard's defaults (`guard_budgets()` in
 * `services/analyzer/service/jobrun.py`), not a second policy: the point of checking on the
 * device is refusing the same things one upload earlier, while the original file still exists
 * to re-trim from.
 */
export const PREFLIGHT_MAX_REAL_S = 15;
export const PREFLIGHT_MAX_FRAMES = 2000;
export const PREFLIGHT_MAX_DIM = 4320;
/** How much SHORTER than requested a trim may come back before it reads as a failed cut.
 *  (Longer is normal — the keyframe-aligned start extends the front by design.) */
const PREFLIGHT_SHORTFALL_MS = 750;

/**
 * The post-remux preflight (WP-003): does the trimmed output AGREE with the manifest built
 * for it? A contradiction here is the slow-motion arithmetic being wrong — the exact defect
 * that shipped a 41.6s "five-second swing" to a GPU — and the cheap place to refuse is on the
 * device, before a byte is uploaded. Returns the refusal sentence, or null to proceed.
 */
export function judgeTrimmedClip(
  probe: ImportProbe | null,
  manifest: SourceManifest,
): string | null {
  if (!probe || probe.durationMs <= 0) {
    return "the trimmed clip has no readable video";
  }
  if (
    (probe.width ?? 0) > PREFLIGHT_MAX_DIM ||
    (probe.height ?? 0) > PREFLIGHT_MAX_DIM
  ) {
    return `the trimmed clip's resolution (${probe.width}×${probe.height}) is larger than SwingSage analyzes`;
  }
  const slowMo = Math.max(1, manifest.source.slowmo_factor ?? 1);
  const realS = probe.durationMs / slowMo / 1000;
  if (realS > PREFLIGHT_MAX_REAL_S) {
    return `the cut is ${Math.round(realS)} real seconds of swing — the slow-motion mapping disagrees with the file`;
  }
  const captureFps =
    manifest.source.capture_fps > 0
      ? manifest.source.capture_fps
      : manifest.source.presentation_fps;
  if (realS * captureFps > PREFLIGHT_MAX_FRAMES) {
    return `the cut is too much video to analyze (${Math.round(realS * captureFps)} frames)`;
  }
  const trim = manifest.trim;
  if (trim) {
    const requestedMs = trim.requested_file_end_pts_ms - trim.requested_file_start_pts_ms;
    if (probe.durationMs < requestedMs - PREFLIGHT_SHORTFALL_MS) {
      return "the trim came back shorter than the swing window it was asked for";
    }
  }
  return null;
}
