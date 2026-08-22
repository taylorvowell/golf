import type { SessionPatchRequest } from "@swingsage/schema/contract";

import { withUser } from "@/db/session";
import { requireUserIdOrNull } from "@/lib/auth";
import { SessionError, isSessionType, normalizeName, updateSession } from "@/lib/sessions";

const noStore = { "Cache-Control": "no-store" };

/**
 * `PATCH /api/v1/sessions/:id` — rename a session, or retype one that is still empty.
 *
 * Partial like the profile patch: a screen sends only what it edits, so a build written before
 * a field existed cannot erase it. `name: null` is a real value — the golfer clearing the name
 * back to the log's date title — which is why absent and null mean different things here.
 *
 * No PUT and no DELETE. Deleting a session would be a decision about the swings inside it, and
 * D29 makes a session an organizing layer over swings rather than their owner; that surface
 * belongs to the swing log, where the golfer can see what they are about to reorganize.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { id } = await params;

  let body: SessionPatchRequest;
  try {
    body = (await req.json()) as SessionPatchRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: noStore });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  if (body.sessionType !== undefined && !isSessionType(body.sessionType)) {
    return Response.json(
      { error: "invalid_session_type", message: "sessionType must be one of the SessionType values" },
      { status: 400, headers: noStore },
    );
  }

  const patch: { name?: string | null; sessionType?: SessionPatchRequest["sessionType"] } = {};
  if ("name" in body) patch.name = normalizeName(body.name);
  if (body.sessionType !== undefined) patch.sessionType = body.sessionType;

  try {
    const session = await withUser(userId, (tx) => updateSession(tx, userId, id, patch));
    // 404 covers both "no such session" and "not yours" on purpose — RLS makes them the same
    // query result, and saying which would confirm the existence of another golfer's session.
    if (!session) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    return Response.json({ session }, { headers: noStore });
  } catch (err) {
    if (err instanceof SessionError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: 409, headers: noStore },
      );
    }
    console.error("[sessions] patch failed", err);
    return Response.json({ error: "update_failed" }, { status: 500, headers: noStore });
  }
}
