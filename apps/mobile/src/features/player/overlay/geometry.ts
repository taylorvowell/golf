import type { AngleField, Analysis, Keypoint, PointExpr } from "@swingsage/schema/contract";

/**
 * Where an angle lives on the body — resolved, never computed.
 *
 * Ported from `apps/web/src/lib/angleOverlay.ts`, keeping `resolve()` and `rays()` and dropping
 * every `CanvasRenderingContext2D` call, because those two are geometry and the rest was painting.
 * The **label is not produced here**: it is read from `metrics.series[frame][field]`, so what is
 * drawn and what is printed come from the same measurement. Nothing in this file derives an angle.
 *
 * That the arc matches the label is not luck. The analyzer measures in aspect-corrected space,
 * (x·W/H, y), which is pixel space under a uniform scale — and uniform scales preserve angles. So
 * the arc drawn at (x·w, y·h) is exactly the angle in the label.
 */

/**
 * Matches `metrics.MIN_CONF`. Below this the analyzer treated the point as missing, so drawing on
 * it would hang a confident-looking arc off a keypoint the number never used.
 *
 * **This is the measurement bar, not the drawing bar.** The stick figure draws anything with
 * `conf > 0`; anything that reads as a measurement — angles, orientation rods — is held here.
 * Collapsing the two is a bug in both directions: one bar either deletes the skeleton or
 * fabricates measurements.
 */
export const MIN_CONF = 0.35;

/** Distinguishable at small sizes against the skeleton's green / yellow / cyan. */
export const ANGLE_COLORS = ["#FB923C", "#F472B6", "#A78BFA", "#38BDF8", "#FACC15"];

export interface Pt {
  x: number;
  y: number;
}

type Geom = NonNullable<AngleField["geom"]>;

/** Index by NAME, from the artifact's own `keypoint_names`. No literal index is written anywhere. */
export type KeypointIndex = Record<string, number>;

export function keypointIndex(a: Analysis): KeypointIndex {
  const m: KeypointIndex = {};
  a.pose.keypoint_names.forEach((n, i) => (m[n] = i));
  return m;
}

function kp(frame: Keypoint[], idx: KeypointIndex, name: string): Pt | null {
  const i = idx[name];
  if (i === undefined) return null;
  const p = frame[i];
  return p && p[2] >= MIN_CONF ? { x: p[0], y: p[1] } : null;
}

export function resolve(
  expr: PointExpr | undefined,
  frame: Keypoint[],
  idx: KeypointIndex,
  series: Record<string, unknown> | undefined,
  clubHead: [number, number] | null,
): Pt | null {
  if (expr === undefined) return null;
  if (typeof expr === "string") return kp(frame, idx, expr);
  if ("club" in expr) return clubHead ? { x: clubHead[0], y: clubHead[1] } : null;

  if ("feet" in expr) {
    // Mean over both feet of heel + frac·(toe − heel). Averaging the two halves the noise in the
    // foot's short, foreshortened projection down the line — the weakest input to the stack
    // angles, and the reason mid-foot is published beside ball-of-foot.
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

  // A chain, optionally told which link actually answered. Head anchors are not interchangeable —
  // the nose sits forward of the ear — so when the analyzer recorded its choice for this frame,
  // draw on that point rather than re-deriving a possibly different one.
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

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

export interface Rays {
  origin: Pt;
  u: Pt;
  v: Pt;
  /** A reference direction rather than a real bone — drawn dashed, at a fixed length. */
  uDashed: boolean;
  vDashed: boolean;
  guide?: Pt;
}

/**
 * Resolve one angle into an origin and two rays, each either a real bone (solid, drawn to its true
 * endpoint) or a reference direction (dashed, fixed length).
 *
 * Returns null when any input keypoint is missing or below `MIN_CONF`, so nothing is drawn on a
 * joint the measurement itself could not see. Abstaining is the product behaviour here, not a
 * degraded one.
 */
export function rays(
  geom: Geom,
  frame: Keypoint[],
  idx: KeypointIndex,
  series: Record<string, unknown> | undefined,
  clubHead: [number, number] | null,
): Rays | null {
  const R = (e: PointExpr | undefined) => resolve(e, frame, idx, series, clubHead);

  if (geom.kind === "interior") {
    const o = R(geom.vertex),
      a = R(geom.a),
      b = R(geom.b);
    if (!o || !a || !b) return null;
    // A `_flex` field reports departure from straight, so the arc has to open from the bone's
    // *continuation* through the joint — which is also what "straight" looks like.
    const u = geom.supplement ? sub(o, a) : sub(a, o);
    return { origin: o, u, v: sub(b, o), uDashed: !!geom.supplement, vDashed: false };
  }

  if (geom.kind === "vectors") {
    const o = R(geom.at);
    const u0 = R(geom.u?.[0]),
      u1 = R(geom.u?.[1]);
    const v0 = R(geom.v?.[0]),
      v1 = R(geom.v?.[1]);
    if (!o || !u0 || !u1 || !v0 || !v1) return null;
    return { origin: o, u: sub(u1, u0), v: sub(v1, v0), uDashed: true, vDashed: true };
  }

  const o = R(geom.from),
    to = R(geom.to);
  if (!o || !to) return null;
  const ref: Pt =
    geom.kind === "vertical"
      ? { x: 0, y: -1 }
      : geom.kind === "plumb"
        ? { x: 0, y: 1 }
        : { x: 1, y: 0 };
  return {
    origin: o,
    u: sub(to, o),
    v: ref,
    uDashed: false,
    vDashed: true,
    // 90° = stacked is the thing being checked, so the plumb line is worth showing even where the
    // measurement's own reference is horizontal.
    guide: geom.guide === "plumb" ? { x: 0, y: -1 } : undefined,
  };
}

/**
 * One angle, resolved into everything the renderer needs, or null if it must abstain.
 *
 * Four independent reasons to draw nothing, and all four are real on these fixtures: the field has
 * no drawable geometry (the width-derived rotation estimates), the artifact has no value for this
 * frame, a keypoint is below `MIN_CONF`, or a ray is degenerate. A layer that guessed past any of
 * them would put a number on screen the analysis never made.
 */
export interface ResolvedAngle {
  field: string;
  label: string;
  value: number;
  origin: Pt;
  /** Unit direction in NORMALIZED space — scaled to pixels by the renderer, which knows the size. */
  u: Pt;
  v: Pt;
  uDashed: boolean;
  vDashed: boolean;
  guide?: Pt;
}

export function resolveAngle(
  spec: AngleField,
  analysis: Analysis,
  idx: KeypointIndex,
  frameNo: number,
  /** The head from the SELECTED club solution. Omitted falls back to the primary block. */
  clubHead?: [number, number] | null,
): ResolvedAngle | null {
  const geom = spec.geom;
  if (!geom) return null;
  const fr = analysis.pose.frames[frameNo];
  if (!fr) return null;

  const series = analysis.metrics?.series?.[frameNo] as Record<string, unknown> | undefined;
  const value = series?.[spec.field];
  if (typeof value !== "number") return null;

  const head =
    clubHead ?? ((analysis.club?.frames?.[frameNo]?.head ?? null) as [number, number] | null);
  const r = rays(geom, fr.kp, idx, series, head);
  if (!r) return null;

  return {
    field: spec.field,
    label: spec.label,
    value,
    origin: r.origin,
    u: r.u,
    v: r.v,
    uDashed: r.uDashed,
    vDashed: r.vDashed,
    guide: r.guide,
  };
}
