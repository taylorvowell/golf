import type { SwingSummary } from "@swingsage/schema/contract";

import {
  PLACEHOLDER_PRIORITIES,
  PLACEHOLDER_TRENDS,
  compareEnds,
  progressViewModel,
  progressWindow,
} from "./viewModel";
import { sessionize } from "../swings/sessions";

/**
 * Progress's honesty rules, pinned:
 * - The 30-day window counts only what landed inside it.
 * - Net gain exists only across ≥2 SCORED sessions — one session is never a trend.
 * - The compare block exists only across ≥2 scored swings, and its ends are the real
 *   earliest/latest, not whichever order the list arrived in.
 * - Placeholder coaching content carries NO numbers — no canned Before/Now, no canned deltas.
 */

const NOW = 1_770_000_000_000;
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

describe("progressWindow", () => {
  it("counts only sessions inside the window", () => {
    const sessions = sessionize([
      swing({ id: "old", createdAt: NOW - 40 * DAY, overallScore: 90 }),
      swing({ id: "a", createdAt: NOW - 2 * DAY, overallScore: 70 }),
      swing({ id: "b", createdAt: NOW - DAY, overallScore: 80 }),
    ]);
    const w = progressWindow(sessions, NOW);
    expect(w.sessions).toBe(2);
    expect(w.swings).toBe(2);
    // The 90 landed outside the window — the best inside it is 80.
    expect(w.best).toBe(80);
  });

  it("abstains from net gain under two scored sessions", () => {
    const sessions = sessionize([
      swing({ id: "a", createdAt: NOW - 2 * DAY, overallScore: 70 }),
      // A second session with swings but nothing scored must not create a trend.
      swing({ id: "b", createdAt: NOW - DAY }),
    ]);
    const w = progressWindow(sessions, NOW);
    expect(w.scoredSessions).toBe(1);
    expect(w.netGain).toBeNull();
    expect(w.latestAvg).toBe(70);
  });

  it("nets the latest scored session against the earliest", () => {
    const sessions = sessionize([
      swing({ id: "a", createdAt: NOW - 3 * DAY, overallScore: 60 }),
      swing({ id: "b", createdAt: NOW - 2 * DAY, overallScore: 70 }),
      swing({ id: "c", createdAt: NOW - DAY, overallScore: 68 }),
    ]);
    // Three sessions averaging 60, 70, 68 → net = 68 − 60.
    expect(progressWindow(sessions, NOW).netGain).toBe(8);
  });

  it("returns nulls, not zeros, on an empty window", () => {
    const w = progressWindow(sessionize([]), NOW);
    expect(w).toEqual({
      sessions: 0,
      swings: 0,
      best: null,
      scoredSessions: 0,
      netGain: null,
      latestAvg: null,
    });
  });
});

describe("compareEnds", () => {
  it("pairs the earliest and latest scored swings in the window", () => {
    const sessions = sessionize([
      swing({ id: "out", createdAt: NOW - 45 * DAY, overallScore: 50 }),
      swing({ id: "first", createdAt: NOW - 9 * DAY, overallScore: 72, label: "Then" }),
      swing({ id: "mid", createdAt: NOW - 5 * DAY }),
      swing({ id: "last", createdAt: NOW - DAY, overallScore: 86, label: "Now" }),
    ]);
    const pair = compareEnds(sessions, NOW);
    expect(pair?.then).toMatchObject({ swingId: "first", score: 72 });
    expect(pair?.now).toMatchObject({ swingId: "last", score: 86 });
  });

  it("abstains under two scored swings", () => {
    const sessions = sessionize([
      swing({ id: "a", createdAt: NOW - DAY, overallScore: 80 }),
      swing({ id: "b", createdAt: NOW - 2 * DAY }),
    ]);
    expect(compareEnds(sessions, NOW)).toBeNull();
  });

  it("ignores a scored swing that is not ready", () => {
    const sessions = sessionize([
      swing({ id: "a", createdAt: NOW - 2 * DAY, overallScore: 70 }),
      swing({ id: "b", createdAt: NOW - DAY, overallScore: 90, status: "processing" }),
    ]);
    expect(compareEnds(sessions, NOW)).toBeNull();
  });
});

describe("progressViewModel", () => {
  it("classifies empty / low-data / ready on the window's evidence", () => {
    expect(progressViewModel([], NOW).kind).toBe("empty");
    expect(
      progressViewModel([swing({ id: "a", createdAt: NOW - DAY, overallScore: 70 })], NOW).kind,
    ).toBe("low-data");
    const ready = progressViewModel(
      [
        swing({ id: "a", createdAt: NOW - 2 * DAY, overallScore: 70 }),
        swing({ id: "b", createdAt: NOW - DAY, overallScore: 78 }),
      ],
      NOW,
    );
    expect(ready.kind).toBe("ready");
    expect(ready.window.netGain).toBe(8);
    expect(ready.compare).not.toBeNull();
  });

  it("treats a log with only out-of-window swings as an empty window", () => {
    const vm = progressViewModel(
      [swing({ id: "a", createdAt: NOW - 60 * DAY, overallScore: 88 })],
      NOW,
    );
    expect(vm.kind).toBe("empty");
    expect(vm.compare).toBeNull();
  });
});

describe("placeholder honesty", () => {
  // AMENDED 2026-08-19: the page follows SAMPLE-progress-page.html exactly (Taylor), so the
  // placeholder block carries the sample's canned numbers for the UI-stub phase — flagged at
  // the seam, replaced by priority-engine/goal-progression. The pin is now that every canned
  // entry is FLAGGED and matches the sample, not that it is numberless.
  it("placeholder coaching content is flagged and matches the pinned sample", () => {
    for (const p of PLACEHOLDER_PRIORITIES) {
      expect(p.placeholder).toBe(true);
      expect(p.progress).not.toBeNull();
    }
    expect(PLACEHOLDER_PRIORITIES.map((p) => p.progress)).toEqual([
      { before: 68, now: 79 },
      { before: 64, now: 74 },
      { before: 71, now: 82 },
    ]);
    for (const trend of PLACEHOLDER_TRENDS) {
      expect(trend.placeholder).toBe(true);
    }
    expect(PLACEHOLDER_TRENDS.map((t) => t.delta)).toEqual([9, 6, 11]);
  });

  it("placeholder categories are ones the scoring config scores", () => {
    // The v2 scoring config's category vocabulary — canned copy may only name these.
    const real = new Set([
      "setup_posture",
      "takeaway",
      "backswing_top",
      "transition_tempo",
      "downswing_plane",
      "impact",
      "follow_through_balance",
    ]);
    for (const p of PLACEHOLDER_PRIORITIES) expect(real.has(p.category)).toBe(true);
    for (const trend of PLACEHOLDER_TRENDS) expect(real.has(trend.category)).toBe(true);
  });
});
