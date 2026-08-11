-- Step 09 — media addressing. One column, and a deliberate NON-change.
--
-- D30 predicted this migration would rewrite `media_key` into an object-storage prefix. It does
-- not, and D33 records why: a storage key is now DERIVED from identity the database already owns
-- (`users.id` / `swings.id` / `swing_views.id` / `artifact_revision`, assembled in
-- `lib/media/keys.ts`). A derived key cannot drift out of agreement with the identity it encodes,
-- and there is nothing to backfill, nothing to keep in sync, and no second source of truth.
--
-- What `media_key` still means is the analyzer's own working-directory name — `out/<stem>/`.
-- `burnin.py` has never heard of this database and still writes by stem, so that concept is real
-- and separate; conflating it with the product's addressing is what made the media unmovable in
-- the first place.
--
-- `artifact_revision` is the piece that has to be stored, because it is state rather than
-- identity: which analysis run's output the app should currently be addressing.

alter table "swing_views"
  add column if not exists "artifact_revision" integer not null default 1;

comment on column "swing_views"."artifact_revision" is
  'Which analysis run produced the artifacts currently addressed. Incremented per successful '
  're-analysis, never reused. Object storage has no rename-into-place, so a re-analysis writes '
  'r<n+1> alongside r<n> rather than over it — that is what stops a re-run from pulling the '
  'video out from under a player that is mid-scrub.';

comment on column "swing_views"."media_key" is
  'The analyzer working-directory name for this view (services/analyzer/out/<stem>/). NOT the '
  'storage address — that is derived from identity in lib/media/keys.ts. New views use their own '
  'id as the stem; the bundled fixtures keep their human-readable ones. See D33.';
