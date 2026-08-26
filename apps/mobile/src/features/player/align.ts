import { MIN_CONF } from "@swingsage/schema/contract";

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
 * ## Not every published checkpoint is a measurement
 *
 * This is the part the first version got wrong, and it is the whole difference between a
 * comparison that lines up and one that only looks like it does. `checkpoints.py` publishes ten
 * rows on every swing **whether or not it found ten positions**, and says which is which in `conf`
 * and `basis`:
 *
 *  - `proxy: midpoint of P5 -> impact` (conf 0.30) is P6 admitting it split the difference between
 *    its neighbours. Anchoring on it is circular — it carries no information the neighbours do not
 *    already carry, and it *pins* the map to a frame nobody measured.
 *  - `no span between P8 and the finish` (conf 0.30) is the same admission for P9.
 *  - The **ordering nudge** is the dangerous one: when a position lands at or before its
 *    predecessor, `build()` shoves it one frame later and clamps its confidence to 0.35. Ten rows
 *    come out strictly increasing, and the first `anchorsOf` — which checked only that they
 *    increased — took all ten. On `7wood-1` that is P4 through P10 stacked into eight consecutive
 *    frames, so the entire downswing mapped onto a single instant while the map reported ten
 *    healthy anchors.
 *
 * So an anchor must clear the project's own confidence floor, and a low-confidence row wedged
 * within a frame of a neighbour is read as what it is — the nudge's fingerprint, not a position.
 *
 * ## The audio witness can veto Impact, and may never move it
 *
 * `audio_impact.agrees === false` means the strike was HEARD somewhere the video-side Impact is
 * not, and on `7wood-1` that gap is about forty frames. The heard frame is **not** substituted:
 * the contract puts 121–148 ms of unmeasured recording latency on it — nine frames at 60fps — and
 * says never to snap a rendered event to it. A disputed anchor is dropped, not relocated, and if
 * that leaves the swing with nothing at impact then the two swings cannot be lined up. Refusing is
 * the correct answer for a swing whose impact frame is contested; inventing one is not.
 *
 * ## What it refuses to do
 *
 * **It never extrapolates outside the detected swing.** Before address and after finish there is
 * no corresponding position in the other clip — only footage — so the mapping clamps to the ends
 * rather than inventing an alignment out there.
 *
 * **It only uses positions BOTH artifacts admitted**, and it insists one of them is at or after
 * impact. A pair sharing only P1–P4 can be drawn, and everything from the top onwards would be a
 * guess presented at the same confidence as the rest.
 *
 * A refusal must reach the user as *"these two cannot be aligned"*, with the reason, never as a
 * silently unaligned pair — which looks exactly like a working one.
 */

/** A position the analyzer detected, the frame it detected it at, and how much it stands by it. */
export interface Anchor {
  p: string;
  frame: number;
  /** As published. Absent on a hand-built table, which is then taken at face value. */
  conf: number;
}

/**
 * Whatever the caller happens to be holding: the whole `analysis.json`, or the two-kilobyte
 * `SyncProfile` the server projects out of it.
 *
 * Structural rather than a union of the two named types, and that is the point — the leader's
 * artifact is already downloaded for the overlay, while the swing it is compared against must
 * never cost 22 MB to line up. Both describe the same published table, so both must produce the
 * same anchors; a signature naming only what is read is what makes that hard to get wrong.
 */
export interface AnchorSource {
  checkpoints?: readonly { p: string; frame: number; conf?: number }[] | null;
  /** `analysis.json`'s shape. */
  audio_impact?: { agrees: boolean } | null;
  /** `SyncProfile`'s shape — the same fact, already reduced to the only value that is evidence. */
  audioDisagrees?: boolean;
}

/**
 * Below this a checkpoint is not a position, it is a placeholder.
 *
 * The same floor `MIN_CONF` applies to every other consumer of the artifact — a keypoint below it
 * is not measured from — and the reason it belongs here too is that `checkpoints.py`'s two
 * admitted fabrications (`proxy: midpoint…`, `no span…`) both publish at 0.30, immediately below
 * it. Applying the contract's own gate is what excludes them; no bespoke threshold is needed.
 */
const ANCHOR_FLOOR = MIN_CONF;

/**
 * The confidence the ordering nudge clamps to, and the gap that gives it away.
 *
 * `build()` caps a nudged row at exactly 0.35 and places it one frame after its predecessor. Both
 * halves are required to reject: a fast swing legitimately puts Impact one frame before
 * mid-follow-through (`7wood-2`, conf 0.98) and a tour finish one frame after P9 (`pro_3`, conf
 * 0.90), and dropping those on the gap alone would throw away the best anchors in the table.
 */
const NUDGE_CONF = 0.35;
const NUDGE_GAP = 1;

/**
 * Not a gate here, and the reason is worth writing down: `tempoIsFlagged` looks like the obvious
 * second opinion on a broken event table and it is the wrong one. It fires on `pro_3` (9.2 s
 * backswing) and `perfect` (3.3 s) because those are SLOW-MOTION clips — which is to say it fires
 * hardest on precisely the reference swings this feature exists to compare against — and on
 * `swing2`, a deliberate rehearsal swing whose impact frame is independently confirmed. Measured
 * across all nineteen stored artifacts, an implausible tempo does not separate a broken detection
 * from an unusual swing. The admission rules above catch `7wood-1` on the evidence that actually
 * distinguishes it: rows the analyzer itself declined to stand behind.
 */

/** Position ordinal, or null when it is not a P-code at all. */
function ordinalOf(p: unknown): number | null {
  if (typeof p !== "string") return null;
  const m = /^P(\d+)$/.exec(p);
  return m ? Number(m[1]) : null;
}

/**
 * The P-codes an artifact can be aligned on: strictly increasing in frame, admitted, two or more.
 *
 * Strictly increasing is a real gate, not defensive noise — the interpolation divides by a
 * segment's span, and a zero or negative span would produce a division by zero or a mapping that
 * runs backwards through the swing. It is tested on the RAW table, before anything is dropped: a
 * table whose top precedes its address is a broken detection, and quietly discarding the offending
 * row would repair the symptom and keep the swing. Returns null when there is nothing usable.
 */
export function anchorsOf(source: AnchorSource | null | undefined): Anchor[] | null {
  const raw = source?.checkpoints;
  if (!raw) return null;

  const rows: { p: string; frame: number; conf: number; ordinal: number }[] = [];
  for (const c of raw) {
    if (typeof c?.frame !== "number" || !Number.isFinite(c.frame)) continue;
    const ordinal = ordinalOf(c?.p);
    if (ordinal === null) continue;
    // A missing confidence is a hand-built table (a test, a fixture pared down by hand) rather than
    // a low-confidence detection, and is taken at face value instead of being scored as zero.
    const conf = typeof c.conf === "number" && Number.isFinite(c.conf) ? c.conf : 1;
    rows.push({ p: c.p, frame: c.frame, conf, ordinal });
  }

  // Sorted by POSITION, never by frame. Sorting by frame would make the check below vacuous — it
  // would order any table into compliance and quietly accept a swing whose top was detected before
  // its address. Ordered by position, a non-increasing frame is exactly that broken detection, and
  // aligning on it would run the follower backwards through its own swing.
  rows.sort((a, b) => a.ordinal - b.ordinal);

  for (let i = 1; i < rows.length; i++) {
    // Equal frames are as unusable as inverted ones: a zero-span segment has no defined fraction.
    if (rows[i].frame <= rows[i - 1].frame) return null;
  }

  // Impact is dropped, never moved, when the two witnesses disagree — see the header. Either
  // shape answers the same question; absence is not disagreement in either.
  const impactDisputed =
    source?.audioDisagrees === true || source?.audio_impact?.agrees === false;

  const admitted: Anchor[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.conf < ANCHOR_FLOOR) continue;
    if (impactDisputed && row.p === "P7") continue;

    // Gap to the nearer neighbour IN THE PUBLISHED TABLE — not in the admitted set, which is still
    // being built and would measure the distance to whatever happened to survive.
    const gaps: number[] = [];
    if (i > 0) gaps.push(row.frame - rows[i - 1].frame);
    if (i + 1 < rows.length) gaps.push(rows[i + 1].frame - row.frame);
    const nearest = gaps.length ? Math.min(...gaps) : Number.POSITIVE_INFINITY;
    if (row.conf <= NUDGE_CONF && nearest <= NUDGE_GAP) continue;

    admitted.push({ p: row.p, frame: row.frame, conf: row.conf });
  }

  return admitted.length >= 2 ? admitted : null;
}

/** The positions both swings admitted, as aligned pairs — the only thing that can anchor a map. */
function sharedPairs(from: Anchor[], to: Anchor[]): { p: string; from: number; to: number }[] {
  const toByP = new Map(to.map((a) => [a.p, a.frame]));
  const pairs: { p: string; from: number; to: number }[] = [];
  for (const a of from) {
    const t = toByP.get(a.p);
    if (t !== undefined) pairs.push({ p: a.p, from: a.frame, to: t });
  }
  return pairs;
}

/** How much of the swing the shared anchors actually pin down. */
export type AlignQuality = "aligned" | "approximate";

/**
 * Why a pair could not be lined up — each one a sentence the UI owes the golfer.
 *
 * `impact-uncovered` is the one that matters most: it is what a swing with a contested or nudged
 * Impact degrades into, and it is the difference between refusing `7wood-1` and drawing its whole
 * downswing on top of a single frame.
 */
export type AlignFailure = "no-anchors" | "too-few-shared" | "impact-uncovered";

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
  /** Which ones, in order — what the UI names when it explains the alignment. */
  positions: string[];
  quality: AlignQuality;
}

export type AlignResult =
  | { ok: true; map: Alignment }
  | { ok: false; reason: AlignFailure };

/**
 * Five shared positions, reaching back to the takeaway, is a swing genuinely pinned down end to
 * end. Fewer than that still maps — it is simply coarser between the anchors, and the UI says so
 * rather than claiming a precision it does not have.
 */
const WELL_ANCHORED = 5;

/** Build the map from one swing's frames onto another's, or say why it cannot be built. */
export function alignmentResult(from: Anchor[] | null, to: Anchor[] | null): AlignResult {
  if (!from || !to) return { ok: false, reason: "no-anchors" };
  const pairs = sharedPairs(from, to);
  if (pairs.length < 2) return { ok: false, reason: "too-few-shared" };

  // Everything after the top is what a golfer actually studies, and without an anchor at or past
  // impact all of it is extrapolation wearing the same confidence as the rest of the map.
  const covered = pairs.some((p) => (ordinalOf(p.p) ?? 0) >= 7);
  if (!covered) return { ok: false, reason: "impact-uncovered" };

  const first = pairs[0].from;
  const last = pairs[pairs.length - 1].from;
  const reachesTakeaway = (ordinalOf(pairs[0].p) ?? 99) <= 2;

  return {
    ok: true,
    map: {
      first,
      last,
      anchors: pairs.length,
      positions: pairs.map((p) => p.p),
      quality: pairs.length >= WELL_ANCHORED && reachesTakeaway ? "aligned" : "approximate",
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
    },
  };
}

/** The map alone, for callers with nothing to say about a refusal. */
export function alignment(from: Anchor[] | null, to: Anchor[] | null): Alignment | null {
  const r = alignmentResult(from, to);
  return r.ok ? r.map : null;
}

/** The whole thing, from two artifacts. Convenience for callers that hold artifacts, not tables. */
export function alignmentBetween(
  from: AnchorSource | null | undefined,
  to: AnchorSource | null | undefined,
): AlignResult {
  return alignmentResult(anchorsOf(from), anchorsOf(to));
}
