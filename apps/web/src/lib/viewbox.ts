import type { Analysis } from "./swings";

/**
 * The sub-rectangle of the frame worth showing, in the same normalized 0-1 space as every
 * coordinate in analysis.json.
 *
 * This is a *display* crop only — a CSS offset on the <video> plus a coordinate remap on the
 * overlay canvas. No pixels are re-encoded and no CV is re-run, so it is safe to retune
 * without re-analysing a swing, and it works on every already-stored analysis.json. It is
 * emphatically NOT the ROI crop of DECISIONS D5: that one fed cropped pixels to the landmark
 * model and measurably hurt pose accuracy. Nothing here reaches the estimator.
 *
 * One static box for the whole clip, never per-frame. `head_sway` and `hip_sway` are measured
 * against the frame, and a viewer's ability to *see* a swaying head depends on the frame
 * holding still — a crop that tracked the golfer would make a sway look stable.
 */
export interface ViewBox {
  x0: number;
  y0: number;
  cw: number;
  ch: number;
  /** Display aspect ratio of the cropped region — what the stage container is sized to. */
  aspect: number;
  /** True when this is the whole frame: no crop was worth making, or there was no data. */
  identity: boolean;
}

/** Keypoints below this are unverified (D6) and must not be allowed to define the framing. */
const POSE_CONF = 0.3;

/**
 * Percentile clipping, not min/max. Matches pose.swing_bbox: one wild misdetection would
 * otherwise inflate the box and undo the whole gain. The club gets a tighter band because
 * its solver emits a shaft on every frame at 100% coverage — including frames where the
 * solution is wrong (D12/D14) — so its outliers are more common than the pose's.
 */
const POSE_LO = 0.5, POSE_HI = 99.5;
const CLUB_LO = 1, CLUB_HI = 99;

/**
 * Padding as a fraction of the larger span, measured in SQUARE PIXELS — see the aspect
 * correction in `computeViewBox`. On a 1080x1920 portrait frame this is ~245px on every side.
 *
 * **This is the tuning knob.** It is not a clipping guard: nothing was clipped even at 0.08
 * (0% of pose points, 0% of club points between address and finish). A box that merely
 * contains the swing still reads as claustrophobic, because it leaves the golfer hard against
 * the edges. Padding buys breathing room and costs zoom:
 *
 *   pad   swing1              swing2
 *   0.08  1.24x               1.64x     visibly tight
 *   0.18  1.12x (vert only)   1.40x     <- here
 *   0.25  no crop             1.27x
 */
const PAD = 0.18;

/**
 * Below this much trimmed on BOTH axes the crop is not worth an aspect-ratio change: the
 * stage reflows and the swing library stops looking consistent for a zoom nobody notices.
 */
const MAX_KEEP = 0.92;

/** Never zoom past 5x, whatever the data says. Guards a pathological analysis. */
const MIN_SIZE = 0.2;

const asc = (a: number, b: number) => a - b;

/** Percentile with linear interpolation, over an already-sorted array. */
function pct(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Grow an interval to `min` about its centre, then slide it back inside [0, 1]. */
function expandTo(lo: number, hi: number, min: number): [number, number] {
  if (hi - lo >= min) return [lo, hi];
  const c = (lo + hi) / 2;
  let a = c - min / 2, b = c + min / 2;
  if (a < 0) { b -= a; a = 0; }
  if (b > 1) { a -= b - 1; b = 1; }
  return [Math.max(0, a), Math.min(1, b)];
}

export function fullView(a: Analysis): ViewBox {
  return {
    x0: 0, y0: 0, cw: 1, ch: 1,
    aspect: a.video.width / a.video.height,
    identity: true,
  };
}

/**
 * Union of the golfer and the club, padded — the region the swing actually happens in.
 *
 * Pose is taken over *every* frame, not just the swing: the player can scrub the whole clip,
 * so the body must stay in frame at address-minus-100 as much as at impact. The club is taken
 * only between address and finish, because outside that window the solver is tracking nothing
 * meaningful — on fixture swing1 its furthest-right head positions are all ~110 frames after
 * finish, and including them widens the box from 0.80 to 0.95 for no reason.
 */
export function computeViewBox(a: Analysis): ViewBox {
  const full = fullView(a);
  const frames = a.pose?.frames;
  if (!frames?.length) return full;

  const xs: number[] = [], ys: number[] = [];
  for (const fr of frames) {
    for (const p of fr.kp) {
      if (p[2] > POSE_CONF) { xs.push(p[0]); ys.push(p[1]); }
    }
  }
  if (xs.length < 100) return full;
  xs.sort(asc); ys.sort(asc);

  let x0 = pct(xs, POSE_LO), x1 = pct(xs, POSE_HI);
  let y0 = pct(ys, POSE_LO), y1 = pct(ys, POSE_HI);

  // The club is what actually sets the frame — the head sweeps a circle of radius club_len
  // (0.35 of frame height on swing1) around the hands, well outside any body box. Gated on
  // trace_enabled so a solution that already failed the 50% coverage quality gate cannot
  // define the framing.
  const club = a.club;
  if (club?.trace_enabled) {
    const f0 = a.events ? a.events.address.frame : -Infinity;
    const f1 = a.events ? a.events.finish.frame : Infinity;
    const cx: number[] = [], cy: number[] = [];
    for (const cf of club.frames ?? []) {
      if (cf.f < f0 || cf.f > f1) continue;
      for (const p of [cf.head, cf.butt, ...(cf.shaft ?? [])]) {
        if (p) { cx.push(p[0]); cy.push(p[1]); }
      }
    }
    if (cx.length >= 20) {
      cx.sort(asc); cy.sort(asc);
      x0 = Math.min(x0, pct(cx, CLUB_LO)); x1 = Math.max(x1, pct(cx, CLUB_HI));
      y0 = Math.min(y0, pct(cy, CLUB_LO)); y1 = Math.max(y1, pct(cy, CLUB_HI));
    }

    // The swing path, taken at its true extent rather than percentile-clipped. It is already
    // smoothed and segmented by event, so it has no fliers to defend against — and it is the
    // one overlay whose whole point is its shape, so trimming its ends to spare a few pixels
    // would be the wrong trade. It does reach past the per-frame club points: on swing1 the
    // trace runs x 0.011-0.752 where the club frames only reach 0.032-0.743.
    for (const pts of Object.values(club.trace ?? {})) {
      for (const p of pts ?? []) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      }
    }
  }

  // Pad in SQUARE PIXELS, not in normalized units. x is normalized by frame width and y by
  // frame height, so on a 1080x1920 portrait clip an equal normalized pad puts 144px at the
  // sides against 256px top and bottom — the crop reads correct vertically and far too tight
  // horizontally. Work in units of frame height (x' = x·W/H), pad uniformly there, convert
  // back. The same asymmetry is why angleOverlay.ts measures in aspect-corrected space.
  const A = a.video.width / a.video.height;
  const pad = Math.max((x1 - x0) * A, y1 - y0) * PAD;
  x0 = Math.max(0, x0 - pad / A); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(1, x1 + pad / A); y1 = Math.min(1, y1 + pad);

  [x0, x1] = expandTo(x0, x1, MIN_SIZE);
  [y0, y1] = expandTo(y0, y1, MIN_SIZE);

  const cw = x1 - x0, ch = y1 - y0;
  if (!(cw > 0) || !(ch > 0)) return full;
  if (cw > MAX_KEEP && ch > MAX_KEEP) return full;

  return {
    x0, y0, cw, ch,
    aspect: (cw * a.video.width) / (ch * a.video.height),
    identity: false,
  };
}
