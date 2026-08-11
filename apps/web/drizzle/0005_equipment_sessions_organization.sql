-- The §6/§7/§8 model, additively.
--
-- Deliberately NOT including §7.1's multi-view restructure (one Swing owning several views, each
-- with its own video and analysis artifact). That one changes the identity of a swing and rewrites
-- every query and the player with it, so it is its own focused change rather than a rider on this.
-- Everything here is additive: no existing column changes meaning, and the app keeps working
-- throughout.

-- §6 — equipment. A club is a real row, not a free-text string.
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category text not null check (category in ('wood','hybrid','iron','wedge','putter')),
  -- `number` is text, not an integer: "PW", "SW", "3" and "A" all live here.
  number text,
  loft real,
  brand text,
  model text,
  shaft text,
  flex text,
  length_in real,
  lie_deg real,
  -- Feeds the analyzer's `--club-type driver|irons` so club-aware scoring bands stop being a
  -- hand-typed flag. Derived from category on write rather than inferred at analysis time,
  -- because the analyzer must not have to know this table exists.
  analyzer_club_type text check (analyzer_club_type in ('driver','irons')),
  retired boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists clubs_user_idx on public.clubs (user_id) where retired = false;

-- §8 — sessions become real rather than a bare date.
alter table public.sessions add column if not exists goal text;
alter table public.sessions add column if not exists representative_swing_id text
  references public.swings (id) on delete set null;

-- §7.2 / §7.3 — the swing fields the log needs to filter and organise on.
alter table public.swings add column if not exists club_id uuid
  references public.clubs (id) on delete set null;
alter table public.swings add column if not exists favourite boolean not null default false;
alter table public.swings add column if not exists tags text[] not null default '{}';
alter table public.swings add column if not exists coach_reviewed_at timestamptz;
alter table public.swings add column if not exists analysis_version text;
alter table public.swings add column if not exists ball text;

-- `club` (free text) is deliberately KEPT alongside `club_id`. Ten analysed fixtures carry a
-- typed-in club name and no inventory row; dropping it would lose that. The rule is: club_id wins
-- when present, club is the fallback, and nothing has to be backfilled to keep working.
comment on column public.swings.club is
  'Legacy free-text club. club_id supersedes it when set; kept so pre-inventory swings keep their value.';

create index if not exists swings_favourite_idx on public.swings (user_id) where favourite;
create index if not exists swings_tags_idx on public.swings using gin (tags);

-- RLS for the new table, matching the shape every other user-scoped table uses.
alter table public.clubs enable row level security;
alter table public.clubs force  row level security;

drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_coach_access(user_id)));

drop policy if exists clubs_write on public.clubs;
create policy clubs_write on public.clubs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
