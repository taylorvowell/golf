import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import { swingViews as viewsTable } from "@/db/schema";
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
  await withUser(actorId, (t) => syncSwingScore(t, { ...view, revision })).catch(() => {});
}

export async function markViewFailed(
  actorId: string,
  viewId: string,
  reason: string,
): Promise<void> {
  await withUser(actorId, (t) => t.update(viewsTable)
    .set({ status: "failed", failureReason: reason })
    .where(eq(viewsTable.id, viewId))).catch(() => {});
}
