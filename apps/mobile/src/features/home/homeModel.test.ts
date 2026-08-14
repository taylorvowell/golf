import type { CoachReport, SwingSummary } from "@swingsage/schema/contract";

import { aggregateFocus, latestDrill, latestSessionStats } from "./homeModel";
import { SESSION_GAP_MS, sessionize } from "../swings/sessions";

/**
 * The home screen's claims, pinned where they are computed.
 *
 * The invariants worth a test are the honest-abstention ones — an unscored session must produce
 * nulls rather than zeros, a single-session golfer gets no delta rather than a delta against
 * nothing — and the ranking rule: **recurrence beats one-off leverage**, because the whole point
 * of aggregating a session's reports is that a pattern outranks an outlier.
 */

const T0 = 1_760_000_000_000; // an arbitrary fixed instant, ms

function swing(over: Partial<SwingSummary> & { id: string; createdAt: number }): SwingSummary {
  return {
    label: "Swing",
    referenceLabel: null,
    views: [],
    primaryViewId: null,
    frameCount: 120,
    fps: 60,
    view: "dtl",
    overallScore: null,
    band: null,
    scoringModelVersion: null,
    status: "ready",
    model: null,
    tempoRatio: null,
    traceEnabled: true,
    poseCoverage: 1,
    ...over,
  };
}

function reportWith(
  priorities: Array<{ key: string; label: string; cue: string; leverage: number; checkpoint?: string }>,
  drillTitle: string | null = null,
  swingId = "s-x",
): { swingId: string; report: CoachReport } {
  const report = {
    scoring_model_version: "v2",
    club_type: null,
    view: "dtl",
    overall: 70,
    band: "solid",
    arc_shift: null,
    coverage: { scored: 10, skipped_this_swing: 0, deferred_in_config: 0, total_checks: 10 },
    categories: {},
    checkpoints: {
      P1: { p: "P1", label: "Address", score: 70, n_measurable: 2 },
      P4: { p: "P4", label: "Top", score: 80, n_measurable: 3 },
    },
    findings: [],
    priorities: priorities.map((p) => ({ checkpoint: null, score: 60, ...p })),
    primary: { id: null, checkpoint: null, title: "", copy: "", moment: "", score: 0, leverage: 0 },
    drill: { title: drillTitle ?? "", copy: "", dose: drillTitle ? "3 × 10 slow reps" : "", doseNote: "" },
  } as CoachReport;
  return { swingId, report };
}

describe("latestSessionStats", () => {
  it("computes best, average and the trend scores from ready scored swings only", () => {
    const sessions = sessionize([
      swing({ id: "a", createdAt: T0, overallScore: 60 }),
      swing({ id: "b", createdAt: T0 + 60_000, overallScore: 74 }),
      swing({ id: "c", createdAt: T0 + 120_000, overallScore: null }),
      swing({ id: "d", createdAt: T0 + 180_000, overallScore: 68, status: "processing" }),
    ]);
    const stats = latestSessionStats(sessions, T0 + SESSION_GAP_MS * 2);

    expect(stats).not.toBeNull();
    expect(stats?.scores).toEqual([60, 74]);
    expect(stats?.best).toBe(74);
    expect(stats?.bestSwingId).toBe("b");
    expect(stats?.average).toBe(67);
    expect(stats?.live).toBe(false);
    expect(stats?.analysing).toBe(1);
  });

  it("abstains rather than inventing: no delta with one session, nulls with no scores", () => {
    const sessions = sessionize([swing({ id: "a", createdAt: T0 })]);
    const stats = latestSessionStats(sessions, T0);

    expect(stats?.best).toBeNull();
    expect(stats?.bestSwingId).toBeNull();
    expect(stats?.average).toBeNull();
    expect(stats?.deltaVsPrevious).toBeNull();
    expect(latestSessionStats([], T0)).toBeNull();
  });

  it("compares the latest session's average against the previous one's", () => {
    const sessions = sessionize([
      // previous session, a day earlier: avg 60
      swing({ id: "p1", createdAt: T0 - 86_400_000, overallScore: 55 }),
      swing({ id: "p2", createdAt: T0 - 86_400_000 + 60_000, overallScore: 65 }),
      // latest: avg 70
      swing({ id: "n1", createdAt: T0, overallScore: 70 }),
    ]);
    expect(latestSessionStats(sessions, T0 + 1000)?.deltaVsPrevious).toBe(10);
    // still inside the gap of the last swing → the session reads as live
    expect(latestSessionStats(sessions, T0 + 1000)?.live).toBe(true);
  });
});

describe("aggregateFocus", () => {
  it("ranks recurrence over a single high-leverage appearance", () => {
    const focus = aggregateFocus([
      reportWith(
        [
          { key: "hip_turn", label: "Hip turn", cue: "old cue", leverage: 40, checkpoint: "P1" },
          { key: "tempo", label: "Tempo", cue: "slow the takeaway", leverage: 95 },
        ],
        null,
        "s-old",
      ),
      reportWith(
        [{ key: "hip_turn", label: "Hip turn", cue: "clear the lead hip", leverage: 45, checkpoint: "P4" }],
        null,
        "s-new",
      ),
    ]);

    expect(focus[0]?.key).toBe("hip_turn");
    expect(focus[0]?.seenIn).toBe(2);
    expect(focus[0]?.reportCount).toBe(2);
    // the newest report's wording, exemplar swing and checkpoint win
    expect(focus[0]?.cue).toBe("clear the lead hip");
    expect(focus[0]?.exemplarId).toBe("s-new");
    expect(focus[0]?.checkpoint).toBe("P4");
    // the label resolves by VALUE through the report's checkpoint table
    expect(focus[0]?.checkpointLabel).toBe("Top");
    expect(focus[1]?.key).toBe("tempo");
    expect(focus[1]?.exemplarId).toBe("s-old");
  });

  it("breaks recurrence ties by mean leverage", () => {
    const focus = aggregateFocus([
      reportWith([
        { key: "low", label: "Low", cue: "", leverage: 20 },
        { key: "high", label: "High", cue: "", leverage: 80 },
      ]),
    ]);
    expect(focus.map((f) => f.key)).toEqual(["high", "low"]);
  });

  it("returns nothing from nothing", () => {
    expect(aggregateFocus([])).toEqual([]);
  });
});

describe("latestDrill", () => {
  it("takes the newest report that actually carries a drill", () => {
    const drill = latestDrill([
      reportWith([], "Older drill"),
      reportWith([], "Pump drill"),
      reportWith([], null),
    ]);
    expect(drill).toEqual({ title: "Pump drill", dose: "3 × 10 slow reps" });
    expect(latestDrill([reportWith([], null)])).toBeNull();
  });
});
