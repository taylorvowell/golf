--------------------------------------------------------------------------------------------
-- Per-user dismissals — the generic "seen it, never again" store
--------------------------------------------------------------------------------------------
-- The spotlights track's backbone, but deliberately NOT spotlight-shaped: any one-time
-- surface (a promo card, a "got it" tip, an intro banner) records its dismissal here as a
-- namespaced key (`spotlight.multiview.v1`). Server-side rather than device-local because
-- the product promise is "dismiss once, never again on ANY device" — the two existing
-- home intro cards are device-local AsyncStorage precisely because their promise was the
-- opposite (a reinstall re-introducing a first-run moment was correct); this table exists
-- for the surfaces where it is not.
--
-- A row is a fact, not state: it is only ever created. There is no `undismiss` in the
-- product — re-showing a reworked card is a NEW key (bump the version suffix), so history
-- stays true. DELETE exists solely for the dev debug-menu reset and is additionally gated
-- to non-production at the route.
--
-- Hand-written, like every migration since 0003.

--------------------------------------------------------------------------------------------
-- 1. The table
--------------------------------------------------------------------------------------------
create table if not exists public.user_dismissals (
  user_id      uuid        not null references public.users(id) on delete cascade,
  -- Namespaced, versioned by convention: `<surface>.<id>.v<N>`. Text rather than an enum
  -- because a new card must never be a migration.
  key          text        not null check (char_length(key) between 1 and 200),
  dismissed_at timestamptz not null default now(),
  -- The PK is also the only index this table needs: every read is "all keys for me", and
  -- the leading user_id column carries the RLS predicate.
  primary key (user_id, key)
);

--------------------------------------------------------------------------------------------
-- 2. RLS
--------------------------------------------------------------------------------------------
-- FORCE as well as ENABLE, per 0003: without FORCE the table owner is exempt and a missing
-- policy stays hidden behind "it worked when I ran it as postgres".
alter table public.user_dismissals enable row level security;
alter table public.user_dismissals force  row level security;

-- Personal, owner-only in every direction. Unlike most golfer tables there is no coach
-- read: which promos a golfer waved away is nobody's coaching data.
drop policy if exists user_dismissals_select_self on public.user_dismissals;
create policy user_dismissals_select_self on public.user_dismissals
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Unlike notifications, INSERT is a plain policy: a dismissal never crosses users — the
-- only row anyone can mint is their own.
drop policy if exists user_dismissals_insert_self on public.user_dismissals;
create policy user_dismissals_insert_self on public.user_dismissals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- The debug-menu reset. Own rows only; the route additionally refuses this in production.
drop policy if exists user_dismissals_delete_self on public.user_dismissals;
create policy user_dismissals_delete_self on public.user_dismissals
  for delete to authenticated
  using (user_id = (select auth.uid()));

--------------------------------------------------------------------------------------------
-- 3. Grants
--------------------------------------------------------------------------------------------
-- 0008's default privileges hand `authenticated` full CRUD on every new table; trim to the
-- real surface. No UPDATE policy exists, but revoke it anyway so the surface is stated in
-- both layers — a dismissal is immutable (dismissed_at is the fact's timestamp, not state).
revoke update on public.user_dismissals from authenticated;
grant select, insert, delete on public.user_dismissals to authenticated;
grant all on public.user_dismissals to service_role;
