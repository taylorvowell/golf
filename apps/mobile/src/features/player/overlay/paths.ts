/**
 * Turning geometry into the only primitive a plain-`View` overlay has: a rotated rectangle.
 *
 * D23 and D36 settled that the mobile overlay is rotated React Native `View`s — not a canvas and
 * not Skia — after 49 keypoints held 99.2% frame-lock that way and removing React from the paint
 * path scored no better. Everything drawn therefore reduces to a list of **segments**, each of
 * which becomes one `View`, so *the number of segments is the cost of a frame*. That is why the
 * functions here are about producing FEWER of them, not about drawing.
 *
 * All arithmetic is in pixels of the stage. Normalized→pixel happens once, at the caller.
 */

export type Pt = [number, number];

/** One rotated rectangle: a line from `a` to `b`, rendered centred on its own midpoint. */
export interface Segment {
  a: Pt;
  b: Pt;
}

/** A polyline as segments, in order. Runs shorter than two points contribute nothing. */
export function polylineSegments(pts: readonly Pt[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i] });
  return out;
}

/**
 * Ramer–Douglas–Peucker, in screen pixels, run **after** the trace smoothing rather than instead
 * of it.
 *
 * The smoothing filters subdivide for a canvas — Catmull-Rom emits eight points per span — and on
 * a phone stage a few hundred pixels wide most of that detail is finer than one pixel. Every one
 * of those points is a `View` here, so the subdivision that is free on a canvas is the single
 * largest cost in this renderer. RDP with a sub-pixel tolerance removes points the display cannot
 * resolve and provably moves the drawn line by less than `tol`.
 *
 * **Both endpoints are preserved exactly**, which is the property the trace is judged on: the head
 * of the line has to land on the playhead and the tail has to reach the ball. This is a
 * render-time simplification of an already-smoothed curve; it never touches `analysis.json`, and
 * it never bridges a gap — bridges are separate pieces and are simplified independently.
 */
export function simplify(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length <= 2 || !(tol > 0)) return pts.slice();

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const tol2 = tol * tol;

  // Explicit stack rather than recursion: a smoothed swing trace can run to a few thousand points
  // and the worst case here is linear depth.
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const [ax, ay] = pts[lo];
    const [bx, by] = pts[hi];
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let worst = -1;
    let worstAt = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = pts[i];
      let d2: number;
      if (len2 === 0) {
        d2 = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      } else {
        // Distance to the SEGMENT, not the infinite line — a path that doubles back on itself
        // (every golf swing does, at the top) has points whose nearest approach is an endpoint.
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx,
          qy = ay + t * dy;
        d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      }
      if (d2 > worst) {
        worst = d2;
        worstAt = i;
      }
    }

    if (worst > tol2 && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([lo, worstAt], [worstAt, hi]);
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * A polyline walked by arc length and emitted as dashes.
 *
 * Canvas has `setLineDash`; a `View` has nothing. Emitting the dashes as segments is not merely
 * the available option, it is the cheap one: a 400px path dashed 5-on / 8-off is ~31 views, where
 * the same path drawn solid from a smoothed sample list is several hundred. Dashing the backswing
 * therefore costs less than not dashing it.
 *
 * `on` and `off` are pixel lengths. A non-positive `on` returns nothing rather than looping.
 */
export function dashSegments(pts: readonly Pt[], on: number, off: number): Segment[] {
  const out: Segment[] = [];
  if (pts.length < 2 || !(on > 0) || !(off >= 0)) return out;

  // `off === 0` would draw a solid line as an unbounded number of abutting dashes.
  if (off === 0) return polylineSegments(pts);

  let drawing = true;
  let remaining = on;
  let [cx, cy] = pts[0];
  /**
   * Where the dash currently being drawn started.
   *
   * One segment per DASH, not one per input sample crossed. Emitting per sample is the obvious
   * implementation and it silently destroys the saving this function exists for: a dense polyline
   * dashed 5-on/8-off then costs five views per dash instead of one. The dash becomes a chord
   * across whatever curve it spans, which over a few pixels of an already-simplified path is
   * sub-pixel.
   */
  let dashFrom: Pt = [cx, cy];

  for (let i = 1; i < pts.length; i++) {
    const [nx, ny] = pts[i];
    let segLen = Math.hypot(nx - cx, ny - cy);
    while (segLen > remaining) {
      const t = remaining / segLen;
      const mx = cx + (nx - cx) * t;
      const my = cy + (ny - cy) * t;
      if (drawing) out.push({ a: dashFrom, b: [mx, my] });
      cx = mx;
      cy = my;
      segLen -= remaining;
      drawing = !drawing;
      remaining = drawing ? on : off;
      if (drawing) dashFrom = [cx, cy];
    }
    remaining -= segLen;
    cx = nx;
    cy = ny;
  }
  // The tail: a dash the path ended in the middle of still has to be drawn.
  if (drawing && (cx !== dashFrom[0] || cy !== dashFrom[1])) out.push({ a: dashFrom, b: [cx, cy] });
  return out;
}

/**
 * An arc as a short polyline.
 *
 * The web player strokes a real arc and fills the wedge behind it. Neither is expressible as
 * rectangles, so the arc is approximated by `steps` chords and **the translucent wedge fill is
 * dropped** — named here rather than discovered later. At the radius an angle arc is drawn on a
 * phone (~7% of the stage) twelve chords are already sub-pixel-accurate.
 *
 * Angles are in radians, `a0`→`a0 + sweep`, y-down like the screen.
 */
export function arcSegments(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  sweep: number,
  steps = 12,
): Segment[] {
  if (!(r > 0) || !Number.isFinite(sweep) || sweep === 0 || steps < 1) return [];
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return polylineSegments(pts);
}

/**
 * The shortest signed sweep from direction `a0` to direction `a1`.
 *
 * The short way round is the angle both the drawing and the label mean — an arc taking the long
 * way would show the reflex angle beside a label reporting its complement.
 */
export function shortestSweep(a0: number, a1: number): number {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Unit vector, or null when the input is too short to have a direction. */
export function unit(x: number, y: number): Pt | null {
  const n = Math.hypot(x, y);
  return n < 1e-6 ? null : [x / n, y / n];
}
