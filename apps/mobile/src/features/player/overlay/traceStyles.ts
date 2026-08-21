import type { Pt } from "./paths";
import { dashSegments } from "./paths";

/**
 * THE production swing-path style — chosen by Taylor 2026-08-19 after five comparison rounds
 * on real swings: `gradient3d · bulge · aquaDeep · silk`. The losing styles, palettes,
 * exaggerations and join treatments were removed the same day ("that is the final
 * combination, remove all others"); git history holds the comparison harness if it is ever
 * wanted again.
 *
 * What each surviving ingredient is:
 *
 *  - **WIDTH (gradient3d · bulge)** — a Gaussian bulge centred just past mid-downswing
 *    (t ≈ 0.72 of the whole path): slim at address, fattest where the club is fastest, slim
 *    again by impact. Width says speed, not proximity to the strike.
 *  - **COLOUR (aquaDeep)** — shades of one hue: near-black teal at address, deep teal through
 *    the top, bright aqua at the strike. Position along the swing is carried by lightness.
 *  - **JOINS (silk)** — the path is resampled to uniform ~3px steps, and every stroke is
 *    extended half a width so its rounded cap centres ON the joint: a geometric round join,
 *    the construction canvas `lineJoin: "round"` performs. The short strokes ALSO make the
 *    colour blend continuous instead of banded — one fix for both visible seams and banding.
 *
 * Honesty rules, unchanged from the two-colour renderer this replaces:
 *
 *  1. **Bridges stay dashed chords.** A span with no measurement behind it draws as the
 *     straight dashed line it is — the style never dresses a gap up as data.
 *  2. **Endpoints are exact.** The capsule extension is SKIPPED on each piece's terminal
 *     ends, so the tail still reaches the ball and the head lands on the playhead.
 *
 * Render-only: nothing here touches the measured points, the smoothing, or `analysis.json`.
 * The web player still draws the legacy two-colour phase trace from the same artifact — a
 * named divergence, recorded in docs/decisions/mobile-client.md, pending a canvas port.
 */

/** One styled stroke: a `Line` with its own width and colour. */
export interface StyledSeg {
  a: Pt;
  b: Pt;
  w: number;
  color: string;
  opacity?: number;
}

export interface StyledDot {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity?: number;
}

export interface StyledPiece {
  segs: StyledSeg[];
  dots: StyledDot[];
}

export interface StylePieceInput {
  /** Simplified stage-pixel points of this piece (already smoothed + RDP'd). */
  pts: Pt[];
  bridge: boolean;
  /** The renderer's base width for this stage size. */
  peak: number;
  /** This piece's span of the whole drawn path, 0..1 — carries the ramps across pieces. */
  t0: number;
  t1: number;
}

/** Linear blend of two hex colours (no alpha). */
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const r = ch((pa >> 16) & 255, (pb >> 16) & 255);
  const g = ch((pa >> 8) & 255, (pb >> 8) & 255);
  const bl = ch(pa & 255, pb & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** aquaDeep: near-black teal → deep teal → bright aqua, as a t→colour function. */
export function traceColorAt(t: number): string {
  return t < 0.5
    ? lerpHex("#04252C", "#0E7490", t * 2)
    : lerpHex("#0E7490", "#3FFFF5", (t - 0.5) * 2);
}

/**
 * The bulge width profile: a Gaussian bump centred just past the middle of the downswing,
 * effectively zero through most of the backswing and back to ~5% of the ramp by impact.
 */
function bulgeProfile(t: number): number {
  return Math.exp(-Math.pow((t - 0.72) / 0.16, 2));
}

/**
 * Re-emit a polyline at uniform arc-length steps (the "silk" half of the join fix). Both
 * endpoints are kept exactly; interior points are linear interpolations of the input, so the
 * resampled path never leaves the original — this changes segment COUNT, not the curve.
 */
function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2 || !(step > 0)) return pts;
  const out: Pt[] = [pts[0]];
  let prev: Pt = pts[0];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (carry + d >= step && d > 0) {
      const t = (step - carry) / d;
      const nx = prev[0] + (cur[0] - prev[0]) * t;
      const ny = prev[1] + (cur[1] - prev[1]) * t;
      out.push([nx, ny]);
      prev = [nx, ny];
      d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      carry = 0;
    }
    carry += d;
    prev = cur;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/** Cumulative arc length per point, so `t` moves with distance rather than sample density. */
function arcLengths(pts: Pt[]): { at: number[]; total: number } {
  const at = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    at.push(total);
  }
  return { at, total };
}

/**
 * Style one trace piece. Pure geometry→geometry; the caller owns memoisation, and every
 * emitted stroke is one `Line` view — the number of views is still the cost of a frame.
 */
export function stylePiece(input: StylePieceInput): StyledPiece {
  const { bridge, peak, t0, t1 } = input;
  const segs: StyledSeg[] = [];
  const dots: StyledDot[] = [];
  if (input.pts.length < 2) return { segs, dots };

  // Rule 1: a bridge is a dashed chord, coloured at the gradient's midpoint so it does not
  // break the blend visually.
  if (bridge) {
    const color = traceColorAt((t0 + t1) / 2);
    for (const s of dashSegments(input.pts, peak * 1.25, peak * 2.1)) {
      segs.push({ a: s.a, b: s.b, w: peak * 0.9, color, opacity: 0.85 });
    }
    return { segs, dots };
  }

  const pts = resample(input.pts, Math.max(2.5, peak));
  const { at, total } = arcLengths(pts);
  if (!(total > 0)) return { segs, dots };
  const tAt = (i: number) => t0 + (t1 - t0) * (at[i] / total);

  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    let b = pts[i];
    const t = (tAt(i - 1) + tAt(i)) / 2;
    const w = peak * Math.max(0.3, 0.6 + 2.4 * bulgeProfile(t));

    // The capsule join: each stroke is a capsule (borderRadius rounds its ends into
    // semicircles), so extending it by exactly half its width centres that cap ON the joint.
    // Rule 2: the piece's terminal ends are NOT extended — endpoints stay exact.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > 0.01) {
      const ext = w * 0.5;
      if (i > 1) a = [a[0] - (dx / len) * ext, a[1] - (dy / len) * ext];
      if (i < pts.length - 1) b = [b[0] + (dx / len) * ext, b[1] + (dy / len) * ext];
    }

    segs.push({ a, b, w, color: traceColorAt(t) });
  }

  return { segs, dots };
}
