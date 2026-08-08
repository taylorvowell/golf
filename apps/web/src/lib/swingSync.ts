import type { Analysis } from "@/lib/swings";

/**
 * Frame-mapping between two swings, so a comparison pane shows the same *part of the swing* as
 * the video beside it — whatever the clips' lengths, frame rates or playback speeds.
 *
 * ## What failed first, and why
 *
 * **Elapsed time** is hopeless: pro footage is essentially always slow motion, so the reference
 * can carry five times the frames, and no fixed rate survives a slow backswing followed by a
 * fast downswing.
 *
 * **The eight detected events** work only as well as the detector does, and on heavily
 * slow-motion footage it does not work at all — the bundled reference has its impact detected
 * ~55 frames early.
 *
 * **Raw hand position, frame-to-frame (DTW)** is ambiguous: the hands pass through nearly the
 * same place going up and coming down, so position alone cannot say which half of the swing
 * you are in.
 *
 * **Whole-clip arc length** was defeated by what happens *after* the swing. Measured: 46% of
 * one fixture's total hand travel happens after the finish, as the golfer lowers the club,
 * against ~0% for the reference. Any global normalisation gets dragged around by that tail.
 *
 * ## What this does
 *
 * Anchor on four landmarks — **address, top, impact, finish** — and match by hand-path arc
 * length *within* each segment.
 *
 * The landmarks come from the hand-height signal directly (`grip_center` above `mid_hip`), not
 * from the event detector: the top is the first prominent peak after address, impact the
 * trough after it, the finish the peak after that. Those are geometric extrema of one
 * well-tracked signal, so they survive slow motion — measured against hand-checked truth they
 * land on 198/221/244 where the events say 198/221/243, and recover the reference's impact at
 * f533 where its own event detection says f474 against a true ~530.
 *
 * Arc length within a segment is what handles the speed difference: it counts distance
 * travelled, not frames, so a slow-motion clip and a real-time one produce the same curve, and
 * the reference holds, skips or stretches its own frames to keep the hands in the same place.
 *
 * Outside `[address, finish]` the mapping clamps, which is the wanted behaviour rather than a
 * limitation: the reference **holds its address frame** until your swing starts and **freezes
 * at its finish** once yours is over.
 *
 * Backswing and downswing are the segments this is tuned to get right. The finish anchor is
 * the least reliable of the four on slow-motion footage, and the reference sitting on a frozen
 * finish frame while your follow-through completes is an accepted trade.
 */

/** Matches `metrics.MIN_CONF` — below it the analyzer treated the point as missing. */
const MIN_CONF = 0.35;

/** Per-frame hand movement below this fraction of typical movement is treated as zero, so
 *  keypoint jitter doesn't accumulate arc across a motionless address hold. */
const DEADBAND = 0.06;

/** A peak must be followed by a fall of this fraction of the hand-height range to count —
 *  enough to ignore the wobble at the top of the backswing without missing the top itself. */
const PROMINENCE = 0.25;

export interface SwingSync {
  /** user frame -> reference frame */
  toRef: (userFrame: number) => number;
  /** reference frame -> user frame */
  toUser: (refFrame: number) => number;
  /** d(refFrame)/d(userFrame) — the local warp factor, used to set the reference's
   *  `playbackRate` so it plays in step rather than being seeked every frame. */
  slopeAt: (userFrame: number) => number;
  method: "landmarks" | "linear";
  /** The four anchor frames found on each side, so the UI (and a human debugging it) can see
   *  what the alignment actually keyed on. */
  anchors: { user: number[]; ref: number[] } | null;
}

/** Hand height above the hips, per frame, in body-heights. Gaps filled, lightly smoothed. */
function handHeight(a: Analysis): number[] | null {
  const idx: Record<string, number> = {};
  a.pose.keypoint_names.forEach((n, i) => (idx[n] = i));
  const gi = idx["grip_center"], hp = idx["mid_hip"];
  if (gi === undefined || hp === undefined) return null;
  const bh = a.metrics?.body_height_norm || 0.4;

  const raw: (number | null)[] = [];
  let tracked = 0;
  for (let f = 0; f < a.video.frame_count; f++) {
    const kp = a.pose.frames[f]?.kp;
    const g = kp?.[gi], h = kp?.[hp];
    if (g && h && g[2] >= MIN_CONF && h[2] >= MIN_CONF) {
      raw.push((h[1] - g[1]) / bh);
      tracked++;
    } else raw.push(null);
  }
  if (tracked < raw.length * 0.4 || tracked < 20) return null;

  let last: number | null = null;
  for (let i = 0; i < raw.length; i++) { if (raw[i] !== null) last = raw[i]; else raw[i] = last; }
  last = null;
  for (let i = raw.length - 1; i >= 0; i--) { if (raw[i] !== null) last = raw[i]; else raw[i] = last; }
  if (raw[0] === null) return null;

  const h = raw as number[];
  const s = h.slice();
  for (let i = 2; i < h.length - 2; i++) s[i] = (h[i - 2] + h[i - 1] + h[i] + h[i + 1] + h[i + 2]) / 5;
  return s;
}

/**
 * Hand path length per frame, measured RELATIVE TO THE HIPS.
 *
 * Relative, not absolute, is load-bearing: an absolute path counts camera pans and zooms as
 * hand travel, and the reference clip's camera moves through the follow-through. Measured, that
 * alone was enough to throw the alignment out by ~100 frames.
 */
function arcCurve(a: Analysis): number[] | null {
  const idx: Record<string, number> = {};
  a.pose.keypoint_names.forEach((n, i) => (idx[n] = i));
  const gi = idx["grip_center"], hp = idx["mid_hip"];
  if (gi === undefined || hp === undefined) return null;
  const bh = a.metrics?.body_height_norm || 0.4;
  const aspect = a.video.width / a.video.height;

  const pts: ({ x: number; y: number } | null)[] = [];
  let last: { x: number; y: number } | null = null;
  for (let f = 0; f < a.video.frame_count; f++) {
    const kp = a.pose.frames[f]?.kp;
    const g = kp?.[gi], h = kp?.[hp];
    if (g && h && g[2] >= MIN_CONF && h[2] >= MIN_CONF) {
      last = { x: ((g[0] - h[0]) * aspect) / bh, y: (g[1] - h[1]) / bh };
    }
    pts.push(last);
  }

  const steps: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = pts[i - 1];
    steps.push(p && q ? Math.hypot(p.x - q.x, p.y - q.y) : 0);
  }
  const sorted = [...steps].filter((s) => s > 0).sort((x, y) => x - y);
  const floor = (sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0) * DEADBAND;

  const cum: number[] = [];
  let t = 0;
  for (const s of steps) { if (s > floor) t += s; cum.push(t); }
  return t > 1e-6 ? cum : null;
}

/** First extremum after `from` that is then reversed by `prom`. `dir` 1 = peak, -1 = trough. */
function firstExtremum(h: number[], from: number, prom: number, dir: 1 | -1): number {
  let best = from, bv = dir * h[from];
  for (let f = from; f < h.length; f++) {
    const v = dir * h[f];
    if (v > bv) { bv = v; best = f; }
    else if (bv - v > prom) return best;
  }
  return best;
}

/** address, top, impact, finish — from hand height, not from the event detector. */
function landmarks(a: Analysis, h: number[]): number[] | null {
  const addr = a.events?.address?.frame;
  if (typeof addr !== "number" || addr >= h.length - 4) return null;
  const tail = h.slice(addr);
  const prom = (Math.max(...tail) - h[addr]) * PROMINENCE;
  if (!(prom > 0)) return null;

  const top = firstExtremum(h, addr, prom, 1);
  const imp = firstExtremum(h, top, prom, -1);
  const fin = firstExtremum(h, imp, prom, 1);
  // Strictly increasing, or the piecewise segments below collapse.
  if (!(addr < top && top < imp && imp < fin)) return null;
  return [addr, top, imp, fin];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** First index whose value is >= `target`, over a non-decreasing slice. */
function search(arr: number[], target: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function buildSwingSync(
  user: Analysis, ref: Analysis,
  userWin: [number, number], refWin: [number, number],
): SwingSync | null {
  const uh = handHeight(user), rh = handHeight(ref);
  const ua = arcCurve(user), ra = arcCurve(ref);

  if (uh && rh && ua && ra) {
    const uL = landmarks(user, uh), rL = landmarks(ref, rh);
    if (uL && rL) {
      // One reference frame per user frame across the whole user window.
      const [u0, u1] = userWin;
      const map: number[] = [];
      for (let f = u0; f <= u1; f++) {
        if (f <= uL[0]) { map.push(rL[0]); continue; }          // hold the address
        if (f >= uL[3]) { map.push(rL[3]); continue; }          // freeze at the finish
        // Which segment, and how far through it by distance travelled.
        let k = 0;
        while (k < 2 && f > uL[k + 1]) k++;
        const uSpan = ua[uL[k + 1]] - ua[uL[k]];
        const frac = uSpan > 1e-9 ? (ua[f] - ua[uL[k]]) / uSpan : 0;
        const target = ra[rL[k]] + frac * (ra[rL[k + 1]] - ra[rL[k]]);
        map.push(clamp(search(ra, target, rL[k], rL[k + 1]), refWin[0], refWin[1]));
      }
      for (let i = 1; i < map.length; i++) if (map[i] < map[i - 1]) map[i] = map[i - 1];
      return build(map, u0, userWin, refWin, "landmarks", { user: uL, ref: rL });
    }
  }

  // Nothing usable to anchor on — stretch one window evenly onto the other and say so, rather
  // than implying a match that isn't there.
  const [u0, u1] = userWin, [r0, r1] = refWin;
  const scale = (r1 - r0) / Math.max(1, u1 - u0);
  const map: number[] = [];
  for (let f = u0; f <= u1; f++) map.push(r0 + Math.round((f - u0) * scale));
  return build(map, u0, userWin, refWin, "linear", null);
}

function build(
  map: number[], u0: number,
  userWin: [number, number], refWin: [number, number],
  method: SwingSync["method"], anchors: SwingSync["anchors"],
): SwingSync {
  const n = map.length;
  return {
    toRef: (f) => clamp(map[clamp(Math.round(f) - u0, 0, n - 1)], refWin[0], refWin[1]),
    toUser: (rf) => {
      const target = clamp(Math.round(rf), refWin[0], refWin[1]);
      let best = 0, bestD = Infinity;
      for (let k = 0; k < n; k++) {
        const d = Math.abs(map[k] - target);
        if (d < bestD) { bestD = d; best = k; }
      }
      return clamp(best + u0, userWin[0], userWin[1]);
    },
    slopeAt: (f) => {
      // Central difference over a small window, so a single repeated frame in the middle of
      // the swing doesn't read as a full stop.
      //
      // The lower bound is 0, NOT a small positive floor. Outside [address, finish] the map is
      // deliberately constant — the reference holds — and a positive floor there would let it
      // creep forward, trip the drift tolerance, get seeked back, and creep again: a visible
      // back-and-forth judder at the approach and after the finish. A true zero lets the caller
      // recognise a hold and pause instead (see ComparisonPane's HOLD_SLOPE).
      const k = clamp(Math.round(f) - u0, 0, n - 1);
      const lo = clamp(k - 5, 0, n - 1), hi = clamp(k + 5, 0, n - 1);
      const span = hi - lo;
      if (span <= 0) return 0;
      return clamp((map[hi] - map[lo]) / span, 0, 10);
    },
    method,
    anchors,
  };
}
