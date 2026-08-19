import type { CaptureView } from "./sessionState";

/**
 * Why an analysis stopped short, in a golfer's words.
 *
 * The pipeline degrades rather than crashes (root `CLAUDE.md`): a run can finish with no usable
 * swing, or finish with the club unmeasurable, and either way the golfer is owed the REASON and
 * the fix — not a spinner that ends in nothing. Each kind names the stage it died at, because
 * "we could not find a swing" and "we found the swing but lost the club" are different problems
 * with different answers.
 *
 * `showsFraming` marks the kinds a picture actually helps with. Where the fault is how the shot
 * was set up, the sheet puts a frame of their own video beside the stance we wanted — comparing
 * the two answers the question faster than any sentence does. Where it is not (an empty clip),
 * a picture of nothing would be noise.
 */

export type AnalysisErrorKind = "no_swing" | "club_lost" | "too_close" | "low_confidence";

export interface AnalysisErrorCopy {
  /** The stage that failed — stated plainly, never a code. */
  stage: string;
  title: string;
  detail: string;
  /** What to do differently. One instruction, not a checklist. */
  fix: string;
  showsFraming: boolean;
}

export const ANALYSIS_ERRORS: Record<AnalysisErrorKind, AnalysisErrorCopy> = {
  no_swing: {
    stage: "Finding the swing",
    title: "We couldn't find a swing",
    detail: "The video played through without a golf swing in it that we could measure.",
    fix: "Start recording just before you set up, and let it run through the finish.",
    showsFraming: false,
  },
  club_lost: {
    stage: "Tracking the club",
    title: "The club left the frame",
    detail:
      "We followed your body the whole way, but the club head went outside the picture during the swing, so club measurements aren't available.",
    fix: "Step back or tilt the phone up so the top of the backswing stays in shot.",
    showsFraming: true,
  },
  too_close: {
    stage: "Tracking your body",
    title: "You're too close to the camera",
    detail: "Parts of you left the frame during the swing, so the body angles can't be trusted.",
    fix: "Move the phone back until your whole body and a little space above your head are in shot.",
    showsFraming: true,
  },
  low_confidence: {
    stage: "Finding your body",
    title: "We couldn't see you clearly enough",
    detail:
      "The picture was too dark, too soft or too busy for us to place your joints with any confidence.",
    fix: "Find better light and a plainer background, and keep the phone still.",
    showsFraming: true,
  },
};

/** The stance we wanted, for the comparison panel — the same art the capture guide draws. */
export function referenceStance(view: CaptureView): CaptureView {
  return view;
}
