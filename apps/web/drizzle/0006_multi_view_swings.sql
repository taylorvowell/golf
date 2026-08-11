-- §7.1 — a Swing owns one or more VIEWS, and a swing's identity stops being a folder name.
--
-- This is the half D28 deliberately split out of 0005, because it changes what a swing *is*:
--
--   before: one `swings` row == one video == one `out/<stem>/` folder, and `swings.id` WAS that
--           folder name. Every child table (jobs, scores, head_markers, swing_stages) keyed off
--           it, so "frame 120 of swing X" was unambiguous only because a swing could not have a
--           second camera.
--   after:  a `swings` row is the SHOT — one golfer, one club, one moment. A `swing_views` row
--           is one camera's recording of it, and it owns the video, the storage key, the frame
--           geometry and its own analysis artifact. Everything frame-indexed hangs off the VIEW,
--           because a frame number means nothing without knowing which video it counts.
--
-- Two properties this migration must not lose, both asserted by `src/db/multiView.test.ts`:
--   * every pre-existing swing keeps its analysis and its score
--   * no column stores a filesystem path as identity — `media_key` is a storage key (today the
--     `out/<stem>` folder name, tomorrow an object-storage prefix), joined to a root by the app
--     and never trusted raw
--
-- Reversible only by restore: it drops the legacy text primary key. Take a dump first.

--------------------------------------------------------------------------------------------
-- 1. A uuid identity for every swing, alongside the legacy text id for the length of this file
--------------------------------------------------------------------------------------------

alter table public.swings add column if not exists uid uuid not null default gen_random_uuid();

--------------------------------------------------------------------------------------------
-- 2. The views table
--------------------------------------------------------------------------------------------

create table if not exists public.swing_views (
  id uuid primary key default gen_random_uuid(),
  -- FK added at the end, once `swings.id` is the uuid this points at.
  swing_id uuid not null,
  view text not null check (view in ('dtl', 'face_on')),

  -- The normalized clip's storage key. NOT a path: no root, no separators of its own, and the
  -- app validates it before joining it to anything. Today it is the `out/<stem>` folder name the
  -- analyzer writes; step 09 turns it into an object-storage prefix by changing values, not
  -- columns.
  media_key text not null,

  -- D29 — the raw original, kept 30 days after a successful analysis so a bad trim is
  -- recoverable, then dropped. Its own key and its own expiry because it has its own lifecycle:
  -- a swing stays perfectly valid after the raw is gone, and the UI must say so rather than
  -- offering a re-trim that cannot work.
  raw_media_key text,
  raw_expires_at timestamptz,

  -- Frame geometry is per-video. Two phones do not agree on fps, size or frame count, and a
  -- frame index is only meaningful against the video it counts.
  fps integer,
  frame_count integer,
  width integer,
  height integer,

  status text not null default 'uploaded'
    check (status in ('uploaded', 'queued', 'analyzing', 'ready', 'failed')),
  failure_reason text,

  -- Which analyzer produced this view's artifact, and what scored it. Per-view because each
  -- view is analysed independently — one camera can be re-analysed without touching the other.
  analysis_version text,
  scoring_model_version text,
  overall_score real,
  band text,

  -- The view the player opens by default and the one whose score rolls up to the swing. At most
  -- one per swing, enforced below; a swing with a single view has it set.
  is_primary boolean not null default false,

  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);

-- §7.1 reads "a down-the-line view, a face-on view, or both" — so one of each at most. That is
-- what makes "switch to the face-on view" a well-defined action rather than an ambiguous one.
create unique index if not exists swing_views_swing_view on public.swing_views (swing_id, view);
create unique index if not exists swing_views_primary
  on public.swing_views (swing_id) where is_primary;
create index if not exists swing_views_swing_id_idx on public.swing_views (swing_id);
-- Reverse lookup: the analyzer and the backfill know a storage key and need the view.
create unique index if not exists swing_views_media_key on public.swing_views (media_key);

--------------------------------------------------------------------------------------------
-- 3. Every existing swing becomes one swing + one view
--------------------------------------------------------------------------------------------
-- The legacy text id IS the `out/<stem>` folder name, so it becomes the view's media_key —
-- which is the one place a storage key legitimately belongs. `media_path` is deliberately NOT
-- carried across: it holds an absolute machine-local path ("C:\...\out\swing1"), which is
-- exactly the coupling this step exists to remove.

insert into public.swing_views (
  swing_id, view, media_key, fps, frame_count, width, height,
  status, failure_reason, analysis_version, scoring_model_version, overall_score, band,
  is_primary, created_at, analyzed_at
)
select
  s.uid, s.view, s.id, s.fps, s.frame_count, s.width, s.height,
  s.status, s.failure_reason, s.analysis_version, s.scoring_model_version,
  s.overall_score, s.band,
  true, s.created_at, s.analyzed_at
from public.swings s
on conflict do nothing;

--------------------------------------------------------------------------------------------
-- 4. Repoint everything frame-indexed from the swing to the view
--------------------------------------------------------------------------------------------
-- jobs, scores, head_markers and swing_stages are all statements ABOUT ONE VIDEO. A job runs the
-- analyzer over one clip; a scorecard is computed from one `analysis.json`; a marker and a stage
-- are both "frame N", which two cameras number differently. Leaving them on the swing would make
-- the second view silently overwrite the first's corrections.

alter table public.jobs          add column if not exists view_id uuid;
alter table public.scores        add column if not exists view_id uuid;
alter table public.head_markers  add column if not exists view_id uuid;
alter table public.swing_stages  add column if not exists view_id uuid;

update public.jobs j
   set view_id = v.id from public.swing_views v where v.media_key = j.swing_id and j.view_id is null;
update public.scores sc
   set view_id = v.id from public.swing_views v where v.media_key = sc.swing_id and sc.view_id is null;
update public.head_markers hm
   set view_id = v.id from public.swing_views v where v.media_key = hm.swing_id and hm.view_id is null;
update public.swing_stages ss
   set view_id = v.id from public.swing_views v where v.media_key = ss.swing_id and ss.view_id is null;

-- Loud rather than lossy. Every child row referenced a swing by FK and every swing produced
-- exactly one view, so an unmatched row means the mapping above is wrong — and silently dropping
-- a golfer's hand-placed corrections is the worst possible way to find that out.
do $$
declare orphans integer;
begin
  select (select count(*) from public.jobs where view_id is null)
       + (select count(*) from public.scores where view_id is null)
       + (select count(*) from public.head_markers where view_id is null)
       + (select count(*) from public.swing_stages where view_id is null)
    into orphans;
  if orphans > 0 then
    raise exception 'multi-view migration: % child rows did not map to a view', orphans;
  end if;
end
$$;

-- Policies depend on the column they read, so 0003's must come off before `swing_id` can. They
-- are recreated against `view_id` in §8 — the table is never left unprotected outside this
-- transaction, and the migration runs as one.
drop policy if exists jobs_select          on public.jobs;
drop policy if exists jobs_write           on public.jobs;
drop policy if exists scores_select        on public.scores;
drop policy if exists scores_write         on public.scores;
drop policy if exists head_markers_select  on public.head_markers;
drop policy if exists head_markers_write   on public.head_markers;
drop policy if exists swing_stages_select  on public.swing_stages;
drop policy if exists swing_stages_write   on public.swing_stages;

alter table public.jobs          drop constraint if exists jobs_swing_id_swings_id_fk;
alter table public.scores        drop constraint if exists scores_swing_id_swings_id_fk;
alter table public.head_markers  drop constraint if exists head_markers_swing_id_swings_id_fk;
alter table public.swing_stages  drop constraint if exists swing_stages_swing_id_swings_id_fk;

drop index if exists public.head_markers_swing_frame;
drop index if exists public.swing_stages_swing_stage;
drop index if exists public.jobs_swing_id_idx;
drop index if exists public.head_markers_swing_id_idx;
drop index if exists public.swing_stages_swing_id_idx;

alter table public.jobs          drop column if exists swing_id;
alter table public.scores        drop column if exists swing_id;
alter table public.head_markers  drop column if exists swing_id;
alter table public.swing_stages  drop column if exists swing_id;

alter table public.jobs          alter column view_id set not null;
alter table public.scores        alter column view_id set not null;
alter table public.head_markers  alter column view_id set not null;
alter table public.swing_stages  alter column view_id set not null;

alter table public.jobs         add constraint jobs_view_id_swing_views_id_fk
  foreign key (view_id) references public.swing_views (id) on delete cascade;
alter table public.scores       add constraint scores_view_id_swing_views_id_fk
  foreign key (view_id) references public.swing_views (id) on delete cascade;
alter table public.head_markers add constraint head_markers_view_id_swing_views_id_fk
  foreign key (view_id) references public.swing_views (id) on delete cascade;
alter table public.swing_stages add constraint swing_stages_view_id_swing_views_id_fk
  foreign key (view_id) references public.swing_views (id) on delete cascade;

-- One scorecard per view (was: one per swing). The uniqueness is what makes the score sync an
-- upsert rather than an accumulating history.
create unique index if not exists scores_view_id on public.scores (view_id);
create unique index if not exists head_markers_view_frame on public.head_markers (view_id, frame);
create unique index if not exists swing_stages_view_stage on public.swing_stages (view_id, stage);
create index if not exists jobs_view_id_idx on public.jobs (view_id);

--------------------------------------------------------------------------------------------
-- 5. sessions.representative_swing_id follows the swing's new identity
--------------------------------------------------------------------------------------------
-- Added in 0005 as text against the legacy id, and never populated (no sessions exist yet).

alter table public.sessions drop column if exists representative_swing_id;
alter table public.sessions add column representative_swing_id uuid;

--------------------------------------------------------------------------------------------
-- 6. The swap: swings.id becomes the uuid
--------------------------------------------------------------------------------------------
-- Safe only because §4 and §5 removed every reference to the text key.

alter table public.swings drop constraint swings_pkey;
alter table public.swings drop column id;
alter table public.swings rename column uid to id;
alter table public.swings add primary key (id);
alter table public.swings alter column id set default gen_random_uuid();

-- Columns that describe a VIDEO, not a shot. They now live on swing_views, and leaving copies
-- here would guarantee the two disagree the first time a swing has two cameras.
alter table public.swings drop column if exists view;
alter table public.swings drop column if exists media_path;
alter table public.swings drop column if exists fps;
alter table public.swings drop column if exists frame_count;
alter table public.swings drop column if exists width;
alter table public.swings drop column if exists height;
alter table public.swings drop column if exists status;
alter table public.swings drop column if exists failure_reason;
alter table public.swings drop column if exists analysis_version;

-- overall_score / band / scoring_model_version STAY on the swing. They are the primary view's
-- score, denormalized so the log can sort and filter without a join per row — the same rationale
-- 0000 recorded, unchanged by this migration. `scores.view_id` remains the source of truth.

-- §20's professional reference library, in its minimal honest form: whether a row is a bundled
-- model swing is a property of the ROW, not of its id. Before this migration it was inferred by
-- string-matching the id against a hardcoded list ("perfect", "pro_2"), which only worked while
-- an id was a folder name. `comparison-and-reference` builds the real library on top of this.
alter table public.swings add column if not exists reference_label text;
create index if not exists swings_reference_idx on public.swings (reference_label)
  where reference_label is not null;

update public.swings s set reference_label = c.label
  from (values ('perfect', 'Pro Swing'), ('pro_2', 'Pro 2')) as c(key, label)
  join public.swing_views v on v.media_key = c.key
 where v.swing_id = s.id and s.reference_label is null;

--------------------------------------------------------------------------------------------
-- 7. The FK that could not be added until swings.id existed
--------------------------------------------------------------------------------------------

alter table public.swing_views add constraint swing_views_swing_id_swings_id_fk
  foreign key (swing_id) references public.swings (id) on delete cascade;

alter table public.sessions add constraint sessions_representative_swing_id_swings_id_fk
  foreign key (representative_swing_id) references public.swings (id) on delete set null;

--------------------------------------------------------------------------------------------
-- 8. RLS for swing_views, and the child policies re-pointed through it
--------------------------------------------------------------------------------------------
-- Same shape as 0003: a child asks whether its parent is visible, and the nested select is
-- itself policy-filtered, so coach access and revocation flow through automatically instead of
-- being restated (and eventually drifting) per table. One extra hop now — child → view → swing.

-- 0003's grant was `on all tables in schema public`, which is a snapshot, not a rule — a table
-- created afterwards gets nothing. `swing_views` needs its own grant, and so did `clubs`, whose
-- 0005 policies have been inert for want of one: a policy decides which rows a role may touch,
-- never whether it may touch the table at all.
grant select, insert, update, delete on public.swing_views, public.clubs to authenticated;
grant all on public.swing_views, public.clubs to service_role;

alter table public.swing_views enable row level security;
alter table public.swing_views force  row level security;

drop policy if exists swing_views_select on public.swing_views;
create policy swing_views_select on public.swing_views
  for select to authenticated
  using (exists (select 1 from public.swings s where s.id = swing_id));

drop policy if exists swing_views_write on public.swing_views;
create policy swing_views_write on public.swing_views
  for all to authenticated
  using (exists (select 1 from public.swings s
                 where s.id = swing_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swings s
                      where s.id = swing_id and s.user_id = (select auth.uid())));

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (exists (select 1 from public.swing_views v where v.id = view_id));

drop policy if exists jobs_write on public.jobs;
create policy jobs_write on public.jobs
  for all to authenticated
  using (exists (select 1 from public.swing_views v
                   join public.swings s on s.id = v.swing_id
                  where v.id = view_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swing_views v
                        join public.swings s on s.id = v.swing_id
                       where v.id = view_id and s.user_id = (select auth.uid())));

drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores
  for select to authenticated
  using (exists (select 1 from public.swing_views v where v.id = view_id));

drop policy if exists scores_write on public.scores;
create policy scores_write on public.scores
  for all to authenticated
  using (exists (select 1 from public.swing_views v
                   join public.swings s on s.id = v.swing_id
                  where v.id = view_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swing_views v
                        join public.swings s on s.id = v.swing_id
                       where v.id = view_id and s.user_id = (select auth.uid())));

drop policy if exists head_markers_select on public.head_markers;
create policy head_markers_select on public.head_markers
  for select to authenticated
  using (exists (select 1 from public.swing_views v where v.id = view_id));

drop policy if exists head_markers_write on public.head_markers;
create policy head_markers_write on public.head_markers
  for all to authenticated
  using (exists (select 1 from public.swing_views v
                   join public.swings s on s.id = v.swing_id
                  where v.id = view_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swing_views v
                        join public.swings s on s.id = v.swing_id
                       where v.id = view_id and s.user_id = (select auth.uid())));

drop policy if exists swing_stages_select on public.swing_stages;
create policy swing_stages_select on public.swing_stages
  for select to authenticated
  using (exists (select 1 from public.swing_views v where v.id = view_id));

drop policy if exists swing_stages_write on public.swing_stages;
create policy swing_stages_write on public.swing_stages
  for all to authenticated
  using (exists (select 1 from public.swing_views v
                   join public.swings s on s.id = v.swing_id
                  where v.id = view_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swing_views v
                        join public.swings s on s.id = v.swing_id
                       where v.id = view_id and s.user_id = (select auth.uid())));
