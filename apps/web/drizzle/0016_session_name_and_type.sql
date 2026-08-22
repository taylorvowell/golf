-- Session mode's row becomes real (D61): a session gains the two things the capture screen
-- has been holding client-side — the golfer's name for it, and what they came to do.
--
-- Both additive, both safe for every row already stored: `name` is nullable and `session_type`
-- defaults, so the sessions the sampler wrote keep working untouched and an older client that
-- never sends either still creates a valid row.
--
-- `name` is NULL when the golfer never renamed the session, and that null is load-bearing: the
-- swing log's title rule is "the date, unless the golfer named it". Storing the client's default
-- "Session 3" here would make every session look renamed and the log could never tell a name a
-- person chose from a number the app counted.
--
-- `session_type` is a CHECK-constrained text column rather than a pg enum: adding a value to an
-- enum is a migration that cannot run inside a transaction on older Postgres, and this list will
-- grow. `swing_analysis` is the default because it is what the product is for — a row created by
-- anything that does not name a type is an analysis session, never a quarantined one.
--
-- Quarantine is enforced in the client's aggregation (drills and video-only never feed a durable
-- average), not by a constraint here: the rows are still the golfer's own data and must still be
-- readable, counted, and shown.
--
-- Hand-written, like every migration since 0003.

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "name" text;

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "session_type" text NOT NULL
  DEFAULT 'swing_analysis';

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_session_type_check";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_session_type_check"
  CHECK ("session_type" IN ('swing_analysis', 'practice_drills', 'video_only'));

COMMENT ON COLUMN public.sessions.name IS
  'The golfer''s chosen name. NULL means never renamed — the log keeps its date title.';
COMMENT ON COLUMN public.sessions.session_type IS
  'What the golfer came to do. Locks once the session has swings; practice_drills and video_only are excluded from durable averages.';
