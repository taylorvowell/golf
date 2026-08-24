import type { Notification, NotificationListResponse } from "@swingsage/schema/contract";

import type { DbTx } from "@/db/session";
import type { NotificationKind, NotificationRow } from "@/db/schema";

/**
 * §29's notification backbone, server side. Three readers (list, unread count, ack) and one
 * writer. The writer goes through `app.notify()` — a SECURITY DEFINER function — because
 * emission crosses users (a coach action notifies a golfer) and RLS insert policies cannot
 * express that safely; see migration 0013's header for the whole argument. Everything here
 * takes a `DbTx` and therefore runs inside `withUser`, so RLS scopes every read and ack to
 * the caller no matter what the JS says.
 */

/** What an emitter provides. `groupKey` makes the event COLLAPSE while unread (D60). */
export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  groupKey?: string;
}

function toApi(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    data: row.data,
    groupKey: row.groupKey,
    count: row.count,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt ? row.readAt.getTime() : null,
  };
}

/**
 * Mint (or fold) a notification. Returns the row id — the EXISTING row's id when the event
 * grouped into an open row. Callable for any target user; the constraint that keeps that safe
 * is architectural: only server code inside `withUser` can reach `app.notify` at all.
 */
export async function notify(tx: DbTx, input: NotifyInput): Promise<string> {
  const { sql } = await import("drizzle-orm");
  const result = await tx.execute<{ notify: string }>(sql`
    select app.notify(
      ${input.userId}::uuid,
      ${input.kind},
      ${input.title},
      ${input.body ?? null},
      ${JSON.stringify(input.data ?? {})}::jsonb,
      ${input.groupKey ?? null}
    ) as notify
  `);
  return result[0].notify;
}

/**
 * The inbox: newest first, list and unread count in ONE answer so the bell and the inbox are
 * a single fetch. Capped rather than paginated for now — an inbox that needs page two has
 * already failed §29's "without becoming noisy"; history depth is a later, additive concern.
 */
export async function listNotifications(
  tx: DbTx,
  userId: string,
  limit = 100,
): Promise<NotificationListResponse> {
  const { notifications } = await import("../db/schema");
  const { eq, desc, and, isNull, count } = await import("drizzle-orm");

  const [rows, unread] = [
    await tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    await tx
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ];

  return { notifications: rows.map(toApi), unreadCount: unread[0].n };
}

/**
 * Ack: unread → read, own rows only (RLS enforces the "own" even if the ids are somebody
 * else's — those rows simply don't match). Re-acking a read row is a 0-count no-op, never an
 * error, because acks race: two devices, one inbox. Returns what the bell needs next.
 */
export async function markNotificationsRead(
  tx: DbTx,
  userId: string,
  target: { ids: string[] } | { all: true },
): Promise<{ acked: number; unreadCount: number }> {
  const { notifications } = await import("../db/schema");
  const { eq, and, isNull, inArray, count } = await import("drizzle-orm");

  const scope =
    "all" in target
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          inArray(notifications.id, target.ids),
        );

  const acked =
    "all" in target || target.ids.length > 0
      ? await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(scope)
          .returning({ id: notifications.id })
      : [];

  const unread = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return { acked: acked.length, unreadCount: unread[0].n };
}

/**
 * Dismiss: delete the caller's own rows, own rows only (RLS enforces the "own" even if the ids
 * are somebody else's — those rows simply don't match, so a cross-user id is a 0, never a leak
 * and never an error). Deleting an already-deleted row is 0 too: two devices share one inbox
 * and a sweep on one races the other.
 *
 * Returns the unread count AFTER the delete, because dismissing an unread row moves the bell —
 * without it the badge would keep counting a row that is no longer anywhere to be found.
 */
export async function dismissNotifications(
  tx: DbTx,
  userId: string,
  ids: string[],
): Promise<{ dismissed: number; unreadCount: number }> {
  const { notifications } = await import("../db/schema");
  const { eq, and, isNull, inArray, count } = await import("drizzle-orm");

  const dismissed =
    ids.length > 0
      ? await tx
          .delete(notifications)
          .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
          .returning({ id: notifications.id })
      : [];

  const unread = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return { dismissed: dismissed.length, unreadCount: unread[0].n };
}
