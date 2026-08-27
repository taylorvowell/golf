import mirror from "../stages.json" with { type: "json" };

/**
 * The ONE analysis-stage vocabulary, mirrored from `swingsage/stages.py`.
 *
 * Python owns the list; `services/analyzer/scripts/build_stage_mirror.py` writes
 * `stages.json`; the analyzer's `test_stage_metrics.py` fails if the two drift. Before this
 * there were two hand-maintained copies (`jobrun.STAGE_PCT` and `jobs.ts STAGES`) that spelled
 * four stages differently and disagreed about six more, which made a per-stage percentile
 * unanswerable without first knowing which runner had written the row.
 *
 * Stage ids are MACHINE names — stable, snake_case, safe to group by in a query. Anything a
 * person reads goes through `stageLabel`, so renaming a screen never moves a telemetry key.
 */

/** Percentage the progress bar has reached when a stage BEGINS. */
export const STAGE_PCT: Record<string, number> = mirror.stagePct;

/** Human wording per machine id. */
export const STAGE_LABELS: Record<string, string> = mirror.labels;

/** Stages that run inside another stage — their seconds are already counted in the parent. */
export const NESTED_STAGES: readonly string[] = mirror.nested;

/** Execution order, for reporting. */
export const STAGE_ORDER: readonly string[] = mirror.order;

/** Human wording for a stage id. Unknown ids pass through, so a new worker stage shows its
 * raw name rather than vanishing from a screen. */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "";
  return STAGE_LABELS[stage] ?? stage;
}

export function isKnownStage(stage: string): boolean {
  return Object.hasOwn(STAGE_PCT, stage);
}
