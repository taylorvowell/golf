/**
 * Pose contract as the client sees it, plus the rendering constants that mirror the web player.
 *
 * Kept free of any React Native import so the arithmetic stays testable in a plain Node process —
 * the same reason `probes.ts` is separate from the screen.
 */

/** Matches `metrics.MIN_CONF` and the web player. Below this the analyzer treated the point as
 *  missing, so every consumer re-applies the same gate rather than inventing its own. */
export const MIN_CONF = 0.35;

/** Mirrors `apps/web/src/lib/skeleton.ts`. L = lead-agnostic anatomical left, R right, M midline. */
export const SIDE_COLOR: Record<string, string> = {
  L: "#22C55E",
  R: "#FACC15",
  M: "#22D3EE",
};

/**
 * Bone list copied from the web player so the two renderers draw the same figure.
 *
 * Named joints, never indices. `analysis.json` ships `pose.keypoint_names` with every artifact
 * precisely so a derived joint added on the Python side cannot silently desync a renderer, and
 * hardcoding 0-48 here would throw that property away.
 */
export const BONES: [string, string, string][] = [
  ["head_center", "neck", "M"],
  ["neck", "spine_mid", "M"],
  ["spine_mid", "mid_hip", "M"],
  ["neck", "left_shoulder", "L"],
  ["neck", "right_shoulder", "R"],
  ["left_shoulder", "left_elbow", "L"],
  ["left_elbow", "left_wrist", "L"],
  ["right_shoulder", "right_elbow", "R"],
  ["right_elbow", "right_wrist", "R"],
  ["left_wrist", "grip_center", "L"],
  ["right_wrist", "grip_center", "R"],
  ["mid_hip", "left_hip", "L"],
  ["mid_hip", "right_hip", "R"],
  ["left_hip", "left_knee", "L"],
  ["left_knee", "left_ankle", "L"],
  ["right_hip", "right_knee", "R"],
  ["right_knee", "right_ankle", "R"],
  ["left_ankle", "left_heel", "L"],
  ["left_heel", "left_foot_index", "L"],
  ["right_ankle", "right_heel", "R"],
  ["right_heel", "right_foot_index", "R"],
  ["left_heel", "left_small_toe", "L"],
  ["left_small_toe", "left_foot_index", "L"],
  ["right_heel", "right_small_toe", "R"],
  ["right_small_toe", "right_foot_index", "R"],
  ["left_pinky", "left_index", "L"],
  ["right_pinky", "right_index", "R"],
  ["chin", "nose_bridge", "M"],
];

/** One keypoint: normalized x, normalized y, confidence. */
export type Keypoint = [number, number, number];

export interface PoseFrame {
  f: number;
  kp: Keypoint[];
}

/** What `scripts/make_real_clip.py` writes next to the stamped clip. */
export interface PoseBundle {
  stem: string;
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  view: string | null;
  handedness: string | null;
  keypointNames: string[];
  frames: PoseFrame[];
}

/** Name → index, built once per bundle. */
export function buildIndex(names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = i;
  });
  return out;
}

/**
 * Pose frame for a video frame index.
 *
 * `pose.frames` is dense and in order for every artifact this project produces, so the direct hit
 * is checked first and the scan is only a guard against that ever stopping being true. Returning
 * null rather than a neighbouring frame is deliberate: drawing frame 301's skeleton on frame 300
 * is exactly the defect the whole frame-sync effort exists to prevent, so a gap must render
 * nothing rather than something plausible.
 */
export function frameAt(bundle: PoseBundle, index: number): PoseFrame | null {
  const direct = bundle.frames[index];
  if (direct && direct.f === index) return direct;
  return bundle.frames.find((fr) => fr.f === index) ?? null;
}
