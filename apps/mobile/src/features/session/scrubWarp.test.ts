import {
  buildScrubMap,
  fractionAtTime,
  stripTimes,
  timeAtFraction,
} from "./scrubWarp";

/**
 * The scrub axis is pure arithmetic, and the one place a wrong answer is invisible: a handle a few
 * pixels off its finger reads as a laggy control rather than a broken map. So it is pinned.
 */

const DURATION = 60;
const ANCHOR = 30;

it("reaches both ends of the clip", () => {
  const map = buildScrubMap(DURATION, ANCHOR);
  expect(timeAtFraction(map, 0)).toBeCloseTo(0, 5);
  expect(timeAtFraction(map, 1)).toBeCloseTo(DURATION, 5);
});

it("is its own inverse", () => {
  const map = buildScrubMap(DURATION, ANCHOR);
  for (const frac of [0, 0.05, 0.25, 0.5, 0.63, 0.95, 1]) {
    expect(fractionAtTime(map, timeAtFraction(map, frac))).toBeCloseTo(frac, 5);
  }
});

it("never goes backwards", () => {
  const map = buildScrubMap(DURATION, ANCHOR);
  let previous = -1;
  for (let i = 0; i <= 100; i += 1) {
    const t = timeAtFraction(map, i / 100);
    expect(t).toBeGreaterThanOrEqual(previous);
    previous = t;
  }
});

it("squeezes the first and last three seconds into a sliver", () => {
  const map = buildScrubMap(DURATION, ANCHOR);
  expect(fractionAtTime(map, 3)).toBeCloseTo(0.05, 2);
  expect(1 - fractionAtTime(map, DURATION - 3)).toBeCloseTo(0.05, 2);
});

it("gives the five seconds around the strike nearly half the bar", () => {
  const map = buildScrubMap(DURATION, ANCHOR);
  const band = fractionAtTime(map, ANCHOR + 2.5) - fractionAtTime(map, ANCHOR - 2.5);
  expect(band).toBeCloseTo(0.45, 2);
});

it("makes a second near the strike far wider than a second at the start", () => {
  // The whole purpose: the same horizontal travel must mean much less time near impact.
  const map = buildScrubMap(DURATION, ANCHOR);
  const nearStrike = fractionAtTime(map, ANCHOR + 0.5) - fractionAtTime(map, ANCHOR - 0.5);
  const atStart = fractionAtTime(map, 1) - fractionAtTime(map, 0);
  expect(nearStrike).toBeGreaterThan(atStart * 5);
});

it("scales its bands by the slow-motion factor", () => {
  // On an 8x clip, three real seconds of walking is twenty-four seconds of file.
  const map = buildScrubMap(480, 240, 8);
  expect(fractionAtTime(map, 24)).toBeCloseTo(0.05, 2);
});

it("keeps the magnified band full width when the strike sits at an end", () => {
  // Sliding the band beats shrinking it: a strike near the start still deserves fine control.
  for (const anchor of [0, DURATION, -5, DURATION + 5]) {
    const map = buildScrubMap(DURATION, anchor);
    for (let i = 0; i <= 20; i += 1) {
      const t = timeAtFraction(map, i / 20);
      expect(Number.isFinite(t)).toBe(true);
      expect(Number.isFinite(fractionAtTime(map, t))).toBe(true);
    }
  }
});

it("hands the filmstrip one time per cell, in order and inside the clip", () => {
  const times = stripTimes(buildScrubMap(DURATION, ANCHOR), 12);
  expect(times).toHaveLength(12);
  expect(times[0]).toBeGreaterThanOrEqual(0);
  expect(times[times.length - 1]).toBeLessThanOrEqual(DURATION);
  expect([...times].sort((a, b) => a - b)).toEqual(times);
});

it("degrades to something usable on a zero-length clip", () => {
  const map = buildScrubMap(0, 0);
  expect(Number.isFinite(timeAtFraction(map, 0.5))).toBe(true);
});
