import { eq } from "drizzle-orm";
import { db } from "./client";
import { scores, swings } from "./schema";
import { getScorecard } from "../lib/scoring";

/**
 * Reads this swing's `coach_report.json` (if any) and upserts it into the `scores` table plus
 * the denormalized `overall_score`/`band`/`scoring_model_version` columns on `swings` — the
 * columns the swing list (`lib/swings.ts:listSwings`) sorts/filters on without a join. Called
 * from both `jobs.ts` (after a reanalyze finishes) and `backfill.ts` (for swings that already
 * had a `coach_report.json` on disk before this table existed), so a swing's score is never
 * stale relative to its artifact for more reasons than one code path can drift apart on.
 *
 * A swing with no `coach_report.json` yet (pre-Stage-8, or `--no-scoring`) is left alone —
 * this is a no-op, not a failure.
 */
export async function syncSwingScore(swingId: string): Promise<boolean> {
  const card = await getScorecard(swingId);
  if (!card || card.overall === null) return false;

  await db.insert(scores).values({
    swingId,
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
    target: scores.swingId,
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

  await db.update(swings).set({
    overallScore: card.overall,
    band: card.band,
    scoringModelVersion: card.scoring_model_version,
  }).where(eq(swings.id, swingId));

  return true;
}
