import type { StanceAnnotation } from "../../design/system";

/**
 * The guided stance analysis script — Taylor's standardized sequence (2026-08-19, captured in
 * `DESIGN-coach-surface.md` §3): every run walks the same beats, DTL first, then face-on.
 * Each beat draws its marks, holds while the coach talks, clears, and the next beat draws.
 *
 * STUB, flagged: `narration` is the voice track's script rendered as text until the voice
 * lands (the D57 voice-bank seam), and the verdict copy is the "good" reading — the wired
 * version chooses between good/adjust lines per beat from the golfer's own geometry, and the
 * hang-loose cue (beat 1's `alt`) surfaces only when the shaft line misses the belt buckle.
 * Wording stays qualitative on purpose: no invented degrees — video does not yield them.
 *
 * Verdict rendering rule (Taylor, 2026-08-19): a CORRECT reading pops the green check badge;
 * a NEGATIVE reading turns the highlight itself `tone: "bad"` (red) and pops NOTHING. The
 * stub's beats are all the good path, so every beat here carries a check.
 */

export interface StanceBeat {
  key: string;
  view: "dtl" | "face_on";
  /** The beat's place in the walk — "Address · Down the line". */
  eyebrow: string;
  title: string;
  narration: string;
  /** The adjust-path narration the wired feature swaps in when the check misses. */
  alt?: string;
  annotations: StanceAnnotation[];
  /** How long the beat holds after the draw — the "3 seconds later, clear" rhythm. */
  holdMs: number;
}

/* Anchor points are figure-space fractions of the pose art's box (see StanceStage) —
   eyeballed for the stub, replaced by artifact keypoints when wired. */

/**
 * The wrap narration when NO front-view artifact exists — the walk only ever shows what was
 * actually filmed (Taylor, 2026-08-19: "it should only show what we have"), and the close
 * invites the missing angle instead of faking it.
 */
export const WRAP_NO_FRONT_NARRATION =
  "Solid foundation from down the line. Upload a front-view swing and your coach will walk " +
  "the front positions too — shoulder lean, knee balance, and weight. When something needs " +
  "work, this walkthrough is where your coach will show you, drawn right on your own stance.";

export const STANCE_SCRIPT: readonly StanceBeat[] = [
  {
    key: "shaft-line",
    view: "dtl",
    eyebrow: "Address · Down the line",
    title: "The shaft points at your belt buckle",
    narration:
      "Follow your club shaft up from the ball — the line should run straight into your belt buckle. Not your belly button, not below your belt. Yours lands right on it: that spacing sets your posture for everything after.",
    alt:
      "Picture a hang-loose sign between your body and the end of the club — that's the gap you want. Let's draw from the butt of the club to your belt buckle and match that distance.",
    annotations: [
      // The belt buckle is the FRONT EDGE of the body at belt height — lower and ball-side of
      // the torso's centre point, where a buckle actually sits (Taylor, 2026-08-19).
      { id: "shaft", kind: "line", from: [0.1, 0.94], to: [0.52, 0.5], tone: "guide" },
      { id: "extend", kind: "line", from: [0.52, 0.5], to: [0.71, 0.47], tone: "guide", dashed: true },
      { id: "buckle", kind: "dot", at: [0.71, 0.47], tone: "good" },
      // The coach's pen circles the meeting point AFTER the lines land (the marker motion).
      { id: "buckle-ring", kind: "circle", at: [0.71, 0.47], r: 0.06, tone: "good" },
      // Correct here in the stub — wired, the check pops only when the verdict passes.
      { id: "buckle-check", kind: "check", at: [0.86, 0.34] },
    ],
    holdMs: 5200,
  },
  {
    key: "spine-knees",
    view: "dtl",
    eyebrow: "Address · Down the line",
    title: "The back angle",
    narration:
      "Now the angles. Your spine sets a strong line from hips to shoulders — a real hinge from the hips, not a slouch. The faint line is the optimal angle — about forty degrees — and you're sitting right on it.",
    annotations: [
      // The optimal-angle reference fades in first; the golfer's own line draws over it.
      { id: "spine-optimal", kind: "line", from: [0.75, 0.44], to: [0.64, 0.15], ghost: true, label: "40°" },
      { id: "spine", kind: "line", from: [0.6, 0.17], to: [0.75, 0.44], tone: "good" },
      { id: "spine-check", kind: "check", at: [0.86, 0.26] },
    ],
    holdMs: 4800,
  },
  {
    key: "knee-bend",
    view: "dtl",
    eyebrow: "Address · Down the line",
    title: "A slight bend in the knees",
    narration:
      "Right after the back angle comes the knees. The faint line is a straight leg — you want about twenty degrees of soft bend away from it. Athletic and springy, never locked, never a squat. Yours sit right in that window.",
    alt:
      "Right after the back angle comes the knees. The faint line is a straight leg — you want about twenty degrees of soft bend away from it. Yours are outside that window: soften into a gentle athletic flex — not locked, not a squat.",
    annotations: [
      // The straight-leg reference, wearing the optimal bend it is measured against.
      { id: "leg-straight", kind: "line", from: [0.74, 0.44], to: [0.56, 0.95], ghost: true, label: "20°" },
      { id: "thigh", kind: "line", from: [0.74, 0.44], to: [0.62, 0.68], tone: "good" },
      { id: "shin", kind: "line", from: [0.62, 0.68], to: [0.56, 0.95], tone: "good" },
      { id: "knee-dot", kind: "dot", at: [0.62, 0.68], tone: "good" },
      { id: "knee-check", kind: "check", at: [0.76, 0.62] },
    ],
    holdMs: 4800,
  },
  {
    key: "arm-drape",
    view: "dtl",
    eyebrow: "Address · Down the line",
    title: "Arms drape from the shoulders",
    narration:
      "Your arms should hang straight down from the shoulders — draped by gravity, not reaching for the ball and not pinned to your body. The faint line is plumb vertical, your reference. Relaxed wrists let the club release on its own.",
    annotations: [
      { id: "drape-plumb", kind: "line", from: [0.57, 0.24], to: [0.57, 0.5], ghost: true },
      { id: "drape", kind: "line", from: [0.57, 0.24], to: [0.53, 0.49], tone: "guide" },
      { id: "wrists", kind: "circle", at: [0.52, 0.51], r: 0.055, tone: "good" },
      { id: "drape-check", kind: "check", at: [0.66, 0.4] },
    ],
    holdMs: 4800,
  },
  {
    key: "free-look",
    view: "dtl",
    eyebrow: "Address · Down the line",
    title: "One more thing your coach noticed",
    narration:
      "Your head stays quiet over the ball — eyes level, chin off your chest. That gives your shoulders room to turn under you instead of around you.",
    annotations: [
      { id: "head", kind: "circle", at: [0.62, 0.08], r: 0.07, tone: "guide" },
      { id: "head-check", kind: "check", at: [0.78, 0.03] },
    ],
    holdMs: 4200,
  },
  {
    key: "shoulder-lean",
    view: "face_on",
    eyebrow: "Address · Front view",
    title: "Shoulder lean",
    narration:
      "From the front: with your trail hand lower on the grip, your shoulders should show a slight lean away from the target — trail shoulder just under the lead. Yours sits in a good spot.",
    annotations: [
      { id: "shoulders", kind: "line", from: [0.2, 0.24], to: [0.8, 0.2], tone: "good" },
      { id: "lean-check", kind: "check", at: [0.88, 0.12] },
    ],
    holdMs: 4800,
  },
  {
    key: "knee-flex",
    view: "face_on",
    eyebrow: "Address · Front view",
    title: "Knees and balance",
    narration:
      "Both knees carry the same soft flex, and your weight sits balanced across the middle of each foot — nothing drifting toward the toes or heels. A stable base is what the whole swing turns on.",
    annotations: [
      { id: "knee-l", kind: "line", from: [0.3, 0.66], to: [0.42, 0.7], tone: "guide" },
      { id: "knee-r", kind: "line", from: [0.58, 0.7], to: [0.7, 0.66], tone: "guide" },
      { id: "knees-check", kind: "check", at: [0.5, 0.56] },
    ],
    holdMs: 4800,
  },
  {
    key: "wrap",
    view: "face_on",
    eyebrow: "Address",
    title: "That's your setup",
    narration:
      "Solid foundation. When something needs work, this walkthrough is where your coach will show you — drawn right on your own stance. Check the Coach tab for what to work on first.",
    annotations: [],
    holdMs: 4200,
  },
];
