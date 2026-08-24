/**
 * The SWING PLANE — the ellipse the logo's swoosh actually draws — and the geometry for walking it.
 *
 * It is its own module because `SWING_PLANE` is MEASURED, not chosen: `scripts/fit-swing-plane.mjs`
 * fits it to the artwork and prints the numbers to paste here, the same arrangement `brandPaths.ts`
 * has with its generator. Re-run the script after any change to the logo.
 *
 * Only the plane and the geometry live here. The loader's own look — its ramp, its stroke weights,
 * its track colours — belongs to the loader, and having had both was how two copies of the same
 * constant ended up a paste apart.
 */


/**
 * The SWING PLANE — the ellipse the logo's swoosh actually draws, in the mark's own user units
 * (`MARK_VIEWBOX`, 55.9 wide). `a` is the semi-major radius, `b` the semi-minor, `tilt` the major
 * axis's screen angle in degrees.
 *
 * GENERATED — `node scripts/fit-swing-plane.mjs`, which fits a conic to the swoosh's centreline
 * (the ridge of its distance field, not the midpoint of its bounding box) and writes a PNG of the
 * fit over the artwork. Re-run it when the logo changes, and look at the PNG.
 *
 * The loaders used to orbit an ellipse fitted to the swoosh's BOUNDING BOX, with the lean and the
 * squash then set by eye at -22° and 0.62. The artwork's own are -35.65° and 0.432 — a different
 * ellipse, which is why the ball tracked nothing in particular.
 */
export const SWING_PLANE = { cx: 29.63, cy: 21.49, a: 26.45, b: 11.43, tilt: -35.65 } as const;

/** The plane's squash, as the fraction a loader sets. */
export const PLANE_SQUASH = SWING_PLANE.b / SWING_PLANE.a;

/** The logo swoosh's angle — the house tilt, measured off the artwork rather than guessed. */
export const TILT = SWING_PLANE.tilt;

/**
 * Travel direction, as the sign on the orbit angle (Taylor, 2026-08-24). Negative runs the ball
 * up the far side and down the near one — the direction a right-handed downswing sweeps.
 *
 * It multiplies the ANGLE, so everything derived from `sin` of that angle — the near/far handover,
 * the scale ramp — turns with it and stays correct. Negating a position instead would reverse the
 * travel and leave the depth cues pointing the old way.
 */
export const SPIN = -1;

/** A point on an ellipse. Degrees from 3 o'clock, clockwise, matching SVG's y-down axis. */
function ept(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

/** An elliptical arc as a stroke path, swept clockwise on screen. */
export function earc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  d0: number,
  d1: number,
): string {
  const s = ept(cx, cy, rx, ry, d0);
  const e = ept(cx, cy, rx, ry, d1);
  return `M ${s.x} ${s.y} A ${rx} ${ry} 0 ${Math.abs(d1 - d0) > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
}

/**
 * The depth swap's threshold — and it is NOT the halfway point.
 *
 * Geometrically the near half is `sin > 0`, but that puts the handover at the ellipse's left and
 * right vertices, which is exactly where the near arc's end-caps are: the ball spends its whole
 * approach to each vertex behind the front stroke, with the stroke cutting across it. Biasing it
 * brings the ball forward early, so it only drops behind for the short run across the top where
 * there is no near arc to be behind.
 */
const FRONT_FROM = -0.55;
/** One frame wide. Any wider and the ball goes briefly translucent with the arc showing through. */
const FADE = 0.02;
/** Sample count for the interpolations below. Odd, so a sample lands on each vertex. */
const STEPS = 33;

const RANGE = Array.from({ length: STEPS }, (_, i) => i / (STEPS - 1));
