-- §29's notification backbone — the inbox rows every delivery channel fans out FROM.
--
-- One table is the source of truth; push (track step 05) and email are projections of it, so
-- "did the user ever get told" always has one place to look. Two properties are load-bearing:
--
--   1. **Emission crosses users.** A coach action notifies a golfer, so an INSERT policy on
--      `authenticated` cannot express emission (`with check user_id = auth.uid()` forbids
--      exactly the useful case, and its absence would let any account spam any inbox). Emission
--      is therefore a SECURITY DEFINER function, `app.notify()` — the 0012 `ensure_profile`
--      pattern — and the table has NO insert policy at all. This stays safe only while the
--      `app` schema is NOT in PostgREST's exposed list: server code reaches it through
--      `withUser`, clients cannot reach it at all.
--   2. **Grouping is a data-model property** (§29 "without becoming noisy", D60's collapsing
--      conversation messages). Rows sharing an OPEN (unread) `group_key` fold into one row
--      whose `count` grows, enforced by a partial unique index + upsert, not by delivery-time
--      bookkeeping. Reading the group closes it; the next event opens a fresh row.
--
-- The kind list mirrors packages/schema/schemas/api.schema.json#/definitions/notification —
-- growing it is an additive migration + additive schema change, always together.
--
-- Hand-written, like every migration since 0003.

--------------------------------------------------------------------------------------------
-- 1. The table
--------------------------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  kind       text        not null check (kind in (
                 -- golfer (§29 + D55 + D60 + D62)
                 'analysis_ready','coach_request_approved','coach_request_declined',
                 'swing_reviewed','coach_comment','coach_annotation','coach_message',
                 'coach_plan','subscription_event','goal_assigned','goal_achieved',
                 'goal_regressed','lesson_sent','conversation_reply','review_answered',
                 'achievement_earned',
                 -- coach
                 'golfer_request','golfer_swing','golfer_reply','plan_progress',
                 'review_requested','student_message','lesson_viewed','drill_done',
                 'student_goal_achieved')),
  title      text        not null,
  body       text,
  -- The deep-link payload (swingId / goalId / conversationId …). Open jsonb on purpose: each
  -- kind's emitter and screen agree on its shape, and a new key must never be a migration.
  data       jsonb       not null default '{}'::jsonb,
  -- Rows sharing this key collapse while unread. Null = this event never groups.
  group_key  text,
  -- How many events this row stands for. 1 unless grouped.
  count      integer     not null default 1 check (count >= 1),
  -- On a grouped row this is the LATEST folded event's time — the inbox surfaces it at its
  -- newest member, the same way a messaging thread sorts.
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

--------------------------------------------------------------------------------------------
-- 2. Indexes
--------------------------------------------------------------------------------------------
-- The inbox list. Also carries the RLS predicate column, per the RLS-performance rule.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- The bell's unread count — partial, so a year of read history costs the count nothing.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- The collapse rule itself: at most one OPEN row per (user, group). `app.notify`'s upsert
-- targets this index; reading the row closes it and frees the slot.
create unique index if not exists notifications_open_group_uq
  on public.notifications (user_id, group_key)
  where read_at is null and group_key is not null;

--------------------------------------------------------------------------------------------
-- 3. app.notify — the ONLY way a notification is minted
--------------------------------------------------------------------------------------------
-- SECURITY DEFINER because emission crosses users (see header). The caller must still be an
-- authenticated identity — an anonymous transaction cannot mint anything. Cross-user targeting
-- is deliberately allowed HERE and constrained at the call sites: only server code inside
-- `withUser` can reach this function (the `app` schema is not exposed to PostgREST), and every
-- emitter names the §29 event it implements. Returns the row id (the folded row's id when the
-- event grouped).
create or replace function app.notify(
  p_user_id   uuid,
  p_kind      text,
  p_title     text,
  p_body      text  default null,
  p_data      jsonb default '{}'::jsonb,
  p_group_key text  default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'notify: no authenticated identity in this transaction';
  end if;
  if p_user_id is null then
    raise exception 'notify: target user required';
  end if;

  insert into public.notifications (user_id, kind, title, body, data, group_key)
  values (p_user_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_group_key)
  on conflict (user_id, group_key) where read_at is null and group_key is not null
  do update set
    count      = public.notifications.count + 1,
    title      = excluded.title,
    body       = excluded.body,
    data       = excluded.data,
    created_at = pg_catalog.now()
  returning id into nid;

  return nid;
end;
$$;

revoke execute on function app.notify(uuid, text, text, text, jsonb, text) from public, anon;
grant  execute on function app.notify(uuid, text, text, text, jsonb, text) to authenticated, service_role;

--------------------------------------------------------------------------------------------
-- 4. RLS
--------------------------------------------------------------------------------------------
-- FORCE as well as ENABLE, per 0003: without FORCE the table owner is exempt and a missing
-- policy stays hidden behind "it worked when I ran it as postgres".
alter table public.notifications enable row level security;
alter table public.notifications force  row level security;

-- The inbox is PERSONAL: owner only, no `has_coach_access` — §24's grant is a golfer's swing
-- data, not their notification stream, and a coach gets their own rows for coach events.
drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

-- The only client write is the ack (read_at), enforced twice: this row policy, and the
-- column-level grant below that makes any other column unassignable. No INSERT policy
-- (emission is app.notify only) and no DELETE policy (clearing history is not a product
-- feature; if it becomes one it arrives as its own migration).
drop policy if exists notifications_ack_self on public.notifications;
create policy notifications_ack_self on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

--------------------------------------------------------------------------------------------
-- 5. Grants
--------------------------------------------------------------------------------------------
-- 0008's default privileges hand `authenticated` full INSERT/UPDATE/DELETE on every new table
-- so a later migration is never silently unreadable — which on THIS table would let the ack
-- policy's row match rewrite any column (retitling history) and is exactly what
-- `notificationsRls.test.ts` caught on first run. Revoke down to the real surface: read
-- everything, write `read_at`, nothing else. INSERT stays revoked because emission has one
-- door (`app.notify`); DELETE stays revoked because clearing history is not a feature yet.
revoke insert, update, delete on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
