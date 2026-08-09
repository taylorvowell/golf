import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, CATEGORY_ORDER, scoreBand, scoreColor } from "./scoreDisplay";

/**
 * Band and colour are the two places a score becomes a claim to the golfer. The module's own
 * comment says the score and its badge must never silently disagree — that only holds if the
 * boundaries are exact, so these pin every boundary rather than sampling the middles.
 *
 * Both functions are pure and client-safe, which is why they live in `scoreDisplay.ts` rather
 * than `scoring.ts` (which reads Postgres). They port to mobile unchanged, and these tests are
 * the oracle for that port.
 */

describe("scoreBand boundaries", () => {
  const cases: [number, string][] = [
    [100, "Elite"],
    [90, "Elite"],
    [89.9, "Pure"],
    [75, "Pure"],
    [74.9, "Solid"],
    [60, "Solid"],
    [59.9, "Building"],
    [40, "Building"],
    [39.9, "Reset"],
    [0, "Reset"],
  ];

  for (const [score, band] of cases) {
    it(`${score} → ${band}`, () => {
      expect(scoreBand(score)).toBe(band);
    });
  }

  it("is inclusive at the lower edge of every band", () => {
    // The boundary belongs to the HIGHER band: 75.0 is Pure, not Solid.
    expect(scoreBand(75)).toBe("Pure");
    expect(scoreBand(74.999999)).toBe("Solid");
  });

  it("never returns undefined, even for out-of-range input", () => {
    for (const s of [-10, -0.1, 0, 100, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(typeof scoreBand(s)).toBe("string");
      expect(scoreBand(s).length).toBeGreaterThan(0);
    }
  });

  it("is monotonic — a higher score never lands in a weaker band", () => {
    const rank = ["Reset", "Building", "Solid", "Pure", "Elite"];
    let last = -1;
    for (let s = 0; s <= 100; s += 0.5) {
      const r = rank.indexOf(scoreBand(s));
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("scoreColor", () => {
  it("steps at the documented thresholds", () => {
    expect(scoreColor(0)).toBe("#8b7bff");
    expect(scoreColor(71.9)).toBe("#8b7bff");
    expect(scoreColor(72)).toBe("#6e92ff");
    expect(scoreColor(79.9)).toBe("#6e92ff");
    expect(scoreColor(80)).toBe("#5ed0ff");
    expect(scoreColor(100)).toBe("#5ed0ff");
  });

  it("always returns a valid hex colour", () => {
    for (let s = -20; s <= 120; s += 3) {
      expect(scoreColor(s)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("scoring categories", () => {
  it("order and labels stay in lockstep", () => {
    expect(CATEGORY_ORDER).toEqual(Object.keys(CATEGORY_LABELS));
    for (const key of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[key]).toBeTruthy();
    }
  });

  it("has no duplicate category keys or labels", () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
    const labels = Object.values(CATEGORY_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
