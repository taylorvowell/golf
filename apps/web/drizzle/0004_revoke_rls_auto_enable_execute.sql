-- public.rls_auto_enable() is a Supabase-provided EVENT TRIGGER function that turns RLS on for
-- any new table in `public` — a good safety net, and worth knowing about: a table added later
-- gets RLS with no policies, which denies everything rather than exposing it.
--
-- It should not be EXECUTE-able by request roles though. It is SECURITY DEFINER and sits in the
-- exposed `public` schema, so PostgREST advertises it at /rest/v1/rpc/rls_auto_enable. Supabase's
-- own security advisor flags it, and it was the only finding on the project after step 03.
--
-- Revoking does not affect the event trigger: those fire through the trigger mechanism as the
-- function owner, not through a caller's EXECUTE privilege.
--
-- Guarded because the function is a hosted-Supabase artifact and does not exist locally.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
