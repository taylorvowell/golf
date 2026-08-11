-- The application stops being a superuser, so the policies written in 0003 actually fire.
--
-- D26 recorded the defect this closes: every one of the policies in migration 0003 was inert in
-- the running product. The app connected as `swingsage` locally and would have connected as
-- `postgres` on Supabase, and BOTH of those bypass row-level security outright — `swingsage` is a
-- superuser, and Supabase's `postgres` carries BYPASSRLS. `FORCE ROW LEVEL SECURITY` does not
-- reach either of them. The eleven tests in `src/db/rls.test.ts` passed the whole time, because
-- they impersonate `authenticated` correctly: they proved the POLICIES were right, never that the
-- PRODUCT used them.
--
-- Three things make the boundary real, and all three have to be here rather than in code:
--   1. a login role with no superuser, no BYPASSRLS and no route to `service_role`
--   2. default privileges, so a table added in a later migration is not silently unreadable
--      (0003 and 0006 both granted point-in-time and 0006 existed only to repair 0003's miss)
--   3. `public.ensure_profile()`, so first-sign-in row creation stops being the one operation
--      that needs elevation on a request path

--------------------------------------------------------------------------------------------
-- 1. swingsage_app — the role the running application connects as
--------------------------------------------------------------------------------------------
-- NOINHERIT is the whole design, and it mirrors Supabase's own `authenticator`: the role holds
-- membership in `anon` and `authenticated` but gets NONE of their privileges passively. It has to
-- `set local role` into one, per transaction, which is exactly the seam `src/db/session.ts`
-- provides. A query written outside that seam therefore reads nothing at all rather than reading
-- everything — the failure mode is a visible error, not a silent leak.
--
-- Deliberately created NOLOGIN and without a password. A password in a committed migration is a
-- credential in git; `src/db/appRole.ts` (`pnpm --filter web db:app-role`, chained onto
-- `db:migrate`) grants LOGIN and sets one, refusing to invent a default for anything but a
-- local host.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'swingsage_app') then
    create role swingsage_app nologin noinherit;
  end if;
end
$$;

-- Membership, NOT privileges — noinherit above is what makes that distinction load-bearing.
grant anon, authenticated to swingsage_app;

-- `service_role` is deliberately absent, and its absence is asserted at startup by
-- `assertNotPrivileged()` rather than trusted: it carries BYPASSRLS, so a `set role service_role`
-- reachable from a request handler would void every policy in this file in one statement. 4b's
-- privilege boundary is that the analyzer's role is unreachable from the API surface, and "the
-- app's login role is not a member of it" is the version of that claim the database can enforce.

--------------------------------------------------------------------------------------------
-- 2. Default privileges — so the next table is not silently invisible
--------------------------------------------------------------------------------------------
-- `grant ... on all tables in schema public` is a point-in-time statement, not a rule. 0003 ran
-- it, 0005 added `clubs` and 0006 added `swing_views`, and 0006 had to re-grant both by hand. That
-- worked because RLS was inert and nothing depended on the grant; now that the app is a
-- non-superuser, a missed grant is a table the product cannot read at all.
--
-- Scoped to the role running this migration, which owns the tables in both environments
-- (`swingsage` locally, `postgres` on Supabase) — default privileges attach to the creating role,
-- so this is the correct and only useful target.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- And catch up anything that already exists, since default privileges are not retroactive.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

--------------------------------------------------------------------------------------------
-- 3. app.ensure_profile — first sign-in, without elevation on a request path
--------------------------------------------------------------------------------------------
-- Mirroring a new auth identity into `public.users` is the one write the request path cannot make
-- as `authenticated`: `users` has SELECT and UPDATE policies but deliberately no INSERT policy,
-- and the local `auth.users` shim is not writable by a request role at all. The obvious fix — an
-- elevated connection used "just for this" — is precisely what D26 says must not exist, because a
-- privileged path that exists on a request will eventually be used for something else.
--
-- So it is a SECURITY DEFINER function instead, built the same way `private.has_coach_access` is:
--   * `search_path = ''`, so every name is schema-qualified and cannot be hijacked
--   * the identity comes from `auth.uid()` INTERNALLY — a caller can only ever create THEIR OWN
--     profile, and passing someone else's id is not expressible
--   * the email is the only argument, and it is data, never an identity
--
-- The SCHEMA is the third property, and it took an advisor to find it. In `public` this function
-- is a PostgREST endpoint — `/rest/v1/rpc/ensure_profile` — and Supabase's own default privileges
-- grant EXECUTE on new public functions to `anon`, so `revoke ... from public` does not remove it.
-- It went from "called by our server over its own connection" to "callable by anyone holding the
-- publishable key" without a line of code saying so.
--
-- `app` is therefore a new schema for exactly this: functions the application calls BY NAME over
-- its own Postgres connection and that must never be reachable over the REST API. PostgREST
-- exposes only the schemas it is configured with (`public`, `graphql_public`), so a function here
-- is unreachable from the internet by construction rather than by a grant that has to stay right.
-- `private` was the other candidate and is not the same thing: it holds objects nothing calls by
-- name at all, which is why 0003 revoked USAGE on it outright.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- An earlier revision of this migration created it in `public`. Dropped rather than left behind:
-- a stale SECURITY DEFINER function on the REST surface is precisely the finding above.
drop function if exists public.ensure_profile(text);

create or replace function app.ensure_profile(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  shim boolean;
begin
  if uid is null then
    -- Not an error condition to paper over: it means the seam did not set the request claims, so
    -- every policy below would have evaluated against a NULL identity.
    raise exception 'ensure_profile: no authenticated identity in this transaction';
  end if;

  -- Is `auth.users` the local stand-in from migration 0003, or the real auth system?
  --
  -- This has to be answered by inspection rather than by privilege. The definer role owns
  -- everything locally AND may hold INSERT on the hosted `auth.users`, so "can I write here"
  -- does not distinguish the two — and writing a half-populated row into a real auth system is
  -- how a account that cannot be signed into gets created. The shim has exactly `id` and
  -- `email`; every real Supabase `auth.users` has `encrypted_password`.
  select not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'auth.users'::pg_catalog.regclass
       and a.attname = 'encrypted_password'
       and not a.attisdropped
  ) into shim;

  if shim then
    insert into auth.users (id, email) values (uid, p_email)
    on conflict (id) do nothing;
  end if;

  -- `coalesce` and `nullif` are SQL grammar, not schema-qualified functions — qualifying them is
  -- a syntax error, and `search_path = ''` does not reach them. `split_part` is a real function
  -- and does need the qualification.
  insert into public.users (id, email, display_name)
  values (uid, p_email, coalesce(nullif(pg_catalog.split_part(p_email, '@', 1), ''), 'golfer'))
  on conflict (id) do nothing;

  return uid;
end;
$$;

-- `anon` explicitly as well as `public`: Supabase's default privileges grant EXECUTE on new
-- functions directly to `anon`, and revoking from PUBLIC does not touch a direct grant.
revoke execute on function app.ensure_profile(text) from public, anon;
grant execute on function app.ensure_profile(text) to authenticated;

--------------------------------------------------------------------------------------------
-- 4. The local shim gets the grants Supabase already makes
--------------------------------------------------------------------------------------------
-- On the hosted project `authenticated` can call `auth.uid()` by name; locally it could not,
-- because 0003 created the `auth` schema and granted nothing on it. That difference was invisible
-- while nothing but a policy expression called the function — a policy is parsed when it is
-- CREATED, as the owner, so it kept working. The moment application code asks "who am I" the two
-- environments diverge, which is precisely the class of gap the shim exists to eliminate.
--
-- Guarded to the shim: on Supabase the `auth` schema belongs to `supabase_auth_admin` and these
-- grants are neither ours to make nor needed.
do $$
begin
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'auth.users'::regclass
       and a.attname = 'encrypted_password'
       and not a.attisdropped
  ) then
    execute 'grant usage on schema auth to anon, authenticated, service_role';
    execute 'grant execute on function auth.uid() to anon, authenticated, service_role';
    execute 'grant select on auth.users to service_role';
  end if;
end
$$;

-- `assertNotPrivileged()` reads `pg_roles` and `pg_has_role` at startup; both are world-readable.
-- Nothing else is required: the seam sets `request.jwt.claims`, which is a custom GUC and needs
-- no privilege, and `set local role` needs only the membership granted in section 1.
