import { arcSegments, dashSegments, polylineSegments, shortestSweep, simplify, unit } from "./paths";
import type { Pt } from "./paths";

/**
 * These pin the properties the renderer's cost reduction is only allowed to have.
 *
 * `simplify` is the load-bearing one. It exists to cut the number of `View`s the trace costs, and
 * the moment it is allowed to move an endpoint it stops being a rendering optimisation and becomes
 * a change to the drawn measurement — the head of the line has to land on the playhead and the tail
 * has to reach the ball. So the tests are about bounds and endpoints, not about how many points
 * survive on a particular curve.
 */

describe("polylineSegments", () => {
  it("emits one segment per gap", () => {
    expect(polylineSegments([[0, 0], [1, 1], [2, 2]])).toHaveLength(2);
  });

  it("emits nothing for a run too short to have a direction", () => {
    expect(polylineSegments([[0, 0]])).toHaveLength(0);
    expect(polylineSegments([])).toHaveLength(0);
  });
});

describe("simplify", () => {
  it("keeps both endpoints exactly", () => {
    const pts: Pt[] = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i / 5) * 0.2]);
    const out = simplify(pts, 1);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("never moves the drawn line further than the tolerance", () => {
    const pts: Pt[] = Array.from({ length: 200 }, (_, i) => [i * 0.5, Math.sin(i / 9) * 6]);
    const tol = 0.6;
    const out = simplify(pts, tol);

    // Every discarded point must lie within `tol` of the polyline that survived it.
    for (const p of pts) {
      let best = Infinity;
      for (let i = 1; i < out.length; i++) {
        best = Math.min(best, distToSegment(p, out[i - 1], out[i]));
      }
      expect(best).toBeLessThanOrEqual(tol + 1e-9);
    }
  });

  it("collapses a straight run to its two ends", () => {
    const pts: Pt[] = Array.from({ length: 100 }, (_, i) => [i, 0]);
    expect(simplify(pts, 0.6)).toEqual([
      [0, 0],
      [99, 0],
    ]);
  });

  it("does not fold a path that doubles back on itself", () => {
    // Every golf swing does this at the top. Measuring to the infinite line rather than to the
    // segment would call the far end of the hairpin "close to the chord" and delete the turn.
    const pts: Pt[] = [
      [0, 0],
      [50, 0],
      [100, 0],
      [50, 0.1],
      [0, 0.2],
    ];
    const out = simplify(pts, 0.6);
    expect(out).toContainEqual([100, 0]);
  });

  it("is a no-op below three points or without a tolerance", () => {
    const two: Pt[] = [
      [0, 0],
      [3, 4],
    ];
    expect(simplify(two, 5)).toEqual(two);
    const many: Pt[] = [
      [0, 0],
      [1, 5],
      [2, 0],
    ];
    expect(simplify(many, 0)).toEqual(many);
  });
});

describe("dashSegments", () => {
  it("starts on the path's first point and ends inside it", () => {
    const out = dashSegments(
      [
        [0, 0],
        [100, 0],
      ],
      10,
      10,
    );
    expect(out[0].a).toEqual([0, 0]);
    for (const s of out) {
      expect(s.a[0]).toBeGreaterThanOrEqual(0);
      expect(s.b[0]).toBeLessThanOrEqual(100.000001);
    }
  });

  it("costs fewer views than the samples it dashes", () => {
    // The reason the backswing is affordable: dashing is a saving, not a surcharge.
    const dense: Pt[] = Array.from({ length: 400 }, (_, i) => [i, 0]);
    expect(dashSegments(dense, 5, 8).length).toBeLessThan(dense.length / 4);
  });

  it("draws solid rather than looping forever when the gap is zero", () => {
    const out = dashSegments(
      [
        [0, 0],
        [10, 0],
      ],
      3,
      0,
    );
    expect(out).toEqual([{ a: [0, 0], b: [10, 0] }]);
  });

  it("draws nothing for a non-positive dash", () => {
    expect(dashSegments([[0, 0], [10, 0]], 0, 5)).toHaveLength(0);
  });
});

describe("arcSegments", () => {
  it("spans exactly the sweep asked for", () => {
    const segs = arcSegments(0, 0, 10, 0, Math.PI / 2, 8);
    expect(segs).toHaveLength(8);
    expect(segs[0].a[0]).toBeCloseTo(10);
    expect(segs[0].a[1]).toBeCloseTo(0);
    expect(segs[7].b[0]).toBeCloseTo(0);
    expect(segs[7].b[1]).toBeCloseTo(10);
  });

  it("draws nothing for a zero sweep or a zero radius", () => {
    expect(arcSegments(0, 0, 10, 0, 0)).toHaveLength(0);
    expect(arcSegments(0, 0, 0, 0, 1)).toHaveLength(0);
  });
});

describe("shortestSweep", () => {
  it("takes the short way round", () => {
    // The long way would draw the reflex angle beside a label reporting its complement.
    expect(shortestSweep(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
    expect(shortestSweep(0, Math.PI / 4)).toBeCloseTo(Math.PI / 4);
  });
});

describe("unit", () => {
  it("refuses a direction it cannot know", () => {
    expect(unit(0, 0)).toBeNull();
    expect(unit(3, 4)).toEqual([0.6, 0.8]);
  });
});

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
