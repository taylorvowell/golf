import type { Analysis } from "@swingsage/schema/contract";

/**
 * A small, real-shaped `analysis.json` for the overlay tests.
 *
 * Hand-built rather than a captured fixture, and deliberately so: the tests that use it are about
 * what the renderer does with **absence** — a keypoint below `MIN_CONF`, a null `club`, a missing
 * `metrics` block, a gap in the trace — and a captured artifact from a healthy swing has none of
 * those. The one thing it does copy exactly is the *shape*, including the fact that nearly every
 * block is nullable.
 *
 * It lives under `__fixtures__` so nothing in the app can import it: the app bundle has no business
 * carrying a synthetic swing.
 */

export const KEYPOINT_NAMES = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "neck",
  "head_center",
  "spine_mid",
  "mid_hip",
  "grip_center",
];

/** Indices into `KEYPOINT_NAMES`, so a test can name a joint without counting. */
export const KP = Object.fromEntries(KEYPOINT_NAMES.map((n, i) => [n, i])) as Record<string, number>;

export interface FixtureOptions {
  frameCount?: number;
  fps?: number;
  /** Per-frame confidence for every keypoint. Below 0.35 the measurement layers must abstain. */
  conf?: number;
  club?: boolean;
  traceEnabled?: boolean;
  /** Insert a gap in the measured trace frames, so a bridge piece is produced. */
  traceGap?: boolean;
  events?: boolean;
  metrics?: boolean;
  playbackWindow?: [number, number] | null;
}

export function makeAnalysis(o: FixtureOptions = {}): Analysis {
  const frameCount = o.frameCount ?? 40;
  const fps = o.fps ?? 60;
  const conf = o.conf ?? 0.9;
  const withClub = o.club ?? true;
  const withEvents = o.events ?? true;
  const withMetrics = o.metrics ?? true;

  const frames = Array.from({ length: frameCount }, (_, f) => ({
    f,
    // A slow drift across the clip, so a bone has a direction and a test can tell frame N's pose
    // from frame N+1's.
    kp: KEYPOINT_NAMES.map((_n, i) => [
      0.3 + i * 0.02 + f * 0.001,
      0.2 + i * 0.03 + f * 0.002,
      conf,
    ]) as [number, number, number][],
    st: null,
    interp: false,
  }));

  const traceFrames = o.traceGap ? [0, 1, 2, 12, 13, 14] : [0, 1, 2, 3, 4, 5];
  const tracePts = traceFrames.map((f, i) => [0.4 + i * 0.03, 0.5 - i * 0.02] as [number, number]);

  const event = (frame: number) => ({ frame, conf: 0.9 });

  return {
    schema_version: 9,
    video: {
      fps,
      frame_count: frameCount,
      width: 1080,
      height: 1920,
      view: "dtl",
    },
    pose: {
      model: "rtmw",
      keypoint_names: KEYPOINT_NAMES,
      frames,
    },
    events: withEvents
      ? {
          address: event(2),
          toe_up: event(6),
          mid_backswing: event(9),
          top: event(12),
          mid_downswing: event(15),
          impact: event(18),
          mid_follow_through: event(22),
          finish: event(26),
        }
      : undefined,
    checkpoints: null,
    phases: null,
    swing_window: null,
    playback_window: o.playbackWindow === undefined ? [4, 30] : o.playbackWindow,
    playback_pad: null,
    address_span: null,
    tempo: null,
    club: withClub
      ? {
          club_len: 0.4,
          butt_len: 0.1,
          coverage: { backswing: 0.9 },
          trace_enabled: o.traceEnabled ?? true,
          notes: [],
          frames: Array.from({ length: frameCount }, (_, f) => ({
            f,
            shaft: [
              [0.5, 0.5],
              [0.6, 0.8],
            ] as [number, number][],
            head: [0.6, 0.8] as [number, number],
            butt: [0.5, 0.5] as [number, number],
            conf: 0.8,
            interp: false,
          })),
          trace: {
            backswing: tracePts,
            downswing: [],
            followthrough: [],
          },
          trace_frames: {
            backswing: traceFrames,
            downswing: [],
            followthrough: [],
          },
        }
      : null,
    face: null,
    metrics: withMetrics
      ? {
          body_height_norm: 0.5,
          units: "deg",
          provisional_thresholds: false,
          glossary: null,
          sides: null,
          series: Array.from({ length: frameCount }, () => ({ lead_knee_flex: 24.5 })),
          event_snapshots: {},
          checkpoints: null,
          angle_fields: [
            {
              field: "lead_knee_flex",
              label: "Lead knee flex",
              view: "both",
              delta: false,
              when: "both",
              geom: {
                kind: "interior",
                vertex: "left_knee",
                a: "left_hip",
                b: "left_ankle",
                supplement: true,
              },
            },
            {
              // No geometry: the width-derived rotation estimates. Must never be offered.
              field: "shoulder_turn_est",
              label: "Shoulder turn (estimated)",
              view: "both",
              delta: false,
              when: "swing",
              geom: null,
            },
          ],
          summary: {},
        }
      : null,
    quality: { pose_coverage: 0.98, club_coverage: 0.7 },
    quality_raw: null,
    quality_mediapipe: null,
    stage3: null,
  } as unknown as Analysis;
}
