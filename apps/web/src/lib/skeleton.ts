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

/**
 * Club-head trace colours, one per segment.
 *
 * **Deliberate deviation from doc 04 §5 / the UI brief's "locked" palette**, which specified
 * red backswing and blue downswing. Red-back / blue-down is a golf-instruction convention, so
 * a coach reading this trace will not get the pairing they expect — that cost is real and was
 * accepted knowingly. See docs/DECISIONS.md D34.
 *
 * Follow-through carries its alpha in the colour rather than being drawn at a lower opacity,
 * so it stays translucent regardless of how the renderer sets globalAlpha. It is also drawn
 * FIRST (see SwingStage), so it sits behind the two segments a coach reads rather than over
 * them — the pairing of "behind" and "faint" is what keeps the long tail of the path from
 * competing with the backswing and downswing it crosses.
 */
export const TRACE_COLOR = {
  backswing: "#2E9BFF",
  downswing: "#6D59FF",
  // Follow-through is drawn at ZERO alpha — hidden, not deleted (user directive
  // 2026-08-08: "change styling to 0 but keep it in case we want it"). Everything that
  // builds and cuts the follow-through path still runs; only the paint is invisible, so
  // restoring it is this one value. The legend hides its swatch to match.
  followthrough: "rgba(255,255,255,0)",
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
  // Outer foot edge, closing the sole triangle. A foot drawn as a single heel-to-toe line
  // cannot show heel lift or roll; these are the segments that make both visible.
  ["left_heel", "left_small_toe", "L"],
  ["left_small_toe", "left_foot_index", "L"],
  ["right_heel", "right_small_toe", "R"],
  ["right_small_toe", "right_foot_index", "R"],
  // Knuckle line (pinky knuckle -> index knuckle). Its rotation is forearm roll.
  ["left_pinky", "left_index", "L"],
  ["right_pinky", "right_index", "R"],
  // Face profile, so head orientation is legible beside the head_center dot.
  ["chin", "nose_bridge", "M"],
];

/**
 * Face detail adds clutter without coaching value (doc 03 §2). The hand landmarks are
 * hidden as *joints* but their connecting bone is drawn above — on the wholebody path
 * these are real measured knuckles, and the line reads as roll where three dots read as
 * noise. Points absent from an analysis are skipped by the renderer anyway, so this stays
 * correct for MediaPipe-only runs.
 */
export const HIDE_JOINT = /^(nose|.*_eye.*|mouth_.*|.*_pinky|.*_index|.*_thumb|jaw_.*)$/;

export const EV_SHORT: Record<string, string> = {
  address: "ADR", toe_up: "TOE", mid_backswing: "MID-B", top: "TOP",
  mid_downswing: "MID-D", impact: "IMP", mid_follow_through: "MID-F", finish: "FIN",
};

/**
 * What a coach calls each span between two events, keyed by the analyzer's `phases[].name`.
 *
 * The phase bar labels itself with the short code of the event a segment *ends* at — so the
 * span from address to toe-up reads "TOE", which the UI brief lists as a real confusion (§8.6).
 * These are the names for the hover tooltip: the thing between address and toe-up is the
 * takeaway, not "toe up". Vocabulary matches docs/GLOSSARY.md.
 */
export const PHASE_LABEL: Record<string, string> = {
  "address->toe_up": "Takeaway",
  "toe_up->mid_backswing": "Backswing",
  "mid_backswing->top": "To the top",
  "top->mid_downswing": "Transition",
  "mid_downswing->impact": "Delivery",
  "impact->mid_follow_through": "Release",
  "mid_follow_through->finish": "Follow through",
};
