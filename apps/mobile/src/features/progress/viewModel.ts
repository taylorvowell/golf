import type { SwingSummary } from "@swingsage/schema/contract";

import type { BrandIconName, StickFigure } from "../../design/system";
import { FORM_FIGURES } from "../../design/system";
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

/* The mockup's stick figures now live in the design system's form-art library (`formArt.ts`)
 * so every coach-voiced surface shows the same picture for the same topic. */
const FIGURE_SETUP = FORM_FIGURES.setup;
const FIGURE_IMPACT = FORM_FIGURES.impact;
const FIGURE_TEMPO = FORM_FIGURES.tempo;
const FIGURE_POSTURE = FORM_FIGURES.posture;
const FIGURE_STRIKE = FORM_FIGURES.strike;
const FIGURE_THEN: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 19.5 18 18.5 24", "M19.5 18 25.2 17", "M18.5 24 16.2 31"],
  accents: ["M25.2 17 29.5 14", "M19.5 18 24 25", "M24 25 25.8 31"],
};

/** Compare-card figures — the mockup's then/now poses (real scores render beside them). */
export const COMPARE_FIGURES = { then: FIGURE_THEN, now: FIGURE_STRIKE } as const;

/** The mockup's figures by name, shared with the Coach page's stubs so both surfaces draw a
 *  category with the same pose. */
export const CATEGORY_FIGURES = {
  setup: FIGURE_SETUP,
  impact: FIGURE_IMPACT,
  tempo: FIGURE_TEMPO,
  posture: FIGURE_POSTURE,
  strike: FIGURE_STRIKE,
} as const;

/* Content below is the PINNED SAMPLE's, verbatim (`.claude/SAMPLE-progress-page.html`,
 * Taylor 2026-08-19: "I want this followed exactly") — including the Before/Now numbers,
 * which are canned during the UI-stub phase. That amendment is recorded in
 * `docs/decisions/mobile-client.md` ("Progress renders the pinned sample…"); the engines
 * replace these constants and the honesty bar returns with them. */

export const PLACEHOLDER_PRIORITIES: readonly ProgressPriority[] = [
  {
    category: "setup_posture",
    ordinal: "Priority 01",
    title: "Hip depth at address",
    copy: "Better setup depth is unlocking cleaner transition and more centered contact.",
    level: "high",
    levelLabel: "High",
    figure: FIGURE_SETUP,
    progress: { before: 68, now: 79 },
    placeholder: true,
  },
  {
    category: "impact",
    ordinal: "Priority 02",
    title: "Chest open at impact",
    copy: "Rotation is improving, but impact is still the biggest scoring opportunity.",
    level: "med",
    levelLabel: "Medium",
    figure: FIGURE_IMPACT,
    progress: { before: 64, now: 74 },
    placeholder: true,
  },
  {
    category: "transition_tempo",
    ordinal: "Priority 03",
    title: "Tempo consistency",
    copy: "The motion is more repeatable. Continue tempo work to stabilize path and face.",
    level: "low",
    levelLabel: "On track",
    figure: FIGURE_TEMPO,
    icon: "tempo",
    progress: { before: 71, now: 82 },
    placeholder: true,
  },
];

export const PLACEHOLDER_TRENDS: readonly ProgressTrend[] = [
  {
    category: "setup_posture",
    group: "Setup",
    title: "Posture",
    copy: "Shoulders and hip hinge are cleaner.",
    figure: FIGURE_POSTURE,
    delta: 9,
    placeholder: true,
  },
  {
    category: "transition_tempo",
    group: "Motion",
    title: "Tempo",
    copy: "Backswing to downswing ratio is stabilizing.",
    figure: FIGURE_TEMPO,
    icon: "tempo",
    delta: 6,
    placeholder: true,
  },
  {
    category: "impact",
    group: "Strike",
    title: "Impact",
    copy: "Club delivery and strike quality are trending up.",
    figure: FIGURE_STRIKE,
    delta: 11,
    placeholder: true,
  },
];

/** Canned coach narrative — the sample's, verbatim; replaced by ai-coach/goal-progression. */
export const PLACEHOLDER_COACH_NOTE =
  "Stay focused on the first two priorities until impact scores move above 80 consistently. " +
  "Once that stabilizes, the coach can shift more attention toward face control and " +
  "shot-shaping goals.";

/** The hero's description line and fourth chip — the sample's coach-voice copy, canned. */
export const PLACEHOLDER_HERO_DESCRIPTION =
  "Coach focus is shifting from setup stability toward impact sequencing and release control.";
export const PLACEHOLDER_CONFIDENCE_CHIP = "Coach confidence rising";
