import { MIN_CONF, type Analysis, type SyncProfile, type SyncSubject } from "@swingsage/schema/contract";

/**
 * The half-kilobyte a client needs to line one swing up against another.
 *
 * ## Why this route exists at all
 *
 * Everything here is already in `analysis.json`, and reading it from there is what the mobile
 * comparison used to do — for ten integers, a frame rate and a bounding box. That artifact is
 * **5.9 MB on `6iron-1` and 22 MB on `pro_3`**, it is the largest payload the app moves, and the
 * comparison needs it for a swing the golfer is not even watching. On a phone that is not a
 * detail: it is the difference between a side-by-side that appears when you tap a row and one
 * that arrives long enough afterwards to read as broken.
 *
 * ## A projection, never a second source of truth
 *
 * Nothing is computed here that the artifact does not already state, and no judgement is applied
 * to it. In particular the checkpoint table goes out **as published, including the rows the
 * analyzer does not stand behind** — the confidence floor and the ordering-nudge fingerprint are
 * applied client-side in `align.ts`. That split is deliberate: admission rules will get stricter
 * as the event detector is understood better, and a stored artifact must not be re-interpreted by
 * whichever server version happens to answer. Two app versions are allowed to disagree about what
 * is trustworthy; neither is allowed to see different numbers.
 */

/** How much of the frame a golfer must occupy before a box around them is worth believing. */
const MIN_SUBJECT_SPAN = 0.05;

/**
 * Room left around the golfer, as a fraction of the box.
 *
 * The keypoints stop at the joints — there is no keypoint for the top of the head, the club, or
 * the ball — so a box drawn tight to them crops the head off and cuts the club at the hands. This
 * is generous on purpose; the cost of too much padding is a slightly smaller golfer, and the cost
 * of too little is a decapitated one.
 */
const SUBJECT_PAD = 0.18;

/**
 * A percentile rather than the extremes.
 *
 * One flyaway wrist — a promoted keypoint that landed on a wall, a hand tracked onto the golfer's
 * shadow — is enough to stretch a min/max box across the whole frame, and the frame is exactly
 * what this exists to avoid showing. Taking the 2nd and 98th percentile of the observed
 * coordinates discards a handful of outliers and still contains the golfer, because a real body
 * contributes hundreds of points per frame and a flyaway contributes one.
 */
const OUTLIER_TRIM = 0.02;

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * A box around the golfer across the swing, or null when the pose was never confident enough.
 *
 * Restricted to the playback window, which is the analyzer's own answer to "where is the swing" —
 * a golfer who walks into shot at the start of the clip would otherwise widen the box across
 * everywhere they stood, and the whole point is to fill a narrow column with the swing.
 *
 * Confidence-gated at the contract's floor, inclusively and without rounding, like every other
 * consumer: a keypoint below it was not measured, and sizing the picture from one would let a
 * joint the analyzer refused to score decide how big the golfer appears.
 */
export function subjectBox(a: Analysis): SyncSubject | null {
  const frames = a.pose?.frames;
  if (!frames?.length) return null;

  // Inclusive [from, to]. Absent on an artifact written before schema 5, which is not a reason to
  // refuse — the whole clip is a worse window, not an unusable one.
  const window = a.playback_window;
  const first = window ? window[0] : -Infinity;
  const last = window ? window[1] : Infinity;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const frame of frames) {
    if (frame.f < first || frame.f > last) continue;
    for (const kp of frame.kp) {
      // `[0, 0, 0]` is the contract's "this joint was not seen", and it sits in the corner of the
      // frame — including it would anchor every box to the top-left.
      if (!kp || kp[2] < MIN_CONF) continue;
      xs.push(kp[0]);
      ys.push(kp[1]);
    }
  }
  if (xs.length < 50) return null;

  xs.sort((m, n) => m - n);
  ys.sort((m, n) => m - n);
  const x0 = percentile(xs, OUTLIER_TRIM);
  const x1 = percentile(xs, 1 - OUTLIER_TRIM);
  const y0 = percentile(ys, OUTLIER_TRIM);
  const y1 = percentile(ys, 1 - OUTLIER_TRIM);

  const w = x1 - x0;
  const h = y1 - y0;
  // A degenerate box means the pose collapsed to a point — a detection failure, not a small
  // golfer. Cropping to it would zoom a column onto a few pixels of noise.
  if (w < MIN_SUBJECT_SPAN || h < MIN_SUBJECT_SPAN) return null;

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x0: clamp(x0 - w * SUBJECT_PAD),
    y0: clamp(y0 - h * SUBJECT_PAD),
    x1: clamp(x1 + w * SUBJECT_PAD),
    y1: clamp(y1 + h * SUBJECT_PAD),
  };
}

export function syncProfileOf(
  swingId: string,
  view: string,
  a: Analysis,
): SyncProfile {
  const checkpoints = (a.checkpoints ?? [])
    .filter((c) => typeof c?.frame === "number" && Number.isFinite(c.frame))
    .map((c) => ({ p: c.p, frame: Math.round(c.frame), conf: c.conf }));

  // `agrees === false` is the only value that is evidence. Agreement, a silent clip and an
  // artifact written before schema 10 are three different situations that all mean "nothing here
  // contradicts the video", and collapsing them into one boolean is what keeps the client from
  // having to know which is which.
  const audioDisagrees = a.audio_impact?.agrees === false;

  return {
    swingId,
    view,
    fps: a.video.fps,
    frameCount: a.video.frame_count,
    width: a.video.width,
    height: a.video.height,
    handedness: a.video.handedness,
    checkpoints,
    audioDisagrees,
    subject: subjectBox(a),
  };
}
