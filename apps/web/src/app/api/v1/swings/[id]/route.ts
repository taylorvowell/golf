import { sql } from "drizzle-orm";
import type { SwingDeletion, SwingPatchRequest } from "@swingsage/schema/contract";

import { withUser } from "@/db/session";
import { isUuid } from "@/db/views";
import { requireUserIdOrNull } from "@/lib/auth";
import { ARTIFACT_BUCKET, SOURCE_BUCKET, swingPrefix } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { listSwings, setSwingFavourite } from "@/lib/swings";

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

const noStore = { "Cache-Control": "no-store" };

/**
 * `PATCH /api/v1/swings/:id` — today, one field: whether the golfer starred this swing (§7.3).
 *
 * Partial like the session and profile patches, and for the same reason: a screen sends only
 * what it edits, so an older build cannot erase a field it was never told about. An empty patch
 * is a no-op answered with the current row, not a 400 — there is nothing wrong with it.
 *
 * **Owner only, never a coach** — the same line `DELETE` above draws. A coach reads a golfer's
 * swing through the relationship boundary and may not restyle their log, so this route does not
 * reuse the owner-or-approved-coach check that the read routes share.
 *
 * Answers the whole updated `SwingSummary` rather than 204, so the client writes its cache from
 * the CONFIRMED row instead of from what it hoped it sent — the same discipline the swing list
 * and the deletion response follow.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  if (!isUuid(id)) return new Response("not found", { status: 404 });

  let body: SwingPatchRequest;
  try {
    body = (await req.json()) as SwingPatchRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: noStore });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  if (body.favourite !== undefined && typeof body.favourite !== "boolean") {
    return Response.json(
      { error: "invalid_favourite", message: "favourite must be a boolean" },
      { status: 400, headers: noStore },
    );
  }

  const swing = await withUser(userId, async (tx) => {
    if (body.favourite !== undefined) {
      const updated = await setSwingFavourite(tx, userId, id, body.favourite);
      // Null means no such swing, or not this caller's — 404 for both, as DELETE does.
      if (updated === null) return null;
    }
    // Re-read through the same helper the log uses, so the answer cannot drift from what a
    // refresh would show. One extra query on an action a golfer takes by hand.
    return (await listSwings(tx, userId)).find((s) => s.id === id) ?? null;
  });

  if (!swing) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
  return Response.json({ swing }, { headers: noStore });
}
