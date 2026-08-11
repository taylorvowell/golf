import {
  PROBES,
  THRESHOLDS,
  judgeCapture,
  judgeOverlayDrift,
  judgeSeekError,
  spikeComplete,
  unsupportedClaims,
  type Probe,
  type StatSummary,
} from "./probes";

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

const stats = (over: Partial<StatSummary> = {}): StatSummary => ({
  count: 600,
  mean: 0,
  p50: 0,
  p95: 0,
  max: 0,
  exactShare: 1,
  ...over,
});

describe("probe definitions", () => {
  it("covers the three questions step 02 must answer", () => {
    expect(PROBES.map((p) => p.id)).toEqual(["overlay-sync", "seek", "scrub", "capture"]);
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

  it("no probe ships already claiming an answer", () => {
    // The two runnable probes sit at `pending` until a device produces numbers; capture is still
    // `blocked-dev-build` because no camera path is wired yet. Both are accurate states, and
    // neither is a result.
    expect(PROBES.every((p) => p.status === "pending" || p.status === "blocked-dev-build")).toBe(
      true,
    );
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
      ...PROBES.slice(1),
    ];
    expect(spikeComplete(partial)).toBe(false);
  });

  it("covers scrubbing, not just playback", () => {
    // The step file asks for the overlay lock 'during scrub'. A spike that only measured
    // playback could pass while the interaction the lock exists for still fails.
    expect(PROBES.map((p) => p.id)).toContain("scrub");
  });

  it("is true only when every probe carries a real measurement", () => {
    const done: Probe[] = PROBES.map((p) => ({
      ...p,
      status: "pass" as const,
      measurement: { value: 0, device: "Pixel 7a" },
    }));
    expect(spikeComplete(done)).toBe(true);
  });

  it("a running probe is not a finished one", () => {
    const mid: Probe[] = PROBES.map((p) => ({ ...p, status: "running" as const }));
    expect(spikeComplete(mid)).toBe(false);
  });
});

describe("judgeOverlayDrift", () => {
  it("passes only when every sample is exactly locked", () => {
    expect(judgeOverlayDrift(stats({ p95: 0, exactShare: 1 })).status).toBe("pass");
  });

  it("fails a single frame of p95 drift", () => {
    // The bar is 0, not 'small'. One frame late is what a viewer sees as the drawing sliding
    // off the golfer, and D13 chose to learn that now rather than ship it.
    expect(judgeOverlayDrift(stats({ p95: 1, exactShare: 0.9 })).status).toBe("fail");
  });

  /**
   * The regression that matters. A run sitting mostly at -1 -- the overlay one frame BEHIND --
   * yields a signed p95 of 0, because percentiles are computed on sorted SIGNED samples. The old
   * `p95 <= 0` gate passed exactly this shape, and it is not hypothetical: it is the real S25+
   * measurement of 2026-08-11, 24 locked samples out of 229, reported as PASS.
   */
  it("fails a run that is mostly one frame BEHIND, despite a signed p95 of zero", () => {
    const real = stats({ count: 229, p50: -1, p95: 0, max: 1, exactShare: 0.105 });
    const verdict = judgeOverlayDrift(real);
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("10.5% exactly locked");
  });

  it("reports the share NOT locked, so the value moves the right way", () => {
    expect(judgeOverlayDrift(stats({ exactShare: 0.105 })).value).toBe(89.5);
    expect(judgeOverlayDrift(stats({ exactShare: 1 })).value).toBe(0);
  });

  it("refuses to pass on too few samples, however good they look", () => {
    const verdict = judgeOverlayDrift(stats({ count: 10 }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("only 10 samples");
  });

  it("reports the distribution, not just the verdict", () => {
    const verdict = judgeOverlayDrift(stats({ p50: 0, p95: 2, max: 5, exactShare: 0.83 }));
    expect(verdict.detail).toContain("p95 2");
    expect(verdict.detail).toContain("max 5");
    expect(verdict.detail).toContain("83.0% exactly locked");
  });
});

describe("judgeSeekError", () => {
  it("passes when every seek landed on the requested frame", () => {
    expect(judgeSeekError(stats({ count: 40, max: 0 })).status).toBe("pass");
  });

  it("fails when any seek missed", () => {
    expect(judgeSeekError(stats({ count: 40, max: 3 })).status).toBe("fail");
  });

  it("fails a negative miss too — landing early is still landing wrong", () => {
    expect(judgeSeekError(stats({ count: 40, max: -2 })).status).toBe("fail");
  });

  it("does not read zero seeks as a clean sheet", () => {
    const verdict = judgeSeekError(stats({ count: 0, max: 0 }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("no seeks were measured");
  });
});

describe("judgeCapture", () => {
  it("passes a true 60fps recording", () => {
    expect(judgeCapture(600, 10, 60).status).toBe("pass");
  });

  it("fails a recording that silently degraded to 30fps", () => {
    const verdict = judgeCapture(300, 10, 60);
    expect(verdict.status).toBe("fail");
    expect(verdict.value).toBe(30);
  });

  it("measures the file rather than trusting the requested rate", () => {
    // 597 frames in 10s is 59.7fps — over the bar, and the detail must still show the real
    // numbers so a marginal device is visible rather than rounded into a pass.
    const verdict = judgeCapture(597, 10, 60);
    expect(verdict.status).toBe("pass");
    expect(verdict.detail).toContain("597 frames");
    expect(verdict.detail).toContain("59.70 fps");
  });

  it("treats a missing recording as a failure, not a pass", () => {
    expect(judgeCapture(0, 0, 60).status).toBe("fail");
  });

  it("holds the 60fps bar where §2.3 puts it", () => {
    expect(THRESHOLDS.captureMinFps).toBeGreaterThan(59);
    expect(THRESHOLDS.overlayDriftP95).toBe(0);
    expect(THRESHOLDS.seekErrorMax).toBe(0);
  });
});
