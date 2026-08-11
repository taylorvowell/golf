import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { scores, swings, swingViews } from "./schema";
import { getScorecard } from "../lib/scoring";
import type { ResolvedView } from "./views";

/**
 * Reads this VIEW's `coach_report.json` (if any) and upserts it into the `scores` table, onto the
 * view's own denormalized score columns, and — when this is the swing's primary view — onto the
 * swing's, which is what the log sorts and filters on without a join per row. Called from both
 * `jobs.ts` (after a reanalyze finishes) and `backfill.ts` (for views that already had a
 * `coach_report.json` on disk before this table existed), so a score is never stale relative to
 * its artifact for more reasons than one code path can drift apart on.
 *
 * Scored per view rather than per swing because a scorecard is computed from exactly one
 * `analysis.json`, and a swing may now hold two. The swing-level number is the primary view's,
 * stated rather than averaged — averaging two cameras' scores would invent a number neither
 * analysis produced.
 *
 * A view with no `coach_report.json` yet (pre-Stage-8, or `--no-scoring`) is left alone —
 * this is a no-op, not a failure.
 */
export async function syncSwingScore(view: ResolvedView): Promise<boolean> {
  const card = await getScorecard(view.mediaKey);
  if (!card || card.overall === null) return false;

  await db.insert(scores).values({
    viewId: view.viewId,
    scoringModelVersion: card.scoring_model_version,
    overall: card.overall,
    band: card.band ?? "",
    arcShift: card.arc_shift,
    categories: card.categories,
    checkpoints: card.checkpoints,
    findings: card.findings,
    priorities: card.priorities,
    primaryFix: card.primary,
    drill: card.drill,
  }).onConflictDoUpdate({
    target: scores.viewId,
    set: {
      scoringModelVersion: card.scoring_model_version,
      overall: card.overall,
      band: card.band ?? "",
      arcShift: card.arc_shift,
      categories: card.categories,
      checkpoints: card.checkpoints,
      findings: card.findings,
      priorities: card.priorities,
      primaryFix: card.primary,
      drill: card.drill,
      createdAt: new Date(),
    },
  });

  await db.update(swingViews).set({
    overallScore: card.overall,
    band: card.band,
    scoringModelVersion: card.scoring_model_version,
  }).where(eq(swingViews.id, view.viewId));

  // Only the primary view rolls up to the swing. A second camera re-analysed on its own must not
  // silently replace the number the log has been showing for the swing.
  const primary = await db.select({ id: swingViews.id }).from(swingViews)
    .where(and(eq(swingViews.id, view.viewId), eq(swingViews.isPrimary, true)));
  if (primary.length) {
    await db.update(swings).set({
      overallScore: card.overall,
      band: card.band,
      scoringModelVersion: card.scoring_model_version,
    }).where(eq(swings.id, view.swingId));
  }

  return true;
}
