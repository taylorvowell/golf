-- The human coach is named INSTRUCTOR everywhere, including internal identifiers
-- (.claude/architecture/instructor-platform-2026-08-24.md §1, accepted 2026-08-26).
-- "coach" keeps exactly one meaning in this codebase after this migration: the AI coach.
--
-- Renamed now, while the window is cheap: dev-only data, one seeded persona link, one
-- role-gated route. Renaming later means renaming under RLS with production data behind it.
--
-- Hand-written, like every migration since 0003.

--------------------------------------------------------------------------------------------
-- 1. The relationship table: coach_links -> instructor_links
--------------------------------------------------------------------------------------------
-- Policies survive a table/column rename (they bind by oid/attnum), but their NAMES don't
-- follow, and names are how later migrations drop/recreate them. Rename everything so no
-- object keeps a coach_* name.

alter table public.coach_links rename to instructor_links;
alter table public.instructor_links rename column coach_id to instructor_id;
alter table public.instructor_links rename constraint coach_links_no_self to instructor_links_no_self;
alter index public.coach_links_pair rename to instructor_links_pair;
alter index public.coach_links_coach_idx rename to instructor_links_instructor_idx;

drop policy if exists coach_links_select on public.instructor_links;
create policy instructor_links_select on public.instructor_links
  for select to authenticated
  using (golfer_id = (select auth.uid()) or instructor_id = (select auth.uid()));

drop policy if exists coach_links_write on public.instructor_links;
create policy instructor_links_write on public.instructor_links
  for all to authenticated
  using (golfer_id = (select auth.uid()))
  with check (golfer_id = (select auth.uid()));

--------------------------------------------------------------------------------------------
-- 2. The access primitive: has_coach_access -> has_instructor_access
--------------------------------------------------------------------------------------------
-- Same body, same three safety properties (empty search_path, internal auth.uid(), private
-- schema). Created BEFORE the dependent policies are recreated; the old function is dropped
-- last because the not-yet-recreated policies still depend on it.

create or replace function private.has_instructor_access(golfer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructor_links il
    where il.golfer_id = golfer
      and il.instructor_id = (select auth.uid())
      and il.status = 'approved'
  );
$$;

revoke execute on function private.has_instructor_access(uuid) from public;
grant execute on function private.has_instructor_access(uuid) to authenticated;

-- Every live policy that read has_coach_access, recreated on the new function.
-- (golfer_goals' policy died with the table in 0015.)

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()) or (select private.has_instructor_access(id)));

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_instructor_access(user_id)));

drop policy if exists swings_select on public.swings;
create policy swings_select on public.swings
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_instructor_access(user_id)));

drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_instructor_access(user_id)));

drop policy if exists golfer_profiles_select on public.golfer_profiles;
create policy golfer_profiles_select on public.golfer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_instructor_access(user_id)));

drop function private.has_coach_access(uuid);

--------------------------------------------------------------------------------------------
-- 3. The role value: 'coach' -> 'instructor'
--------------------------------------------------------------------------------------------
-- Constraint first (the update would violate the old whitelist), rows second, new
-- constraint third. The inline check from 0012 was auto-named user_roles_role_check.

alter table public.user_roles drop constraint if exists user_roles_role_check;
update public.user_roles set role = 'instructor' where role = 'coach';
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('golfer', 'instructor', 'admin'));

-- claim_role's whitelist follows. Same shape and safety notes as 0012 §8.
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

  if p_role not in ('golfer', 'instructor') then
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
-- 4. The review column
--------------------------------------------------------------------------------------------

alter table public.swings rename column coach_reviewed_at to instructor_reviewed_at;

--------------------------------------------------------------------------------------------
-- 5. Notification kinds: coach_* -> instructor_*
--------------------------------------------------------------------------------------------
-- Rows first is safe here because the CHECK is dropped before both steps. Only the kinds
-- naming the HUMAN coach rename; the instructor-side family (golfer_request, ...) and the
-- shared kinds (swing_reviewed, lesson_sent, ...) never said "coach".

alter table public.notifications drop constraint if exists notifications_kind_check;

update public.notifications set kind = 'instructor_request_approved' where kind = 'coach_request_approved';
update public.notifications set kind = 'instructor_request_declined' where kind = 'coach_request_declined';
update public.notifications set kind = 'instructor_comment'          where kind = 'coach_comment';
update public.notifications set kind = 'instructor_annotation'       where kind = 'coach_annotation';
update public.notifications set kind = 'instructor_message'          where kind = 'coach_message';
update public.notifications set kind = 'instructor_plan'             where kind = 'coach_plan';

alter table public.notifications add constraint notifications_kind_check check (kind in (
  -- golfer (§29 + D55 + D60 + D62)
  'analysis_ready','analysis_failed','instructor_request_approved','instructor_request_declined',
  'swing_reviewed','instructor_comment','instructor_annotation','instructor_message',
  'instructor_plan','subscription_event','goal_assigned','goal_achieved',
  'goal_regressed','lesson_sent','conversation_reply','review_answered',
  'achievement_earned',
  -- instructor
  'golfer_request','golfer_swing','golfer_reply','plan_progress',
  'review_requested','student_message','lesson_viewed','drill_done',
  'student_goal_achieved'));
