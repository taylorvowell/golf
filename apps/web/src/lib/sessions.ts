import type { SessionSummary } from "@swingsage/schema/contract";

import type { DbTx } from "@/db/session";

/**
 * The practice session — the organizing layer over swings (D29), now that a capture flow
 * actually mints one.
 *
 * Two rules live here rather than in the route handlers, because both are about the DATA and
 * would otherwise have to be remembered by every future caller:
 *
 *   * **A session's type locks once it has swings.** Every swing in a session was captured
 *     under one promise — analysed, drilled, or filmed — and `practice_drills`/`video_only`
 *     are quarantined from durable averages. Flipping the type afterwards silently rewrites
 *     what a golfer's history claims about swings they already hit.
 *   * **`name` is null until the golfer renames it.** The client's "Session 3" is a number the
 *     app counted, not a name a person chose, and the swing log's title rule depends on being
 *     able to tell those apart.
 *
 * Access control is row-level, not checked here: every function takes a `DbTx` from `withUser`,
 * so `sessions_write` (owner only) and `sessions_select` (owner or approved coach) decide what
 * a query can see. A session id belonging to someone else simply matches no row — the caller
 * gets `null` and answers 404, which is also the right answer for "does not exist" and does not
 * leak which of the two it was.
 */

export type SessionType = SessionSummary["sessionType"];

const SESSION_TYPES: readonly SessionType[] = [
  "swing_analysis",
  "practice_drills",
  "video_only",
];

export function isSessionType(v: unknown): v is SessionType {
  return typeof v === "string" && (SESSION_TYPES as readonly string[]).includes(v);
}

/** `YYYY-MM-DD` — the client states it because only the phone knows the golfer's timezone. */
export function isCalendarDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * A name the golfer typed, or null.
 *
 * Whitespace-only collapses to null rather than being stored: an empty title is the golfer
 * clearing the name, which is the same state as never having set one.
 */
export function normalizeName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 120);
}

export class SessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface SessionRow {
  id: string;
  date: string;
  name: string | null;
  sessionType: SessionType;
  createdAt: Date;
}

function toSummary(row: SessionRow, swingCount: number): SessionSummary {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    sessionType: row.sessionType,
    swingCount,
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * The caller's sessions, newest first, each with the number of swings pointing at it.
 *
 * The count comes from a left join rather than a subquery per row so the list is one query, and
 * it is what the client numbers the next default name from — "Session N" is N sessions, not N
 * swings, and inferring it client-side from the swing log was only ever an approximation.
 */
export async function listSessions(tx: DbTx, userId: string): Promise<SessionSummary[]> {
  const { sessions, swings } = await import("../db/schema");
  const { eq, desc, sql } = await import("drizzle-orm");

  const rows = await tx
    .select({
      id: sessions.id,
      date: sessions.date,
      name: sessions.name,
      sessionType: sessions.sessionType,
      createdAt: sessions.createdAt,
      swingCount: sql<number>`count(${swings.id})::int`,
    })
    .from(sessions)
    .leftJoin(swings, eq(swings.sessionId, sessions.id))
    .where(eq(sessions.userId, userId))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.createdAt));

  return rows.map((r) => toSummary(r, r.swingCount));
}

export async function createSession(
  tx: DbTx,
  userId: string,
  input: { name?: string | null; sessionType?: SessionType; date?: string },
): Promise<SessionSummary> {
  const { sessions } = await import("../db/schema");

  const [row] = await tx
    .insert(sessions)
    .values({
      userId,
      // The client's day, not the server's: a golfer hitting balls at 9pm Pacific is not
      // practising tomorrow, which is what a UTC date would claim.
      date: input.date ?? new Date().toISOString().slice(0, 10),
      name: input.name ?? null,
      sessionType: input.sessionType ?? "swing_analysis",
    })
    .returning({
      id: sessions.id,
      date: sessions.date,
      name: sessions.name,
      sessionType: sessions.sessionType,
      createdAt: sessions.createdAt,
    });

  // A brand-new session has no swings by construction — the mint happens on the first one.
  return toSummary(row, 0);
}

/**
 * Rename, and — only while the session is still empty — retype.
 *
 * Returns null when no such session belongs to the caller. Throws `SessionError` when the
 * request is understood and refused, which is a different answer from "not found" and reaches
 * the client as a 409 it can explain.
 */
export async function updateSession(
  tx: DbTx,
  userId: string,
  sessionId: string,
  patch: { name?: string | null; sessionType?: SessionType },
): Promise<SessionSummary | null> {
  const { sessions, swings } = await import("../db/schema");
  const { and, eq, sql } = await import("drizzle-orm");

  const [existing] = await tx
    .select({
      id: sessions.id,
      date: sessions.date,
      name: sessions.name,
      sessionType: sessions.sessionType,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

  if (!existing) return null;

  // A separate count rather than a correlated subquery in the select above: this number decides
  // whether the type is locked, so it has to be obviously right rather than one round trip
  // cheaper. Both statements run inside the same `withUser` transaction, so they see one
  // consistent snapshot.
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(swings)
    .where(eq(swings.sessionId, sessionId));
  const swingCount = counted?.n ?? 0;

  if (
    patch.sessionType !== undefined &&
    patch.sessionType !== existing.sessionType &&
    swingCount > 0
  ) {
    throw new SessionError(
      "type_locked",
      "This session already has swings in it, so its type is fixed — every swing in it was " +
        "recorded under that mode.",
    );
  }

  const values: { name?: string | null; sessionType?: SessionType } = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.sessionType !== undefined) values.sessionType = patch.sessionType;
  if (Object.keys(values).length === 0) return toSummary(existing, swingCount);

  const [row] = await tx
    .update(sessions)
    .set(values)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({
      id: sessions.id,
      date: sessions.date,
      name: sessions.name,
      sessionType: sessions.sessionType,
      createdAt: sessions.createdAt,
    });

  return row ? toSummary(row, swingCount) : null;
}
