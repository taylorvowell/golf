/**
 * COPIED VERBATIM from `apps/web/src/lib/traceSmoothing.ts`. Do not edit one copy alone.
 *
 * Duplicated rather than shared because the only workspace package a phone build already
 * resolves is `@swingsage/schema`, and adding a second one means Metro resolution and a native
 * rebuild to move pure array math. The trigger to un-duplicate is the THIRD consumer, or the
 * first time the two copies are found to have diverged — see D51.
 */
/**
 * How the club-head trace is turned from a list of samples into a drawn curve.
 *
 * The samples are honest and jagged. They come from a detector firing on a small, fast, often
 * blurred object, at uneven spacing — a 30fps source normalised to 60fps CFR clusters them in
 * pairs — so joining them directly gives a line with visible corners and micro-wobble even
 * where every individual point is correct. Smoothing trades agreement with those samples for a
 * curve that reads as a swing.
 *
 * **That trade is the point, and it is deliberate.** These are render-time only: nothing here
 * touches `analysis.json`, the per-frame club, or any measurement. `scripts/checktrace.py`
 * still reports fidelity against the unsmoothed points, so how much a method moves the line off
 * the measured heads stays visible rather than being hidden by how good it looks.
 *
 * Two invariants every method keeps, because the player depends on them:
 *
 *  1. **Endpoints are exact.** The last drawn point is the head of the line, and with "trace
 *     follows the frame" on it has been interpolated onto the playhead so it sits on the club
 *. A filter that pulled it off would put back the lag the endpoint-exact rule removed, so
 *     the approximating methods below blend back to the true ends.
 *  2. **Bridges are never smoothed.** A span with no measurement behind it is drawn as the
 *     straight dashed chord it is; curving it would dress a gap up as data.
 *
 * Methods are grouped by what they do to the samples:
 *   *interpolating* — the curve passes through every sample (corner cutting, Catmull-Rom)
 *   *approximating* — the curve passes near them (Gaussian, Savitzky-Golay)
 *   *fitting*       — the curve ignores them individually and models the whole path (curve fit)
 */

export type Pt = [number, number];

export type SmoothingKey =
  | "off"
  | "chaikin"
  | "chaikinHeavy"
  | "catmull"
  | "arclen"
  | "gaussian"
  | "gaussianStrong"
  | "savgol"
  | "fit";

/**
 * Savitzky-Golay, not the corner cutting this shipped with.
 *
 * Corner cutting subdivides but does not filter: it rounds the joints between samples and
 * leaves the sample-to-sample noise underneath, so the line still crawls. Measured against the
 * detector's own heads on `perfect`, going from corner cutting to Savitzky-Golay moves the drawn
 * curve a median of 0.3px and 1.6px at p90 — 0.3% of body height — for a visibly continuous
 * path. It is also the one strong filter that does not cut the corner at Top, which is the one
 * place a golf trace has real curvature worth keeping, and it is what the analyzer already uses
 * on the pose series for exactly that reason (the pose spec).
 *
 * `gaussianStrong` and `fit` are smoother still and are one click away.
 */
export const DEFAULT_SMOOTHING: SmoothingKey = "savgol";

export interface SmoothingOption {
  key: SmoothingKey;
  label: string;
  /** One line on what it does to the measurements. */
  hint: string;
  /** How far it is allowed to move the line off the samples, for the menu's ordering. */
  strength: "none" | "light" | "medium" | "strong" | "max";
}

export const SMOOTHING_OPTIONS: SmoothingOption[] = [
  { key: "off", label: "Off — raw samples", strength: "none",
    hint: "the measured points, joined. every corner is real" },
  { key: "chaikin", label: "Corner cutting", strength: "light",
    hint: "Chaikin subdivision — passes near every point, no overshoot" },
  { key: "chaikinHeavy", label: "Corner cutting — heavy", strength: "medium",
    hint: "pre-averaged, then cut four times. rounder through the transition" },
  { key: "catmull", label: "Catmull-Rom spline", strength: "light",
    hint: "a true curve THROUGH every sample. fluid without giving up fidelity" },
  { key: "arclen", label: "Arc-length resample + spline", strength: "medium",
    hint: "evens out sample spacing first — kills the wobble 30→60fps duplication causes" },
  { key: "gaussian", label: "Gaussian along the path", strength: "medium",
    hint: "blurs the samples. corners pull inward, motion reads continuous" },
  { key: "gaussianStrong", label: "Gaussian — strong", strength: "strong",
    hint: "the same, heavier. very fluid; visibly inside the real arc at the top" },
  { key: "savgol", label: "Savitzky-Golay", strength: "strong",
    hint: "local quadratic fit — as smooth as Gaussian but keeps the curvature at Top" },
  { key: "fit", label: "Curve fit — maximum fluidity", strength: "max",
    hint: "models the whole segment as one smooth arc. ignores individual samples" },
];

/* ------------------------------------------------------------------ helpers */

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Blend `out` back to `src` over the first and last `ramp` samples, so the ends stay exact. */
function anchorEnds(out: Pt[], src: Pt[], ramp: number): Pt[] {
  const n = out.length;
  if (n < 3) return src.slice();
  const k = Math.max(1, Math.min(ramp, Math.floor(n / 2) - 1));
  const res = out.slice() as Pt[];
  for (let i = 0; i < k; i++) {
    const u = i / k;                       // 0 at the very end -> 1 once clear of it
    res[i] = [lerp(src[i][0], out[i][0], u), lerp(src[i][1], out[i][1], u)];
    const j = n - 1 - i;
    res[j] = [lerp(src[j][0], out[j][0], u), lerp(src[j][1], out[j][1], u)];
  }
  res[0] = src[0];
  res[n - 1] = src[n - 1];
  return res;
}

/**
 * Chaikin corner cutting: replace every interior corner with two points a quarter and three
 * quarters along its edges, keeping the endpoints. Converges on a quadratic B-spline and never
 * overshoots its input, which a spline fit through noisy detections would.
 */
function chaikin(src: Pt[], passes: number): Pt[] {
  let cur = src;
  for (let p = 0; p < passes && cur.length >= 3; p++) {
    const next: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [x0, y0] = cur[i], [x1, y1] = cur[i + 1];
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** One pass of 3-tap averaging over the control polygon, endpoints fixed. */
function preAverage(src: Pt[]): Pt[] {
  if (src.length < 3) return src;
  const out: Pt[] = [src[0]];
  for (let i = 1; i < src.length - 1; i++) {
    out.push([(src[i - 1][0] + 2 * src[i][0] + src[i + 1][0]) / 4,
              (src[i - 1][1] + 2 * src[i][1] + src[i + 1][1]) / 4]);
  }
  out.push(src[src.length - 1]);
  return out;
}

/**
 * Centripetal Catmull-Rom. `alpha = 0.5` rather than the uniform 0, because uniform
 * parameterisation cusps and self-intersects exactly where samples bunch up — which on this
 * data is every duplicated frame pair.
 */
function catmullRom(src: Pt[], perSpan = 8): Pt[] {
  const n = src.length;
  if (n < 3) return src.slice();
  const P = [src[0], ...src, src[n - 1]];
  const out: Pt[] = [src[0]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const d = (a: Pt, b: Pt) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-6;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let s = 1; s <= perSpan; s++) {
      const t = lerp(t1, t2, s / perSpan);
      const a1: Pt = [((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0),
                      ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0)];
      const a2: Pt = [((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1),
                      ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1)];
      const a3: Pt = [((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2),
                      ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2)];
      const b1: Pt = [((t2 - t) * a1[0] + (t - t0) * a2[0]) / (t2 - t0),
                      ((t2 - t) * a1[1] + (t - t0) * a2[1]) / (t2 - t0)];
      const b2: Pt = [((t3 - t) * a2[0] + (t - t1) * a3[0]) / (t3 - t1),
                      ((t3 - t) * a2[1] + (t - t1) * a3[1]) / (t3 - t1)];
      out.push([((t2 - t) * b1[0] + (t - t1) * b2[0]) / (t2 - t1),
                ((t2 - t) * b1[1] + (t - t1) * b2[1]) / (t2 - t1)]);
    }
  }
  return out;
}

/** Resample a polyline at uniform arc-length steps. Endpoints preserved exactly. */
function resampleByArcLength(src: Pt[], count: number): Pt[] {
  const n = src.length;
  if (n < 3) return src.slice();
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
  }
  const total = cum[n - 1];
  if (total < 1e-6) return src.slice();
  const out: Pt[] = [src[0]];
  let j = 1;
  for (let k = 1; k < count - 1; k++) {
    const want = (total * k) / (count - 1);
    while (j < n - 1 && cum[j] < want) j++;
    const span = cum[j] - cum[j - 1] || 1e-6;
    const u = (want - cum[j - 1]) / span;
    out.push([lerp(src[j - 1][0], src[j][0], u), lerp(src[j - 1][1], src[j][1], u)]);
  }
  out.push(src[n - 1]);
  return out;
}

/** Symmetric 1-D convolution with edge-reflected padding. */
function convolve(src: Pt[], kernel: number[]): Pt[] {
  const n = src.length, h = (kernel.length - 1) / 2;
  const at = (i: number) => src[Math.min(n - 1, Math.max(0, i))];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let k = -h; k <= h; k++) {
      const w = kernel[k + h], p = at(i + k);
      x += w * p[0];
      y += w * p[1];
    }
    out.push([x, y]);
  }
  return out;
}

function gaussianKernel(sigma: number): number[] {
  const h = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -h; i <= h; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  return k.map((v) => v / sum);
}

/**
 * Savitzky-Golay smoothing coefficients for a quadratic fit over a window of `m = 2h+1`.
 * Closed form rather than solving the normal equations per call — it is the standard result,
 * and the analyzer uses the same filter on the pose series for the same reason (the pose spec):
 * it removes noise without flattening a real peak, which here is the corner at Top.
 */
function savgolKernel(m: number): number[] {
  const h = (m - 1) / 2;
  const denom = 4 * m * (m * m - 4);
  const k: number[] = [];
  for (let i = -h; i <= h; i++) k.push((3 * (3 * m * m - 7 - 20 * i * i)) / denom);
  return k;
}

/**
 * Least-squares polynomial fit of x and y against normalised arc length.
 *
 * This is the "fluid even if it is not on the club head" end of the range: the curve models the
 * whole segment at once and no individual sample can put a kink in it. Degree 5 keeps a golf
 * swing's actual shape — a long arc with one reversal — while discarding everything finer.
 * Solved by normal equations with partial pivoting; the matrix is 6×6 over t in [0,1], which is
 * well within float64 even though the monomial basis is poorly conditioned in general.
 */
function polyFit(src: Pt[], degree = 5): Pt[] {
  const n = src.length;
  if (n < degree + 2) return src.slice();
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
  }
  const total = cum[n - 1];
  if (total < 1e-6) return src.slice();
  const t = cum.map((c) => c / total);

  const m = degree + 1;
  const ata: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const atx = new Array(m).fill(0);
  const aty = new Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    const pow = [1];
    for (let d = 1; d < m; d++) pow.push(pow[d - 1] * t[i]);
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) ata[r][c] += pow[r] * pow[c];
      atx[r] += pow[r] * src[i][0];
      aty[r] += pow[r] * src[i][1];
    }
  }
  const cx = solve(ata.map((r) => r.slice()), atx.slice());
  const cy = solve(ata.map((r) => r.slice()), aty.slice());
  if (!cx || !cy) return src.slice();

  const evalAt = (co: number[], u: number) => {
    let v = 0;
    for (let d = co.length - 1; d >= 0; d--) v = v * u + co[d];
    return v;
  };
  const out: Pt[] = [];
  const steps = Math.max(48, Math.min(240, n * 3));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    out.push([evalAt(cx, u), evalAt(cy, u)]);
  }
  // Ends exact: resample the source onto the same parameterisation so the ramp has something
  // to blend against point-for-point.
  return anchorEnds(out, resampleByArcLength(src, out.length), Math.round(out.length * 0.12));
}

/** Gaussian elimination with partial pivoting. Returns null if the system is singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/* ------------------------------------------------------- the finished path */

/** A stretch of the finished curve: either measured path, or a bridge across a gap. */
export interface TracePiece {
  /** Smoothed polyline, in whatever space the samples were given in. */
  pts: Pt[];
  /** The frame each point sits at. Same length as `pts`, non-decreasing. */
  frames: number[];
  /** Nothing was measured across this piece — drawn as a dashed straight chord, never curved. */
  bridge: boolean;
}

/** A frame step larger than this is a gap. See SwingStage / checktrace.py — must agree. */
export const BRIDGE_STEP = 3;

/**
 * Put a frame on every point of a *smoothed* curve, by matching it back to the samples it came
 * from.
 *
 * A smoothing filter does not return one output point per input sample — Catmull-Rom emits eight
 * per span, the curve fit emits a fixed budget, corner cutting doubles — so after smoothing there
 * is no index arithmetic that recovers "which frame is this point". Without that mapping the
 * finished curve cannot be revealed frame by frame, which is the whole point of building it.
 *
 * So: walk the samples in order, and for each one find the nearest point on the smoothed curve,
 * searching only *forward* from the previous match. Forward-only is what makes the result
 * monotonic by construction — a path that doubles back on itself (every golf swing does, at the
 * top) would otherwise match a later sample to an earlier point and run the playhead backwards.
 * Frames between two matched points are interpolated.
 */
function assignFrames(sm: Pt[], raw: Pt[], rawFrames: number[]): number[] {
  const n = sm.length, m = raw.length;
  const out = new Array<number>(n).fill(rawFrames[0]);
  if (n === 0) return out;
  if (m < 2) return out.fill(rawFrames[0] ?? 0);

  const idx = new Array<number>(m);
  idx[0] = 0;
  idx[m - 1] = n - 1;
  let cur = 0;
  for (let j = 1; j < m - 1; j++) {
    let best = cur, bestD = Infinity;
    for (let i = cur; i < n; i++) {
      const dx = sm[i][0] - raw[j][0], dy = sm[i][1] - raw[j][1];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    idx[j] = Math.min(best, n - 1);
    cur = idx[j];
  }

  for (let j = 0; j < m - 1; j++) {
    const a = idx[j], b = idx[j + 1];
    const fa = rawFrames[j], fb = rawFrames[j + 1];
    if (b <= a) { out[a] = Math.max(out[a], fb); continue; }
    for (let i = a; i <= b; i++) out[i] = fa + ((fb - fa) * (i - a)) / (b - a);
  }
  out[n - 1] = rawFrames[m - 1];
  for (let i = 1; i < n; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out;
}

/**
 * Build the finished, smoothed path for one trace segment, once.
 *
 * This exists because smoothing the *visible* prefix is wrong. If the filter runs on however
 * much of the path has been revealed so far, its window grows as frames arrive and the curve
 * already on screen keeps changing shape underneath — the first frames of a segment come out
 * barely smoothed (there is nothing to smooth them against yet) and then settle as more points
 * land. Building the whole segment first and revealing it means what you see while scrubbing is
 * exactly the final path, and every frame of it is stable.
 *
 * Work in a resolution-independent space (video pixels, not canvas pixels) so the result can be
 * cached across resizes and only recomputed when the samples or the method actually change.
 */
export function buildTracePath(
  pts: Pt[], frames: number[], method: SmoothingKey,
): TracePiece[] {
  if (pts.length < 2 || frames.length !== pts.length) return [];

  // Collapse consecutive duplicates. A 30fps source normalised to 60fps CFR repeats every
  // frame, so half of these are exact copies of their predecessor; a duplicate has no direction
  // and puts a kink in anything that reads a tangent. The FIRST frame of each run is kept —
  // the position is identical either way, so growth is unaffected.
  const dp: Pt[] = [], df: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const last = dp[dp.length - 1];
    if (last && Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) <= 0.25) continue;
    dp.push(pts[i]);
    df.push(frames[i]);
  }
  if (dp.length < 2) return [];

  const out: TracePiece[] = [];
  let run: Pt[] = [], runF: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const sm = smoothPath(run, method);
      out.push({ pts: sm, frames: assignFrames(sm, run, runF), bridge: false });
    } else if (run.length === 1) {
      out.push({ pts: run.slice(), frames: runF.slice(), bridge: false });
    }
    run = []; runF = [];
  };

  for (let i = 0; i < dp.length; i++) {
    run.push(dp[i]);
    runF.push(df[i]);
    if (i + 1 >= dp.length) break;
    if (df[i + 1] - df[i] <= BRIDGE_STEP) continue;
    flush();
    out.push({ pts: [dp[i], dp[i + 1]], frames: [df[i], df[i + 1]], bridge: true });
  }
  flush();
  return out.filter((p) => p.pts.length >= 2);
}

/**
 * The part of a finished piece up to `frame`, with its last point interpolated to sit exactly on
 * the playhead. Returns null when the piece has not started yet.
 *
 * Cutting the finished curve rather than smoothing a cut one is the difference this whole file's
 * `buildTracePath` exists for; this is the cheap half that runs every frame.
 */
export function cutAt(piece: TracePiece, frame: number): Pt[] | null {
  const { pts, frames } = piece;
  if (frames[0] > frame) return null;
  if (frames[frames.length - 1] <= frame) return pts;
  let k = 0;
  while (k < frames.length && frames[k] <= frame) k++;
  const head = pts.slice(0, k);
  const prev = frames[k - 1], next = frames[k];
  if (next > prev && frame > prev) {
    const u = (frame - prev) / (next - prev);
    head.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u,
               pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u]);
  }
  return head.length >= 2 ? head : null;
}

/* --------------------------------------------------------------------- api */

/**
 * Smooth one solid run of the trace, in screen pixels.
 *
 * `pts` must already be de-duplicated and must be a single measured run — callers split at
 * bridges first, because a bridge is a straight chord over frames nothing measured and curving
 * it would present a gap as data.
 */
export function smoothPath(pts: Pt[], method: SmoothingKey): Pt[] {
  if (pts.length < 3 || method === "off") return pts;

  // How dense the input already is decides how much subdivision is worth doing: past roughly
  // one sample per two pixels, more points only cost draw time.
  const dense = pts.length > 200 ? 1 : pts.length > 80 ? 2 : 3;

  switch (method) {
    case "chaikin":
      return chaikin(pts, dense);

    case "chaikinHeavy":
      return chaikin(preAverage(preAverage(pts)), Math.max(3, dense + 1));

    case "catmull":
      return catmullRom(pts, pts.length > 120 ? 4 : 8);

    case "arclen": {
      // Even spacing first. The samples arrive clustered — duplicated frames put two points on
      // top of each other and fast frames leave long jumps — and every filter after this one
      // weights by sample index, so uneven spacing IS the wobble.
      const even = resampleByArcLength(pts, Math.max(24, Math.min(200, pts.length * 2)));
      return catmullRom(even, 4);
    }

    case "gaussian":
    case "gaussianStrong": {
      const sigma = method === "gaussian"
        ? Math.max(1.2, pts.length / 60)
        : Math.max(2.5, pts.length / 22);
      const even = resampleByArcLength(pts, Math.max(24, Math.min(220, pts.length * 2)));
      const blurred = convolve(even, gaussianKernel(sigma));
      return catmullRom(anchorEnds(blurred, even, Math.ceil(sigma * 2)), 3);
    }

    case "savgol": {
      // Window scales with the run so a long backswing and a short downswing get comparable
      // treatment; kept odd and at least 5, which is where a quadratic fit starts to mean
      // anything.
      const even = resampleByArcLength(pts, Math.max(24, Math.min(220, pts.length * 2)));
      let m = Math.round(even.length / 7);
      m = Math.max(5, m % 2 ? m : m + 1);
      if (m > even.length - 2) m = Math.max(5, (even.length - 3) | 1);
      const fitted = convolve(even, savgolKernel(m));
      return catmullRom(anchorEnds(fitted, even, Math.ceil(m / 2)), 3);
    }

    case "fit":
      return polyFit(pts, 5);

    default:
      return chaikin(pts, dense);
  }
}
