import { activeBand, phaseBands } from "./phaseBands";
import { makeAnalysis } from "./overlay/__fixtures__/analysis";

/**
 * The strip is drawn to scale in time, so everything that can be wrong about it is arithmetic.
 *
 * Two properties carry the whole thing and are asserted first: the bands **tile the window with no
 * gap and no overlap**, and each band's width **is its duration**. Break either and the strip is
 * still a plausible-looking row of coloured blocks — which is exactly the failure mode this project
 * keeps meeting, a wrong answer that looks healthy.
 *
 * The fixture's events are address 2, top 12, impact 18, finish 26, in a window of 4–30.
 */

const WINDOW = { first: 4, last: 30 };

it("has nothing to draw without an artifact", () => {
  expect(phaseBands(null, undefined, WINDOW)).toEqual([]);
});

it("has nothing to draw when the analyzer could not find the events", () => {
  // Empty rather than approximate. A strip that guessed at the top of the backswing would be a
  // confident wrong answer drawn to scale, next to a picture that disagrees with it.
  expect(phaseBands(makeAnalysis({ events: false }), undefined, WINDOW)).toEqual([]);
});

it("tiles the window exactly — no gap, no overlap, no reordering", () => {
  const bands = phaseBands(makeAnalysis(), undefined, WINDOW);
  expect(bands.length).toBeGreaterThan(0);
  expect(bands[0].from).toBe(WINDOW.first);
  expect(bands[bands.length - 1].to).toBe(WINDOW.last);
  for (let i = 1; i < bands.length; i++) expect(bands[i].from).toBe(bands[i - 1].to);
});

it("makes a band's width its duration", () => {
  const bands = phaseBands(makeAnalysis(), undefined, WINDOW);
  const by = Object.fromEntries(bands.map((b) => [b.key, b.to - b.from]));
  // address 2 is before the window opens, so the backswing starts where the window does.
  expect(by.backswing).toBe(12 - 4);
  expect(by.downswing).toBe(18 - 12);
  expect(by.through).toBe(26 - 18);
  expect(by.runout).toBe(30 - 26);
});

it("moves a boundary when a golfer has corrected one", () => {
  // Correcting "start of downswing" has to move the band edge with it, or pinning the top of the
  // backswing does nothing visible and the control reads as broken.
  const bands = phaseBands(makeAnalysis(), { downswing_start: 15 }, WINDOW);
  const backswing = bands.find((b) => b.key === "backswing");
  const downswing = bands.find((b) => b.key === "downswing");
  expect(backswing?.to).toBe(15);
  expect(downswing?.from).toBe(15);
});

it("drops a phase of zero length rather than drawing a band of nothing", () => {
  // Impact and the finish legitimately land on the same frame on a fast swing. A zero-width band
  // is not a fault, and it must not take a share of the row.
  const bands = phaseBands(makeAnalysis(), { impact: 26 }, WINDOW);
  expect(bands.some((b) => b.key === "through")).toBe(false);
  for (const b of bands) expect(b.to).toBeGreaterThan(b.from);
});

it("holds every boundary inside the window", () => {
  // A hand correction dragged past the run-out, or a window recomputed after the fact. A negative
  // width renders as a band of zero and silently drops that phase off the strip.
  const bands = phaseBands(makeAnalysis(), { finish_start: 999 }, WINDOW);
  for (const b of bands) {
    expect(b.from).toBeGreaterThanOrEqual(WINDOW.first);
    expect(b.to).toBeLessThanOrEqual(WINDOW.last);
  }
});

it("gives the backswing and downswing the colours their trace is drawn in", () => {
  // The band under the playhead and the line over the golfer have to be visibly the same thing.
  const bands = phaseBands(makeAnalysis(), undefined, WINDOW);
  expect(bands.find((b) => b.key === "backswing")?.color).toBe("#0E7490");
  expect(bands.find((b) => b.key === "downswing")?.color).toBe("#3FFFF5");
});

describe("activeBand", () => {
  const bands = phaseBands(makeAnalysis(), undefined, WINDOW);

  it("finds the band the playhead is standing in", () => {
    expect(bands[activeBand(bands, 13)].key).toBe("downswing");
  });

  it("puts a boundary frame in the band it STARTS, not the one it ends", () => {
    // Frame 12 is the top of the backswing. The downswing starts there; showing the backswing lit
    // at the top would light the wrong phase on the one frame everyone scrubs to.
    expect(bands[activeBand(bands, 12)].key).toBe("downswing");
  });

  it("reports no band at all outside the window", () => {
    expect(activeBand(bands, 999)).toBe(-1);
  });
});
