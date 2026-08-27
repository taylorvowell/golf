-- 0024 — per-stage timing and cost attribution for a job.
--
-- Until now the only structured duration that survived a job was `elapsed_s`, appended to the
-- log as a sentence. Per-stage wall clock was printed to stdout and discarded, so "which stage
-- is the p95 spent in" could only be answered by string-scanning a 200-line ring buffer, and
-- only for the stages the spawn scraper happened to have a regex for.
--
-- Shape is `swingsage.stages.StageAccumulator.record()` — schema-versioned inside the document
-- so the reader can evolve without a migration:
--   { schema, schemaVersion, totalS, attributedS, unattributedS, attributedPct,
--     stages: [{stage, seconds, frames?, nested?, count?}], ... facts }
--
-- Nullable rather than defaulted: an old job genuinely has no metrics, and `{}` would be
-- indistinguishable from a job whose worker failed to report any.

ALTER TABLE "jobs" ADD COLUMN "job_metrics" jsonb;

-- Partial index: every analytical query over this column is "the jobs that have metrics",
-- and the column is null for every row written before this migration.
CREATE INDEX "jobs_metrics_present" ON "jobs" ("finished_at") WHERE "job_metrics" IS NOT NULL;
