-- §4.3 account deletion, and D31's "every account carries an email" invariant.
--
-- Two things land together because the second is a precondition for the first being honest: a
-- deletion that cannot reach the golfer by email afterwards ("your account and its videos are
-- gone") is a deletion nobody can confirm happened.

--------------------------------------------------------------------------------------------
-- 1. Every account carries an email address, whatever it signed in with (D31)
--------------------------------------------------------------------------------------------
-- D31 added this to step 04's Definition of Done and it is deliberately landing BEFORE the
-- provider that can violate it. Phone is the next sequenced provider, and a phone-only identity
-- arrives from Supabase with `email` NULL — so the moment that path exists, `ensure_profile`
-- would happily write a profile that is unreachable and, per D25's objection, permanently lost
-- the day the golfer changes carrier.
--
-- Making the column NOT NULL is what turns "the phone flow should collect an email" from a note
-- into something the database refuses to skip. The phone flow will get a distinguishable error
-- (below) rather than a constraint violation, which is the signal onboarding needs.
alter table public.users alter column email set not null;

--------------------------------------------------------------------------------------------
-- 2. ensure_profile rejects a missing email, by name
--------------------------------------------------------------------------------------------
-- Replaces the 0008 body. The insert is otherwise identical; what changes is that a null or blank
-- email now raises `SS_EMAIL_REQUIRED` instead of hitting the NOT NULL constraint, so the caller
-- can tell "this identity has no email yet, ask for one" apart from "the database rejected the
-- write". A 23502 would be indistinguishable from a bug.
create or replace function app.ensure_profile(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  shim boolean;
  -- `coalesce` is SQL grammar, not a schema-qualified function: `pg_catalog.coalesce(...)` is a
  -- "function does not exist" error, exactly as 0008 records. `btrim` is a real function and does
  -- need the qualification under `search_path = ''`.
  email text := pg_catalog.btrim(coalesce(p_email, ''));
begin
  if uid is null then
    raise exception 'ensure_profile: no authenticated identity in this transaction';
  end if;

  -- D31: an account with no address is an account that cannot be recovered. Raised with a stable
  -- prefix so the application matches on the code, never on the prose.
  if email = '' then
    raise exception 'SS_EMAIL_REQUIRED: this identity carries no email address'
      using errcode = 'check_violation';
  end if;

  -- Is `auth.users` the local stand-in from migration 0003, or the real auth system? Unchanged
  -- from 0008 — see there for why this is answered by inspection rather than by privilege.
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

  return uid;
end;
$$;

revoke execute on function app.ensure_profile(text) from public, anon;
grant execute on function app.ensure_profile(text) to authenticated;

--------------------------------------------------------------------------------------------
-- 3. app.delete_own_account — §4.3, without elevation on a request path
--------------------------------------------------------------------------------------------
-- Deleting a `public.users` row cascades to everything the golfer owns: clubs, sessions, swings,
-- swing_views and every artifact row hanging off a view, plus both sides of coach_links. That is
-- the whole point of the `on delete cascade` chain established in 0003/0005/0006 — the cascade is
-- declared once, next to the foreign keys, rather than re-derived as a delete script that drifts
-- out of step with the schema the day a table is added.
--
-- But `users` has no DELETE policy and deliberately never will: a request-role DELETE on that
-- table is a statement whose blast radius is "an entire person", and the only safe version of it
-- is one where the target cannot be named. Hence the same shape as `ensure_profile` —
-- SECURITY DEFINER, `search_path = ''`, identity read from `auth.uid()` INTERNALLY. Deleting
-- somebody else's account is not expressible in this API. There is no argument to get wrong.
--
-- It lives in `app` rather than `public` for the reason the advisor found in 0008: a SECURITY
-- DEFINER function in `public` is a PostgREST endpoint, and Supabase's default privileges hand
-- `anon` EXECUTE on new public functions. `/rest/v1/rpc/delete_own_account` callable by anyone
-- holding the publishable key is not a hypothetical, it is what 0008 shipped and then fixed.
--
-- Returns what it removed rather than void, so the route can report a real number to the golfer
-- and so a test can assert the cascade actually reached the swings instead of trusting it.
create or replace function app.delete_own_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  n_swings int;
  n_views int;
  n_users int;
  shim boolean;
begin
  if uid is null then
    raise exception 'delete_own_account: no authenticated identity in this transaction';
  end if;

  -- Counted BEFORE the delete. Afterwards there is nothing left to count, and a caller that
  -- reports "0 swings removed" when it removed ten is worse than one that reports nothing.
  select pg_catalog.count(*) into n_swings from public.swings s where s.user_id = uid;
  select pg_catalog.count(*) into n_views
    from public.swing_views v
    join public.swings s on s.id = v.swing_id
   where s.user_id = uid;

  delete from public.users u where u.id = uid;
  get diagnostics n_users = row_count;

  -- The local `auth.users` shim (migration 0003) has no cascade FROM `public.users`, so the
  -- identity row would survive its own profile and the next `ensure_profile` would silently
  -- re-adopt it. On the hosted project this block does not run: `auth.users` there belongs to
  -- the auth system, is deleted through the admin API by the caller, and touching it directly
  -- would leave the auth service's own tables inconsistent.
  select not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'auth.users'::pg_catalog.regclass
       and a.attname = 'encrypted_password'
       and not a.attisdropped
  ) into shim;

  if shim then
    delete from auth.users au where au.id = uid;
  end if;

  return pg_catalog.jsonb_build_object(
    'userId', uid,
    'profileDeleted', n_users > 0,
    'swings', n_swings,
    'views', n_views,
    'authShimDeleted', shim
  );
end;
$$;

revoke execute on function app.delete_own_account() from public, anon;
grant execute on function app.delete_own_account() to authenticated;
