import type { Analysis } from "@swingsage/schema/contract";

/**
 * Putting two swings at the same place in the golf swing at once.
 *
 * ## Frames and seconds are both wrong answers
 *
 * Frame 143 of one swing has no relationship to frame 143 of another: two clips filmed on two days
 * are different lengths, start at different moments and need not share a frame rate. Seconds are no
 * better — a fast tour swing and a slow amateur one reach the top at different times by design, and
 * that difference is the very thing a golfer is comparing, not an offset to cancel out.
 *
 * The only vocabulary the two clips genuinely share is **the swing itself**. Both artifacts carry
 * `checkpoints` — the ten coaching positions P1…P10, each with the frame the analyzer detected it
 * at. Address is address in both. So the mapping is: find which segment the leader's frame falls
 * in (say P4→P5), take the fraction across it, and land at that same fraction of the follower's
 * own P4→P5. Differing lengths and differing frame rates both fall out for free, because nothing
 * here ever touches absolute time.
 *
 * `swing1` runs P1@150 → P10@243 and `pro_3` runs P1@210 → P10@1477 — five times longer. Any
 * frame-offset or time-scaling scheme puts one of them in the wrong half of the swing; this one
 * has them at the top together by construction.
 *
 * ## What it refuses to do
 *
 * **It never extrapolates outside the detected swing.** Before address and after finish there is
 * no corresponding position in the other clip — only footage — so the mapping clamps to the ends
 * rather than inventing an alignment out there.
 *
 * **It only uses positions BOTH artifacts detected.** An anchor one side is missing cannot align
 * anything, so the shared subset is what gets used, and fewer than two shared anchors means there
 * is no segment to interpolate within and the honest answer is `null`.
 *
 * A `null` from here must reach the user as *"these two cannot be aligned"* — never as a silently
 * unaligned pair, which looks exactly like a working one.
 */

/** A position the analyzer detected, and the frame it detected it at. */
export interface Anchor {
  p: string;
  frame: number;
}

/**
 * The P-codes an artifact can be aligned on: strictly increasing in frame, at least two of them.
 *
 * Strictly increasing is a real gate, not defensive noise — the interpolation divides by a
 * segment's span, and a zero or negative span would produce a division by zero or a mapping that
 * runs backwards through the swing. Returns null when there is nothing usable.
 */
export function anchorsOf(analysis: Analysis | null | undefined): Anchor[] | null {
  const raw = analysis?.checkpoints;
  if (!raw) return null;

  const anchors: { p: string; frame: number; ordinal: number }[] = [];
  for (const c of raw) {
    if (typeof c?.frame !== "number" || !Number.isFinite(c.frame) || typeof c?.p !== "string") {
      continue;
    }
    // The P-codes carry their own order, and it is the ordering that matters here — P4 is the top
    // whatever frame it landed on.
    const m = /^P(\d+)$/.exec(c.p);
    if (!m) continue;
    anchors.push({ p: c.p, frame: c.frame, ordinal: Number(m[1]) });
  }

  // Sorted by POSITION, never by frame. Sorting by frame would make the check below vacuous — it
  // would order any table into compliance and quietly accept a swing whose top was detected before
  // its address. Ordered by position, a non-increasing frame is exactly that broken detection, and
  // aligning on it would run the follower backwards through its own swing.
  anchors.sort((a, b) => a.ordinal - b.ordinal);

  for (let i = 1; i < anchors.length; i++) {
    // Equal frames are as unusable as inverted ones: a zero-span segment has no defined fraction.
    if (anchors[i].frame <= anchors[i - 1].frame) return null;
  }

  return anchors.length >= 2 ? anchors.map(({ p, frame }) => ({ p, frame })) : null;
}

/** The positions both swings detected, as aligned pairs — the only thing that can anchor a map. */
function sharedPairs(from: Anchor[], to: Anchor[]): { from: number; to: number }[] {
  const toByP = new Map(to.map((a) => [a.p, a.frame]));
  const pairs: { from: number; to: number }[] = [];
  for (const a of from) {
    const t = toByP.get(a.p);
    if (t !== undefined) pairs.push({ from: a.frame, to: t });
  }
  return pairs;
}

/**
 * A reusable map between two swings. Build it once per artifact pair — it is a pure function of
 * the two anchor tables — and call `at()` on the per-frame path.
 */
export interface Alignment {
  at: (frame: number) => number;
  /** The leader's span this map is defined over; outside it, `at` clamps. */
  first: number;
  last: number;
  /** How many positions the two swings actually share. */
  anchors: number;
}

/**
 * Build the map from one swing's frames onto another's, or null when they cannot be aligned.
 *
 * Null means: one side has no usable anchor table, or they share fewer than two positions. Both
 * are real states — an unanalysed reference is the common one — and both must be *stated* to the
 * user rather than papered over.
 */
export function alignment(
  from: Anchor[] | null,
  to: Anchor[] | null,
): Alignment | null {
  if (!from || !to) return null;
  const pairs = sharedPairs(from, to);
  if (pairs.length < 2) return null;

  const first = pairs[0].from;
  const last = pairs[pairs.length - 1].from;

  return {
    first,
    last,
    anchors: pairs.length,
    at: (frame: number) => {
      // Outside the detected swing there is no corresponding position — only footage. Clamp.
      if (frame <= first) return pairs[0].to;
      if (frame >= last) return pairs[pairs.length - 1].to;

      for (let i = 1; i < pairs.length; i++) {
        const hi = pairs[i];
        if (frame > hi.from) continue;
        const lo = pairs[i - 1];
        const span = hi.from - lo.from;
        // Guaranteed positive: `anchorsOf` rejected any table that was not strictly increasing,
        // and the shared subset preserves that order on the `from` side.
        const t = (frame - lo.from) / span;
        return Math.round(lo.to + t * (hi.to - lo.to));
      }
      return pairs[pairs.length - 1].to;
    },
  };
}

/** The whole thing, from two artifacts. Convenience for callers that hold artifacts, not tables. */
export function alignmentBetween(
  from: Analysis | null | undefined,
  to: Analysis | null | undefined,
): Alignment | null {
  return alignment(anchorsOf(from), anchorsOf(to));
}
