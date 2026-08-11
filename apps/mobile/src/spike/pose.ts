/**
 * Pose contract as the client sees it, plus the rendering constants that mirror the web player.
 *
 * Kept free of any React Native import so the arithmetic stays testable in a plain Node process —
 * the same reason `probes.ts` is separate from the screen.
 */

/**
 * Two different gates, and conflating them is a real bug that already happened here.
 *
 * `MIN_CONF` is the **measurement** gate, matching `metrics.MIN_CONF`. Below it the analyzer
 * refused to compute an angle from the point, so anything metric-like re-applies it rather than
 * inventing its own threshold.
 *
 * `DRAWN_CONF` is the **rendering** gate, and it is far looser: the web player draws any point
 * with confidence above zero, because zero is the analyzer's "missing" sentinel — a point it
 * never located at all. Applying the measurement gate to drawing was the first mobile port's
 * mistake and it silently deleted every joint between 0 and 0.35 that the web player shows, so
 * the skeleton looked sparser on the phone than on the desktop for no reason visible in the data.
 */
export const MIN_CONF = 0.35;
export const DRAWN_CONF = 0;

/**
 * Joints the web player hides as dots — face detail and finger tips, which are noisy, tiny, and
 * clutter the figure. The BONES list still uses some of them (the knuckle line is forearm roll),
 * so this hides the dot only, never the bone.
 */
export const HIDE_JOINT = /^(nose|.*_eye.*|mouth_.*|.*_pinky|.*_index|.*_thumb|jaw_.*)$/;

/** Anatomical side from a keypoint name, for colouring. */
export function sideOf(name: string): string {
  return name.startsWith("left_") ? "L" : name.startsWith("right_") ? "R" : "M";
}

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
  ["chin", "nose_bridge", "M"],
];

/**
 * Bones the web player draws that this one deliberately does NOT.
 *
 * The knuckle line (pinky knuckle -> index knuckle) was there to show forearm roll. It is dropped
 * on the client's own judgement: it is built from RTMW's hand keypoints, which are the least
 * reliable part of the pose at golf-swing distance — a hand is a few dozen pixels across in a
 * down-the-line clip, and the two knuckles sit inside each other's noise, exactly the geometry
 * that made the shoulder/hip rods misbehave in D20. A roll cue derived from that is a confident
 * wrong number, which this project would rather not draw at all.
 *
 * The wrist ANGLE is unaffected and is what a coach reads anyway: it is the joint between
 * `elbow -> wrist` and `wrist -> grip_center`, both of which are still drawn.
 *
 * The web player still draws the knuckle line. That divergence is intentional and recorded here
 * rather than left to be discovered as a difference between two renderers.
 */
export const OMITTED_BONES: [string, string][] = [
  ["left_pinky", "left_index"],
  ["right_pinky", "right_index"],
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
