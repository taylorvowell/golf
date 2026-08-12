import {
  clampFrame,
  fpsDisagrees,
  fractionToFrame,
  frameToFraction,
  isSeekable,
  lastFrame,
  msToFrame,
  stepFrame,
} from "./frames";

describe("lastFrame", () => {
  it("is one below the count", () => {
    expect(lastFrame(240)).toBe(239);
  });

  it("reports -1 for a clip with nothing to seek, rather than 0", () => {
    // 0 would be a real, seekable frame. The distinction is the whole point: the caller must be
    // forced to handle "no frames" instead of seeking to a frame that does not exist.
    expect(lastFrame(0)).toBe(-1);
    expect(lastFrame(Number.NaN)).toBe(-1);
  });
});

describe("clampFrame", () => {
  it("holds both ends of the clip", () => {
    expect(clampFrame(-5, 100)).toBe(0);
    expect(clampFrame(500, 100)).toBe(99);
  });

  it("rounds to a whole frame", () => {
    expect(clampFrame(12.4, 100)).toBe(12);
    expect(clampFrame(12.6, 100)).toBe(13);
  });

  it("lands on 0 rather than NaN when the input is not a number", () => {
    expect(clampFrame(Number.NaN, 100)).toBe(0);
  });
});

describe("stepFrame", () => {
  it("steps by one and by ten", () => {
    expect(stepFrame(50, 1, 100)).toBe(51);
    expect(stepFrame(50, -10, 100)).toBe(40);
  });

  it("stops at the ends instead of wrapping", () => {
    // Wrapping would throw a golfer studying the finish back to address, which reads as the
    // control being broken at the exact moment they are looking hardest.
    expect(stepFrame(99, 1, 100)).toBe(99);
    expect(stepFrame(99, 10, 100)).toBe(99);
    expect(stepFrame(0, -1, 100)).toBe(0);
    expect(stepFrame(4, -10, 100)).toBe(0);
  });
});

describe("msToFrame", () => {
  it("is round(t · fps)", () => {
    expect(msToFrame(1000, 60)).toBe(60);
    expect(msToFrame(1008, 60)).toBe(60); // 60.48 -> 60
    expect(msToFrame(1016, 60)).toBe(61); // 60.96 -> 61
  });

  it("inverts a frame/fps seek target exactly", () => {
    // The native seek aims at `frame / fps` (D40). Reading that position back must return the same
    // frame or the sync panel would report a drift that is purely arithmetic.
    for (const frame of [0, 1, 59, 60, 137, 239]) {
      expect(msToFrame((frame / 60) * 1000, 60)).toBe(frame);
    }
  });

  it("returns 0 rather than Infinity when fps is missing", () => {
    expect(msToFrame(1000, 0)).toBe(0);
  });
});

describe("frameToFraction / fractionToFrame", () => {
  it("round-trips the ends", () => {
    expect(frameToFraction(0, 100)).toBe(0);
    expect(frameToFraction(99, 100)).toBe(1);
    expect(fractionToFrame(0, 100)).toBe(0);
    expect(fractionToFrame(1, 100)).toBe(99);
  });

  it("clamps a drag that leaves the bar", () => {
    expect(fractionToFrame(-0.3, 100)).toBe(0);
    expect(fractionToFrame(1.4, 100)).toBe(99);
  });

  it("does not divide by zero on a single-frame clip", () => {
    expect(frameToFraction(0, 1)).toBe(0);
    expect(fractionToFrame(0.5, 1)).toBe(0);
  });
});

describe("fpsDisagrees", () => {
  it("is quiet when the container agrees", () => {
    expect(fpsDisagrees(60, 60)).toBe(false);
    expect(fpsDisagrees(59.94, 60)).toBe(false);
  });

  it("flags a real mismatch", () => {
    expect(fpsDisagrees(30, 60)).toBe(true);
  });

  it("treats an undeclared container rate as unknown, not as disagreement", () => {
    // Claiming a mismatch we cannot see is the same class of mistake as missing one.
    expect(fpsDisagrees(0, 60)).toBe(false);
  });
});

describe("isSeekable", () => {
  it("requires both a frame count and a rate", () => {
    expect(isSeekable(240, 60)).toBe(true);
    expect(isSeekable(0, 60)).toBe(false);
    expect(isSeekable(240, 0)).toBe(false);
  });
});
