import type { SwingSummary } from "@swingsage/schema/contract";

import { createdAtMs, type SwingSession } from "../swings/sessions";

/**
 * Progress's derivations — all-time records and the across-sessions trend, pure over the swing
 * list. Same discipline as `homeModel`: null/empty abstains, nothing is ever a fabricated zero.
 */

export interface ProgressStats {
  totalSwings: number;
  totalSessions: number;
  /** The best-scoring ready swing ever, or null when nothing scored. */
  best: { score: number; swingId: string; at: number } | null;
  /** Median tempo across scored swings — the median because one mis-detected outlier must not
   *  move the number a golfer tracks. Null under three samples: two swings are not a tendency. */
  medianTempo: number | null;
}

export function progressStats(swings: SwingSummary[], sessionCount: number): ProgressStats {
  let best: ProgressStats["best"] = null;
  const tempos: number[] = [];
  for (const s of swings) {
    if (s.status !== "ready") continue;
    if (typeof s.overallScore === "number" && (best === null || s.overallScore > best.score)) {
      best = { score: s.overallScore, swingId: s.id, at: createdAtMs(s) };
    }
    if (typeof s.tempoRatio === "number" && s.tempoRatio > 0) tempos.push(s.tempoRatio);
  }
  tempos.sort((a, b) => a - b);
  const medianTempo =
    tempos.length >= 3
      ? tempos.length % 2
        ? tempos[(tempos.length - 1) / 2]
        : (tempos[tempos.length / 2 - 1] + tempos[tempos.length / 2]) / 2
      : null;
  return { totalSwings: swings.length, totalSessions: sessionCount, best, medianTempo };
}

export interface SessionPoint {
  /** Mean overall score of the session's scored swings. */
  average: number;
  start: number;
}

/**
 * One point per session that actually scored something, oldest → newest, capped to the newest
 * `limit`. Averages rather than bests: a best rewards one lucky swing, an average moves when the
 * session as a whole did — which is the claim a progress chart makes.
 */
export function sessionAverages(sessions: SwingSession[], limit = 10): SessionPoint[] {
  const points: SessionPoint[] = [];
  // `sessionize` returns newest first; walk it and reverse at the end.
  for (const session of sessions) {
    const scores = session.swings
      .filter((s) => s.status === "ready" && typeof s.overallScore === "number")
      .map((s) => s.overallScore as number);
    if (!scores.length) continue;
    points.push({
      average: scores.reduce((a, b) => a + b, 0) / scores.length,
      start: session.start,
    });
    if (points.length === limit) break;
  }
  return points.reverse();
}
