import type { SwingSummary } from "@swingsage/schema/contract";

import { progressStats, sessionAverages } from "./progressModel";
import { sessionize } from "../swings/sessions";

/**
 * Progress's honesty rules: records only from `ready` swings, a tempo claim only from enough
 * samples for a median to mean something, and the trend built from session AVERAGES with
 * unscored sessions skipped — never charted as zero.
 */

const T0 = 1_760_000_000_000;
const DAY = 86_400_000;

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

describe("progressStats", () => {
  it("finds the all-time best among ready swings only", () => {
    const stats = progressStats(
      [
        swing({ id: "a", createdAt: T0, overallScore: 71 }),
        swing({ id: "b", createdAt: T0 + 1, overallScore: 88, status: "processing" }),
        swing({ id: "c", createdAt: T0 + 2, overallScore: 80 }),
      ],
      2,
    );
    expect(stats.best).toEqual({ score: 80, swingId: "c", at: T0 + 2 });
    expect(stats.totalSwings).toBe(3);
    expect(stats.totalSessions).toBe(2);
  });

  it("abstains from tempo under three samples, then reports the median", () => {
    const two = progressStats(
      [
        swing({ id: "a", createdAt: T0, tempoRatio: 3.0 }),
        swing({ id: "b", createdAt: T0 + 1, tempoRatio: 2.8 }),
      ],
      1,
    );
    expect(two.medianTempo).toBeNull();

    const three = progressStats(
      [
        swing({ id: "a", createdAt: T0, tempoRatio: 3.0 }),
        swing({ id: "b", createdAt: T0 + 1, tempoRatio: 2.8 }),
        // The outlier the median exists to ignore.
        swing({ id: "c", createdAt: T0 + 2, tempoRatio: 9.9 }),
      ],
      1,
    );
    expect(three.medianTempo).toBe(3.0);
  });

  it("returns nulls, not zeros, when nothing is scored", () => {
    const stats = progressStats([swing({ id: "a", createdAt: T0 })], 1);
    expect(stats.best).toBeNull();
    expect(stats.medianTempo).toBeNull();
  });
});

describe("sessionAverages", () => {
  it("averages each scored session oldest → newest and skips unscored sessions", () => {
    const sessions = sessionize([
      // session 1: avg 60
      swing({ id: "a", createdAt: T0, overallScore: 55 }),
      swing({ id: "b", createdAt: T0 + 60_000, overallScore: 65 }),
      // session 2: nothing scored — must be absent, not zero
      swing({ id: "c", createdAt: T0 + DAY }),
      // session 3: avg 70
      swing({ id: "d", createdAt: T0 + 2 * DAY, overallScore: 70 }),
    ]);
    const points = sessionAverages(sessions);
    expect(points.map((p) => p.average)).toEqual([60, 70]);
    expect(points[0].start).toBeLessThan(points[1].start);
  });

  it("caps at the newest `limit` sessions", () => {
    const swings = Array.from({ length: 12 }, (_, i) =>
      swing({ id: `s${i}`, createdAt: T0 + i * DAY, overallScore: 50 + i }),
    );
    const points = sessionAverages(sessionize(swings), 10);
    expect(points).toHaveLength(10);
    // The newest 10, still oldest first: sessions 2..11 → scores 52..61.
    expect(points[0].average).toBe(52);
    expect(points[9].average).toBe(61);
  });
});
