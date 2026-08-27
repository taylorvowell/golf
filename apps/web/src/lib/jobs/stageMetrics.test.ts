import { describe, expect, it } from "vitest";
import { STAGE_PCT, STAGE_ORDER, isKnownStage, stageLabel } from "@swingsage/schema/stages";
import { summarize, costRate } from "@/db/jobStats";
import type { JobStageMetrics } from "@/db/schema";

/**
 * The stage vocabulary and the reader over it.
 *
 * The property worth pinning is that this side and the worker's side agree on stage NAMES.
 * They used to not: `jobs.ts` said `pose (localiser)` / `pose-post` / `coach` where the worker
 * said `pose_localiser` / `stage3` / `scoring`, so the same stage produced two different
 * `jobs.stage` values depending on which runner ran the job — and nothing surfaced it, because
 * both lists agreed on the percentages and the bar therefore looked right either way.
 */

function metrics(over: Partial<JobStageMetrics> = {}): JobStageMetrics {
  return {
    schema: "stage-metrics",
    schemaVersion: 1,
    totalS: 100,
    attributedS: 96,
    unattributedS: 4,
    attributedPct: 96,
    captureFps: 240,
    stages: [
      { stage: "download", seconds: 6 },
      { stage: "pose", seconds: 50 },
      { stage: "club", seconds: 40 },
      { stage: "variants", seconds: 30, nested: true },
    ],
    ...over,
  };
}

describe("the one stage vocabulary", () => {
  it("carries the stages the spawn scraper reports", () => {
    // Exactly the names jobs.ts now maps its regexes onto.
    for (const s of ["probe", "normalize", "pose_localiser", "pose", "stage3", "events",
      "club", "face", "metrics", "scoring", "render"]) {
      expect(isKnownStage(s), `${s} missing from the vocabulary`).toBe(true);
    }
  });

  it("names the job-level stages that happen outside the pipeline", () => {
    // Unnamed, these three land in the unattributed remainder instead of being measurable.
    for (const s of ["download", "guard", "upload"]) expect(isKnownStage(s)).toBe(true);
  });

  it("orders stages by execution, not alphabetically", () => {
    expect(STAGE_ORDER.indexOf("probe")).toBeLessThan(STAGE_ORDER.indexOf("pose"));
    expect(STAGE_ORDER.indexOf("pose")).toBeLessThan(STAGE_ORDER.indexOf("render"));
    expect(STAGE_ORDER.indexOf("download")).toBe(0);
  });

  it("keeps percentages monotonic, so the bar never goes backwards", () => {
    const pcts = STAGE_ORDER.map((s) => STAGE_PCT[s]);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
  });

  it("separates the machine id from what a person reads", () => {
    expect(stageLabel("pose_localiser")).toBe("pose (localiser)");
    expect(stageLabel("scoring")).toBe("coach");
    // An unknown id passes through rather than vanishing from a screen.
    expect(stageLabel("brand_new_stage")).toBe("brand_new_stage");
    expect(stageLabel(null)).toBe("");
  });
});

describe("job stats", () => {
  it("never counts a nested stage's seconds toward the total share", () => {
    const [row] = summarize([metrics()]);
    const names = row.stages.map((s) => s.stage);
    expect(names).not.toContain("variants"); // its 30s are already inside club's 40s
    expect(row.stages.find((s) => s.stage === "club")!.medianS).toBe(40);
  });

  it("buckets by capture-fps class, because a frame is not the same work at 30 and 240", () => {
    const rows = summarize([metrics({ captureFps: 240 }), metrics({ captureFps: 30 })]);
    expect(rows.map((r) => r.fpsClass).sort()).toEqual(["240", "30"]);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it("reports stage share against the p50 total", () => {
    const [row] = summarize([metrics()]);
    expect(row.totalP50).toBe(100);
    expect(row.stages.find((s) => s.stage === "pose")!.sharePct).toBe(50);
  });

  it("uses the median rather than the mean, so one bad job cannot redefine a stage", () => {
    const [row] = summarize([
      metrics({ stages: [{ stage: "pose", seconds: 10 }] }),
      metrics({ stages: [{ stage: "pose", seconds: 12 }] }),
      metrics({ stages: [{ stage: "pose", seconds: 900 }] }),
    ]);
    expect(row.stages.find((s) => s.stage === "pose")!.medianS).toBe(12);
  });

  it("prices a view from configuration, not a literal", () => {
    const { usdPerSecond, source } = costRate();
    expect(usdPerSecond).toBeGreaterThan(0);
    expect(source).toBeTruthy();
    const [row] = summarize([metrics()]);
    expect(row.costP50Usd).toBeCloseTo(100 * usdPerSecond, 6);
  });

  it("survives a record whose worker reported nothing but an error", () => {
    const rows = summarize([{ schema: "stage-metrics", schemaVersion: 1, error: "boom" }]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].totalP50).toBeNull();
  });
});
