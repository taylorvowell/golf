import { and, eq, isNotNull, sql } from "drizzle-orm";
import { withUser } from "@/db/session";
import {
  headMarkers,
  swingStages,
  swings as swingsTable,
  swingViews as viewsTable,
} from "@/db/schema";
import { syncSwingScore } from "@/db/scores";
import { mediaAddress, type ResolvedView } from "@/db/views";
import { getAnalysis } from "@/lib/swings";

/**
 * The terminal `swing_views` transition, shared by both job runners.
 *
 * The spawn path reaches here after `publishFromWorkingDir`; the queue path after the worker
 * has uploaded its artifacts and reported done. Either way the rule is the same: artifacts at
 * the NEW revision are already in the store before the row flips, so a golfer mid-scrub keeps
 * the artifacts they started with, and a failure costs the re-analysis, never the swing.
 */

/**
 * Flip a view to `ready` at `revision`, refreshing the video facts from the published
 * `analysis.json` — read back through the store because that published copy is what the player
 * will get, so anything wrong with the publish shows up here rather than at playback.
 */
export async function markViewReady(
  actorId: string,
  view: ResolvedView,
  revision: number,
): Promise<void> {
  const address = { ...mediaAddress(view), revision };
  const fresh = await getAnalysis(address).catch(() => null);
  await withUser(actorId, (t) => t.update(viewsTable).set({
    status: "ready",
    analyzedAt: new Date(),
    artifactRevision: revision,
    fps: fresh?.video.fps,
    frameCount: fresh?.video.frame_count,
    width: fresh?.video.width,
    height: fresh?.video.height,
  }).where(eq(viewsTable.id, view.viewId))).catch(() => {});

  // Correction consistency (C10): a re-analysis that changed the view's fps has renumbered
  // every frame, so corrections stamped against the old clock are now STALE — flagged, never
  // deleted. The flag itself is derived at read time (row fps ≠ view fps, db/markers.ts);
  // what belongs here is the observability count, because this is the one moment staleness
  // is CREATED and the count is what says whether a migration/re-stamp tool is ever worth
  // building. Deleting instead would destroy the project's only hand-labelled club truth.
  if (fresh?.video.fps != null) {
    await withUser(actorId, async (t) => {
      const [m] = await t.select({ n: sql<number>`count(*)::int` }).from(headMarkers)
        .where(and(
          eq(headMarkers.viewId, view.viewId),
          isNotNull(headMarkers.fps),
          sql`abs(${headMarkers.fps} - ${fresh.video.fps}) > 0.5`,
        ));
      const [s] = await t.select({ n: sql<number>`count(*)::int` }).from(swingStages)
        .where(and(
          eq(swingStages.viewId, view.viewId),
          isNotNull(swingStages.fps),
          sql`abs(${swingStages.fps} - ${fresh.video.fps}) > 0.5`,
        ));
      if ((m?.n ?? 0) + (s?.n ?? 0) > 0) {
        console.warn(
          `[corrections] view ${view.viewId} re-analysed at ${fresh.video.fps}fps: ` +
          `${m?.n ?? 0} head markers + ${s?.n ?? 0} stage marks now stale (flagged, kept)`,
        );
      }
    }).catch(() => {});
  }

  await withUser(actorId, (t) => syncSwingScore(t, { ...view, revision })).catch(() => {});
}

/**
 * Flip a view to `failed`, and TELL the golfer.
 *
 * The notification is emitted here rather than by each runner because this is the one place a
 * view becomes failed — spawn, hosted worker, orphan sweep, every path lands on this function.
 * An emitter per runner is an emitter one of them forgets.
 *
 * Why an inbox row at all: an analysis can take minutes and a golfer does not sit and watch it,
 * so a toast fires at somebody who has put the phone down. `analysis_failed` sits beside
 * `analysis_ready` as the other end of the same event — the pipeline finished, one way or the
 * other — and the reason travels as the body so the row can be acted on rather than merely
 * noticed. It carries no `groupKey`: two swings that failed for two different reasons are two
 * things to read, not one row saying "2".
 *
 * Best-effort, like the status write it follows. A notification that could not be minted must
 * never stop a view from being marked failed — that would leave the swing analysing forever,
 * which is strictly worse than a missing inbox row.
 */
export async function markViewFailed(
  actorId: string,
  viewId: string,
  reason: string,
): Promise<void> {
  await withUser(actorId, (t) => t.update(viewsTable)
    .set({ status: "failed", failureReason: reason })
    .where(eq(viewsTable.id, viewId))).catch(() => {});

  await withUser(actorId, async (t) => {
    const [row] = await t
      .select({ swingId: viewsTable.swingId, ownerId: swingsTable.userId })
      .from(viewsTable)
      .innerJoin(swingsTable, eq(swingsTable.id, viewsTable.swingId))
      .where(eq(viewsTable.id, viewId))
      .limit(1);
    if (!row) return;
    const { notify } = await import("@/lib/notifications");
    await notify(t, {
      userId: row.ownerId,
      kind: "analysis_failed",
      title: "A swing couldn't be analysed",
      body: reason,
      // The swing is still watchable — its video is on the server — so the row deep-links to it.
      data: { swingId: row.swingId, viewId },
    });
  }).catch(() => {});
}
