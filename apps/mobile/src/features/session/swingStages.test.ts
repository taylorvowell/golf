import {
  BACKSWING_SEC,
  DOWNSWING_SEC,
  THROUGH_SEC,
  swingStages,
} from "./swingStages";

const CLIP = 30;

describe("swingStages", () => {
  it("hangs the three parts off the mark, in order, with contact on the downswing/through seam", () => {
    const bands = swingStages(10, CLIP);
    expect(bands.map((b) => b.key)).toEqual(["backswing", "downswing", "through"]);

    const [back, down, through] = bands;
    expect(back.toSec).toBeCloseTo(down.fromSec);
    // The mark IS the boundary the golfer is placing — if these ever drift apart, the handle
    // stops sitting on the moment the shape says contact happened.
    expect(down.toSec).toBeCloseTo(10);
    expect(through.fromSec).toBeCloseTo(10);
  });

  it("uses the nominal durations, not a share of the clip", () => {
    const [back, down, through] = swingStages(10, CLIP);
    expect(back.toSec - back.fromSec).toBeCloseTo(BACKSWING_SEC);
    expect(down.toSec - down.fromSec).toBeCloseTo(DOWNSWING_SEC);
    expect(through.toSec - through.fromSec).toBeCloseTo(THROUGH_SEC);
  });

  it("scales every duration by the slow-motion factor", () => {
    // The trap this pins: a phone slow-motion clip's timeline runs eight times slower than the
    // world, so a template written in real seconds and applied unscaled covers an eighth of the
    // swing — the whole shape collapses inside what is actually the downswing. The same bug has
    // already been fixed once on this screen for the save window.
    const [back] = swingStages(10, CLIP, 8);
    expect(back.toSec - back.fromSec).toBeCloseTo(BACKSWING_SEC * 8);
  });

  it("clips to the clip rather than running off the front", () => {
    const bands = swingStages(0.1, CLIP);
    expect(Math.min(...bands.map((b) => b.fromSec))).toBeGreaterThanOrEqual(0);
    // A mark right at the start legitimately has no room for a backswing. Dropping the band is
    // the honest answer; a zero-width one would still take its place in the row.
    expect(bands.map((b) => b.key)).not.toContain("backswing");
  });

  it("drops bands that would run off the end", () => {
    const bands = swingStages(CLIP, CLIP);
    expect(Math.max(...bands.map((b) => b.toSec))).toBeLessThanOrEqual(CLIP);
    expect(bands.map((b) => b.key)).not.toContain("through");
  });
});
