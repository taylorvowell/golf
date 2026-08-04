/**
 * Rendering constants mirroring services/analyzer/swingsage/skeleton.py.
 *
 * Keypoint *order* is not duplicated here — it arrives with every analysis.json as
 * `pose.keypoint_names`, so the contract stays self-describing and adding a derived joint
 * on the Python side cannot silently desync the renderer. Only names are referenced.
 */
export const SIDE_COLOR: Record<string, string> = {
  L: "#22C55E", // left
  R: "#FACC15", // right
  M: "#22D3EE", // spine / derived midline
};

export const TRACE_COLOR = {
  backswing: "#E5484D",
  downswing: "#3B82F6",
  followthrough: "rgba(59,130,246,.35)",
} as const;

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
  // The hands — wrist out to where they hold the club. Without these the skeleton stops at
  // the wrist and the club reads as detached from the body.
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
];

/** Face detail and the hand landmarks add clutter without coaching value (doc 03 §2). */
export const HIDE_JOINT = /^(nose|.*_eye.*|mouth_.*|.*_pinky|.*_index|.*_thumb)$/;

export const EV_SHORT: Record<string, string> = {
  address: "ADR", toe_up: "TOE", mid_backswing: "MID-B", top: "TOP",
  mid_downswing: "MID-D", impact: "IMP", mid_follow_through: "MID-F", finish: "FIN",
};
