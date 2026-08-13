import type { Analysis } from "@swingsage/schema/contract";

/**
 * Where in the video a scorecard row is talking about.
 *
 * This is the seam that turns the Analysis panel from a paragraph into an analysis: a finding that
 * says "lag at mid-downswing" and cannot take you to mid-downswing is a claim a golfer has to take
 * on trust. `CLAUDE.md`'s constraint is that analysis must be explainable — what was detected, why
 * it matters, how important it is, what to work on first — and on a video player the honest end of
 * that sentence is *"…and here is the frame where you can see it."*
 *
 * ## The key is a P-code, and this was very nearly built wrong
 *
 * `CheckResult.checkpoint` and `Priority.checkpoint` carry a **coaching position** — `"P1"`,
 * `"P4"`, `"P10"` — and NOT one of the eight GolfDB event names in `EVENT_ORDER`. The two look
 * interchangeable from the type (both are `string | null`) and are not: routing through
 * `analysis.events` resolves eight of the ten and silently drops **P6 and P9**, which are exactly
 * the two positions the events do not cover. `analysis.checkpoints` carries all ten with a frame
 * each — verified across the fixtures — so it is the only correct source.
 *
 * ## Null is a first-class answer
 *
 * Every failure mode returns null and the caller offers **no tap at all**: a control that is
 * visibly present and does nothing is worse than an absent one, and guessing a nearby frame would
 * put a golfer on a frame the scorecard never meant. Abstaining rather than approximating is the
 * same rule the overlay follows when it refuses to interpolate across a gap.
 */

export interface CheckpointTarget {
  /** The coaching position, e.g. `"P4"`. */
  p: string;
  /** How a golfer says it, e.g. `"Top"` — from the artifact, never invented here. */
  label: string;
  frame: number;
}

/**
 * Resolve a scorecard checkpoint to a frame, or null when there is no honest answer.
 *
 * @param analysis   the artifact, or null when the swing has none
 * @param checkpoint a P-code from the report, or null when the row is not anchored to a position
 */
export function checkpointTarget(
  analysis: Analysis | null | undefined,
  checkpoint: string | null | undefined,
): CheckpointTarget | null {
  if (!analysis || !checkpoint) return null;

  // Optional-chained because a native client cannot be force-updated: an artifact older than this
  // build is permanent reality here, and one without `checkpoints` must degrade to "no tap".
  const found = analysis.checkpoints?.find((c) => c.p === checkpoint);
  if (!found || typeof found.frame !== "number" || !Number.isFinite(found.frame)) return null;

  return { p: found.p, label: found.label, frame: found.frame };
}

/**
 * The screen-reader sentence for a control that seeks. Names the destination rather than the
 * action, because "button" is already announced by the role.
 */
export function checkpointA11yLabel(target: CheckpointTarget): string {
  return `${target.label}, frame ${target.frame}`;
}
