/**
 * Drawing an angle from `metrics.angle_fields[].geom` onto the player canvas.
 *
 * The analyzer says *where* each angle lives (which keypoints, which reference direction);
 * this file only resolves those points and strokes them. **No angle is computed here** — the
 * label is read from `metrics.series[frame][field]`, so what is drawn and what is printed
 * come from the same measurement (doc 02: the player renders the artifact, it does not
 * recompute it).
 *
 * That the arc matches the label is not luck. The analyzer measures in aspect-corrected
 * space, (x·W/H, y), which is pixel space under a uniform scale — and uniform scales preserve
 * angles. So the arc drawn at (x·w, y·h) is exactly the angle in the label.
 */
import type { AngleField, Analysis, Keypoint, PointExpr } from "@/lib/swings";

/** Matches metrics.MIN_CONF — below this the analyzer treated the point as missing, so
 *  drawing it would put a confident-looking arc on a keypoint the number never used. */
const MIN_CONF = 0.35;

/** Distinguishable at small sizes against the skeleton's green / yellow / cyan. */
export const ANGLE_COLORS = ["#FB923C", "#F472B6", "#A78BFA", "#38BDF8", "#FACC15"];

type Pt = { x: number; y: number };
type Geom = NonNullable<AngleField["geom"]>;

function kp(frame: Keypoint[], idx: Record<string, number>, name: string): Pt | null {
  const i = idx[name];
  if (i === undefined) return null;
  const p = frame[i];
  return p && p[2] >= MIN_CONF ? { x: p[0], y: p[1] } : null;
}

export function resolve(
  expr: PointExpr | undefined,
  frame: Keypoint[],
  idx: Record<string, number>,
  series: Record<string, unknown> | undefined,
  clubHead: [number, number] | null,
): Pt | null {
  if (expr === undefined) return null;
  if (typeof expr === "string") return kp(frame, idx, expr);
  if ("club" in expr) return clubHead ? { x: clubHead[0], y: clubHead[1] } : null;

  if ("feet" in expr) {
    // Mean over both feet of heel + frac·(toe − heel). Averaging the two halves the noise in
    // the foot's short, foreshortened projection down the line — the weakest input to the
    // stack angles, and the reason mid-foot is published beside ball-of-foot.
    const pts: Pt[] = [];
    for (const side of ["left", "right"]) {
      const h = kp(frame, idx, `${side}_heel`);
      const t = kp(frame, idx, `${side}_foot_index`);
      if (h && t) pts.push({ x: h.x + expr.feet * (t.x - h.x), y: h.y + expr.feet * (t.y - h.y) });
    }
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }

  // A chain, optionally told which link actually answered. Head anchors are not
  // interchangeable — the nose sits forward of the ear — so when the analyzer recorded its
  // choice for this frame, draw on that point rather than re-deriving a possibly different one.
  const named = expr.src ? series?.[expr.src] : undefined;
  if (typeof named === "string") {
    const p = kp(frame, idx, named);
    if (p) return p;
  }
  for (const name of expr.chain) {
    const p = kp(frame, idx, name);
    if (p) return p;
  }
  return null;
}

const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Resolve one angle into what the canvas needs: an origin and two rays, each either a real
 * bone (solid, drawn to its true endpoint) or a reference direction (dashed, fixed length).
 * Returns null when any input keypoint is missing, so nothing is drawn on a joint the
 * measurement itself could not see.
 */
function rays(
  geom: Geom,
  frame: Keypoint[],
  idx: Record<string, number>,
  series: Record<string, unknown> | undefined,
  clubHead: [number, number] | null,
): { origin: Pt; u: Pt; v: Pt; uDashed: boolean; vDashed: boolean; guide?: Pt } | null {
  const R = (e: PointExpr | undefined) => resolve(e, frame, idx, series, clubHead);

  if (geom.kind === "interior") {
    const o = R(geom.vertex), a = R(geom.a), b = R(geom.b);
    if (!o || !a || !b) return null;
    // A `_flex` field reports departure from straight, so the arc has to open from the
    // bone's *continuation* through the joint — which is also what "straight" looks like.
    const u = geom.supplement ? sub(o, a) : sub(a, o);
    return { origin: o, u, v: sub(b, o), uDashed: !!geom.supplement, vDashed: false };
  }

  if (geom.kind === "vectors") {
    const o = R(geom.at);
    const u0 = R(geom.u?.[0]), u1 = R(geom.u?.[1]);
    const v0 = R(geom.v?.[0]), v1 = R(geom.v?.[1]);
    if (!o || !u0 || !u1 || !v0 || !v1) return null;
    return { origin: o, u: sub(u1, u0), v: sub(v1, v0), uDashed: true, vDashed: true };
  }

  const o = R(geom.from), to = R(geom.to);
  if (!o || !to) return null;
  const ref: Pt =
    geom.kind === "vertical" ? { x: 0, y: -1 } :
    geom.kind === "plumb" ? { x: 0, y: 1 } :
    { x: 1, y: 0 };
  return {
    origin: o, u: sub(to, o), v: ref, uDashed: false, vDashed: true,
    // 90° = stacked is the thing being checked, so the plumb line is worth showing even
    // where the measurement's own reference is horizontal.
    guide: geom.guide === "plumb" ? { x: 0, y: -1 } : undefined,
  };
}

export function drawAngle(
  ctx: CanvasRenderingContext2D,
  spec: AngleField,
  analysis: Analysis,
  frameNo: number,
  w: number,
  h: number,
  color: string,
): boolean {
  const geom = spec.geom;
  if (!geom) return false;
  const fr = analysis.pose.frames[frameNo];
  if (!fr) return false;

  const idx: Record<string, number> = {};
  analysis.pose.keypoint_names.forEach((n, i) => (idx[n] = i));
  const series = analysis.metrics?.series?.[frameNo];
  const value = series?.[spec.field];
  if (typeof value !== "number") return false;

  const head = analysis.club?.frames?.[frameNo]?.head ?? null;
  const r = rays(geom, fr.kp, idx, series, head);
  if (!r) return false;

  // Canvas space. x and y scale by different factors, which is correct — that IS the image
  // geometry, and it is the space the analyzer's aspect correction reproduces.
  const O = { x: r.origin.x * w, y: r.origin.y * h };
  const toCanvas = (d: Pt) => ({ x: d.x * w, y: d.y * h });
  const norm = (d: Pt) => {
    const n = Math.hypot(d.x, d.y);
    return n < 1e-6 ? null : { x: d.x / n, y: d.y / n };
  };
  const U = norm(toCanvas(r.u));
  const V = norm(toCanvas(r.v));
  if (!U || !V) return false;

  const scale = Math.min(w, h);
  const refLen = scale * 0.14;
  const uLen = r.uDashed ? refLen : Math.hypot(r.u.x * w, r.u.y * h);
  const vLen = r.vDashed ? refLen : Math.hypot(r.v.x * w, r.v.y * h);
  const arcR = Math.min(scale * 0.075, uLen * 0.62, vLen * 0.62);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const ray = (D: Pt, len: number, dashed: boolean) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = dashed ? 0.6 : 0.95;
    ctx.lineWidth = Math.max(1.5, w / 400);
    ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.beginPath();
    ctx.moveTo(O.x, O.y);
    ctx.lineTo(O.x + D.x * len, O.y + D.y * len);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (r.guide) {
    const G = norm(toCanvas(r.guide));
    if (G) {
      ctx.strokeStyle = "#E5E7EB";
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = Math.max(1, w / 500);
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(O.x, O.y);
      ctx.lineTo(O.x + G.x * scale * 0.5, O.y + G.y * scale * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ray(U, uLen, r.uDashed);
  ray(V, vLen, r.vDashed);

  // Arc swept the short way between the rays, which is the angle both the drawing and the
  // label mean. atan2 with canvas y-down, so the sweep direction follows the screen.
  const a0 = Math.atan2(U.y, U.x);
  const a1 = Math.atan2(V.y, V.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, w / 400);
  ctx.beginPath();
  ctx.arc(O.x, O.y, arcR, a0, a0 + d, d < 0);
  ctx.stroke();

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(O.x, O.y);
  ctx.arc(O.x, O.y, arcR, a0, a0 + d, d < 0);
  ctx.closePath();
  ctx.fill();

  // Label on the arc's bisector, pushed out past it so it never sits on the bones.
  const mid = a0 + d / 2;
  const lx = O.x + Math.cos(mid) * (arcR + scale * 0.055);
  const ly = O.y + Math.sin(mid) * (arcR + scale * 0.055);
  const text = `${value.toFixed(1)}°`;
  const fs = Math.max(11, scale * 0.032);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#0A0A0A";
  const padX = fs * 0.38, padY = fs * 0.26;
  const bx = lx - tw / 2 - padX, by = ly - fs / 2 - padY;
  const bw = tw + padX * 2, bh = fs + padY * 2;
  // roundRect is recent enough to be worth not betting the whole overlay on — a throw here
  // would take the skeleton down with it, since this runs inside the shared draw pass.
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, fs * 0.3);
    ctx.fill();
  } else {
    ctx.fillRect(bx, by, bw, bh);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, lx, ly);

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(O.x, O.y, Math.max(2.5, w / 260), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}

/**
 * Draws the TARGET for a from-vertical angle — a dashed reference ray at the band's centre,
 * on the same side as the golfer's actual value, so "here's where you are" (the solid ray
 * `drawAngle` already draws) and "here's where this should be" sit on the same paused frame.
 *
 * Scoped to `kind: "vertical"` geoms only for now (spine/arm-hang/shin-from-vertical angles —
 * a vertex plus a single reference direction, the simplest case to invert). Every other geom
 * kind (`interior`, `plumb`, `horizontal`, `vectors`) returns `false` rather than drawing
 * something unverified; extend this once the vertical case has been eyeballed against a real
 * fixture and the sign convention is trusted (the same discipline `checkangles.py` exists for
 * — see CLAUDE.md's "run it before trusting a new mapping").
 *
 * The inversion: `metrics._from_vertical(v) = degrees(atan2(v.x, -v.y))`. Solving for a unit
 * vector at signed angle `deg` gives `{x: sin(deg), y: -cos(deg)}` — the exact inverse, so a
 * target ray at the band centre reads as the same quantity the label already names.
 */
export function drawAngleTarget(
  ctx: CanvasRenderingContext2D,
  spec: AngleField,
  analysis: Analysis,
  frameNo: number,
  w: number,
  h: number,
  band: { min: number; max: number },
  absValue: boolean,
  color = "#4ADE80",
): boolean {
  const geom = spec.geom;
  if (!geom || geom.kind !== "vertical") return false;
  const fr = analysis.pose.frames[frameNo];
  if (!fr) return false;

  const idx: Record<string, number> = {};
  analysis.pose.keypoint_names.forEach((n, i) => (idx[n] = i));
  const series = analysis.metrics?.series?.[frameNo];
  const value = series?.[spec.field];
  if (typeof value !== "number") return false;

  const head = analysis.club?.frames?.[frameNo]?.head ?? null;
  const origin = resolve(geom.from, fr.kp, idx, series, head);
  if (!origin) return false;

  const O = { x: origin.x * w, y: origin.y * h };
  const targetMag = (band.min + band.max) / 2;
  // Same side as the actual value, so this reads as "same direction, different amount" rather
  // than a mirrored, confusing comparison. Meaningless for a value near zero on an abs_value
  // band whose min is negative (e.g. SET-05) — there is no real "side" to match — but the ray
  // still draws at the target magnitude, which is the useful half.
  const sign = !absValue && value < 0 ? -1 : 1;
  const rad = (sign * targetMag * Math.PI) / 180;
  const dir = { x: Math.sin(rad), y: -Math.cos(rad) };

  const scale = Math.min(w, h);
  const len = scale * 0.17;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(2, w / 320);
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(O.x, O.y);
  ctx.lineTo(O.x + dir.x * len, O.y + dir.y * len);
  ctx.stroke();
  ctx.setLineDash([]);

  const lx = O.x + dir.x * (len + scale * 0.035);
  const ly = O.y + dir.y * (len + scale * 0.035);
  const text = `target ${targetMag.toFixed(0)}°`;
  const fs = Math.max(10, scale * 0.028);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  const padX = fs * 0.35, padY = fs * 0.24;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#0A0A0A";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2 - padX, ly - fs / 2 - padY, tw + padX * 2, fs + padY * 2, fs * 0.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, lx, ly);
  ctx.restore();
  return true;
}
