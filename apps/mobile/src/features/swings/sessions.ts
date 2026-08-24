import type { SwingSummary } from "@swingsage/schema/contract";

import type { SessionType } from "../session/sessionState";

/**
 * The log's grouping: a practice **session** — a real row when capture minted one, inferred
 * from time when it did not.
 *
 * Both kinds exist in the same log and always will. Session mode mints a `sessions` row on the
 * first recorded swing and the contract carries its id (additive, D41), so those swings group by
 * a fact. Every swing recorded before session mode — and every swing whose session was deleted —
 * has no id, and for those a session is still what it is on a range: swings close together in
 * time, split at `SESSION_GAP_MS`. The screens never see the difference; a session that KNOWS
 * its name and mode simply says so, and one that does not abstains rather than inventing them.
 */

export interface SwingSession {
  /** The real session id when there is one, otherwise the oldest swing's id — either way stable
   *  across refreshes, which is what keys the accordion. */
  id: string;
  /** Epoch ms of the first and last swing. */
  start: number;
  end: number;
  /** Oldest first — the order that numbers them "#1…#N" the way they were hit. */
  swings: SwingSummary[];
  /** The best overall score in the session, or null when nothing scored — and always null for a
   *  quarantined session, whose swings never feed a durable number. */
  best: number | null;
  /**
   * The golfer's name for this session, or null when they never renamed it.
   *
   * Null is not "unnamed": it is what tells the log to keep its date title. The app's own
   * "Session 4" is a number it counted, and printing that back as if the golfer had chosen it
   * would make every session look named.
   */
  name: string | null;
  /**
   * Which mode it was recorded in — Analysis, Drills or Video.
   *
   * Null for a time-inferred session: there is no row to ask, and a mode on a session nobody
   * recorded under one would be a made-up claim about the golfer's own data.
   */
  sessionType: SessionType | null;
  /**
   * The real `sessions` rows this card stands for.
   *
   * Usually one, and it is the same value as `id`. A DAY card (`mergeByDay`) stands for every
   * session recorded that day, and deleting it has to remove all of them — a card that deleted
   * only the first would come back holding the rest. Empty for a time-inferred group, which has
   * no row on the server at all.
   */
  parts: string[];
}

/** What the log needs to know about a real session row — `useSessions`' rows, narrowed. */
export interface SessionMeta {
  id: string;
  name: string | null;
  sessionType: SessionType;
}

/**
 * Sessions whose swings never feed a durable number.
 *
 * Drills are reps, not swing attempts, and a video-only clip was never analysed — averaging
 * either into a golfer's history makes the history claim something they did not do. Excluded
 * means **absent**, never zero: a quarantined session still shows its own swings, still counts
 * as a session, and simply contributes no average, no best, and no trend point.
 */
export function isQuarantined(session: Pick<SwingSession, "sessionType">): boolean {
  return session.sessionType === "practice_drills" || session.sessionType === "video_only";
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
  // A drills or video-only session has no durable numbers to report — all four abstain rather
  // than reading 0, which a golfer would take as a score.
  if (isQuarantined(session)) return { avg: null, best: null, start: null, improvement: null };
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
    // Counts include everything the golfer did; averages do not. A drills session is still a
    // session they showed up for, and hiding it from the count would make the log look thinner
    // than their practice actually was.
    swings += session.swings.length;
    if (isQuarantined(session)) continue;
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

function bestOf(swings: SwingSummary[]): number | null {
  let best: number | null = null;
  for (const s of swings) {
    if (typeof s.overallScore === "number") {
      best = best === null ? s.overallScore : Math.max(best, s.overallScore);
    }
  }
  return best;
}

/**
 * Newest session first; swings inside each session oldest first.
 *
 * `meta` is the golfer's real session rows (`useSessions`). Pass it and every swing carrying a
 * `sessionId` groups by that id and gains its name and mode; leave it out — or lose the network
 * — and those swings still group by id, just without a name or a mode. Swings with no id fall
 * back to time inference, which is every swing recorded before session mode existed.
 */
export function sessionize(
  swings: SwingSummary[],
  meta?: readonly SessionMeta[],
): SwingSession[] {
  const byId = new Map((meta ?? []).map((m) => [m.id, m] as const));
  const ordered = [...swings].sort((a, b) => createdAtMs(a) - createdAtMs(b));

  // Real sessions first, keyed by the id the server minted. A session's swings are contiguous in
  // hit order but NOT necessarily contiguous in time against other sessions — a swing saved late,
  // or a second phone — so they are collected by id rather than by adjacency.
  const real = new Map<string, SwingSummary[]>();
  const loose: SwingSummary[] = [];
  for (const swing of ordered) {
    const id = swing.sessionId;
    if (typeof id === "string" && id.length > 0) {
      const group = real.get(id);
      if (group) group.push(swing);
      else real.set(id, [swing]);
    } else {
      loose.push(swing);
    }
  }

  const sessions: SwingSession[] = [];
  for (const [id, group] of real) {
    const row = byId.get(id);
    const session: SwingSession = {
      id,
      start: createdAtMs(group[0]),
      end: createdAtMs(group[group.length - 1]),
      swings: group,
      best: null,
      name: row?.name ?? null,
      sessionType: row?.sessionType ?? null,
      parts: [id],
    };
    // Quarantined sessions carry no best: it is a durable number and these swings do not produce
    // one. Computing it here and hiding it downstream is how one screen forgets to.
    session.best = isQuarantined(session) ? null : bestOf(group);
    sessions.push(session);
  }

  // Everything with no session row: the pre-session-mode log, grouped the way it always was.
  let current: SwingSession | null = null;
  for (const swing of loose) {
    const at = createdAtMs(swing);
    if (current && at - current.end <= SESSION_GAP_MS) {
      current.swings.push(swing);
      current.end = at;
      if (typeof swing.overallScore === "number") {
        current.best = Math.max(current.best ?? -Infinity, swing.overallScore);
      }
    } else {
      current = {
        id: swing.id,
        start: at,
        end: at,
        swings: [swing],
        best: typeof swing.overallScore === "number" ? swing.overallScore : null,
        name: null,
        sessionType: null,
        // Nothing on the server to delete — this group is an inference over loose swings.
        parts: [],
      };
      sessions.push(current);
    }
  }

  // One order over both kinds — newest first by when the session started, the same order the
  // purely time-inferred version produced.
  return sessions.sort((a, b) => b.start - a.start || b.end - a.end);
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

/**
 * How ONE swing was filmed, in the same vocabulary. Null when the swing says nothing usable —
 * an angle guessed from an empty `views` list is a claim about the golfer's own footage.
 */
export function swingAngle(swing: SwingSummary): CaptureAngle | null {
  const views = new Set(swing.views.map((v) => v.view));
  if (views.size >= 2) return "dual";
  const only = views.size === 1 ? [...views][0] : swing.view;
  return only === "dtl" || only === "face_on" ? only : null;
}

export function sessionAngles(session: SwingSession): CaptureAngle[] {
  const found = new Set<CaptureAngle>();
  for (const swing of session.swings) {
    const angle = swingAngle(swing);
    if (angle) found.add(angle);
  }
  return ANGLE_ORDER.filter((a) => found.has(a));
}

/**
 * One swing as the LOG presents it — which session it belongs to, and which ball of that session
 * it was.
 *
 * The number is the swing's place in HIT order (`sessionSwingItems`' rule, and the same number
 * the capture screen counted at the time), so a swing is called "Swing 3" wherever it appears.
 */
export interface SwingEntry {
  swing: SwingSummary;
  /** 1-based, oldest first within its session. */
  number: number;
  /** Epoch ms the session began — the date the swing page prints. */
  sessionStart: number;
}

/**
 * The whole log flattened into the order it is READ: newest session first, newest swing first
 * inside it. That is what the swing page swipes through, so a left swipe always moves the way
 * the log's own list moves and never invents a second ordering of the same data.
 */
export function swingOrder(swings: SwingSummary[], meta?: readonly SessionMeta[]): SwingEntry[] {
  const out: SwingEntry[] = [];
  // Merged by day, exactly as the log draws it — the number under a swing's picture has to be
  // the number on the row the golfer tapped.
  for (const session of mergeByDay(sessionize(swings, meta))) {
    for (let i = session.swings.length - 1; i >= 0; i -= 1) {
      out.push({ swing: session.swings[i], number: i + 1, sessionStart: session.start });
    }
  }
  return out;
}


/** `YYYY-MM-DD` in the phone's own timezone — the same key the import path dates a session by. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * One header per DAY (Taylor, 2026-08-22).
 *
 * A golfer went to the range on Saturday; they did not go three times because the app minted
 * three rows while they were there. Session rows are still how swings are grouped underneath —
 * `sessionize` is unchanged and every screen that reasons about a session's mode or its trend
 * point still sees them — but the log draws a day as one card, because "sessions are by date" is
 * what a session means to the person who hit the balls.
 *
 * A merged card carries `parts`, so deleting it removes every row it covers. Its name and its
 * mode survive only if the day AGREES on one: two differently-named sessions merged under one
 * of the two names would be putting a title on swings it was never given to.
 */
export function mergeByDay(sessions: SwingSession[]): SwingSession[] {
  const byDay = new Map<string, SwingSession[]>();
  for (const session of sessions) {
    const key = dayKey(session.start);
    const group = byDay.get(key);
    if (group) group.push(session);
    else byDay.set(key, [session]);
  }

  const days: SwingSession[] = [];
  for (const group of byDay.values()) {
    if (group.length === 1) {
      days.push(group[0]);
      continue;
    }
    const ordered = [...group].sort((a, b) => a.start - b.start);
    const swings = ordered
      .flatMap((s) => s.swings)
      .sort((a, b) => createdAtMs(a) - createdAtMs(b));
    const names = [...new Set(ordered.map((s) => s.name).filter((n): n is string => n != null))];
    const types = [...new Set(ordered.map((s) => s.sessionType))];
    const sessionType = types.length === 1 ? types[0] : null;
    const merged: SwingSession = {
      // The day's FIRST session id: stable across refreshes, which is what keys the accordion.
      id: ordered[0].id,
      start: ordered[0].start,
      end: ordered[ordered.length - 1].end,
      swings,
      best: null,
      name: names.length === 1 ? names[0] : null,
      sessionType,
      parts: ordered.flatMap((s) => s.parts),
    };
    // Quarantine survives the merge per PART, not per day: a drills hour inside a range visit
    // must not start feeding the day's best, and must not stop the rest of the day feeding it.
    merged.best = bestOf(
      ordered.filter((s) => !isQuarantined(s)).flatMap((s) => s.swings),
    );
    days.push(merged);
  }

  return days.sort((a, b) => b.start - a.start || b.end - a.end);
}
