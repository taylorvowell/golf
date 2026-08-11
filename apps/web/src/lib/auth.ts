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
/**
 * Development identity, so the product can be built and used before sign-in is finished.
 *
 * Step 04 warns — correctly — that "a fallback identity that still exists will be used by
 * accident". This is that fallback, so it is built to be impossible to use by accident:
 *
 *   * it requires `DEV_USER_EMAIL` to be set explicitly; there is no default
 *   * it **throws at module load** if that variable is present in a production build, so a
 *     mis-set environment fails loudly at boot rather than silently authenticating everyone as
 *     one person
 *   * it warns on every resolution, so it cannot run unnoticed in a long-lived dev server
 *
 * Deleted, not disabled, once step 04 completes.
 */
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL?.trim();
/** Fixed so the dev golfer keeps their swings across restarts. Obviously a dev artifact on sight. */
const DEV_USER_ID = "00000000-0000-4000-8000-0000000000de";

if (DEV_USER_EMAIL && process.env.NODE_ENV === "production") {
  throw new Error(
    "DEV_USER_EMAIL is set in a production build. It bypasses authentication entirely and every " +
      "request would resolve to the same identity. Refusing to start.",
  );
}

export async function getCurrentUser() {
  if (DEV_USER_EMAIL) {
    console.warn(`[auth] DEV_USER_EMAIL active — every request is ${DEV_USER_EMAIL}`);
    return { id: DEV_USER_ID, email: DEV_USER_EMAIL } as { id: string; email: string };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowed(data.user.email)) return null;
  return data.user;
}

/**
 * Registration allowlist, enforced at the APP boundary rather than at signup.
 *
 * Sign-up is open by construction: the Supabase project is on the public internet and the
 * publishable key ships in the client bundle, so anyone who has both can create an account. That
 * is fine — creating an account is not the same as being allowed into this application.
 *
 * `AUTH_ALLOWED_EMAILS` unset means no restriction, which is the right default for a deployed
 * product. Set it while the app holds only development fixtures and is reachable over the LAN.
 *
 * Deliberately not a client-side check: those are a suggestion. This runs on every identity
 * resolution, so a stranger with a valid Supabase session still resolves to "nobody" here.
 */
function isAllowed(email: string | undefined): boolean {
  const raw = process.env.AUTH_ALLOWED_EMAILS?.trim();
  if (!raw) return true;
  if (!email) return false;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
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
  // Gated behind an explicit opt-in. Handing every fixture to whoever signs in first is a
  // privilege grant, and the runbook tells you to browse this dev server from your phone over
  // the LAN — so "first" is not necessarily you. Off unless deliberately turned on.
  if (process.env.CLAIM_LEGACY_FIXTURES !== "true") return;

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


/**
 * Identity AND authorization for one swing.
 *
 * "Is this caller signed in" is not enough for a swing-scoped route: it would let any account
 * fetch any swing by id, which for the video route means watching a stranger's footage of
 * themselves. So this answers the real question — may THIS user see THIS swing — using the same
 * rule as the `swings_select` policy: the owner, or a coach whose link is approved.
 *
 * The rule is duplicated here rather than delegated to RLS, and that is a **temporary** state
 * that must not be mistaken for the design. The app currently connects to Postgres as a
 * superuser, and superusers bypass RLS entirely — `FORCE ROW LEVEL SECURITY` does not apply to
 * them — so the policies in migration 0003 are inert in the running application. Until the app
 * connects as a non-superuser and sets the request context per transaction, this function is the
 * only thing actually enforcing the boundary. See docs/DECISIONS.md D26.
 */
export async function requireSwingAccess(
  swingId: string,
): Promise<{ userId: string } | { error: Response }> {
  const userId = await requireUserIdOrNull();
  if (!userId) return { error: new Response("unauthorized", { status: 401 }) };

  const rows = await db.execute(sql`
    select 1 from public.swings s
     where s.id = ${swingId}
       and (
         s.user_id = ${userId}
         or exists (
           select 1 from public.coach_links cl
            where cl.golfer_id = s.user_id
              and cl.coach_id = ${userId}
              and cl.status = 'approved'
         )
       )
     limit 1
  `);

  // 404, not 403. Telling an unauthorized caller that a swing exists is itself a disclosure —
  // it confirms an id is real and that someone owns it.
  if (rows.length === 0) return { error: new Response("not found", { status: 404 }) };
  return { userId };
}
