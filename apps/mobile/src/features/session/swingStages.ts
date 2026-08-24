import { TRACE_COLOR } from "../player/overlay/skeleton";

/**
 * The shape of a golf swing, hung off the one instant the phone can actually hear.
 *
 * **What this is for.** The review scrubber asks the golfer for a single moment — where the ball
 * was struck — and until now the only thing on the track that said anything about *where the
 * swing is* was twelve small pictures. The audio detector knows the strike (`swish`, measured
 * 5/5 against hand-labelled frames), and a strike is enough to draw the rest: a swing is a
 * strongly stereotyped movement whose parts sit at known distances either side of contact.
 *
 * **These are a TEMPLATE, not a measurement, and the difference is load-bearing.** The analyzer
 * finds Address, Top and Impact from the club head and the hands, per clip, and those are the
 * numbers a report is built on. Nothing here is measured from this golfer's swing — the bands
 * are nominal durations from tour-tempo norms, and a golfer with a slow takeaway will see them
 * sit wrong. That is acceptable *here* and nowhere else, because on this screen they are an
 * alignment aid the golfer is actively dragging: the coloured shape is slid over the filmstrip
 * until it covers the swing in the pictures. Being approximately right is the entire job, and
 * the golfer can see for themselves when it is not.
 *
 * `phaseBands.ts` is the opposite of this file and must stay that way — it draws the analyzer's
 * real events and returns an EMPTY list rather than guess. Do not merge them, and never build a
 * scoring check, a metric, or a saved window edge on anything in here.
 *
 * **The bands follow the MARK, not the detector.** Anchoring them on the detector's answer would
 * make them a second opinion the golfer has to argue with; anchoring them on the live mark makes
 * them a shape that moves under the finger, which is the thing being aligned. (The scrub axis's
 * magnification is anchored the other way — on the detector — precisely so the ground does not
 * move while the shape does.)
 */

export type SwingStageKey = "backswing" | "downswing" | "through";

export interface SwingStage {
  key: SwingStageKey;
  /** Seconds relative to the mark. Negative is before contact. */
  fromSec: number;
  toSec: number;
  color: string;
}

/**
 * Nominal durations, in REAL seconds, of the parts of a swing either side of contact.
 *
 * Tour tempo is about 3:1 backswing to downswing and a full swing runs a little over a second
 * from takeaway to contact; the follow-through to a settled finish is a shade under half a
 * second. An amateur is slower than this in the takeaway and almost never faster in the
 * downswing, so the template errs by being slightly tight rather than by claiming a golfer moved
 * quicker than they did.
 *
 * Capture-spec §11.7 material — these are exactly the class of value that must stay configurable
 * rather than being baked into a component.
 */
export const BACKSWING_SEC = 0.8;
export const DOWNSWING_SEC = 0.25;
export const THROUGH_SEC = 0.45;

/**
 * How the bands are painted.
 *
 * Backswing and downswing carry the same two colours their trace is drawn in over the picture on
 * the report, so the shape on this track and the line over the golfer later are visibly the same
 * system. Follow-through's trace colour is deliberately transparent (it is hidden on the
 * overlay), so the strip gives it its own quiet grey — the same substitution `phaseBands` makes.
 */
const THROUGH_COLOR = "rgba(255,255,255,0.30)";

/**
 * The swing around a mark, in FILE seconds, clipped to the clip.
 *
 * `slowMoFactor` is not optional decoration: a phone slow-motion clip's timeline runs eight times
 * slower than the world, so a template written in real seconds and applied unscaled would cover
 * an eighth of the swing and sit almost entirely inside the downswing. Every duration on this
 * screen is expressed in real seconds and multiplied through — measured on a real clip, an
 * unscaled five-second window was 0.6 seconds of actual swing.
 */
export function swingStages(
  markSec: number,
  durationSec: number,
  slowMoFactor = 1,
): SwingStage[] {
  const scale = Math.max(1, slowMoFactor);
  const top = markSec - DOWNSWING_SEC * scale;
  const address = top - BACKSWING_SEC * scale;
  const finish = markSec + THROUGH_SEC * scale;

  const clip = (t: number) => Math.min(Math.max(t, 0), Math.max(durationSec, 0));

  const all: SwingStage[] = [
    { key: "backswing", fromSec: clip(address), toSec: clip(top), color: TRACE_COLOR.backswing },
    { key: "downswing", fromSec: clip(top), toSec: clip(markSec), color: TRACE_COLOR.downswing },
    { key: "through", fromSec: clip(markSec), toSec: clip(finish), color: THROUGH_COLOR },
  ];

  // A band pushed entirely off either end of the clip is not drawable, and a zero-width one would
  // still take its share of the row. A mark dragged to the very start legitimately loses its
  // backswing — that is the clip being short, not a fault.
  return all.filter((b) => b.toSec > b.fromSec);
}
