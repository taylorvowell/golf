import type { SwingSummary } from "@swingsage/schema/contract";

import type { SwingSession } from "../swings/sessions";
import type { DrillPick, FocusItem, SessionStats } from "./homeModel";

/**
 * Filler home content — the populated screen rendered from bundled data, for design and
 * architecture work while the account has no swings (Taylor, 2026-08-24: mockup content for
 * deciding what the homepage carries).
 *
 * Everything here is shaped by the REAL contract (`SwingSummary`, `FocusItem`, the scorer's
 * actual band names and P-codes) so the mockup exercises the same components the real data
 * will — nothing renders here that the pipeline could not produce. Forced on from the debug
 * menu only; a mock id can never reach a release build because the toggle does not exist there.
 *
 * The wording follows the coach's own register: directional cues ("what to do differently"),
 * never technical labels dressed up as advice — the same rule `CheckResult.advice` documents.
 */

/** Mock ids wear this prefix so image hooks skip the network and taps do not open a report
 *  for a swing that does not exist. */
export const MOCK_PREFIX = "mock-";

export function isMockSwing(id: string): boolean {
  return id.startsWith(MOCK_PREFIX);
}

/** The "pro" half of the compare strip — a stand-in for a bundled reference swing. */
export const MOCK_PRO_ID = `${MOCK_PREFIX}pro`;

/** Oldest → newest, the shape of a decent range session: rough start, one standout late.
 *  Bands follow the scorer's real thresholds (90 Elite / 75 Pure / 60 Solid / 40 Building). */
const SCORES: Array<number | null> = [64, 71, 66, 73, 68, 79, null];

function bandOf(score: number): string {
  if (score >= 90) return "Elite";
  if (score >= 75) return "Pure";
  if (score >= 60) return "Solid";
  if (score >= 40) return "Building";
  return "Reset";
}

function mockSwing(i: number, createdAt: number): SwingSummary {
  const score = SCORES[i];
  return {
    id: `${MOCK_PREFIX}swing-${i + 1}`,
    label: `Swing ${i + 1}`,
    referenceLabel: null,
    views: [],
    primaryViewId: null,
    frameCount: 1440,
    fps: 240,
    view: "dtl",
    overallScore: score,
    band: score === null ? null : bandOf(score),
    scoringModelVersion: score === null ? null : "v2",
    // The last swing is still working through the analyzer — the home has to say so.
    status: score === null ? "processing" : "ready",
    createdAt,
    model: null,
    tempoRatio: 3.1,
    traceEnabled: true,
    poseCoverage: 0.97,
    sessionId: `${MOCK_PREFIX}session`,
  };
}

/**
 * The hero + session block's input: a session that ended minutes ago, so the screen renders its
 * "Today, so far" (live) voice — the state the homepage is architected around.
 */
export function mockHomeStats(now: number): SessionStats {
  const end = now - 12 * 60 * 1000;
  const start = end - 42 * 60 * 1000;
  const step = (end - start) / (SCORES.length - 1);
  const swings = SCORES.map((_, i) => mockSwing(i, Math.round(start + i * step)));

  const session: SwingSession = {
    id: `${MOCK_PREFIX}session`,
    start,
    end,
    swings,
    best: 79,
    name: null,
    sessionType: "swing_analysis",
    parts: [],
  };

  const scores = SCORES.filter((s): s is number => s !== null);
  return {
    session,
    live: true,
    scores,
    best: 79,
    bestSwingId: `${MOCK_PREFIX}swing-6`,
    average: scores.reduce((a, b) => a + b, 0) / scores.length,
    deltaVsPrevious: 4,
    analysing: 1,
  };
}

/**
 * What recurred across the session's reports, already aggregated — the lead card plus the rail.
 * Keys and checkpoints use the scoring config's real vocabulary so `formFigureFor` lands on the
 * same art the real reports would.
 */
export const MOCK_FOCUS: FocusItem[] = [
  {
    key: "ANG-31",
    label: "Early extension",
    cue: "Keep your belt buckle back through the downswing — turn your hips instead of pushing them toward the ball.",
    seenIn: 5,
    reportCount: 6,
    exemplarId: `${MOCK_PREFIX}swing-6`,
    checkpoint: "P6",
    checkpointLabel: "Downswing",
  },
  {
    key: "ANG-74",
    label: "Trail knee straightens at the top",
    cue: "Hold the flex in your trail knee as you finish the backswing — when it straightens, your hips sway with it.",
    seenIn: 4,
    reportCount: 6,
    exemplarId: `${MOCK_PREFIX}swing-5`,
    checkpoint: "P4",
    checkpointLabel: "Top",
  },
  {
    key: "TEM-01",
    label: "Quick transition",
    cue: "Feel one beat of pause at the top before you start down — your best swing today had it.",
    seenIn: 3,
    reportCount: 6,
    exemplarId: `${MOCK_PREFIX}swing-4`,
    checkpoint: "P5",
    checkpointLabel: "Transition",
  },
  {
    key: "POS-01",
    label: "Posture at address",
    cue: "Bend forward a touch more from your hips at setup, arms hanging straight under your shoulders.",
    seenIn: 2,
    reportCount: 6,
    exemplarId: `${MOCK_PREFIX}swing-2`,
    checkpoint: "P1",
    checkpointLabel: "Address",
  },
];

/** The classic prescription for the lead fault — what the newest report's drill would carry. */
export const MOCK_DRILL: DrillPick = {
  title: "Chair drill",
  dose: "3 × 10 slow reps",
};

/**
 * The drills section's carousel — short vertical drill videos (reels format), each tied to a
 * fault in the focus items' vocabulary so the section reads as "for what you're working on",
 * never a generic library dump. Durations are what a filmed drill demo actually runs.
 */
export interface DrillReelItem {
  id: string;
  title: string;
  /** The fault it works on — the card's tag, and the `formFigureFor` hint. */
  area: string;
  duration: string;
}

export const MOCK_DRILL_REEL: DrillReelItem[] = [
  { id: `${MOCK_PREFIX}reel-1`, title: "Chair drill", area: "Early extension", duration: "0:42" },
  { id: `${MOCK_PREFIX}reel-2`, title: "Pump drill", area: "Transition tempo", duration: "0:58" },
  { id: `${MOCK_PREFIX}reel-3`, title: "Wall posture drill", area: "Address posture", duration: "0:45" },
  { id: `${MOCK_PREFIX}reel-4`, title: "Towel under the arms", area: "Arm connection", duration: "0:36" },
  { id: `${MOCK_PREFIX}reel-5`, title: "Step-through drill", area: "Weight shift", duration: "1:04" },
  { id: `${MOCK_PREFIX}reel-6`, title: "Gate drill", area: "Strike", duration: "0:50" },
];
