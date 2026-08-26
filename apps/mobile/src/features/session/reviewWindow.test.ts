import { PRE_ROLL_SEC, REVIEW_WINDOW_S } from "./captureConstants";
import {
  FALLBACK_FROM_END_SEC,
  pickImpactSeed,
  reviewWindowAround,
} from "./reviewWindow";

/**
 * The confirm screen plays what Save cuts, and the edit screen seeds where the confirm screen
 * looped — both promises reduce to this module giving one answer everywhere it is asked.
 */

describe("reviewWindowAround", () => {
  it("centres the window's pre-roll on the mark and spans the review width", () => {
    const w = reviewWindowAround(10, 30, 1);
    expect(w.startSec).toBeCloseTo(10 - PRE_ROLL_SEC);
    expect(w.endSec).toBeCloseTo(10 - PRE_ROLL_SEC + REVIEW_WINDOW_S);
  });

  it("clamps to the head of the clip without shrinking the far edge's anchor", () => {
    const w = reviewWindowAround(0.5, 30, 1);
    expect(w.startSec).toBe(0);
    // The span is anchored on the mark, not re-hung from the clamp — a strike half a second in
    // still gets everything after it that the window would have kept.
    expect(w.endSec).toBeCloseTo(0.5 - PRE_ROLL_SEC + REVIEW_WINDOW_S);
  });

  it("clamps to the tail of the clip", () => {
    const w = reviewWindowAround(29.5, 30, 1);
    expect(w.endSec).toBe(30);
  });

  it("scales by the slow-mo factor — a 240fps phone clip's timeline runs 8× slower", () => {
    const w = reviewWindowAround(60, 120, 8);
    // 2.5 real seconds of pre-roll is 20 FILE seconds on an 8× clip; unscaled, the window held
    // 0.6 s of actual swing and the backswing was missing (Taylor, 2026-08-22).
    expect(w.startSec).toBeCloseTo(60 - PRE_ROLL_SEC * 8);
    expect(w.endSec).toBeCloseTo(60 - PRE_ROLL_SEC * 8 + REVIEW_WINDOW_S * 8);
  });
});

describe("pickImpactSeed", () => {
  it("takes the last plausible strike, not the loudest — the practice swing comes first", () => {
    const seed = pickImpactSeed(
      [
        { timeSec: 8, score: 1.0 },
        { timeSec: 14, score: 0.7 },
      ],
      30,
    );
    expect(seed).toBe(14);
  });

  it("ignores candidates below the plausibility floor", () => {
    const seed = pickImpactSeed(
      [
        { timeSec: 8, score: 1.0 },
        { timeSec: 14, score: 0.2 },
      ],
      30,
    );
    expect(seed).toBe(8);
  });

  it("falls back near the end when nothing was heard — never an error, never an empty state", () => {
    expect(pickImpactSeed([], 30)).toBe(30 - FALLBACK_FROM_END_SEC);
  });

  it("never falls back before the start of a short clip", () => {
    expect(pickImpactSeed([], 4)).toBe(0);
  });
});
