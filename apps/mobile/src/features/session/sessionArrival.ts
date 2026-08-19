/**
 * The hand-off between ending a session and the Swing Log's arrival moment (Taylor,
 * step-03 iteration): end session stages what just happened, the log takes it exactly once
 * and plays the save → land → count-up sequence.
 *
 * Module-level and consumed-once on purpose — the arrival is a MOMENT, not state: a log
 * visit that didn't come from ending a session must never replay it, and neither must a
 * remount. In the UI phase the "save" is theatre (nothing persists yet); step 05 keeps this
 * exact seam and stages it when the real session row is confirmed.
 */

import type { SessionType } from "./sessionState";

export interface SessionArrival {
  /** The session's display title ("Session 3" or the golfer's rename). */
  title: string;
  swings: number;
  at: number;
  /** Which mode it was recorded in — the log's session row shows it. */
  sessionType: SessionType;
}

let pending: SessionArrival | null = null;

export function stageSessionArrival(arrival: SessionArrival): void {
  pending = arrival;
}

/** Returns the staged arrival and clears it — one consumer, one playback. */
export function takeSessionArrival(): SessionArrival | null {
  const taken = pending;
  pending = null;
  return taken;
}
