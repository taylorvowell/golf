import { describe, expect, it } from "vitest";
import type { Analysis, Keypoint } from "@swingsage/schema/contract";

import { subjectBox, syncProfileOf } from "./syncProfile";

/**
 * The projection that replaced a 22 MB download.
 *
 * Two things are worth pinning here and nothing else is. First, that the checkpoint table goes out
 * **unjudged** — the client owns admission, and a server that quietly filtered would make two app
 * versions see different numbers for the same stored swing. Second, that the subject box is robust
 * to the one thing that actually happens to it: a single keypoint tracked onto a wall.
 */

function pose(frames: { f: number; kp: Keypoint[] }[]) {
  return { model: "rtmw", keypoint_names: [], frames: frames.map((x) => ({ ...x, st: null, interp: false })) };
}

function analysis(over: Partial<Record<string, unknown>> = {}): Analysis {
  return {
    video: { fps: 60, frame_count: 400, width: 1080, height: 1920, handedness: "right", view: "dtl" },
    checkpoints: [
      { p: "P1", frame: 100, conf: 0.9 },
      { p: "P7", frame: 200, conf: 0.98 },
    ],
    playback_window: [40, 300],
    ...over,
  } as unknown as Analysis;
}

/** A body's worth of points in the middle-left of a portrait frame, for `count` frames. */
function body(count: number, conf = 0.9): { f: number; kp: Keypoint[] }[] {
  const out: { f: number; kp: Keypoint[] }[] = [];
  for (let f = 0; f < count; f++) {
    const kp: Keypoint[] = [];
    for (let i = 0; i < 30; i++) kp.push([0.4 + (i % 5) * 0.02, 0.3 + (i % 10) * 0.03, conf]);
    out.push({ f, kp });
  }
  return out;
}

describe("the profile is a projection, not a judgement", () => {
  it("publishes the checkpoint table exactly as the analyzer wrote it", () => {
    // Including the rows the analyzer does not stand behind. Admission (the confidence floor, the
    // ordering-nudge fingerprint) is the client's, and it will get stricter as the event detector
    // is understood better — a stored artifact must not be re-read by whichever server answers.
    const a = analysis({
      checkpoints: [
        { p: "P1", frame: 236, conf: 0.9 },
        { p: "P6", frame: 345, conf: 0.3, basis: "proxy: midpoint of P5 -> impact" },
        { p: "P7", frame: 346, conf: 0.35 },
      ],
    });
    expect(syncProfileOf("s1", "dtl", a).checkpoints).toEqual([
      { p: "P1", frame: 236, conf: 0.9 },
      { p: "P6", frame: 345, conf: 0.3 },
      { p: "P7", frame: 346, conf: 0.35 },
    ]);
  });

  it("reports an audio disagreement, and reports silence as agreement", () => {
    // Three situations mean "nothing here contradicts the video": they agree, the clip had no
    // audio, the artifact predates schema 10. Only an explicit `agrees: false` is evidence.
    const disputed = analysis({ audio_impact: { frame: 305, agrees: false, delta_frames: 40 } });
    expect(syncProfileOf("s1", "dtl", disputed).audioDisagrees).toBe(true);
    expect(syncProfileOf("s1", "dtl", analysis({ audio_impact: { agrees: true } })).audioDisagrees).toBe(false);
    expect(syncProfileOf("s1", "dtl", analysis({ audio_impact: null })).audioDisagrees).toBe(false);
    expect(syncProfileOf("s1", "dtl", analysis()).audioDisagrees).toBe(false);
  });

  it("carries the picture's shape and the golfer's handedness", () => {
    // Two swings of opposite handedness are mirror images; a side-by-side that does not know is
    // comparing a turn against its own reflection.
    const p = syncProfileOf("s1", "dtl", analysis({
      video: { fps: 120, frame_count: 900, width: 720, height: 1280, handedness: "left", view: "dtl" },
    }));
    expect(p).toMatchObject({ fps: 120, frameCount: 900, width: 720, height: 1280, handedness: "left" });
  });
});

describe("the subject box", () => {
  it("survives a keypoint tracked onto the far corner of the frame", () => {
    // One flyaway wrist — a promoted keypoint that landed on a wall or the golfer's shadow — is
    // enough to stretch a min/max box across the whole frame, and the whole frame is exactly what
    // the box exists to avoid showing.
    const frames = body(40);
    frames[10].kp.push([0.99, 0.99, 0.9]);
    const box = subjectBox(analysis({ pose: pose(frames), playback_window: [0, 40] }))!;
    expect(box.x1).toBeLessThan(0.8);
    expect(box.y1).toBeLessThan(0.8);
  });

  it("leaves room for the head and the club, which have no keypoints", () => {
    // The skeleton stops at the joints. A box drawn tight to it crops the head off and cuts the
    // club at the hands, so it is padded — generously, because too much padding costs a slightly
    // smaller golfer and too little costs a decapitated one.
    const box = subjectBox(analysis({ pose: pose(body(40)), playback_window: [0, 40] }))!;
    // The raw points span x 0.40–0.48, y 0.30–0.57.
    expect(box.x0).toBeLessThan(0.4);
    expect(box.y0).toBeLessThan(0.3);
    expect(box.x1).toBeGreaterThan(0.48);
  });

  it("ignores frames outside the playback window", () => {
    // A golfer who walks into shot before the swing would otherwise widen the box across
    // everywhere they stood, which is the opposite of filling a narrow column with the swing.
    const frames = body(40);
    const walking = body(10).map((f, i) => ({
      f: 100 + i,
      kp: f.kp.map(([x, y, c]) => [x + 0.4, y, c] as Keypoint),
    }));
    const inside = subjectBox(analysis({ pose: pose(frames), playback_window: [0, 40] }))!;
    const withWalk = subjectBox(
      analysis({ pose: pose([...frames, ...walking]), playback_window: [0, 40] }),
    )!;
    expect(withWalk.x1).toBeCloseTo(inside.x1, 5);
  });

  it("abstains rather than cropping onto a detection failure", () => {
    // No confident keypoints, or a pose collapsed to a point, is a failure — not a small golfer.
    // Cropping a column onto it would zoom in on a few pixels of noise.
    expect(subjectBox(analysis({ pose: pose(body(40, 0.1)), playback_window: [0, 40] }))).toBeNull();
    const collapsed = body(40).map((f) => ({ f: f.f, kp: f.kp.map(() => [0.5, 0.5, 0.9] as Keypoint) }));
    expect(subjectBox(analysis({ pose: pose(collapsed), playback_window: [0, 40] }))).toBeNull();
    expect(subjectBox(analysis({ pose: null }))).toBeNull();
  });

  it("does not treat an unseen joint as a point in the top-left corner", () => {
    // `[0, 0, 0]` is the contract's "this joint was not seen", and it sits in the corner of the
    // frame — counting it would anchor every box there.
    const frames = body(40);
    for (const f of frames) f.kp.push([0, 0, 0]);
    const box = subjectBox(analysis({ pose: pose(frames), playback_window: [0, 40] }))!;
    expect(box.x0).toBeGreaterThan(0.2);
    expect(box.y0).toBeGreaterThan(0.1);
  });
});
