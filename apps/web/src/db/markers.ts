import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { headMarkers, swings } from "./schema";

/** A hand-placed club head, normalized 0–1 against the video frame. */
export interface HeadMarker {
  frame: number;
  x: number;
  y: number;
}

/**
 * Every hand-placed head for a swing, ordered by frame — which is the order the trace needs
 * them in, so no consumer has to re-sort.
 */
export async function listMarkers(swingId: string): Promise<HeadMarker[]> {
  const rows = await db
    .select({ frame: headMarkers.frame, x: headMarkers.x, y: headMarkers.y })
    .from(headMarkers)
    .where(eq(headMarkers.swingId, swingId))
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
 * `userId` is checked against the swing rather than stored on the marker: markers belong to the
 * swing, and the swing already carries the owner. Passing it here is what stops one user's save
 * landing on another user's swing once real auth exists (D38).
 */
export async function saveMarkers(
  swingId: string,
  userId: string,
  upserts: HeadMarker[],
  deletes: number[],
): Promise<{ saved: number; deleted: number }> {
  const owned = await db
    .select({ id: swings.id })
    .from(swings)
    .where(and(eq(swings.id, swingId), eq(swings.userId, userId)));
  if (!owned[0]) throw new Error(`no such swing for this user: ${swingId}`);

  const clean = upserts
    .filter((m) => Number.isFinite(m.frame) && m.frame >= 0
      && Number.isFinite(m.x) && Number.isFinite(m.y))
    // Normalized coordinates, like everything else in the artifact. A marker outside the frame
    // is a bug in the caller, not a position, so clamp rather than store it.
    .map((m) => ({
      swingId,
      frame: Math.round(m.frame),
      x: Math.min(1, Math.max(0, m.x)),
      y: Math.min(1, Math.max(0, m.y)),
    }));

  await db.transaction(async (tx) => {
    if (clean.length) {
      await tx.insert(headMarkers).values(clean).onConflictDoUpdate({
        target: [headMarkers.swingId, headMarkers.frame],
        set: {
          x: sql`excluded.x`,
          y: sql`excluded.y`,
          updatedAt: new Date(),
        },
      });
    }
    if (deletes.length) {
      await tx.delete(headMarkers).where(and(
        eq(headMarkers.swingId, swingId),
        inArray(headMarkers.frame, deletes.map((f) => Math.round(f))),
      ));
    }
  });
  return { saved: clean.length, deleted: deletes.length };
}
