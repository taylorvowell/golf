import type { SwingSummary } from "@swingsage/schema/contract";

import type { BrandIconName, StickFigure } from "../../design/system";
import {
  createdAtMs,
  sessionStats,
  sessionize,
  type SwingSession,
} from "../swings/sessions";

/**
 * Progress's view-model — the seam `goal-progression` and `priority-engine` will fill.
 *
 * Two kinds of content flow through here, and the split is the whole design:
 *
 * - **Real aggregates** (`progressWindow`, `compareEnds`, `progressHeadline`) are computed from
 *   the swing list alone — session count, swing count, best score, session-average deltas over
 *   the trailing window. Anything without enough data is `null`, never a fabricated zero.
 * - **Placeholder coaching content** (`PLACEHOLDER_PRIORITIES`, `PLACEHOLDER_TRENDS`,
 *   `PLACEHOLDER_COACH_NOTE`) is canned copy pending the priority-engine/goal-progression
 *   tracks. It names only the real categories the scoring config scores, and it carries **no
 *   numbers** — a canned Before/Now bar would present a measurement nobody made. Those tracks
 *   replace these constants (the single swap point) and start feeding `progress`/`delta`;
 *   the components already render them when present.
 */

export const PROGRESS_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProgressWindow {
  /** Sessions whose last swing landed inside the window. */
  sessions: number;
  swings: number;
  /** Best overall score in the window, or null when nothing scored. */
  best: number | null;
  /** Sessions in the window with at least one scored swing. */
  scoredSessions: number;
  /** Latest scored session average minus the earliest — the "+8 net gain". Null under 2
   *  scored sessions: one session is a data point, not a trend. */
  netGain: number | null;
  /** The latest scored session's average — the trend ring's sweep (a real level; the ring
   *  never sweeps to a canned percentage). */
  latestAvg: number | null;
}

export function progressWindow(
  sessions: SwingSession[],
  now: number,
  days: number = PROGRESS_WINDOW_DAYS,
): ProgressWindow {
  const cutoff = now - days * DAY_MS;
  const inWindow = sessions.filter((s) => s.end >= cutoff);
  let swings = 0;
  let best: number | null = null;
  // `sessionize` returns newest first, so averages collect newest → oldest.
  const averages: number[] = [];
  for (const session of inWindow) {
    swings += session.swings.length;
    const stats = sessionStats(session);
    if (stats.best !== null) best = best === null ? stats.best : Math.max(best, stats.best);
    if (stats.avg !== null) averages.push(stats.avg);
  }
  const scoredSessions = averages.length;
  return {
    sessions: inWindow.length,
    swings,
    best,
    scoredSessions,
    netGain: scoredSessions >= 2 ? averages[0] - averages[averages.length - 1] : null,
    latestAvg: scoredSessions >= 1 ? averages[0] : null,
  };
}

/** One end of the then-vs-now compare — a real swing, its real score. */
export interface CompareEnd {
  swingId: string;
  label: string;
  score: number;
  at: number;
}

/**
 * The earliest and latest scored swings inside the window. Null under two scored swings —
 * a swing compared with itself is not a comparison.
 */
export function compareEnds(
  sessions: SwingSession[],
  now: number,
  days: number = PROGRESS_WINDOW_DAYS,
): { then: CompareEnd; now: CompareEnd } | null {
  const cutoff = now - days * DAY_MS;
  const scored: CompareEnd[] = [];
  for (const session of sessions) {
    if (session.end < cutoff) continue;
    for (const s of session.swings) {
      if (s.status === "ready" && typeof s.overallScore === "number") {
        scored.push({
          swingId: s.id,
          label: s.label,
          score: Math.round(s.overallScore),
          at: createdAtMs(s),
        });
      }
    }
  }
  if (scored.length < 2) return null;
  scored.sort((a, b) => a.at - b.at);
  return { then: scored[0], now: scored[scored.length - 1] };
}

/** Deterministic — a sentence the data can stand behind, never AI copy. */
export function progressHeadline(w: ProgressWindow): string {
  if (w.swings === 0) return "Your next 30 days start with a swing.";
  if (w.netGain === null) return "Keep practising to unlock trends.";
  if (w.netGain > 0) return "Session averages are climbing.";
  if (w.netGain < 0) return "Averages dipped — worth a focused session.";
  return "Holding steady across sessions.";
}

export interface ProgressViewModel {
  /** empty: no swings in the window. low-data: swings but under 2 scored sessions — the
   *  layout renders with honest copy and no invented numbers. ready: trends may speak. */
  kind: "empty" | "low-data" | "ready";
  window: ProgressWindow;
  headline: string;
  compare: { then: CompareEnd; now: CompareEnd } | null;
}

export function progressViewModel(swings: SwingSummary[], now: number): ProgressViewModel {
  const sessions = sessionize(swings);
  const window = progressWindow(sessions, now);
  const kind =
    window.swings === 0 ? "empty" : window.scoredSessions >= 2 ? "ready" : "low-data";
  return {
    kind,
    window,
    headline: progressHeadline(window),
    compare: kind === "ready" ? compareEnds(sessions, now) : null,
  };
}

/* ------------------------------------------------------------------------------------------
 * Placeholder coaching content — the single swap point for priority-engine/goal-progression.
 * ---------------------------------------------------------------------------------------- */

export interface ProgressPriority {
  /** A category id the scoring config actually scores — never an invented theme. */
  category: string;
  ordinal: string;
  title: string;
  copy: string;
  level: "high" | "med" | "low";
  levelLabel: string;
  figure: StickFigure;
  /** A supplied brand glyph for the category; set, it replaces the stick figure on the tile.
   *  Categories gain these as Taylor draws them (tempo first). */
  icon?: BrandIconName;
  /** Real before/now category scores arrive with goal-progression; null draws no bar —
   *  a bar at a canned width is a measurement nobody made. */
  progress: { before: number; now: number } | null;
  /** Canned until priority-engine ranks this golfer's real findings. */
  placeholder: boolean;
}

export interface ProgressTrend {
  category: string;
  group: string;
  title: string;
  copy: string;
  figure: StickFigure;
  /** Same contract as `ProgressPriority.icon`. */
  icon?: BrandIconName;
  /** Real per-category delta arrives with goal-progression; null renders no number. */
  delta: number | null;
  placeholder: boolean;
}

/* The mockup's stick figures, path data verbatim (`.stick-thumb` svgs, Progress reference). */
const FIGURE_SETUP: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 18.5 17.5 17.5 23.5", "M18.5 17.5 24.5 17", "M24.5 17 28 13", "M17.5 23.5 16 31"],
  accents: ["M18.2 17.8 24.5 24", "M24.5 24 25 31"],
  traces: ["M8 12c3 1 5 2 8 6"],
};
const FIGURE_IMPACT: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 19, y: 8 }],
  bones: ["M19 11.5 18 18 16.5 24", "M18 18 25.5 17", "M16.5 24 14.5 31"],
  accents: ["M25.5 17 31 14", "M18 18 23 25", "M23 25 25.5 31"],
  traces2: ["M22 16c4-1 7-4 11-6"],
};
const FIGURE_TEMPO: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 20, y: 8 }],
  bones: ["M20 11.5 19 18 18 24", "M19 18 25 19", "M18 24 16 31"],
  accents: ["M25 19 29 16", "M19 18 23.5 23.5", "M23.5 23.5 24.5 31"],
  traces: ["M9 13c4-1 7 0 10 3"],
  traces2: ["M21 18c3 2 6 2 10 0"],
};
const FIGURE_POSTURE: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 18.5 17.5 17.5 23.5", "M18.5 17.5 24.5 17", "M17.5 23.5 16 31"],
  accents: ["M24.5 17 29 14", "M18 18 23.8 24", "M23.8 24 24.6 31"],
};
const FIGURE_STRIKE: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 18.5, y: 8 }],
  bones: ["M18.5 11.5 17.8 17.2 16.5 23.5", "M17.8 17.2 25.5 16.8", "M16.5 23.5 14.8 31"],
  accents: ["M25.5 16.8 31 13", "M17.8 17.2 23 24.2", "M23 24.2 25.2 31"],
  traces2: ["M22 17c4-1 8-3 12-6"],
};
const FIGURE_THEN: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 19.5 18 18.5 24", "M19.5 18 25.2 17", "M18.5 24 16.2 31"],
  accents: ["M25.2 17 29.5 14", "M19.5 18 24 25", "M24 25 25.8 31"],
};

/** Compare-card figures — the mockup's then/now poses (real scores render beside them). */
export const COMPARE_FIGURES = { then: FIGURE_THEN, now: FIGURE_STRIKE } as const;

export const PLACEHOLDER_PRIORITIES: readonly ProgressPriority[] = [
  {
    category: "setup_posture",
    ordinal: "Priority 01",
    title: "Setup posture",
    copy: "A stable, repeatable setup unlocks a cleaner transition and more centered contact.",
    level: "high",
    levelLabel: "High",
    figure: FIGURE_SETUP,
    progress: null,
    placeholder: true,
  },
  {
    category: "impact",
    ordinal: "Priority 02",
    title: "Impact position",
    copy: "Impact is where a swing becomes a shot — delivery is the biggest scoring opportunity.",
    level: "med",
    levelLabel: "Medium",
    figure: FIGURE_IMPACT,
    progress: null,
    placeholder: true,
  },
  {
    category: "transition_tempo",
    ordinal: "Priority 03",
    title: "Transition tempo",
    copy: "A repeatable tempo stabilises path and face from the top down.",
    level: "low",
    levelLabel: "On track",
    figure: FIGURE_TEMPO,
    icon: "tempo",
    progress: null,
    placeholder: true,
  },
];

export const PLACEHOLDER_TRENDS: readonly ProgressTrend[] = [
  {
    category: "setup_posture",
    group: "Setup",
    title: "Posture",
    copy: "Shoulder tilt and hip hinge at address.",
    figure: FIGURE_POSTURE,
    delta: null,
    placeholder: true,
  },
  {
    category: "transition_tempo",
    group: "Motion",
    title: "Tempo",
    copy: "Backswing-to-downswing ratio.",
    figure: FIGURE_TEMPO,
    icon: "tempo",
    delta: null,
    placeholder: true,
  },
  {
    category: "impact",
    group: "Strike",
    title: "Impact",
    copy: "Club delivery and strike quality.",
    figure: FIGURE_STRIKE,
    delta: null,
    placeholder: true,
  },
];

/** Canned coach narrative — replaced by ai-coach/goal-progression. No numbers on purpose. */
export const PLACEHOLDER_COACH_NOTE =
  "Work the priorities in order — setup steadies everything after it, and impact is where " +
  "the scorecard notices. Trends here sharpen as your swing history grows.";
