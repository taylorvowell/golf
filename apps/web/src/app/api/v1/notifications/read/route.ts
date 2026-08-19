import type { NotificationAckRequest } from "@swingsage/schema/contract";

import { requireUserIdOrNull } from "@/lib/auth";
import { withUser } from "@/db/session";
import { markNotificationsRead } from "@/lib/notifications";

/**
 * Ack notifications — ids in the BODY, deliberately not an /:id route: acks arrive in batches
 * (opening the inbox acks everything visible), and route-auth's `[id]` rule is swing-shaped.
 * Re-acking is a 0-count success, never an error — two devices race on one inbox.
 */
export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  let body: NotificationAckRequest;
  try {
    body = (await req.json()) as NotificationAckRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
  if (body.all !== true && ids.length === 0) {
    return Response.json(
      { error: "empty_ack", message: "Provide ids, or all: true." },
      { status: 400 },
    );
  }

  const result = await withUser(userId, (tx) =>
    markNotificationsRead(tx, userId, body.all === true ? { all: true } : { ids }),
  );
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
