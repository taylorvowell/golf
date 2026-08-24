import type { NotificationDismissRequest } from "@swingsage/schema/contract";

import { requireUserIdOrNull } from "@/lib/auth";
import { withUser } from "@/db/session";
import { dismissNotifications, listNotifications } from "@/lib/notifications";

/**
 * The inbox and the bell in one answer: `{ notifications, unreadCount }`. One fetch, because
 * the bell polls-on-open and must never cost two round trips (§29's surface is read far more
 * often than it changes).
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  const body = await withUser(userId, (tx) => listNotifications(tx, userId));
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Dismiss rows — the X on an inbox row, and eventually a sweep.
 *
 * Ids travel in the body rather than as `/notifications/[id]`, matching the ack for the reason
 * the ack documents: this surface is acted on in batches, and route-auth's `[id]` rule is
 * swing-shaped. It hangs off the collection route rather than its own path so the delete cannot
 * be reached by anything that has not already passed this file's identity guard.
 */
export async function DELETE(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  let body: NotificationDismissRequest;
  try {
    body = (await req.json()) as NotificationDismissRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  // Shape-checked here, not in the query: `id` is a uuid column, so a malformed string is a
  // Postgres cast error — a 500 about our internals for what is plainly a bad request.
  const ids = Array.isArray(body.ids)
    ? body.ids.filter(
        (id): id is string =>
          typeof id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      )
    : [];
  if (ids.length === 0) {
    return Response.json(
      { error: "empty_dismiss", message: "Provide the ids to dismiss." },
      { status: 400 },
    );
  }

  const result = await withUser(userId, (tx) => dismissNotifications(tx, userId, ids));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
