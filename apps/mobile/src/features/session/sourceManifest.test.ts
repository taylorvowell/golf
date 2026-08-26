import { validateSourceManifest } from "@swingsage/schema";

import { SAVE_PAD_S } from "./captureConstants";
import { pickImpactSeed, SEED_THRESHOLD_VERSION } from "./reviewWindow";
import {
  buildSourceManifest,
  detectionFacts,
  importedSourceFacts,
  judgeTrimmedClip,
  recordedSourceFacts,
  trimFacts,
} from "./sourceManifest";

/**
 * The step-02 fixture matrix, client half: every clip class the product meets yields the
 * expected manifest, with ZERO frame-count/duration interpretation mismatch — the server-side
 * half (the guard's verdict on these same facts) lives in the analyzer's pytest.
 *
 * The one that matters most is the 240-captured-30-presented slow-mo: its container tag dies
 * in the phone remux, so the manifest built HERE from the original is the only place the
 * capture truth survives (the 2,445-frame incident class).
 */

describe("source facts — the capture-clock truth per clip class", () => {
  it("an in-app take states its recorder config at every supported rate", () => {
    for (const fps of [60, 120, 240]) {
      const facts = recordedSourceFacts({ fps, durationMs: 6_000, width: 1920, height: 1080 });
      expect(facts).toMatchObject({
        presentation_fps: fps,
        capture_fps: fps,
        capture_fps_source: "recorder_config",
        slowmo_factor: 1,
        codec: "h264",
        audio_present: true,
        width: 1920,
        height: 1080,
      });
    }
  });

  it("a 30fps real-time import stays honest: capture unknown, never guessed", () => {
    const facts = importedSourceFacts({ captureFps: 0, videoFps: 30, durationMs: 8_000 });
    expect(facts.presentation_fps).toBe(30);
    expect(facts.capture_fps).toBe(0);
    expect(facts.capture_fps_source).toBe("unknown");
    expect(facts.slowmo_factor).toBeUndefined();
  });

  it("a 240-captured, 30-presented slow-mo records the mapping the remux is about to destroy", () => {
    const facts = importedSourceFacts({
      captureFps: 240,
      videoFps: 30,
      durationMs: 41_600,
      width: 1920,
      height: 1080,
      hasAudio: true,
    });
    expect(facts).toMatchObject({
      container_duration_ms: 41_600,
      presentation_fps: 30,
      capture_fps: 240,
      capture_fps_source: "device_metadata",
      slowmo_factor: 8,
      audio_present: true,
    });
  });

  it("missing metadata falls back rather than fails: picker duration, 30fps presentation", () => {
    const facts = importedSourceFacts({ captureFps: 0, videoFps: 0, durationMs: 0 }, 8_000);
    expect(facts.container_duration_ms).toBe(8_000);
    expect(facts.presentation_fps).toBe(30);
    expect(facts.capture_fps_source).toBe("unknown");
  });

  it("a nonsense capture stamp (below the presentation rate) is treated as no stamp at all", () => {
    const facts = importedSourceFacts({ captureFps: 24, videoFps: 30, durationMs: 8_000 });
    expect(facts.capture_fps).toBe(0);
    expect(facts.capture_fps_source).toBe("unknown");
    expect(facts.slowmo_factor).toBeUndefined();
  });
});

describe("trim facts — requested vs written, file clock vs real clock", () => {
  it("re-expresses a slow-mo window in real milliseconds through the factor", () => {
    // A 5.2 real-second window on an 8× clip is 41.6 FILE seconds — the exact numbers of the
    // incident clip class. Both clocks are recorded; neither is derived server-side.
    const facts = trimFacts({
      fileStartSec: 0,
      fileEndSec: 41.6,
      padFileSec: SAVE_PAD_S,
      slowMoFactor: 8,
      actualStartPtsMs: 0,
      actualEndPtsMs: 41_580,
    });
    expect(facts.requested_file_start_pts_ms).toBe(0);
    expect(facts.requested_file_end_pts_ms).toBeCloseTo(41_600);
    expect(facts.requested_real_start_ms).toBe(0);
    expect(facts.requested_real_end_ms).toBeCloseTo(5_200);
    expect(facts.pad_real_ms).toBeCloseTo((SAVE_PAD_S / 8) * 1000);
    expect(facts.actual_remux_end_pts_ms).toBe(41_580);
  });

  it("records a keyframe-aligned start that landed EARLIER than asked, verbatim", () => {
    const facts = trimFacts({
      fileStartSec: 10,
      fileEndSec: 15.2,
      padFileSec: SAVE_PAD_S,
      slowMoFactor: 1,
      actualStartPtsMs: 9_240, // PREVIOUS_SYNC walked back to the keyframe
      actualEndPtsMs: 15_180,
    });
    expect(facts.requested_file_start_pts_ms).toBe(10_000);
    expect(facts.actual_remux_start_pts_ms).toBe(9_240);
  });

  it("omits actual boundaries when an older native build never reported them", () => {
    const facts = trimFacts({
      fileStartSec: 10,
      fileEndSec: 15.2,
      padFileSec: SAVE_PAD_S,
      slowMoFactor: 1,
    });
    expect(facts.actual_remux_start_pts_ms).toBeUndefined();
    expect(facts.actual_remux_end_pts_ms).toBeUndefined();
  });
});

describe("detection facts — telemetry, never a measurement", () => {
  it("carries the seed's class and candidates in REAL ms, plus how the window was chosen", () => {
    const seed = pickImpactSeed(
      [
        { timeSec: 32, score: 1.0 },
        { timeSec: 38.4, score: 0.9 },
      ],
      41.6,
    );
    const facts = detectionFacts({
      method: "swish",
      seed,
      slowMoFactor: 8,
      userAdjusted: true,
      windowActivity: 1,
    });
    expect(facts.method).toBe("swish");
    expect(facts.threshold_version).toBe(SEED_THRESHOLD_VERSION);
    expect(facts.audio_confidence).toBe("ambiguous");
    // 32 file-seconds on an 8× clip is 4 REAL seconds — the schema's unit.
    expect(facts.audio_candidates?.map((c) => c.real_ms)).toEqual([4_000, 4_800]);
    expect(facts.user_adjusted_window).toBe(true);
    expect(facts.visual_fallback_used).toBe(false);
    expect(facts.window_motion_confidence).toBe(1);
  });

  it("never records the mark itself — a null seed yields only what is known", () => {
    const facts = detectionFacts({
      method: "swish",
      seed: null,
      slowMoFactor: 1,
      userAdjusted: false,
    });
    expect(facts.audio_candidates).toBeUndefined();
    expect(facts.audio_confidence).toBeUndefined();
    expect(Object.keys(facts).sort()).toEqual([
      "method",
      "threshold_version",
      "user_adjusted_window",
      "visual_fallback_used",
    ]);
  });
});

describe("the assembled manifest validates against the shared schema", () => {
  it("full shape — the slow-mo import as it would really upload", () => {
    const seed = pickImpactSeed([{ timeSec: 32, score: 1 }], 41.6);
    const manifest = buildSourceManifest({
      source: importedSourceFacts({ captureFps: 240, videoFps: 30, durationMs: 41_600 }),
      trim: trimFacts({
        fileStartSec: 12,
        fileEndSec: 53.6,
        padFileSec: SAVE_PAD_S,
        slowMoFactor: 8,
        actualStartPtsMs: 11_200,
        actualEndPtsMs: 53_560,
      }),
      detection: detectionFacts({
        method: "swish",
        seed,
        slowMoFactor: 8,
        userAdjusted: false,
        windowActivity: 1,
      }),
    });
    expect(validateSourceManifest(manifest)).toEqual({ valid: true, errors: [] });
  });

  it("minimal shape — the whole-clip fallback carries source facts alone", () => {
    const manifest = buildSourceManifest({
      source: importedSourceFacts({ captureFps: 0, videoFps: 30, durationMs: 8_000 }),
    });
    expect(manifest.trim).toBeUndefined();
    expect(manifest.client_detection).toBeUndefined();
    expect(validateSourceManifest(manifest)).toEqual({ valid: true, errors: [] });
  });
});

describe("judgeTrimmedClip — the pre-upload preflight", () => {
  const slowMoManifest = buildSourceManifest({
    source: importedSourceFacts({ captureFps: 240, videoFps: 30, durationMs: 120_000 }),
    trim: trimFacts({
      fileStartSec: 12,
      fileEndSec: 53.6,
      padFileSec: SAVE_PAD_S,
      slowMoFactor: 8,
    }),
  });

  it("admits the healthy slow-mo cut — 41.6 file seconds IS 5.2 real seconds", () => {
    expect(
      judgeTrimmedClip({ captureFps: 0, videoFps: 30, durationMs: 41_600 }, slowMoManifest),
    ).toBeNull();
  });

  it("refuses the cut when the slow-mo mapping contradicts the file", () => {
    // The manifest says real-time (no factor) but the trim is 41.6s of video: the exact
    // shape the incident clip reached the GPU in, refused before a byte uploads.
    const realTime = buildSourceManifest({
      source: importedSourceFacts({ captureFps: 0, videoFps: 30, durationMs: 120_000 }),
      trim: trimFacts({
        fileStartSec: 12,
        fileEndSec: 53.6,
        padFileSec: SAVE_PAD_S,
        slowMoFactor: 1,
      }),
    });
    const verdict = judgeTrimmedClip(
      { captureFps: 0, videoFps: 30, durationMs: 41_600 },
      realTime,
    );
    expect(verdict).toMatch(/real seconds/);
  });

  it("refuses a cut whose frame estimate exceeds the analyzer's budget", () => {
    // 14 real seconds at 240fps: inside the duration budget, over the frame budget — the
    // same split the server guard enforces, refused one upload earlier.
    const manifest = buildSourceManifest({
      source: recordedSourceFacts({ fps: 240, durationMs: 30_000 }),
      trim: trimFacts({
        fileStartSec: 0,
        fileEndSec: 14,
        padFileSec: SAVE_PAD_S,
        slowMoFactor: 1,
      }),
    });
    expect(
      judgeTrimmedClip({ captureFps: 240, videoFps: 240, durationMs: 14_000 }, manifest),
    ).toMatch(/frames/);
  });

  it("refuses a cut that came back materially shorter than the window asked for", () => {
    const manifest = buildSourceManifest({
      source: recordedSourceFacts({ fps: 60, durationMs: 30_000 }),
      trim: trimFacts({
        fileStartSec: 10,
        fileEndSec: 15.2,
        padFileSec: SAVE_PAD_S,
        slowMoFactor: 1,
      }),
    });
    expect(
      judgeTrimmedClip({ captureFps: 0, videoFps: 60, durationMs: 3_000 }, manifest),
    ).toMatch(/shorter/);
  });

  it("tolerates the keyframe extension — longer than asked is the remux working correctly", () => {
    const manifest = buildSourceManifest({
      source: recordedSourceFacts({ fps: 60, durationMs: 30_000 }),
      trim: trimFacts({
        fileStartSec: 10,
        fileEndSec: 15.2,
        padFileSec: SAVE_PAD_S,
        slowMoFactor: 1,
      }),
    });
    expect(
      judgeTrimmedClip({ captureFps: 0, videoFps: 60, durationMs: 6_100 }, manifest),
    ).toBeNull();
  });

  it("refuses an unreadable or empty trim outright", () => {
    expect(judgeTrimmedClip(null, slowMoManifest)).toMatch(/readable/);
    expect(
      judgeTrimmedClip({ captureFps: 0, videoFps: 0, durationMs: 0 }, slowMoManifest),
    ).toMatch(/readable/);
  });
});
