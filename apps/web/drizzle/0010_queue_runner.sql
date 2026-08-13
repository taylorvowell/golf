-- analyzer-service step 04 — the queue-driven worker loop.
--
-- Two columns on `jobs`, nothing else. `runner` records which execution path owns the job:
-- `spawn` is the analyzer as a child process of the web server (the original path, still the
-- local-dev default), `queue` is a QStash-delivered job running on the hosted worker and
-- reporting back over HTTP. The distinction is load-bearing for `reconcile()` in `lib/jobs.ts`:
-- it settles orphaned spawn jobs by probing the analyzer's working directory on THIS machine
-- (`.analysis.lock`, `analysis.json` mtime), which is meaningless for a job running on another
-- host — so queue rows must be identifiable to be exempted.
--
-- `target_revision` fixes, at enqueue time, the artifact revision a queue job's uploads are
-- addressed to (`swing_views.artifact_revision + 1`). It is state the job must carry rather
-- than derive: deriving it at upload time from the view row would move the address if anything
-- touched the row mid-run, and the publish-then-flip ordering (publish r(n+1), only then make
-- it current) depends on the address being immutable for the job's whole life. Null for spawn
-- jobs, whose publish step computes the revision at completion exactly as before.

alter table "jobs"
  add column if not exists "runner" text not null default 'spawn';

alter table "jobs"
  add column if not exists "target_revision" integer;

comment on column "jobs"."runner" is
  'Execution path: spawn (child process of the web server) or queue (QStash -> hosted worker).';

comment on column "jobs"."target_revision" is
  'Queue jobs only: the artifact revision uploads are addressed to, fixed at enqueue time.';
