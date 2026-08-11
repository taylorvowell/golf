import "server-only";

import { and, eq } from "drizzle-orm";
import type { DbTx } from "./session";
import { swingStages, swings, swingViews } from "./schema";

/** A hand-corrected swing stage: which frame this swing's `top` (or `impact`, …) really is. */
export interface StageMark {
  stage: string;
  frame: number;
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
  const rows = await tx
    .select({ stage: swingStages.stage, frame: swingStages.frame })
    .from(swingStages)
    .where(eq(swingStages.viewId, viewId));
  return rows.sort((a, b) => STAGES.indexOf(a.stage as Stage) - STAGES.indexOf(b.stage as Stage));
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
    .select({ id: swingViews.id })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(and(eq(swingViews.id, viewId), eq(swings.userId, userId)));
  if (!owned[0]) throw new Error(`no such swing view for this user: ${viewId}`);

  if (frame === null) {
    await tx.delete(swingStages)
      .where(and(eq(swingStages.viewId, viewId), eq(swingStages.stage, stage)));
    return;
  }
  if (!Number.isFinite(frame) || frame < 0) throw new Error(`bad frame: ${frame}`);

  await tx.insert(swingStages)
    .values({ viewId, stage, frame: Math.round(frame) })
    .onConflictDoUpdate({
      target: [swingStages.viewId, swingStages.stage],
      set: { frame: Math.round(frame), updatedAt: new Date() },
    });
}
