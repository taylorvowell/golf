import { CANDIDATE_FLOOR, PRE_ROLL_SEC, REVIEW_WINDOW_S } from "./captureConstants";

/**
 * The window a review cuts around a strike, and how the strike itself is seeded — shared by the
 * mark-impact screen (`SwingReview`) and the import confirm pass (`ImportConfirm` via
 * `useImportSwing`). One implementation on purpose: the confirm screen plays the exact clip
 * "Save swing" would cut, and a preview computed by a second copy of this math would drift into
 * showing a different swing than the one that gets saved.
 */

/**
 * Where the mark starts when detection hears nothing.
 *
 * Was `PRE_ROLL_SEC` — 2.5s from the end — which now contradicts the detector's own prior that
 * the last five seconds are the walk back to the phone (Taylor, 2026-08-21). Landing the
 * fallback inside the region every method de-weights would put the silent case exactly where the
 * loud case is told not to look.
 */
export const FALLBACK_FROM_END_SEC = 6;

/** A detector candidate, as the native module reports it. */
export interface ImpactCandidate {
  timeSec: number;
  score: number;
}

/**
 * The strongest candidate wins, unless a later one is nearly as strong.
 *
 * A golfer may hit two balls in one take, and then the second is the one being marked. The old
 * rule — always take the later of two plausible transients, to duck a practice swing — was
 * compensating for a detector that could not tell a practice swing from a strike; `swish` can,
 * because a practice swing is a whoosh with no click on the end of it.
 *
 * Nothing heard → near the end, which is where a swing sits when the golfer walked back to stop
 * the recording. Never an error, never an empty state.
 */
export function pickImpactSeed(
  found: readonly ImpactCandidate[],
  durationS: number,
): number {
  const best = found.length ? Math.max(...found.map((c) => c.score)) : 0;
  const real = [...found]
    .filter((c) => c.score >= best * CANDIDATE_FLOOR)
    .sort((a, b) => a.timeSec - b.timeSec)
    .at(-1);
  return real ? real.timeSec : Math.max(0, durationS - FALLBACK_FROM_END_SEC);
}

/**
 * The window Save cuts around a mark, in FILE seconds.
 *
 * `slowMo` is how many file seconds make one real second — 8 for a phone slow-motion clip, 1 for
 * anything this app records. Every duration here is expressed in real seconds and multiplied
 * through; measured on a real clip, an unscaled 5-second window was 0.6 seconds of actual swing,
 * which is why the backswing was missing (Taylor, 2026-08-22).
 */
export function reviewWindowAround(
  at: number,
  durationS: number,
  slowMo: number,
): { startSec: number; endSec: number } {
  const pre = PRE_ROLL_SEC * slowMo;
  const span = REVIEW_WINDOW_S * slowMo;
  return {
    startSec: Math.max(0, at - pre),
    endSec: Math.min(durationS, at - pre + span),
  };
}
