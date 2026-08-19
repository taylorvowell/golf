import type { SwingSummary } from "@swingsage/schema/contract";

import type { SessionType } from "../session/sessionState";

/**
 * The log's grouping: a practice **session**, inferred from time.
 *
 * The database has a sessions table, but the contract does not carry a session id yet and no
 * capture flow creates session rows — so until it does, a session is what it is on a range:
 * swings close together in time. Two swings more than `SESSION_GAP_MS` apart are different
 * visits. When capture starts minting real sessions, the contract grows `sessionId` (additive,
 * D41) and this module switches to grouping by it; the screens never see the difference.
 */

export interface SwingSession {
  /** The oldest swing's id — stable across refreshes, which keys the accordion. */
  id: string;
  /** Epoch ms of the first and last swing. */
  start: number;
  end: number;
  /** Oldest first — the order that numbers them "#1…#N" the way they were hit. */
  swings: SwingSummary[];
  /** The best overall score in the session, or null when nothing scored. */
  best: number | null;
  /**
   * Which mode it was recorded in — Analysis, Drills or Video.
   *
   * NULL for every session on the log today, and that is not an oversight: no capture flow
   * persists a session row yet (`sessions` is empty and the contract carries no session id),
   * so a mode on an older session would be a made-up claim about the golfer's own data. The
   * one session that DOES know is the one just ended, which carries it on the arrival seam.
   * Session-mode step 05 persists the row and this stops being null.
   */
  sessionType: SessionType | null;
}

/** Two hours. A lunch break splits a day into two sessions; a slow range visit does not. */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

/** `createdAt` arrives as seconds or milliseconds depending on writer age — normalized once. */
export function createdAtMs(swing: Pick<SwingSummary, "createdAt">): number {
  return swing.createdAt < 1e12 ? swing.createdAt * 1000 : swing.createdAt;
}

/**
 * The Ideal Swing log's derived numbers (design-system step 05). All deterministic reads of
 * scored swings — no AI, no server round-trip; an unscored swing never contributes.
 */
export interface SessionStats {
  /** Rounded mean of scored swings, or null when nothing scored. */
  avg: number | null;
  best: number | null;
  /** The first scored swing's score — the "74 start" label. */
  start: number | null;
  /** Last scored minus first scored — the "+7 improvement" label. Null under 2 scored. */
  improvement: number | null;
}

export function sessionStats(session: SwingSession): SessionStats {
  const scored = session.swings
    .map((s) => s.overallScore)
    .filter((v): v is number => typeof v === "number");
  if (!scored.length) return { avg: null, best: null, start: null, improvement: null };
  const avg = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  const start = Math.round(scored[0]);
  const last = Math.round(scored[scored.length - 1]);
  return {
    avg,
    best: Math.round(Math.max(...scored)),
    start,
    improvement: scored.length >= 2 ? last - start : null,
  };
}

/** The whole log in four numbers — the hero's overview (counts + all-swings average). */
export interface LogStats {
  sessions: number;
  swings: number;
  /** Rounded mean over every scored swing in the log, or null when nothing scored. */
  avg: number | null;
  best: number | null;
}

export function logStats(sessions: SwingSession[]): LogStats {
  let swings = 0;
  const scored: number[] = [];
  for (const session of sessions) {
    swings += session.swings.length;
    for (const swing of session.swings) {
      if (typeof swing.overallScore === "number") scored.push(swing.overallScore);
    }
  }
  return {
    sessions: sessions.length,
    swings,
    avg: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    best: scored.length ? Math.round(Math.max(...scored)) : null,
  };
}

/** Newest session first; swings inside each session oldest first. */
export function sessionize(swings: SwingSummary[]): SwingSession[] {
  const ordered = [...swings].sort((a, b) => createdAtMs(a) - createdAtMs(b));
  const sessions: SwingSession[] = [];
  for (const swing of ordered) {
    const at = createdAtMs(swing);
    const current = sessions[sessions.length - 1];
    if (current && at - current.end <= SESSION_GAP_MS) {
      current.swings.push(swing);
      current.end = at;
      if (typeof swing.overallScore === "number") {
        current.best = Math.max(current.best ?? -Infinity, swing.overallScore);
      }
    } else {
      sessions.push({
        id: swing.id,
        start: at,
        end: at,
        swings: [swing],
        best: typeof swing.overallScore === "number" ? swing.overallScore : null,
        sessionType: null,
      });
    }
  }
  return sessions.reverse();
}

/**
 * How a session was filmed — the camera setup, per swing, collapsed to what the log needs.
 *
 * `dual` is not a third camera angle; it is a swing that carries BOTH, and it earns its own
 * label because filming from two angles at once is the thing that makes a session's numbers
 * more trustworthy than a single view's. A session that mixed setups reports each one it used
 * rather than picking a winner.
 *
 * Reads `views` and falls back to the swing's rolled-up `view` string, because a swing written
 * before per-view rows existed still has to say something truthful.
 */
export type CaptureAngle = "dtl" | "face_on" | "dual";

/** Fixed order, so the row does not reshuffle between sessions. */
const ANGLE_ORDER: CaptureAngle[] = ["dual", "dtl", "face_on"];

/** The capture modes, as the log names them — the dock's own short labels. */
export const MODE_LABEL: Record<SessionType, string> = {
  swing_analysis: "Analysis",
  practice_drills: "Drills",
  video_only: "Video",
};

export const ANGLE_LABEL: Record<CaptureAngle, string> = {
  dtl: "DTL",
  face_on: "Front",
  dual: "Dual",
};

export function sessionAngles(session: SwingSession): CaptureAngle[] {
  const found = new Set<CaptureAngle>();
  for (const swing of session.swings) {
    const views = new Set(swing.views.map((v) => v.view));
    if (views.size >= 2) found.add("dual");
    else if (views.size === 1) found.add([...views][0]);
    else if (swing.view === "dtl" || swing.view === "face_on") found.add(swing.view);
  }
  return ANGLE_ORDER.filter((a) => found.has(a));
}
