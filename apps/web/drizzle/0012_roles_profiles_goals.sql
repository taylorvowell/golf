-- §3's roles, §5's golfer profile, and §5.3's goals — with the public/private split expressed
-- as SHAPE rather than as a flag.
--
-- Three things arrive together because they are one design:
--
--   1. `user_roles` — one account, several roles (§3.3), addable later without a new account
--      (§4.4). Claiming `coach` is free and instant (D32); `admin` is not self-grantable.
--   2. `golfer_profiles` — everything §5.2/§5.4/§5.5 says the AI Coach (§17.2) and the priority
--      engine (§16.1) need, PRIVATE to the golfer and their approved coaches.
--   3. `golfer_goals` — §5.3's curated eight, capped at 2-3 by a constraint rather than by UI.
--
-- The public/private question §34.1 asks is answered by which table a column is in. `public.users`
-- is the public face (display name, avatar, bio, region) and is already readable by an approved
-- coach under 0003's `users_select_self`. `golfer_profiles` is everything else. A boolean per
-- column would have answered the same question in application code, where every future reader has
-- to remember to ask it; here, putting a field in the wrong table is a visible design mistake.
--
-- Hand-written, like every migration since 0003 — the drizzle snapshot chain stops at 0002 and
-- `db:generate` cannot express RLS, SECURITY DEFINER functions or a data move anyway.

--------------------------------------------------------------------------------------------
-- 1. The public half of the profile (§5.1)
--------------------------------------------------------------------------------------------
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists bio text;
alter table public.users add column if not exists region text;

--------------------------------------------------------------------------------------------
-- 2. user_roles (§3, §4.4)
--------------------------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid        not null references public.users(id) on delete cascade,
  role       text        not null check (role in ('golfer', 'coach', 'admin')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- The reverse lookup a coach workspace needs ("every account holding this role") and the one an
-- admin surface will need. The primary key already covers user_id -> roles.
create index if not exists user_roles_role_idx on public.user_roles (role);

--------------------------------------------------------------------------------------------
-- 3. golfer_profiles (§5.2, §5.4, §5.5)
--------------------------------------------------------------------------------------------
-- Every column nullable except the identity. §45's success definition starts with "create an
-- account quickly", so nothing here may stand between a new account and a first swing, and
-- handedness — the one REQUIRED onboarding answer — is required by the FLOW, not by a constraint.
-- A NOT NULL would make a half-finished profile unstorable and therefore unresumable, which is
-- the opposite of what §4.4 asks for.
create table if not exists public.golfer_profiles (
  user_id                     uuid primary key references public.users(id) on delete cascade,

  -- §5.4 onboarding personalization
  handedness                  text check (handedness in ('right', 'left')),
  self_reported_style         text check (self_reported_style in ('sty_01','sty_02','sty_03','sty_04','unsure')),
  skill_level                 text check (skill_level in ('just_starting','beginner','advanced')),
  handicap_range              text check (handicap_range in ('plus','scratch_5','6_10','11_15','16_20','21_28','29_plus')),

  -- §5.5 Tier 1
  typical_miss_driver         text check (typical_miss_driver in ('slice','hook','push','pull','fat','thin','top','two_way')),
  typical_miss_irons          text check (typical_miss_irons  in ('slice','hook','push','pull','fat','thin','top','two_way')),
  average_score               integer,
  driver_swing_speed_mph      real,
  seven_iron_carry_yds        real,
  fitted_status               text check (fitted_status in ('never','static','dynamic')),
  fitted_year                 integer,
  grip_size                   text check (grip_size in ('undersize','standard','midsize','oversize','built_up')),
  physical_limitations        jsonb,

  -- §5.5 Tier 2. Equipment SPECS stay in `clubs` (§6) and are linked, never duplicated here.
  launch_monitor_access       text check (launch_monitor_access in ('trackman','gcquad','mevo','simulator_only','none')),
  practice_access             text check (practice_access in ('range','simulator','home_net','course_only')),
  rounds_per_month            integer,
  practice_sessions_per_week  integer,
  altitude_ft                 integer,
  climate                     text check (climate in ('temperate','hot_humid','hot_dry','cold','coastal')),

  -- §5.5 Tier 3
  height_cm                   integer,
  wingspan_cm                 integer,
  wrist_to_floor_cm           integer,
  -- A RANGE, never a birthdate. §43 asks whether age is exact or bucketed; nothing in the product
  -- needs the exact number, and a birthdate would be the most sensitive field in the schema.
  age_range                   text check (age_range in ('under_18','18_29','30_39','40_49','50_59','60_69','70_plus')),
  years_playing               integer,
  mobility_screen             jsonb,
  working_with_coach          boolean,
  swing_change_in_progress    boolean,
  preferred_shot_shape        text check (preferred_shot_shape in ('draw','fade','straight')),
  coaching_style              text check (coaching_style in ('technical','feel')),
  feedback_depth              text check (feedback_depth in ('brief','standard','detailed')),

  -- Null means onboarding is still resumable. That is all "resumable" has to mean once the
  -- profile row itself is the draft.
  onboarding_completed_at     timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

--------------------------------------------------------------------------------------------
-- 4. golfer_goals (§5.3, capped by D54)
--------------------------------------------------------------------------------------------
create table if not exists public.golfer_goals (
  user_id    uuid        not null references public.users(id) on delete cascade,
  goal       text        not null check (goal in (
                 'add_distance','find_fairways','fix_big_miss','strike_flush',
                 'trust_tee_shots','sharper_irons','rebuild_mechanics','smooth_tempo')),
  -- 1-based, in the golfer's own order of importance. Goals #1 and #2 pull the rubric in opposite
  -- directions, and §5.3 requires the coach to name that tension rather than average it away —
  -- which needs an order to reason about.
  rank       integer     not null check (rank between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (user_id, goal)
);

-- The 2-3 cap is a DATABASE rule, not a UI one. Selecting everything teaches the product nothing,
-- and that is the entire reason D54 replaced the open example list with a curated set — a cap
-- enforced only in a form is a cap that a second client, a script or a future screen does not have.
create or replace function public.golfer_goals_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select pg_catalog.count(*) from public.golfer_goals g where g.user_id = new.user_id) > 3 then
    raise exception 'SS_TOO_MANY_GOALS: at most 3 goals may be selected'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists golfer_goals_cap_trg on public.golfer_goals;
-- AFTER, not BEFORE, and that is the load-bearing part: a BEFORE ROW trigger fires while its own
-- statement is still running and cannot see the other rows of a multi-row insert, so
-- `insert ... values (a),(b),(c),(d)` would count 0,1,2,3 and land all four. AFTER ROW triggers
-- are queued until the statement completes, so every row sees the final count.
create constraint trigger golfer_goals_cap_trg
  after insert or update on public.golfer_goals
  deferrable initially immediate
  for each row execute function public.golfer_goals_cap();

--------------------------------------------------------------------------------------------
-- 5. Move handedness and height off the identity table
--------------------------------------------------------------------------------------------
-- They predate profiles and had NO readers anywhere in the app (the per-swing `swings.handedness`
-- is the one everything actually uses, and it comes from the analysis artifact). A golfer's
-- handedness is a property of the golfer, so it belongs on the profile — but the copy comes first
-- and the drop second, so the migration is safe to run against a database where someone had
-- answered.
insert into public.golfer_profiles (user_id, handedness, height_cm)
select u.id, u.handedness, u.height_cm
  from public.users u
 where u.handedness is not null or u.height_cm is not null
on conflict (user_id) do update
   set handedness = coalesce(public.golfer_profiles.handedness, excluded.handedness),
       height_cm  = coalesce(public.golfer_profiles.height_cm,  excluded.height_cm);

alter table public.users drop column if exists handedness;
alter table public.users drop column if exists height_cm;

--------------------------------------------------------------------------------------------
-- 6. Backfill the golfer role for every account that already exists
--------------------------------------------------------------------------------------------
-- Everyone is a golfer by default (D32: onboarding defaults to golfer, and §3.3 expects a coach
-- to film their own swings too). Doing it here rather than only in `ensure_profile` means the
-- accounts created before this migration are not a second, role-less class.
insert into public.user_roles (user_id, role)
select u.id, 'golfer' from public.users u
on conflict do nothing;

--------------------------------------------------------------------------------------------
-- 7. ensure_profile also grants the golfer role
--------------------------------------------------------------------------------------------
-- Replaces the 0009 body. Identical except for the final insert: a new identity gets its golfer
-- role in the same transaction that creates its profile row, so "signed in but holds no role" is
-- never a reachable state. Still SECURITY DEFINER with the identity read from auth.uid()
-- INTERNALLY — creating someone else's profile remains inexpressible.
create or replace function app.ensure_profile(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  shim boolean;
  email text := pg_catalog.btrim(coalesce(p_email, ''));
begin
  if uid is null then
    raise exception 'ensure_profile: no authenticated identity in this transaction';
  end if;

  if email = '' then
    raise exception 'SS_EMAIL_REQUIRED: this identity carries no email address'
      using errcode = 'check_violation';
  end if;

  select not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'auth.users'::pg_catalog.regclass
       and a.attname = 'encrypted_password'
       and not a.attisdropped
  ) into shim;

  if shim then
    insert into auth.users (id, email) values (uid, email)
    on conflict (id) do nothing;
  end if;

  insert into public.users (id, email, display_name)
  values (uid, email, coalesce(nullif(pg_catalog.split_part(email, '@', 1), ''), 'golfer'))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (uid, 'golfer')
  on conflict do nothing;

  return uid;
end;
$$;

revoke execute on function app.ensure_profile(text) from public, anon;
grant execute on function app.ensure_profile(text) to authenticated;

--------------------------------------------------------------------------------------------
-- 8. app.claim_role — the free, instant coach claim (D32), and nothing more
--------------------------------------------------------------------------------------------
-- `user_roles` deliberately has no INSERT policy. A self-service grant table with a write policy
-- is one `with check` typo away from letting an account grant itself `admin`, and the blast radius
-- of that mistake is the whole product. So the grant is a function with a whitelist instead: the
-- role is validated against what a person may claim for THEMSELVES, and the identity is read from
-- auth.uid() internally, so granting somebody else a role is not expressible.
--
-- `golfer` and `coach` are claimable because D32 makes both free and instant — a coach exploring
-- the product needs the workspace with an empty roster, and being LISTED in the directory is the
-- reviewed application that gates anything real. `admin` is not claimable by anyone, ever; it is
-- granted out of band by whatever `admin-surface` builds.
create or replace function app.claim_role(p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'claim_role: no authenticated identity in this transaction';
  end if;

  if p_role not in ('golfer', 'coach') then
    raise exception 'SS_ROLE_NOT_CLAIMABLE: % cannot be claimed', coalesce(p_role, 'null')
      using errcode = 'check_violation';
  end if;

  insert into public.user_roles (user_id, role) values (uid, p_role)
  on conflict do nothing;
end;
$$;

revoke execute on function app.claim_role(text) from public, anon;
grant execute on function app.claim_role(text) to authenticated;

--------------------------------------------------------------------------------------------
-- 9. RLS
--------------------------------------------------------------------------------------------
-- FORCE as well as ENABLE, per 0003: without FORCE the table owner is exempt and a missing policy
-- stays hidden behind "it worked when I ran it as postgres".
alter table public.user_roles      enable row level security;
alter table public.user_roles      force  row level security;
alter table public.golfer_profiles enable row level security;
alter table public.golfer_profiles force  row level security;
alter table public.golfer_goals    enable row level security;
alter table public.golfer_goals    force  row level security;

-- user_roles ---------------------------------------------------------------------------------
-- Readable by the holder. NOT by an approved coach: which roles an account holds is not part of
-- what §24 grants a coach access to, and a coach directory reads the public `users` row, never
-- this table.
--
-- No INSERT, UPDATE or DELETE policy, deliberately — see `app.claim_role` above. Dropping a role
-- is not expressible either; giving up the coach role has product consequences (an active roster,
-- lessons in flight) that belong to `coach-relationships`, not to a DELETE policy written now.
drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- golfer_profiles ----------------------------------------------------------------------------
-- Owner-or-approved-coach for read, owner only for write — the same shape as `swings`, and for
-- the same reason (§24.3: a coach reads a golfer's data, never edits it). This is the private
-- half of §5.1, so the coach's read here is exactly what the golfer approving the link consented
-- to, and nothing wider.
drop policy if exists golfer_profiles_select on public.golfer_profiles;
create policy golfer_profiles_select on public.golfer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_coach_access(user_id)));

drop policy if exists golfer_profiles_write on public.golfer_profiles;
create policy golfer_profiles_write on public.golfer_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- golfer_goals -------------------------------------------------------------------------------
-- Same rule. A coach seeing what the golfer is working on is the point of §26; editing it is not.
drop policy if exists golfer_goals_select on public.golfer_goals;
create policy golfer_goals_select on public.golfer_goals
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_coach_access(user_id)));

drop policy if exists golfer_goals_write on public.golfer_goals;
create policy golfer_goals_write on public.golfer_goals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

--------------------------------------------------------------------------------------------
-- 10. Grants
--------------------------------------------------------------------------------------------
-- 0008's default privileges cover tables created by the same owning role, which these are. The
-- explicit grants are belt-and-braces for a database where 0008's ALTER DEFAULT PRIVILEGES was
-- applied under a different role than the one running this file — 0003 and 0006 both had to
-- repair exactly that.
grant select, insert, update, delete on public.user_roles      to authenticated;
grant select, insert, update, delete on public.golfer_profiles to authenticated;
grant select, insert, update, delete on public.golfer_goals    to authenticated;
grant all on public.user_roles, public.golfer_profiles, public.golfer_goals to service_role;
