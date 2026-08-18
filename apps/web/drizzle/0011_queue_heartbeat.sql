-- analyzer-service step 05 — fair queuing, dead letters, and orphan detection.
--
-- One column on `jobs`, nothing else. `last_event_at` is the queue job's heartbeat: the
-- events route stamps it on every event the worker posts (progress, done, failed). The
-- spawn path never writes it — a spawn job's liveness probe is the analyzer's working-
-- directory lock on this machine, which `reconcile()` already reads.
--
-- It exists because a queue job has no local evidence at all: if the worker host dies
-- mid-run, nothing ever posts again and the row would sit at `running` forever. With a
-- heartbeat, `reconcile()` can settle `running` rows whose last event is older than the
-- heartbeat window, and `queued` rows older than the delivery window, to `failed` on the
-- next poll. The windows are env-tunable (JOBS_QUEUE_HEARTBEAT_TIMEOUT_S,
-- JOBS_QUEUE_PENDING_TIMEOUT_S) because stage gaps are real: the club stage can run
-- minutes between posts on CPU.

alter table "jobs"
  add column if not exists "last_event_at" timestamp with time zone;

comment on column "jobs"."last_event_at" is
  'Queue jobs only: when the worker last posted ANY event. The orphan sweep''s heartbeat.';
