import type { SwingSummary } from "@swingsage/schema/contract";

import { SESSION_GAP_MS, isQuarantined, type SwingSession } from "../swings/sessions";
import type { SessionReport } from "./useSessionReports";

/**
 * The home screen's derivations — pure functions over data the app already holds, so every claim
 * on the screen is testable without a renderer.
 *
 * Two sources feed it. The swing list gives the **session story** (when, how many, best, average,
 * the score trend). The coach reports of the latest session's scored swings give the **focus** —
 * and the aggregation is the point: one swing's top priority is one swing's opinion, but the
 * priority that keeps appearing across a session is what actually needs work next time out.
 * Everything here abstains with `null`/empty rather than guessing; a section with no data is not
 * rendered.
 */

export interface SessionStats {
  session: SwingSession;
  /** The latest session is "live" while `now` is within the session gap of its last swing — the
   *  golfer is plausibly still at the range, and the screen reads "today, so far" not "last time". */
  live: boolean;
  /** Overall scores of the session's ready swings, oldest → newest — the trend line's input. */
  scores: number[];
  best: number | null;
  /** The ready swing carrying the best score — the "watch it" deep link. */
  bestSwingId: string | null;
  average: number | null;
  /** This session's average minus the previous session's, rounded. Null unless both scored. */
  deltaVsPrevious: number | null;
  /** Swings still working through the analyzer — explains scores that have not arrived yet. */
  analysing: number;
}

/**
 * The session's scored swings — empty for a drills or video-only session.
 *
 * Quarantine is applied at the session, not per swing: a drill rep that happened to get analysed
 * still is not a swing attempt, and letting one through would put a number on the home screen
 * that the golfer's history does not stand behind.
 */
function scoredOf(session: SwingSession): SwingSummary[] {
  if (isQuarantined(session)) return [];
  return session.swings.filter((s) => s.status === "ready" && typeof s.overallScore === "number");
}

function averageOf(scores: number[]): number | null {
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/** Stats for the newest session, with the one behind it as the comparison. Null when no swings. */
export function latestSessionStats(sessions: SwingSession[], now: number): SessionStats | null {
  const latest = sessions[0];
  if (!latest) return null;

  const scored = scoredOf(latest);
  const scores = scored.map((s) => s.overallScore as number);
  const average = averageOf(scores);
  const previousAverage = sessions[1]
    ? averageOf(scoredOf(sessions[1]).map((s) => s.overallScore as number))
    : null;

  let bestSwingId: string | null = null;
  for (const s of scored) {
    if (latest.best !== null && (s.overallScore as number) >= latest.best) bestSwingId = s.id;
  }

  return {
    session: latest,
    live: now - latest.end <= SESSION_GAP_MS,
    scores,
    best: latest.best,
    bestSwingId,
    average,
    deltaVsPrevious:
      average !== null && previousAverage !== null ? Math.round(average - previousAverage) : null,
    analysing: latest.swings.filter((s) => s.status !== "ready" && s.status !== "failed").length,
  };
}

export interface FocusItem {
  key: string;
  label: string;
  /** The plain-language "what to do differently", from the newest report that ranked this. */
  cue: string;
  /** How many of the session's scored reports ranked it — the recurrence that earns the top slot. */
  seenIn: number;
  reportCount: number;
  /** The newest swing whose report ranked this — the one to show and to open ("see it on YOUR
   *  swing" has to mean a specific swing, not the idea of one). */
  exemplarId: string;
  /** That priority's checkpoint P-code (`P1`, `P4`…), for parking the player at the moment. */
  checkpoint: string | null;
  /** How a golfer says the checkpoint ("Address", "Top") — from the report, never invented. */
  checkpointLabel: string | null;
}

/**
 * The session's priorities, merged across its reports and ranked by **recurrence first, mean
 * leverage second**. A fault the scorer flagged on four swings out of six is the thing to bring
 * to the next session; a one-off with a big leverage number is not a pattern yet. Reports arrive
 * oldest → newest, so the newest wording of a cue — and the newest exemplar swing — win.
 */
export function aggregateFocus(reports: SessionReport[]): FocusItem[] {
  const byKey = new Map<
    string,
    {
      label: string;
      cue: string;
      seenIn: number;
      leverage: number;
      exemplarId: string;
      checkpoint: string | null;
      checkpointLabel: string | null;
    }
  >();
  for (const { swingId, report } of reports) {
    for (const p of report.priorities ?? []) {
      const entry =
        byKey.get(p.key) ??
        {
          label: p.label,
          cue: p.cue,
          seenIn: 0,
          leverage: 0,
          exemplarId: swingId,
          checkpoint: p.checkpoint ?? null,
          checkpointLabel: null,
        };
      entry.seenIn += 1;
      entry.leverage += p.leverage;
      entry.label = p.label;
      entry.cue = p.cue;
      entry.exemplarId = swingId;
      entry.checkpoint = p.checkpoint ?? null;
      // Found by VALUE, not by key — the map's key shape is the report's business, `p` is ours.
      entry.checkpointLabel = p.checkpoint
        ? (Object.values(report.checkpoints ?? {}).find((c) => c.p === p.checkpoint)?.label ?? null)
        : null;
      byKey.set(p.key, entry);
    }
  }
  return [...byKey.entries()]
    .sort(
      ([, a], [, b]) =>
        b.seenIn - a.seenIn || b.leverage / b.seenIn - a.leverage / a.seenIn,
    )
    .map(([key, e]) => ({
      key,
      label: e.label,
      cue: e.cue,
      seenIn: e.seenIn,
      reportCount: reports.length,
      exemplarId: e.exemplarId,
      checkpoint: e.checkpoint,
      checkpointLabel: e.checkpointLabel,
    }));
}

export interface DrillPick {
  title: string;
  dose: string;
}

/** The newest report's drill — the config already chose it to match that swing's primary fault. */
export function latestDrill(reports: SessionReport[]): DrillPick | null {
  for (let i = reports.length - 1; i >= 0; i--) {
    const drill = reports[i].report.drill;
    if (drill?.title) return { title: drill.title, dose: drill.dose };
  }
  return null;
}
