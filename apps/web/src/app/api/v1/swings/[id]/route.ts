import { sql } from "drizzle-orm";
import type { SwingDeletion } from "@swingsage/schema/contract";

import { withUser } from "@/db/session";
import { isUuid } from "@/db/views";
import { requireUserIdOrNull } from "@/lib/auth";
import { ARTIFACT_BUCKET, SOURCE_BUCKET, swingPrefix } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

/**
 * DELETE /api/v1/swings/:id — remove one swing: its views, artifacts, scores, markers, stages,
 * jobs, and the uploaded video itself.
 *
 * **Owner only, never a coach.** Read access to a swing is owner-or-approved-coach everywhere
 * else, and this route deliberately does not reuse that check: a coach reviews a golfer's swing
 * and never edits it (§24.3), and deletion is the strongest edit there is. The ownership check
 * here is belt to the RLS braces — `swings_write` is owner-only, so even a bug in this file
 * cannot delete across accounts.
 *
 * **The order is `deleteAccount`'s order, for `deleteAccount`'s reason.** Media first: if the
 * sweep fails nothing is lost — the rows still point at the objects and the caller retries. Rows
 * second, one cascading delete. Failing the other way round orphans bytes nothing references and
 * nobody can enumerate.
 *
 * **Emptying a session deletes it** (Taylor, 2026-08-22). A session is an organizing layer over
 * swings (D29) and means nothing without any, so once this swing is gone the session it belonged
 * to is removed if nothing else points at it. That is the ONLY way a session is deleted — there
 * is no `DELETE /sessions/:id`, deliberately, because a delete of its own would be a second and
 * blunter way to destroy swings. The id is reported back so a client's cached log drops the row
 * instead of drawing a session with nothing in it.
 *
 * 404 covers "no such swing" and "not yours" alike — confirming a stranger's id is real is
 * itself a disclosure, the same stance `requireViewAccess` takes.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  if (!isUuid(id)) return new Response("not found", { status: 404 });

  // Ownership established before anything is touched, so the media sweep below can never run
  // for a swing the caller does not own — the prefix embeds the caller's own user id anyway,
  // but a sweep that 404s afterwards would still have deleted the caller's objects for nothing.
  const owned = await withUser(userId, (tx) =>
    tx.execute<{ id: string; session_id: string | null }>(
      sql`select id, session_id from public.swings where id = ${id} and user_id = ${userId}`,
    ),
  );
  if (!owned[0]) return new Response("not found", { status: 404 });
  const sessionId = owned[0].session_id;

  try {
    const store = await getMediaStore();
    const prefix = swingPrefix(userId, id);
    // Both buckets — the untrimmed original lives in one and everything derived in the other
    // (D29). Sweeping only artifacts would leave the actual video of the golfer behind.
    let mediaObjects = 0;
    for (const bucket of [SOURCE_BUCKET, ARTIFACT_BUCKET]) {
      mediaObjects += await store.removePrefix(bucket, prefix);
    }

    // The emptiness check runs INSIDE the same transaction as the swing's own delete, so two
    // concurrent deletes of a session's last two swings cannot both read "one swing left" and
    // both leave the session standing.
    const sessionDeleted = await withUser(userId, async (tx) => {
      await tx.execute(sql`delete from public.swings where id = ${id} and user_id = ${userId}`);
      if (!sessionId) return null;
      const left = await tx.execute<{ id: string }>(
        sql`select id from public.swings where session_id = ${sessionId} and user_id = ${userId} limit 1`,
      );
      if (left[0]) return null;
      await tx.execute(
        sql`delete from public.sessions where id = ${sessionId} and user_id = ${userId}`,
      );
      return sessionId;
    });

    const body: SwingDeletion = { swingId: id, mediaObjects, sessionDeleted };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Reported, never swallowed — and every step above is ordered to be retryable, so the honest
    // answer to a partial deletion is "try again", not a success the log will contradict.
    console.error(`[swings] deletion failed for ${id}`, err);
    return Response.json(
      {
        error: "deletion_failed",
        message: "The swing was not fully deleted. A retry can finish the job.",
      },
      { status: 500 },
    );
  }
}
