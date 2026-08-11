import { ARTIFACT_BUCKET, artifactKey, type ViewAddress } from "@/lib/media/keys";
import { getJson, getMediaStore } from "@/lib/media/store";
import type { CoachReport } from "@swingsage/schema/contract";

/**
 * The real scorecard (the scoring spec's Part C1) — reads `coach_report.json`, written by
 * `swingsage/scoring.py` as Stage 8 of `burnin.py`. Replaces `lib/mockScoring.ts`'s generator.
 *
 * Server-only (uses `node:fs`) — see `lib/scoreDisplay.ts` for the `CoachReport` type and the
 * client-safe display helpers, and why the two files are split. Called from server components
 * (`app/swing/[id]/page.tsx`) and from `db/scores.ts`'s sync helper, never from a `"use client"`
 * component directly.
 *
 * `coach_report.json` is a separate artifact from `analysis.json` on purpose — the architecture spec's data
 * model already names it (`swings.coach_report_path`) as a sibling file, not a field folded
 * into the versioned `analysis.json` contract. A swing analysed before Stage 8 existed, or
 * analysed with `--no-scoring`, simply has no `coach_report.json` yet — `getScorecard` returns
 * `null` rather than throwing, and every consumer renders its "not scored" state instead of
 * crashing (the same degrade-don't-crash pattern as `missingCapabilities()`).
 */
export async function getScorecard(address: ViewAddress): Promise<CoachReport | null> {
  const store = await getMediaStore();
  return getJson<CoachReport>(store, ARTIFACT_BUCKET, artifactKey(address, "coach_report.json"));
}


