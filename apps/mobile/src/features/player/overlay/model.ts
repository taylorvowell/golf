import type { Analysis, Club } from "@swingsage/schema/contract";

import { defaultClubVar } from "./clubVariants";
import { MIN_CONF, type KeypointIndex } from "./geometry";
import { buildTracePath, type SmoothingKey, type TracePiece } from "./traceSmoothing";

/**
 * Everything the overlay needs that is a **pure function of the artifact**, computed once per
 * swing rather than once per frame.
 *
 * These are `SwingStage.tsx`'s memos, extracted as plain functions. They are here and not in a
 * hook for a reason that outlives the port: each is a whole-clip pass, and a hook invites
 * recomputing it from the playhead. `orientationHold` in particular is a **one-pass forward walk
 * over the entire clip with hysteresis**, so scrubbing backwards, jumping to a checkpoint and
 * playing through all give the same bar on the same frame. A running filter fed by the playhead
 * would not, and the difference is invisible until someone scrubs.
 */

/**
 * The club solution to draw — the stored variant the artifact's own numbers select, not `primary`.
 *
 * `primary` is the deliberately conservative classical solve, and the player has defaulted away
 * from it since 2026-08-08 because comparing solutions on real pixels is the only way to judge them
 * until a position-error metric exists. Switching is a RENDER change: metrics, face and event
 * refinement all read the primary block regardless.
 *
 * This was missed on the first pass of the port, and `scripts/checkoverlay.ts` is what found it —
 * the mobile trace was a visibly different line from the web player's over the same swing. That is
 * the entire argument for building the debug view when the work starts.
 */
export function selectedClub(a: Analysis): Club | null {
  const c = a.club;
  if (!c) return null;
  const key = defaultClubVar(a);
  const v = key !== "primary" ? c.variants?.[key] : undefined;
  return v
    ? { ...c, frames: v.frames, trace: v.trace, trace_frames: v.trace_frames, coverage: v.coverage }
    : c;
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
 * Where the trace changes colour.
 *
 * The web player re-cuts these at hand-corrected phase boundaries. There are no corrections on the
 * phone yet — they live in the database and merge at render time, which is a later step — so this
 * reads the analyzer's events directly. The shape is the same one corrections would fill in.
 */
export function traceSpans(a: Analysis): TraceSpans | null {
  const e = a.events;
  if (!e?.address || !e.top || !e.impact || !e.finish) return null;
  return {
    backswing: [e.address.frame, e.top.frame],
    downswing: [e.top.frame, e.impact.frame],
    followthrough: [e.impact.frame, e.finish.frame],
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
): Record<TraceKey, TracePiece[]> {
  const out = { backswing: [], downswing: [], followthrough: [] } as Record<TraceKey, TracePiece[]>;
  const club = selectedClub(a);
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
    const fs: number[] = known
      ? tf
      : pts.map((_, i) => lo + Math.round((i * (hi - lo)) / Math.max(1, pts.length - 1)));
    // A segment with no real frames must not be chopped into bridges by a synthetic index, so hand
    // over a dense synthetic sequence and clear the bridge flag it cannot have earned.
    const framesIn = known ? fs : fs.map((_, i) => lo + i);
    out[key] = buildTracePath(
      pts.map(([x, y]) => [x * vw, y * vh] as [number, number]),
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
 * The span, as a share of body height, at which a bar starts following its pair's angle again, and
 * the one at which it stops. Hysteresis, so a span hovering on a single threshold cannot flicker
 * between held and live — which it did, and each re-entry committed the accumulated drift at once.
 *
 * **Not a phase gate.** Nothing here knows where the swing is; the test is whether this pair, on
 * this frame, is open enough to the camera to be measured. Down the line the far shoulder and hip
 * sit behind the body and the model is inferring them; that inference slides rather than jitters,
 * and foreshortening multiplies it — across a 43px shoulder span a 3px slip is 4°. The result
 * without this gate is an overlay that turns hard while the golfer stands still over the ball.
 */
export const ORIENT_LIVE_SPAN = 0.09;
export const ORIENT_HOLD_SPAN = 0.06;

/** The projected span below which the rod draws dimmed — its angle is guesswork at that length. */
export const ORIENT_WEAK_SPAN = 0.06;
/** The keypoint confidence below which the rod also draws dimmed. Just above `MIN_CONF`. */
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
