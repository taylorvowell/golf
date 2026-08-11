import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTx } from "./session";
import { headMarkers, swings, swingViews } from "./schema";

/** A hand-placed club head, normalized 0–1 against the video frame. */
export interface HeadMarker {
  frame: number;
  x: number;
  y: number;
}

/**
 * Every hand-placed head for one VIEW, ordered by frame — which is the order the trace needs
 * them in, so no consumer has to re-sort.
 *
 * Keyed on the view rather than the swing since migration 0006: a marker is "the club head is
 * here on frame N", and frame N is a different instant in a face-on clip than in the
 * down-the-line one shot beside it.
 */
export async function listMarkers(tx: DbTx, viewId: string): Promise<HeadMarker[]> {
  const rows = await tx
    .select({ frame: headMarkers.frame, x: headMarkers.x, y: headMarkers.y })
    .from(headMarkers)
    .where(eq(headMarkers.viewId, viewId))
    .orderBy(headMarkers.frame);
  return rows;
}

/**
 * Apply one editing session: upsert the placed markers, delete the cleared frames.
 *
 * Batched rather than a request per frame. Correcting a swing by hand means touching tens of
 * frames in a couple of minutes, and a save per click would make the editor's behaviour depend
 * on request ordering — the last write for a frame would not reliably be the last click on it.
 * One transaction per save also means a half-applied correction is not a state the user can
 * reach.
 *
 * `userId` is checked against the view's owning swing rather than stored on the marker: markers
 * belong to a view, the view belongs to a swing, and the swing already carries the owner. Passing
 * it here is what stops one user's save landing on another user's swing.
 */
export async function saveMarkers(
  tx: DbTx,
  viewId: string,
  userId: string,
  upserts: HeadMarker[],
  deletes: number[],
): Promise<{ saved: number; deleted: number }> {
  const owned = await tx
    .select({ id: swingViews.id })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(and(eq(swingViews.id, viewId), eq(swings.userId, userId)));
  if (!owned[0]) throw new Error(`no such swing view for this user: ${viewId}`);

  const clean = upserts
    .filter((m) => Number.isFinite(m.frame) && m.frame >= 0
      && Number.isFinite(m.x) && Number.isFinite(m.y))
    // Normalized coordinates, like everything else in the artifact. A marker outside the frame
    // is a bug in the caller, not a position, so clamp rather than store it.
    .map((m) => ({
      viewId,
      frame: Math.round(m.frame),
      x: Math.min(1, Math.max(0, m.x)),
      y: Math.min(1, Math.max(0, m.y)),
    }));

  // No nested transaction: `tx` already is one. Every caller reaches this through `withUser`,
  // which wraps the whole request in a single transaction, so "a half-applied correction is not a
  // state the user can reach" now holds for the identity context too rather than only the writes.
  if (clean.length) {
    await tx.insert(headMarkers).values(clean).onConflictDoUpdate({
      target: [headMarkers.viewId, headMarkers.frame],
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        updatedAt: new Date(),
      },
    });
  }
  if (deletes.length) {
    await tx.delete(headMarkers).where(and(
      eq(headMarkers.viewId, viewId),
      inArray(headMarkers.frame, deletes.map((f) => Math.round(f))),
    ));
  }
  return { saved: clean.length, deleted: deletes.length };
}
