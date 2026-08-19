import { requireUserIdOrNull } from "@/lib/auth";
import { withUser } from "@/db/session";
import { listNotifications } from "@/lib/notifications";

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
