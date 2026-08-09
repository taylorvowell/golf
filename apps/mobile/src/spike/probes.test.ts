import { PROBES, spikeComplete, unsupportedClaims, type Probe } from "./probes";

/**
 * Proves two things at once.
 *
 * First, that the mobile test harness works at all — jest-expo transforming and running from a
 * Windows machine with no Android SDK, which is the prerequisite for every later mobile test.
 *
 * Second, and the reason these assertions are worth keeping: the spike must never claim an
 * answer it did not measure. Step 02's whole purpose is deciding whether the framework choice
 * in DECISIONS D5 survives contact with a device, and a probe reading PASS with nothing behind
 * it would quietly convert "untested" into "validated".
 */

describe("probe definitions", () => {
  it("covers the three questions step 02 must answer", () => {
    expect(PROBES.map((p) => p.id)).toEqual(["overlay-sync", "seek", "capture"]);
  });

  it("puts overlay-sync first, because it carries the unconfirmed Android risk", () => {
    // iOS has a confirmed path; Android does not. If this one fails, the other two never
    // need measuring and D5 reopens — so it must not sit behind them.
    expect(PROBES[0].id).toBe("overlay-sync");
  });

  it("states a falsifiable unit for every probe", () => {
    for (const p of PROBES) {
      expect(p.measures.trim().length).toBeGreaterThan(0);
      expect(p.question.trim().endsWith("?")).toBe(true);
      expect(p.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
  });
});

describe("the honesty invariant", () => {
  it("current probes claim nothing they have not measured", () => {
    expect(unsupportedClaims(PROBES)).toEqual([]);
  });

  it("all three are still blocked on a development build", () => {
    // Expo Go cannot host the native modules any of them need. Accurate, not a placeholder.
    expect(PROBES.every((p) => p.status === "blocked-dev-build")).toBe(true);
  });

  it("catches a probe that claims pass with no measurement", () => {
    const lying: Probe[] = [{ ...PROBES[0], status: "pass" }];
    expect(unsupportedClaims(lying)).toEqual(["overlay-sync"]);
  });

  it("catches a probe that claims fail with no measurement", () => {
    const lying: Probe[] = [{ ...PROBES[1], status: "fail" }];
    expect(unsupportedClaims(lying)).toEqual(["seek"]);
  });

  it("accepts a claim once a measurement with a device is attached", () => {
    const measured: Probe[] = [
      { ...PROBES[0], status: "pass", measurement: { value: 0, device: "Pixel 7a" } },
    ];
    expect(unsupportedClaims(measured)).toEqual([]);
  });
});

describe("spikeComplete — the step's exit condition", () => {
  it("is false while anything is unmeasured", () => {
    expect(spikeComplete(PROBES)).toBe(false);
  });

  it("is false when only some probes are answered", () => {
    const partial: Probe[] = [
      { ...PROBES[0], status: "pass", measurement: { value: 0, device: "Pixel 7a" } },
      PROBES[1],
      PROBES[2],
    ];
    expect(spikeComplete(partial)).toBe(false);
  });

  it("is true only when every probe carries a real measurement", () => {
    const done: Probe[] = PROBES.map((p) => ({
      ...p,
      status: "pass" as const,
      measurement: { value: 0, device: "Pixel 7a" },
    }));
    expect(spikeComplete(done)).toBe(true);
  });
});
