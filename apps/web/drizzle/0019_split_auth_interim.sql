-- The interim auth/data split (auth home = golf-swing, data = swingsage-prod) hits 0003's
-- identity FK: `public.users.id -> auth.users(id)` assumes auth and data live in the SAME
-- Supabase project. Under the split, a signed-in golfer's uid exists in the AUTH project's
-- auth.users and never in the DATA project's — so `app.ensure_profile()`'s mirror insert
-- violates the FK and every authenticated route answers 500. That is exactly how the first
-- phone session against the hosted stack failed on 2026-08-23.
--
-- Guarded by the same shim test 0008/0009 use: on a LOCAL database, auth.users is the shim
-- (no `encrypted_password` column), ensure_profile inserts the identity there first, and the
-- FK is both satisfiable and worth keeping. Only a REAL auth schema loses the constraint.
--
-- TEMPORARY BY DESIGN: when the auth home moves onto swingsage-prod (the cutover row in
-- docs/HANDOFF.md), re-add the constraint in that migration — identities will then live in
-- the same project again and the integrity check becomes true rather than aspirational.
do $$
begin
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = 'auth.users'::regclass
       and a.attname = 'encrypted_password'
       and not a.attisdropped
  ) then
    alter table public.users drop constraint if exists users_id_auth_users_fk;
  end if;
end
$$;
