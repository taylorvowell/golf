-- Corrections provenance (frame-identity step, C10): a marker or stage row is a FRAME NUMBER,
-- and a frame number is only meaningful against the artifact revision + fps it was placed on.
-- A re-analysis at a different cfr_target_fps used to silently relocate every correction —
-- exactly the case native-rate CFR now creates for 30fps imports (re-analysed: 60 -> 30).
--
-- Nullable + backfilled from the view's CURRENT values: every existing row was placed against
-- the artifact its view currently shows, which is the strongest statement the past supports.
alter table public.head_markers
  add column if not exists fps real,
  add column if not exists artifact_revision integer;

alter table public.swing_stages
  add column if not exists fps real,
  add column if not exists artifact_revision integer;

update public.head_markers m
set fps = v.fps, artifact_revision = v.artifact_revision
from public.swing_views v
where v.id = m.view_id and m.fps is null;

update public.swing_stages s
set fps = v.fps, artifact_revision = v.artifact_revision
from public.swing_views v
where v.id = s.view_id and s.fps is null;

-- Dead column (audit debt #5): never written by any code path since the queue runner landed;
-- `scoring_model_version` is the version that matters and lives on both tables that need it.
alter table public.swing_views drop column if exists analysis_version;
