-- Identity, row-level security, and the coach seam.
--
-- Three things happen here, and the order matters:
--   1. the app's `users.id` becomes the Supabase `auth.users` id (D7: one identity, no shadow
--      table)
--   2. RLS goes on every user-scoped table, because D7 makes the database the authorization
--      boundary rather than application code
--   3. the coach relationship table is created so the policy shape has a real place for it, and
--      so the coach-access tests can be written now instead of five phases from now
--
-- This migration is written to apply UNCHANGED to both Supabase and the local Docker Postgres.
-- That is not tidiness: it means the access-boundary tests run in CI with no cloud credentials,
-- and a policy can be proven wrong on a laptop instead of only in a hosted project.

--------------------------------------------------------------------------------------------
-- 1. auth shim — a no-op on Supabase, a minimal stand-in locally
--------------------------------------------------------------------------------------------

create schema if not exists auth;

-- Guarded by an existence check rather than `if not exists`, because on Supabase the auth schema
-- is owned by supabase_auth_admin and CREATE TABLE IF NOT EXISTS still requires CREATE on the
-- schema — it fails with "permission denied" before it ever gets to the "if not exists" part.
-- So: only attempt it when the table genuinely is not there, which is only ever the local case.
do $$
begin
  if to_regclass('auth.users') is null then
    execute 'create table auth.users (id uuid primary key, email text)';
  end if;
end
$$;

-- Supabase's request roles. They exist on the hosted project; locally they have to be created or
-- `revoke ... from anon` fails outright, and — more importantly — the access-boundary tests
-- cannot `set role authenticated` to impersonate a real request. NOLOGIN: these are role
-- identities to switch into, never accounts to connect as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is what makes this the analyzer's role: it writes artifacts for users it is not
    -- authenticated as. 4b's boundary is that this must never be reachable from request handling.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- auth.uid() must NEVER be replaced on Supabase — it reads the verified request JWT and
-- overwriting it would silently break every policy in the project. So it is created only if
-- absent, which is exactly the local case. The local version reads the same GUC Supabase's does,
-- so a test written against one runs unchanged against the other.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select nullif(
          current_setting('request.jwt.claims', true)::json ->> 'sub', ''
        )::uuid
      $body$;
    $fn$;
  end if;
end
$$;

--------------------------------------------------------------------------------------------
-- 2. One identity: public.users.id IS auth.users.id
--------------------------------------------------------------------------------------------

-- Any pre-existing local rows (the seeded admin) need a matching auth row before the FK can be
-- added. Guarded rather than relying on the select being empty: writing to auth.users needs
-- INSERT privilege on Supabase whether or not any rows would move, and we neither have it nor
-- want it. Rows in public.users before this migration only exist locally.
do $$
begin
  if exists (select 1 from public.users) then
    insert into auth.users (id, email)
    select u.id, u.email from public.users u
    on conflict (id) do nothing;
  end if;
end
$$;

-- The id now comes from the auth system, never from the database. Leaving the default in place
-- would let application code insert a user with an id that exists nowhere in auth — a row that
-- looks valid and can never be logged into.
alter table public.users alter column id drop default;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_id_auth_users_fk'
  ) then
    alter table public.users
      add constraint users_id_auth_users_fk
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end
$$;

--------------------------------------------------------------------------------------------
-- 3. The coach seam
--------------------------------------------------------------------------------------------

-- Deliberately minimal. The coach FEATURE belongs to the `coach-relationships` track; what has
-- to exist now is the shape the policies reference, so the authorization boundary can be tested
-- before anything depends on it being right.
--
-- `status` carries `revoked` as a real state rather than deleting the row: §24.4 requires the
-- golfer to be able to end access, and an audit trail of "this coach could see your swings
-- between these dates" is worth more than a clean table.
create table if not exists public.coach_links (
  id uuid primary key default gen_random_uuid(),
  golfer_id uuid not null references public.users (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_links_no_self check (golfer_id <> coach_id)
);

create unique index if not exists coach_links_pair on public.coach_links (golfer_id, coach_id);

--------------------------------------------------------------------------------------------
-- 4. Indexes on every column a policy reads
--------------------------------------------------------------------------------------------
-- A policy is evaluated for every candidate row. Without these the boundary is correct and the
-- product is slow, which tends to get "fixed" by weakening the boundary.

create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists swings_user_id_idx on public.swings (user_id);
create index if not exists jobs_swing_id_idx on public.jobs (swing_id);
create index if not exists head_markers_swing_id_idx on public.head_markers (swing_id);
create index if not exists swing_stages_swing_id_idx on public.swing_stages (swing_id);
create index if not exists coach_links_coach_idx on public.coach_links (coach_id, status);

--------------------------------------------------------------------------------------------
-- 5. Coach lookup, as a SECURITY DEFINER function
--------------------------------------------------------------------------------------------
-- It has to bypass RLS on coach_links: a policy on `swings` that read `coach_links` directly
-- would have that read filtered by coach_links' own policy, and the two would have to agree
-- forever. One function, one place to be right.
--
-- The safety of a SECURITY DEFINER function is entirely in its body, so:
--   * `search_path = ''` — every name is schema-qualified, so it cannot be hijacked by a
--     same-named object in a caller-controlled schema
--   * it checks `auth.uid()` INTERNALLY, so a caller can only ever ask "may *I* see this
--     golfer", never "may someone else"
--   * it lives in `private`, which is not exposed through PostgREST

create schema if not exists private;

create or replace function private.has_coach_access(golfer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_links cl
    where cl.golfer_id = golfer
      and cl.coach_id = (select auth.uid())
      and cl.status = 'approved'
  );
$$;

-- Nobody calls this by name. `authenticated` keeps EXECUTE because policy expressions are
-- evaluated as the querying role, so revoking it there would break every policy that uses it —
-- the internal auth.uid() check is what makes that safe, not the grant.
revoke execute on function private.has_coach_access(uuid) from public;
revoke all on schema private from anon, authenticated;
grant execute on function private.has_coach_access(uuid) to authenticated;

--------------------------------------------------------------------------------------------
-- 6. RLS
--------------------------------------------------------------------------------------------
-- FORCE as well as ENABLE: without FORCE the table owner is exempt, and "it worked when I ran it
-- as postgres" is how a missing policy stays hidden. The analyzer's service role still bypasses
-- all of this — that is a role attribute (BYPASSRLS), which is the point of 4b's boundary.

alter table public.users          enable row level security;
alter table public.users          force  row level security;
alter table public.sessions       enable row level security;
alter table public.sessions       force  row level security;
alter table public.swings         enable row level security;
alter table public.swings         force  row level security;
alter table public.jobs           enable row level security;
alter table public.jobs           force  row level security;
alter table public.scores         enable row level security;
alter table public.scores         force  row level security;
alter table public.head_markers   enable row level security;
alter table public.head_markers   force  row level security;
alter table public.swing_stages   enable row level security;
alter table public.swing_stages   force  row level security;
alter table public.coach_links    enable row level security;
alter table public.coach_links    force  row level security;

-- `(select auth.uid())` rather than a bare call: the subquery form is evaluated once per
-- statement instead of once per row.

-- users --------------------------------------------------------------------------------------
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()) or (select private.has_coach_access(id)));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- sessions -----------------------------------------------------------------------------------
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_coach_access(user_id)));

drop policy if exists sessions_write on public.sessions;
create policy sessions_write on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- swings -------------------------------------------------------------------------------------
-- Read is owner-or-approved-coach. Write is owner only: a coach reviews a golfer's swing, never
-- edits it (§24.3 — the golfer controls the relationship and the data).
drop policy if exists swings_select on public.swings;
create policy swings_select on public.swings
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_coach_access(user_id)));

drop policy if exists swings_write on public.swings;
create policy swings_write on public.swings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Child tables inherit visibility from their swing, by asking whether the swing is visible.
-- The nested select is itself subject to `swings_select`, so coach access and revocation flow
-- through automatically and cannot drift out of step with the parent's rule.
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (exists (select 1 from public.swings s where s.id = swing_id));

drop policy if exists jobs_write on public.jobs;
create policy jobs_write on public.jobs
  for all to authenticated
  using (exists (select 1 from public.swings s
                 where s.id = swing_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swings s
                      where s.id = swing_id and s.user_id = (select auth.uid())));

drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores
  for select to authenticated
  using (exists (select 1 from public.swings s where s.id = swing_id));

drop policy if exists scores_write on public.scores;
create policy scores_write on public.scores
  for all to authenticated
  using (exists (select 1 from public.swings s
                 where s.id = swing_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swings s
                      where s.id = swing_id and s.user_id = (select auth.uid())));

drop policy if exists head_markers_select on public.head_markers;
create policy head_markers_select on public.head_markers
  for select to authenticated
  using (exists (select 1 from public.swings s where s.id = swing_id));

drop policy if exists head_markers_write on public.head_markers;
create policy head_markers_write on public.head_markers
  for all to authenticated
  using (exists (select 1 from public.swings s
                 where s.id = swing_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swings s
                      where s.id = swing_id and s.user_id = (select auth.uid())));

drop policy if exists swing_stages_select on public.swing_stages;
create policy swing_stages_select on public.swing_stages
  for select to authenticated
  using (exists (select 1 from public.swings s where s.id = swing_id));

drop policy if exists swing_stages_write on public.swing_stages;
create policy swing_stages_write on public.swing_stages
  for all to authenticated
  using (exists (select 1 from public.swings s
                 where s.id = swing_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.swings s
                      where s.id = swing_id and s.user_id = (select auth.uid())));

-- coach_links --------------------------------------------------------------------------------
-- Both parties may see the link. Only the GOLFER may change it — that is §24.4's requirement
-- that the golfer owns the relationship and can end it, expressed as a write rule rather than a
-- button that could be bypassed.
drop policy if exists coach_links_select on public.coach_links;
create policy coach_links_select on public.coach_links
  for select to authenticated
  using (golfer_id = (select auth.uid()) or coach_id = (select auth.uid()));

drop policy if exists coach_links_write on public.coach_links;
create policy coach_links_write on public.coach_links
  for all to authenticated
  using (golfer_id = (select auth.uid()))
  with check (golfer_id = (select auth.uid()));
