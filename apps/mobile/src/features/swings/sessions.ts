import type { SwingSummary } from "@swingsage/schema/contract";

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
}

/** Two hours. A lunch break splits a day into two sessions; a slow range visit does not. */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

/** `createdAt` arrives as seconds or milliseconds depending on writer age — normalized once. */
export function createdAtMs(swing: Pick<SwingSummary, "createdAt">): number {
  return swing.createdAt < 1e12 ? swing.createdAt * 1000 : swing.createdAt;
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
      });
    }
  }
  return sessions.reverse();
}
