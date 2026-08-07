import fs from "node:fs/promises";
import { swingFile } from "./swings";
import type { Scorecard } from "./scoreDisplay";

/**
 * The real scorecard (doc 05 Part C1) — reads `coach_report.json`, written by
 * `swingsage/scoring.py` as Stage 8 of `burnin.py`. Replaces `lib/mockScoring.ts`'s generator.
 *
 * Server-only (uses `node:fs`) — see `lib/scoreDisplay.ts` for the `Scorecard` type and the
 * client-safe display helpers, and why the two files are split. Called from server components
 * (`app/swing/[id]/page.tsx`) and from `db/scores.ts`'s sync helper, never from a `"use client"`
 * component directly.
 *
 * `coach_report.json` is a separate artifact from `analysis.json` on purpose — doc 02's data
 * model already names it (`swings.coach_report_path`) as a sibling file, not a field folded
 * into the versioned `analysis.json` contract. A swing analysed before Stage 8 existed, or
 * analysed with `--no-scoring`, simply has no `coach_report.json` yet — `getScorecard` returns
 * `null` rather than throwing, and every consumer renders its "not scored" state instead of
 * crashing (the same degrade-don't-crash pattern as `missingCapabilities()`).
 */
export async function getScorecard(id: string): Promise<Scorecard | null> {
  try {
    return JSON.parse(await fs.readFile(swingFile(id, "coach_report.json"), "utf8"));
  } catch {
    return null;
  }
}

export type { Scorecard } from "./scoreDisplay";
