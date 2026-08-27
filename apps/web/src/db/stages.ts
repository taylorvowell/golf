import "server-only";

import { and, eq } from "drizzle-orm";
import type { DbTx } from "./session";
import { swingStages, swings, swingViews } from "./schema";

/** A hand-corrected swing stage: which frame this swing's `top` (or `impact`, …) really is. */
export interface StageMark {
  stage: string;
  frame: number;
  /**
   * The row was placed against a DIFFERENT artifact clock than the view currently shows
   * (stamped fps ≠ view fps — C10). Clients dim or hide it, never merge it as truth.
   * Absent (never `false`) on live rows — additive for old clients.
   */
  stale?: true;
}

/**
 * The five boundaries a swing is divided by, in swing order. Mirrors `lib/swingPhases.ts`'s
 * PHASE_MARKS, which is the client's copy — duplicated rather than imported because this module
 * is `server-only` and that one is pulled into the browser bundle.
 *
 * Five marks rather than `analysis.json`'s eight events because these are the ones that are
 * both (a) a boundary the player draws something different either side of, and (b) a moment a
 * person can actually point at in the picture. "Mid backswing" is neither.
 */
export const STAGES = [
  "approach_start", "backswing_start", "downswing_start", "impact", "finish_start",
] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(s: string): s is Stage {
  return (STAGES as readonly string[]).includes(s);
}

/**
 * Every hand-corrected stage for one VIEW, in swing order.
 *
 * Keyed on the view rather than the swing since migration 0006, for the same reason as
 * `db/markers.ts`: a stage mark is a frame number, and two cameras number the same swing
 * differently.
 */
export async function listStages(tx: DbTx, viewId: string): Promise<StageMark[]> {
  // Staleness is derived at read time from "row fps ≠ view fps", same as db/markers.ts —
  // a stored flag would be one more thing a re-analysis could forget to update.
  const rows = await tx
    .select({
      stage: swingStages.stage,
      frame: swingStages.frame,
      fps: swingStages.fps,
      viewFps: swingViews.fps,
    })
    .from(swingStages)
    .innerJoin(swingViews, eq(swingViews.id, swingStages.viewId))
    .where(eq(swingStages.viewId, viewId));
  return rows
    .map(({ stage, frame, fps, viewFps }): StageMark => {
      const stale = fps != null && viewFps != null && Math.abs(fps - viewFps) > 0.5;
      return stale ? { stage, frame, stale: true as const } : { stage, frame };
    })
    .sort((a, b) => STAGES.indexOf(a.stage as Stage) - STAGES.indexOf(b.stage as Stage));
}

/**
 * Pin `stage` to `frame`, or clear it when `frame` is null.
 *
 * Moving rather than adding is the unique index's job: a view has one top, so marking the top on
 * a new frame has to release whichever frame held it. Doing that with an upsert on
 * `(view_id, stage)` means there is no window in which the view has two tops, and no cleanup
 * pass that could leave one behind.
 *
 * `userId` is checked against the view's owning swing, not stored on the row — same reasoning as
 * `db/markers.ts`.
 */
export async function setStage(
  tx: DbTx,
  viewId: string,
  userId: string,
  stage: Stage,
  frame: number | null,
): Promise<void> {
  const owned = await tx
    .select({ id: swingViews.id, fps: swingViews.fps, revision: swingViews.artifactRevision })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(and(eq(swingViews.id, viewId), eq(swings.userId, userId)));
  if (!owned[0]) throw new Error(`no such swing view for this user: ${viewId}`);
  // The clock the mark was placed against — see db/markers.ts (C10). Re-pinning a stage is a
  // new observation on the current clock, which is what un-stales it after a re-analysis.
  const { fps, revision } = owned[0];

  if (frame === null) {
    await tx.delete(swingStages)
      .where(and(eq(swingStages.viewId, viewId), eq(swingStages.stage, stage)));
    return;
  }
  if (!Number.isFinite(frame) || frame < 0) throw new Error(`bad frame: ${frame}`);

  await tx.insert(swingStages)
    .values({ viewId, stage, frame: Math.round(frame), fps, artifactRevision: revision })
    .onConflictDoUpdate({
      target: [swingStages.viewId, swingStages.stage],
      set: {
        frame: Math.round(frame),
        fps,
        artifactRevision: revision,
        updatedAt: new Date(),
      },
    });
}
