--------------------------------------------------------------------------------------------
-- Dismissing a notification
--------------------------------------------------------------------------------------------
-- 0013 closed DELETE deliberately — "clearing history is not a product feature; if it becomes
-- one it arrives as its own migration". It became one: the inbox row now carries an X, so a
-- golfer can clear an event they have dealt with instead of scrolling past it forever.
--
-- Dismissal is a LOCAL act. Deleting the row removes it from this golfer's inbox and reaches
-- back to nothing: the swing, the coach message and the goal that caused the event are all
-- their own rows in their own tables, and a notification is only ever the pointer that said
-- "this happened". That is why a hard DELETE is right here and a soft `dismissed_at` flag is
-- not — there is no history to preserve that is not already preserved somewhere it belongs.
--
-- The surface stays exactly as narrow as before otherwise: still no INSERT (emission has one
-- door, `app.notify`), still UPDATE on `read_at` alone.

drop policy if exists notifications_dismiss_self on public.notifications;
create policy notifications_dismiss_self on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- DELETE is row-level only; there is no column-grant equivalent to get wrong, and the policy
-- above is what scopes it. Another golfer's ids simply match no row and delete nothing.
grant delete on public.notifications to authenticated;
