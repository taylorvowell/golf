import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMOOTHING,
  SMOOTHING_OPTIONS,
  smoothPath,
  type Pt,
  type SmoothingKey,
} from "./traceSmoothing";

/**
 * These pin the rules the trace is *documented* to obey, not the numbers it currently produces.
 *
 * The distinction matters because this logic is about to be re-expressed on a mobile client.
 * A golden snapshot of coordinates would lock in one implementation; these assertions describe
 * behaviour a second implementation must also satisfy, so they survive the port and can be
 * pointed at it.
 *
 * The load-bearing rule is endpoint exactness: every method must leave the first and last point
 * untouched, because the head of the drawn line has to land on the playhead. Nine methods ship
 * and none of them had a test proving it.
 */

const ALL_METHODS: SmoothingKey[] = SMOOTHING_OPTIONS.map((o) => o.key);

/** A curved, noisy path roughly the shape of a club-head arc — not a straight line. */
function arcWithNoise(n = 60): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI;
    const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5; // deterministic pseudo-noise
    pts.push([0.5 + Math.cos(t) * 0.4 + jitter * 0.004, 0.5 - Math.sin(t) * 0.3 + jitter * 0.004]);
  }
  return pts;
}

describe("smoothing options", () => {
  it("exposes the nine documented methods and defaults to Savitzky-Golay", () => {
    expect(ALL_METHODS).toHaveLength(9);
    expect(new Set(ALL_METHODS).size).toBe(9);
    expect(DEFAULT_SMOOTHING).toBe("savgol");
    expect(ALL_METHODS).toContain(DEFAULT_SMOOTHING);
  });

  it("gives every option a label so the overlay menu can render it", () => {
    for (const o of SMOOTHING_OPTIONS) {
      expect(o.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("endpoint exactness — the rule the drawn head depends on", () => {
  const pts = arcWithNoise();

  /**
   * Exact to within floating-point round-trip, not bit-identical.
   *
   * Catmull-Rom, Gaussian and Savitzky-Golay recompute the terminal points rather than copying
   * them, so they land ~1e-17 away. In normalized 0–1 coordinates that is roughly 1e-13 pixels
   * on a 4K canvas — far below anything renderable, and far below the tolerance that matters.
   * A test demanding bit-equality would fail for a reason no user could ever observe, so this
   * asserts the property that is actually load-bearing: the head of the line lands on the
   * playhead to well within a pixel.
   */
  const EPS = 1e-9;

  for (const method of ALL_METHODS) {
    it(`${method} leaves the first and last point where they were`, () => {
      const out = smoothPath(pts, method);
      expect(out.length).toBeGreaterThan(0);
      expect(out[0][0]).toBeCloseTo(pts[0][0], 9);
      expect(out[0][1]).toBeCloseTo(pts[0][1], 9);
      expect(out[out.length - 1][0]).toBeCloseTo(pts[pts.length - 1][0], 9);
      expect(out[out.length - 1][1]).toBeCloseTo(pts[pts.length - 1][1], 9);
      expect(Math.abs(out[0][0] - pts[0][0])).toBeLessThan(EPS);
    });
  }
});

describe("degenerate input is returned untouched", () => {
  for (const method of ALL_METHODS) {
    it(`${method} passes through paths shorter than three points`, () => {
      const two: Pt[] = [
        [0.1, 0.2],
        [0.3, 0.4],
      ];
      expect(smoothPath(two, method)).toEqual(two);
      expect(smoothPath([], method)).toEqual([]);
    });
  }

  it("'off' is identity even on a long path", () => {
    const pts = arcWithNoise();
    expect(smoothPath(pts, "off")).toEqual(pts);
  });
});

describe("smoothing actually smooths", () => {
  /**
   * Resample to a fixed vertex count along arc length before measuring.
   *
   * Without this the comparison is meaningless: the interpolating methods (Chaikin,
   * Catmull-Rom, arc-length) *subdivide*, so a visually smoother curve carries more vertices
   * and accumulates more total turning than the jagged original. Comparing at a common vertex
   * count measures shape rather than point density.
   */
  function resample(pts: Pt[], n: number): Pt[] {
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      seg.push(seg[i - 1] + Math.hypot(dx, dy));
    }
    const total = seg[seg.length - 1];
    if (total === 0) return pts.slice(0, n);
    const out: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const target = (k / (n - 1)) * total;
      let i = 1;
      while (i < seg.length - 1 && seg[i] < target) i++;
      const span = seg[i] - seg[i - 1] || 1;
      const t = (target - seg[i - 1]) / span;
      out.push([
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ]);
    }
    return out;
  }

  /** Mean absolute turn per vertex, at a fixed vertex count — scale- and density-free. */
  function roughness(pts: Pt[]): number {
    const r = resample(pts, 64);
    let total = 0;
    for (let i = 2; i < r.length; i++) {
      const da = Math.atan2(r[i - 1][1] - r[i - 2][1], r[i - 1][0] - r[i - 2][0]);
      const db = Math.atan2(r[i][1] - r[i - 1][1], r[i][0] - r[i - 1][0]);
      let d = db - da;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += Math.abs(d);
    }
    return total / Math.max(1, r.length - 2);
  }

  const noisy = arcWithNoise();
  const baseline = roughness(noisy);

  /**
   * The two families behave differently on purpose, and conflating them is a real modelling
   * error — writing this test surfaced it.
   *
   * INTERPOLATING methods (Chaikin, Catmull-Rom, arc-length) pass through or very near every
   * measured sample. They *cannot* remove noise, because the noise is in the samples they are
   * required to honour; their job is to make the polyline continuous. Catmull-Rom in particular
   * adds curvature between samples and so measures very slightly rougher than the raw polyline.
   *
   * APPROXIMATING and FITTING methods (Gaussian, Savitzky-Golay, least-squares fit) are the
   * ones allowed to move the line off the samples, and therefore the only ones that must
   * actually reduce noise.
   */
  const FILTERS: SmoothingKey[] = ["gaussian", "gaussianStrong", "savgol", "fit"];
  const INTERPOLATORS: SmoothingKey[] = ["chaikin", "chaikinHeavy", "catmull", "arclen"];

  for (const method of FILTERS) {
    it(`${method} (approximating) measurably reduces noise`, () => {
      expect(roughness(smoothPath(noisy, method))).toBeLessThan(baseline);
    });
  }

  for (const method of INTERPOLATORS) {
    it(`${method} (interpolating) stays faithful to the samples rather than filtering`, () => {
      // Not required to reduce roughness — required not to wander off the measured path.
      const out = smoothPath(noisy, method);
      for (const p of noisy) {
        const nearest = Math.min(...out.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
        expect(nearest).toBeLessThan(0.02);
      }
    });
  }

  it("covers every shipped method across the two families", () => {
    expect([...FILTERS, ...INTERPOLATORS].sort()).toEqual(
      ALL_METHODS.filter((m) => m !== "off").sort(),
    );
  });
});

describe("output stays finite and in-frame", () => {
  const pts = arcWithNoise();

  for (const method of ALL_METHODS) {
    it(`${method} emits only finite coordinates`, () => {
      for (const [x, y] of smoothPath(pts, method)) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    });
  }

  it("does not wildly overshoot the input's bounding box", () => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 0.05;
    const [lo, hi] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
    const [lo2, hi2] = [Math.min(...ys) - pad, Math.max(...ys) + pad];

    for (const method of ALL_METHODS) {
      for (const [x, y] of smoothPath(pts, method)) {
        expect(x).toBeGreaterThanOrEqual(lo);
        expect(x).toBeLessThanOrEqual(hi);
        expect(y).toBeGreaterThanOrEqual(lo2);
        expect(y).toBeLessThanOrEqual(hi2);
      }
    }
  });
});

describe("determinism", () => {
  it("is a pure function — same input, same output", () => {
    const pts = arcWithNoise();
    for (const method of ALL_METHODS) {
      expect(smoothPath(pts, method)).toEqual(smoothPath(pts, method));
    }
  });

  it("does not mutate its input", () => {
    const pts = arcWithNoise();
    const before = JSON.stringify(pts);
    for (const method of ALL_METHODS) smoothPath(pts, method);
    expect(JSON.stringify(pts)).toBe(before);
  });
});
