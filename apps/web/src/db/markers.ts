import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTx } from "./session";
import { headMarkers, swings, swingViews } from "./schema";

/** A hand-placed club head, normalized 0–1 against the video frame — or a hand-asserted
 * "no visible head on this frame" (`hidden`, which carries no coordinates). */
export type HeadMarker =
  | {
      frame: number;
      x: number;
      y: number;
      hidden?: undefined;
      /** The position is a motion-streak midpoint, not a sharp head — an estimate. Absent
       * (never `false`) on sharp rows. */
      blurred?: true;
      /**
       * The row was placed against a DIFFERENT artifact clock than the view currently shows
       * (its stamped fps disagrees with the view's fps — C10). A stale frame number names the
       * wrong instant, so clients dim or hide these and never merge them as truth. Absent
       * (never `false`) on live rows, so old clients that don't know the field see no change.
       */
      stale?: true;
    }
  | {
      frame: number;
      x?: undefined;
      y?: undefined;
      /** A human looked at this frame and the club head is NOT visible. No position exists. */
      hidden: true;
      blurred?: undefined;
      stale?: true;
    };

/**
 * Every hand-placed head for one VIEW, ordered by frame — which is the order the trace needs
 * them in, so no consumer has to re-sort.
 *
 * Keyed on the view rather than the swing since migration 0006: a marker is "the club head is
 * here on frame N", and frame N is a different instant in a face-on clip than in the
 * down-the-line one shot beside it.
 *
 * Staleness is DERIVED here, not stored: the truth is "row fps ≠ view fps right now", and a
 * stored flag would be one more thing a re-analysis could forget to update. A row with no
 * stamped fps (pre-provenance, view never analysed) is served live — flagging it would hide
 * corrections that were valid for the whole life of this feature.
 *
 * `includeHidden` is OPT-IN (the editor asks for it): a hidden marker is a row with no
 * coordinates, and a consumer that predates the field would render it as a head at nowhere.
 * Excluding by default means every existing client keeps seeing exactly what it saw before
 * 0023.
 */
export async function listMarkers(
  tx: DbTx,
  viewId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<HeadMarker[]> {
  const rows = await tx
    .select({
      frame: headMarkers.frame,
      x: headMarkers.x,
      y: headMarkers.y,
      hidden: headMarkers.hidden,
      blurred: headMarkers.blurred,
      fps: headMarkers.fps,
      viewFps: swingViews.fps,
    })
    .from(headMarkers)
    .innerJoin(swingViews, eq(swingViews.id, headMarkers.viewId))
    .where(eq(headMarkers.viewId, viewId))
    .orderBy(headMarkers.frame);
  const out: HeadMarker[] = [];
  for (const { frame, x, y, hidden, blurred, fps, viewFps } of rows) {
    const stale = fps != null && viewFps != null && Math.abs(fps - viewFps) > 0.5;
    if (hidden) {
      if (opts.includeHidden) out.push(stale ? { frame, hidden: true, stale: true } : { frame, hidden: true });
      continue;
    }
    // The CHECK constraint guarantees coordinates on non-hidden rows; the guard keeps a
    // malformed row from becoming a NaN head rather than trusting the constraint blindly.
    if (x == null || y == null) continue;
    const m: HeadMarker = { frame, x, y };
    if (blurred) m.blurred = true;
    if (stale) m.stale = true;
    out.push(m);
  }
  return out;
}

/**
 * Apply one editing session: upsert the placed (or hidden) markers, delete the cleared frames.
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
    .select({ id: swingViews.id, fps: swingViews.fps, revision: swingViews.artifactRevision })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(and(eq(swingViews.id, viewId), eq(swings.userId, userId)));
  if (!owned[0]) throw new Error(`no such swing view for this user: ${viewId}`);
  // The clock this editing session was performed against — stamped on every row it touches,
  // so a later re-analysis at a different fps can flag rather than relocate them (C10).
  const { fps, revision } = owned[0];

  const clean = upserts
    .filter((m) => Number.isFinite(m.frame) && m.frame >= 0
      && (m.hidden === true || (Number.isFinite(m.x) && Number.isFinite(m.y))))
    // Normalized coordinates, like everything else in the artifact. A marker outside the frame
    // is a bug in the caller, not a position, so clamp rather than store it. A hidden marker
    // stores NULL coordinates — the CHECK constraint's shape.
    .map((m) => m.hidden === true
      ? { viewId, frame: Math.round(m.frame), x: null, y: null, hidden: true, blurred: false,
          fps, artifactRevision: revision }
      : {
          viewId,
          frame: Math.round(m.frame),
          x: Math.min(1, Math.max(0, m.x)),
          y: Math.min(1, Math.max(0, m.y)),
          hidden: false,
          blurred: m.blurred === true,
          fps,
          artifactRevision: revision,
        });

  // No nested transaction: `tx` already is one. Every caller reaches this through `withUser`,
  // which wraps the whole request in a single transaction, so "a half-applied correction is not a
  // state the user can reach" now holds for the identity context too rather than only the writes.
  if (clean.length) {
    await tx.insert(headMarkers).values(clean).onConflictDoUpdate({
      target: [headMarkers.viewId, headMarkers.frame],
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        hidden: sql`excluded.hidden`,
        blurred: sql`excluded.blurred`,
        // Re-placing a marker is a NEW observation against the CURRENT clock — un-stales it.
        fps: sql`excluded.fps`,
        artifactRevision: sql`excluded.artifact_revision`,
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
