import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is making this request.
 *
 * The seeded-admin fallback this file used to contain is **deleted, not disabled** — step 04's
 * own words, and the reasoning is that a fallback identity which still exists will eventually be
 * used by accident, silently reattributing one person's swings to another.
 *
 * Identity comes from `getUser()`, never from `getSession()`. `getSession()` reads the cookie and
 * believes it; `getUser()` verifies the token with the auth server. On a server that decides who
 * may see a video of someone, the difference is the whole point.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/**
 * The signed-in user's id, creating their profile row on first sign-in.
 *
 * Auth lives in the hosted Supabase project while application data currently lives in the local
 * Postgres (D7 keeps a local database for pipeline work). So the first time someone signs in,
 * their identity has to be mirrored into this database before any row can reference it.
 *
 * The `auth.users` insert targets the SHIM that migration 0003 creates locally. Against a real
 * Supabase database the row already exists and `on conflict do nothing` makes this a no-op — it
 * cannot manufacture an identity where a real auth system owns them.
 */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  await db.execute(sql`
    insert into auth.users (id, email) values (${user.id}, ${user.email ?? null})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into public.users (id, email, display_name)
    values (${user.id}, ${user.email ?? null}, ${user.email?.split("@")[0] ?? "golfer"})
    on conflict (id) do nothing
  `);

  await claimLegacyFixtures(user.id);
  return user.id;
}

/**
 * Hand the pre-auth development fixtures to the first real account that signs in.
 *
 * Before step 04 every swing was owned by a seeded "admin" row. That row is gone, but the ten
 * analysed fixtures on this machine still point at it, and without this they would be invisible
 * the moment real identity arrived — RLS would correctly hide swings belonging to a user nobody
 * can sign in as.
 *
 * Strictly a local-development migration, and it is deliberately one-shot: it only fires while an
 * `admin` row still exists, then deletes it, so the second account to sign in inherits nothing.
 * On a fresh Supabase database there is no admin row and this does nothing at all.
 */
async function claimLegacyFixtures(userId: string) {
  await db.execute(sql`
    with legacy as (
      delete from public.users where display_name = 'admin' returning id
    ), moved as (
      update public.swings set user_id = ${userId}
       where user_id in (select id from legacy) returning id
    )
    select 1
  `);
}

/**
 * For API routes, which must answer 401 rather than redirect — a fetch cannot follow a redirect
 * to a sign-in page and do anything useful with the HTML it gets back.
 */
export async function requireUserIdOrNull(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  await db.execute(sql`
    insert into auth.users (id, email) values (${user.id}, ${user.email ?? null})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into public.users (id, email, display_name)
    values (${user.id}, ${user.email ?? null}, ${user.email?.split("@")[0] ?? "golfer"})
    on conflict (id) do nothing
  `);
  return user.id;
}
