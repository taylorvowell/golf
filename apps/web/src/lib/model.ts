import { MIN_CONF } from "@swingsage/schema/contract";
import type { Analysis, Club } from "@swingsage/schema/contract";

import { defaultClubVar } from "./clubVariants";
import { buildTracePath, type SmoothingKey, type TracePiece } from "./traceSmoothing";

/**
 * Everything the overlay needs that is a **pure function of the artifact**, computed once per
 * swing rather than once per frame.
 *
 * These began as `SwingStage.tsx`'s memos and are plain functions for a reason that outlives the
 * extraction: each is a whole-clip pass, and a hook invites recomputing it from the playhead.
 * `orientationHold` in particular is a **one-pass forward walk over the entire clip with
 * hysteresis**, so scrubbing backwards, jumping to a checkpoint and playing through all give the
 * same bar on the same frame. A running filter fed by the playhead would not, and the difference
 * is invisible until someone scrubs.
 *
 * This file is one of the byte-locked web/mobile pairs (`verbatimCopies.test.ts` on the mobile
 * side) — it is the highest-value math in either player, where the trace changes colour and when
 * a rod holds, and it is exactly the block that once diverged silently between the two clients.
 * The unified behaviour is the mobile port's: the phase-ordering clamps, the `pts[i]` guard and
 * the per-field phase overrides are defensive supersets whose output is identical on every
 * well-formed artifact, and `scripts/checkoverlay.ts` proves this code against the analyzer's
 * Gate 1 burn-in on all ten fixtures.
 */

/** The five marks a person can point at in the picture. Mirrors the server's `STAGES`. */
export type PhaseOverrides = Partial<
  Record<
    "approach_start" | "backswing_start" | "downswing_start" | "impact" | "finish_start",
    number
  >
>;

/** Placed club-head positions, normalized, keyed by the frame they were placed on. */
export type HeadMarks = Map<number, [number, number]>;

/** Index by NAME, from the artifact's own `keypoint_names`. No literal index anywhere. */
export type KeypointIndex = Record<string, number>;

/**
 * A NAMED club solution — `primary` is the artifact's own conservative solve, anything else is a
 * stored variant. Switching is a RENDER change only: metrics, face and event refinement all read
 * the primary block regardless. The desktop's Debug Menu drives the key directly; everything
 * else goes through `selectedClub` below.
 */
export function clubSolution(a: Analysis, key: string): Club | null {
  const c = a.club;
  if (!c) return null;
  const v = key !== "primary" ? c.variants?.[key] : undefined;
  return v
    ? { ...c, frames: v.frames, trace: v.trace, trace_frames: v.trace_frames, coverage: v.coverage }
    : c;
}

/**
 * The club solution to draw — the stored variant the artifact's own numbers select, not `primary`.
 *
 * `primary` is the deliberately conservative classical solve, and the player has defaulted away
 * from it since 2026-08-08 because comparing solutions on real pixels is the only way to judge them
 * until a position-error metric exists.
 *
 * This was missed on the first pass of the mobile port, and `scripts/checkoverlay.ts` is what
 * found it — the mobile trace was a visibly different line from the web player's over the same
 * swing. That is the entire argument for building the debug view when the work starts.
 */
export function selectedClub(a: Analysis): Club | null {
  return clubSolution(a, defaultClubVar(a));
}

/** The three traced spans, from the analyzer's own event frames. */
export interface TraceSpans {
  backswing: [number, number];
  downswing: [number, number];
  followthrough: [number, number];
}

export const TRACE_KEYS = ["backswing", "downswing", "followthrough"] as const;
export type TraceKey = (typeof TRACE_KEYS)[number];

/**
 * Where the trace changes colour — the analyzer's events, **re-cut at any hand-corrected boundary**.
 *
 * Correcting a boundary has to move the colour change with it, or pinning "start of downswing" does
 * nothing visible and the control reads as broken. The analyzer's `events` are the base; a stored
 * override replaces one mark and nothing else.
 *
 * Later marks yield to earlier ones on the forward walk: a pin propagates only downstream, so
 * correcting one boundary never silently drags the ones before it.
 */
export function traceSpans(a: Analysis, phases?: PhaseOverrides): TraceSpans | null {
  const e = a.events;
  if (!e?.address || !e.top || !e.impact || !e.finish) return null;

  const back = phases?.backswing_start ?? e.address.frame;
  let down = phases?.downswing_start ?? e.top.frame;
  let imp = phases?.impact ?? e.impact.frame;
  let fin = phases?.finish_start ?? e.finish.frame;

  down = Math.max(down, back);
  imp = Math.max(imp, down);
  fin = Math.max(fin, imp);

  return {
    backswing: [back, down],
    downswing: [down, imp],
    followthrough: [imp, fin],
  };
}

/**
 * The finished, smoothed trace — built once per swing and then revealed frame by frame.
 *
 * Smoothing the *visible* prefix is what made the line settle as it drew: the filter's window grew
 * as frames arrived, so the first frames of a segment came out barely smoothed and the curve
 * already on screen kept changing shape underneath. Building the whole path first means what you
 * see while scrubbing IS the final path, stable from its first frame.
 *
 * Built in **video-pixel space, not stage pixels**, so it survives a rotation or a resize and is
 * recomputed only when the artifact or the method changes. That property is also what made
 * `traceSmoothing.ts` portable at all.
 */
export function buildTrace(
  a: Analysis,
  spans: TraceSpans | null,
  method: SmoothingKey,
  marks?: HeadMarks,
): Record<TraceKey, TracePiece[]> {
  return buildTraceFor(selectedClub(a), a, spans, method, marks);
}

/**
 * The same build against a NAMED solution.
 *
 * Split out for the desktop stage and `scripts/checkoverlay.ts`, which both have to be able to
 * draw a solution the default did not pick — the desktop persists the Debug Menu's choice in
 * localStorage, globally, so "the phone looks different from what we had" is a question that can
 * only be answered by rendering both.
 */
export function buildTraceFor(
  club: Club | null,
  a: Analysis,
  spans: TraceSpans | null,
  method: SmoothingKey,
  /**
   * Hand-placed club heads, merged in by frame.
   *
   * A marker REPLACES the analyzer's point on its own frame and is INSERTED where the analyzer had
   * none — so a correction shows in the line and not only under the cursor, and correcting a frame
   * inside a bridge closes the bridge, which is the whole reason to correct one.
   */
  marks?: HeadMarks,
): Record<TraceKey, TracePiece[]> {
  const out = { backswing: [], downswing: [], followthrough: [] } as Record<TraceKey, TracePiece[]>;
  if (!club?.trace || !spans) return out;
  const vw = a.video.width,
    vh = a.video.height;

  /**
   * Pool every measured point by the frame it was measured on, then re-split by span.
   *
   * The analyzer ships the trace already split at its own event frames, so reading
   * `club.trace.backswing` straight would be fine here — but pooling is what lets a corrected
   * boundary move the colour change later, and it costs one pass. Only possible when every
   * segment carries real frames: an artifact older than `trace_frames` has a synthetic index that
   * says nothing about when a point was measured, and re-cutting on it would invent gaps.
   */
  const recuttable = TRACE_KEYS.every((k) => {
    const n = (club.trace?.[k] ?? []).length;
    return n < 2 || club.trace_frames?.[k]?.length === n;
  });

  if (recuttable) {
    const pooled = new Map<number, [number, number]>();
    for (const k of TRACE_KEYS) {
      const pts = (club.trace[k] ?? []) as [number, number][];
      const tf = club.trace_frames?.[k];
      if (!tf) continue;
      tf.forEach((f, i) => {
        if (pts[i]) pooled.set(f, pts[i]);
      });
    }
    if (marks) for (const [f, pt] of marks) pooled.set(f, pt);
    const ordered = [...pooled.keys()].sort((p, q) => p - q);
    for (const key of TRACE_KEYS) {
      const [lo, hi] = spans[key];
      // Inclusive at both ends so consecutive spans share their boundary point and the line stays
      // joined where it changes colour.
      const fs = ordered.filter((f) => f >= lo && f <= hi);
      if (fs.length < 2) continue;
      const pts = fs.map((f) => {
        const [x, y] = pooled.get(f)!;
        return [x * vw, y * vh] as [number, number];
      });
      out[key] = buildTracePath(pts, fs, method);
    }
    return out;
  }

  for (const key of TRACE_KEYS) {
    const pts = (club.trace[key] ?? []) as [number, number][];
    if (pts.length < 2) continue;
    const [lo, hi] = spans[key];
    const tf = club.trace_frames?.[key];
    const known = tf?.length === pts.length;
    let fs: number[] = known
      ? tf
      : pts.map((_, i) => lo + Math.round((i * (hi - lo)) / Math.max(1, pts.length - 1)));
    let seg: [number, number][] = pts;

    // Only when the segment carries real frames: a synthetic index says nothing about when a point
    // was measured, so merging a correction into it would place it against a made-up frame.
    if (known && marks?.size) {
      const inSeg = [...marks.entries()].filter(([f]) => f >= lo && f <= hi);
      if (inSeg.length) {
        const merged = new Map<number, [number, number]>();
        fs.forEach((f, i) => merged.set(f, pts[i]));
        for (const [f, pt] of inSeg) merged.set(f, pt);
        fs = [...merged.keys()].sort((x, y) => x - y);
        seg = fs.map((f) => merged.get(f)!);
      }
    }
    // A segment with no real frames must not be chopped into bridges by a synthetic index, so hand
    // over a dense synthetic sequence and clear the bridge flag it cannot have earned.
    const framesIn = known ? fs : fs.map((_, i) => lo + i);
    out[key] = buildTracePath(
      seg.map(([x, y]) => [x * vw, y * vh] as [number, number]),
      framesIn,
      method,
    ).map((piece) => ({ ...piece, bridge: known ? piece.bridge : false }));
  }
  return out;
}

/** The two pairs the orientation rods run through. Anatomical names — these are keypoints. */
export const ORIENT_PAIRS: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "right_hip"],
];

/**
 * The span, as a share of body height, at which a bar starts following its pair's angle again,
 * and the one at which it stops. Hysteresis, so a span hovering on a single threshold cannot
 * flicker between held and live - which it did, and each re-entry committed the whole accumulated
 * drift in one jump.
 *
 * **Not a phase gate.** Nothing here knows where the swing is; the test is whether this pair, on
 * this frame, is open enough to the camera to be measured. Hips that turn before the takeaway
 * still show, provided they are turned far enough to see - which is the same bar every other part
 * of this overlay is held to.
 *
 * Down the line the far shoulder and hip sit behind the body and the model is inferring them.
 * That inference slides rather than jitters, and foreshortening multiplies it: across a 43px
 * shoulder span a 3px slip is 4 degrees. The result is an overlay that turns hard while the
 * golfer stands still over the ball. Measured as angle travelled, approach vs the whole backswing:
 *
 * ```
 *            shoulders            hips
 *            raw     held         raw     held
 *   swing1    83  ->   6    |     129  ->   1
 *   pro_2    110  ->   0    |     179  ->   0
 *   swing2   119  ->   0    |      27  ->   0
 * ```
 *
 * - against backswings of 15, 29 and 33 degrees. The setup was moving the bars four to eight
 * times as far as the swing does. Holding below these thresholds leaves the real rotation intact
 * (swing1 15 -> 15, pro_3 32 -> 32).
 *
 * A plain deadband on the angle was tried first and does nothing: the drift is a smooth ramp, so
 * every step clears the threshold and total travel is unchanged (83 -> 84). So was a stillness
 * gate on the near shoulder - it does not separate the cases, since two fixtures move more before
 * address than during the backswing.
 */
export const ORIENT_LIVE_SPAN = 0.09;
export const ORIENT_HOLD_SPAN = 0.06;

/**
 * The projected span, as a share of body height, below which the rod draws dimmed.
 *
 * Frame-to-frame change in a pair's angle, pooled over all ten fixtures and bucketed by
 * projected span ÷ body height:
 *
 * ```
 *   span      n     median   p90     max
 *   <1%       63     13.3°   62.9°   89.9°
 *   1-2%     506      0.8°    6.1°   73.1°
 *   2-3%     765      0.5°    2.5°   59.6°
 *   4-6%    1766      0.1°    1.3°   32.8°
 *   >10%    7265      0.1°    0.3°    5.6°
 * ```
 *
 * Below a couple of percent the two keypoints sit inside each other's noise and the rod's
 * direction is whichever way the jitter fell. Proportional extension already contains the damage
 * — a 9px span draws a 27px stub, so a 60° error moves its ends by a few pixels rather than
 * swinging a foot-long bar across the frame — but the angle is still not to be trusted at that
 * length, and the overlay says so rather than looking equally certain throughout.
 *
 * **Raised 0.03 -> 0.06.** Down the line the FAR shoulder and hip are behind the body, so the
 * model is inferring them — their confidences run well below the near side's on every fixture.
 * An inferred joint does not jump, it slides, so no filter removes it: swing1's shoulder angle
 * ramps 138.6° to -160° smoothly across f125-175 while its span grows 43 to 195px, which draws as
 * a big confident turn the golfer is not making. Foreshortening is what makes the projected angle
 * hypersensitive to that slide — a 3px error across a 43px span is 4° — so the span is the
 * available proxy for "one end of this bar is a guess". At 6% the approach dims on 8 of 10
 * fixtures while the swing itself stays bright (0-19% of address-to-top dimmed, and every
 * fixture's top sits at 19-24%).
 *
 * A confidence gate was measured as the alternative and rejected: 0.55 keeps only 34-53% of the
 * address-to-top frames on half the fixtures, so it would delete the swing to fix the setup.
 */
export const ORIENT_WEAK_SPAN = 0.06;

/**
 * The keypoint confidence below which the rod also draws dimmed.
 *
 * Just above `MIN_CONF`, and deliberately not at the obvious 0.5: RTMW's confidences on these
 * fixtures sit around 0.55, so a 0.5 rule dims 24% of frames and flips state on 1.7% of frame
 * steps — a rod strobing roughly once a second, which reads as a rendering fault rather than as
 * a confidence signal. At 0.4 it dims 1.0% of frames and flips on 0.2% of steps, so a dim rod
 * means something happened. Angular reliability is governed by the projected span above, not by
 * confidence in this range, which is why the span thresholds carry most of the work.
 */
export const ORIENT_WEAK_CONF = 0.4;

export interface OrientTrack {
  /** Direction in radians, in VIDEO pixel space. `NaN` where nothing trustworthy has been seen. */
  dir: Float64Array;
  /** 1 where this frame's own angle was not trustworthy and the last one is being shown. */
  held: Uint8Array;
}

/**
 * The direction each orientation bar is drawn along, per frame — the pair's own angle wherever it
 * is trustworthy, and the last trustworthy one everywhere else.
 *
 * Computed over the whole clip in one forward pass, which is what makes it a pure function of the
 * artifact rather than of how the golfer got to this frame. Angles are in video pixel space; the
 * stage preserves the frame's aspect ratio, so the same angle is correct there without rescaling.
 */
export function orientationHold(a: Analysis, idx: KeypointIndex): OrientTrack[] {
  const n = a.pose.frames.length;
  // The 0.4 fallback mirrors the analyzer's own in `metrics._body_height`.
  const bodyN = (a.metrics?.body_height_norm || 0.4) * a.video.height;
  const vw = a.video.width,
    vh = a.video.height;

  return ORIENT_PAIRS.map(([ln, rn]) => {
    const dir = new Float64Array(n);
    const held = new Uint8Array(n);
    let live = false,
      last = NaN;
    for (let f = 0; f < n; f++) {
      const kp = a.pose.frames[f]?.kp;
      const p = kp?.[idx[ln]],
        q = kp?.[idx[rn]];
      let ang = NaN,
        span = 0;
      if (p && q && p[2] >= MIN_CONF && q[2] >= MIN_CONF) {
        const dx = (q[0] - p[0]) * vw,
          dy = (q[1] - p[1]) * vh;
        span = Math.hypot(dx, dy) / bodyN;
        ang = Math.atan2(dy, dx);
      }
      live = live ? span >= ORIENT_HOLD_SPAN : span >= ORIENT_LIVE_SPAN;
      if (live && !Number.isNaN(ang)) last = ang;
      dir[f] = last;
      held[f] = live ? 0 : 1;
    }
    return { dir, held };
  });
}
