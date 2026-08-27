import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withUser } from "@/db/session";
import { DEV_USER_ID, DEV_USER_STORED_EMAIL } from "@/lib/devIdentity";
import { isUuid, isViewType, type ResolvedView } from "@/db/views";
import type { ViewType } from "@/db/schema";
import type { ViewAddress } from "@/lib/media/keys";
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

/**
 * The users.id the fallback stands in for, when that person's row already exists.
 *
 * Without this the fallback resolves to the synthetic `dev@swingsage.invalid` row, which owns
 * nothing — so a desktop browser (no bearer) sees an empty swing log while the same person's
 * phone (bearer) sees their real swings. Setting `DEV_USER_DB_ID` to the real row's id makes the
 * browser BE that person. Safe with `app.ensure_profile`: it is insert-only (`on conflict do
 * nothing`), so resolving an existing id never rewrites the row. A wrong id fails empty, not
 * loud — RLS simply returns nothing.
 */
const DEV_USER_DB_ID = process.env.DEV_USER_DB_ID?.trim();

if (DEV_USER_EMAIL && process.env.NODE_ENV === "production") {
  throw new Error(
    "DEV_USER_EMAIL is set in a production build. It bypasses authentication entirely and every " +
      "request would resolve to the same identity. Refusing to start.",
  );
}

export async function getCurrentUser() {
  const bearer = await bearerToken();

  // **A presented identity always beats the fallback.** Without this the development identity
  // would answer the phone's requests too, and every native sign-in test would pass whatever the
  // token said — the app would look authenticated while nothing about the token had been checked.
  // That is not a hypothetical: it is the shape of D26, where a security path passed its own tests
  // because the thing under test was never on the path.
  if (DEV_USER_EMAIL && !bearer) {
    console.warn(`[auth] DEV_USER_EMAIL active — this request is ${DEV_USER_EMAIL}`);
    if (DEV_USER_DB_ID && isUuid(DEV_USER_DB_ID)) {
      return { id: DEV_USER_DB_ID, email: DEV_USER_EMAIL } as { id: string; email: string };
    }
    return { id: DEV_USER_ID, email: DEV_USER_STORED_EMAIL } as { id: string; email: string };
  }

  const supabase = await createClient();
  // A native client has no cookie jar, so its session arrives as a bearer token. `getUser(jwt)`
  // takes that token instead of the cookie the client was built with — the verification path is
  // otherwise identical, which is the point: one identity resolution, two transports.
  const { data, error } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowed(data.user)) return null;
  return data.user;
}

/**
 * The access token a native client sends, or null for a browser.
 *
 * Only `Authorization: Bearer` is honoured — never a query parameter and never a custom header.
 * A token in a URL ends up in server logs, browser history and `Referer`, and this one grants
 * access to a person's video of themselves.
 *
 * The header is read even when a cookie session also exists, and it wins. Anything else would
 * mean a request that explicitly presents an identity could be served as somebody else's.
 */
async function bearerToken(): Promise<string | null> {
  return parseBearer((await headers()).get("authorization"));
}

/**
 * `Authorization: Bearer <jwt>` → the jwt, and anything else → null.
 *
 * Split out from the header read so it is testable without a request. The failure that matters is
 * a *near* match — `Bearer` with no token, a `Basic` credential, a stray newline — returning some
 * truthy string that is then handed to the auth server as if it were a session.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
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
 *
 * Exported for its own tests: the failure that matters is a list that admits somebody it should
 * not, and that is not observable through a route without standing up a session first.
 */
export function isAllowed(identity: { email?: string; phone?: string }): boolean {
  const emails = process.env.AUTH_ALLOWED_EMAILS?.trim();
  // No list at all means no restriction — the right default for a deployed product.
  if (!emails) return true;

  if (identity.email) {
    return emails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .includes(identity.email.toLowerCase());
  }

  // A phone identity carries no address, so the email list can neither admit nor describe it.
  // It gets its own list and **fails closed**: while `AUTH_ALLOWED_EMAILS` is set this app is
  // reachable over the LAN with open sign-up, and treating "no phone list" as "all phones welcome"
  // would mean turning on phone OTP silently unlocked the boundary for anyone who can receive an
  // SMS. Compared on digits alone — GoTrue stores the number without its `+`, and a list written
  // by hand will have one.
  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, "");
    return (process.env.AUTH_ALLOWED_PHONES ?? "")
      .split(",")
      .map((p) => p.replace(/\D/g, ""))
      .filter(Boolean)
      .includes(digits);
  }

  return false;
}

/**
 * Mirror a signed-in identity into this database, once, on first sign-in.
 *
 * Auth lives in the hosted Supabase project while application data currently lives in the local
 * Postgres (D7 keeps a local database for pipeline work), so an identity has to exist here before
 * any row can reference it. That insert is the one write a request cannot make as `authenticated`:
 * `users` has no INSERT policy and the local `auth.users` shim is not writable by a request role.
 *
 * The obvious fix — an elevated connection used "just for this" — is exactly what D26 forbids, so
 * it goes through `app.ensure_profile()` (migration 0008) instead: a SECURITY DEFINER function
 * that takes the email as data and reads the identity from `auth.uid()` internally. Creating
 * someone else's profile is not expressible.
 */
async function ensureProfile(userId: string, email: string | null): Promise<void> {
  await withUser(userId, (tx) => tx.execute(sql`select app.ensure_profile(${email})`));
}

/**
 * The signed-in user's id, creating their profile row on first sign-in.
 */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  await ensureProfile(user.id, user.email ?? null);
  return user.id;
}

/**
 * For API routes, which must answer 401 rather than redirect — a fetch cannot follow a redirect
 * to a sign-in page and do anything useful with the HTML it gets back.
 */
export async function requireUserIdOrNull(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  await ensureProfile(user.id, user.email ?? null);
  return user.id;
}


/**
 * Identity AND authorization for one swing, resolved down to the VIEW being asked for.
 *
 * "Is this caller signed in" is not enough for a swing-scoped route: it would let any account
 * fetch any swing by id, which for the video route means watching a stranger's footage of
 * themselves. So this answers the real question — may THIS user see THIS swing — using the same
 * rule as the `swings_select` policy: the owner, or an instructor whose link is approved.
 *
 * It resolves the view in the same round trip rather than in a second query, because the video
 * route runs this once per HTTP Range request and scrubbing issues a great many of them.
 *
 * Since D42 this query runs inside `withUser`, so the `swings_select` and `swing_views_select`
 * policies filter it before the `where` clause is ever reached — the database is the boundary D7
 * says it is. The ownership predicate below is kept anyway, as **defence in depth** and because it
 * is what distinguishes 404 from found; it is no longer the only thing standing between one
 * golfer and another's video, which is what D26 recorded it as.
 */
export async function requireViewAccess(
  swingId: string,
  viewType?: string | null,
): Promise<ViewAccess | { error: Response }> {
  const userId = await requireUserIdOrNull();
  if (!userId) return { error: new Response("unauthorized", { status: 401 }) };

  const notFound = { error: new Response("not found", { status: 404 }) };
  // A uuid column will not compare against `/swing/perfect` — a bookmark from before migration
  // 0006 — so an unparseable id is answered here rather than raising a cast error as a 500.
  if (!isUuid(swingId)) return notFound;
  const wanted = viewType && isViewType(viewType) ? viewType : null;
  // A view type that is not one of the two is a malformed request, not "give me the default":
  // silently serving down-the-line for `?view=overhead` would look like the parameter worked.
  if (viewType && !wanted) return { error: new Response("unknown view", { status: 400 }) };

  const rows = await withUser(userId, (tx) => tx.execute<{
    view_id: string; view: ViewType; media_key: string;
    owner_id: string; artifact_revision: number;
  }>(sql`
    select v.id as view_id, v.view, v.media_key,
           s.user_id as owner_id, v.artifact_revision
      from public.swings s
      join public.swing_views v on v.swing_id = s.id
     where s.id = ${swingId}
       and (${wanted}::text is null or v.view = ${wanted})
       and (
         s.user_id = ${userId}
         or exists (
           select 1 from public.instructor_links il
            where il.golfer_id = s.user_id
              and il.instructor_id = ${userId}
              and il.status = 'approved'
         )
       )
     order by v.is_primary desc, v.created_at asc
     limit 1
  `));

  // 404, not 403. Telling an unauthorized caller that a swing exists is itself a disclosure —
  // it confirms an id is real and that someone owns it. The same answer covers "no such view",
  // which keeps the two indistinguishable from outside.
  const row = rows[0];
  if (!row) return notFound;
  return {
    userId,
    ownerId: row.owner_id,
    swingId,
    viewId: row.view_id,
    view: row.view,
    mediaKey: row.media_key,
    revision: row.artifact_revision,
    // Built from the OWNER's id, never the caller's. An approved instructor reading a golfer's swing
    // is the case that makes this load-bearing: keying the prefix off `userId` would send them to
    // their own empty namespace and 404 a swing they are entitled to see.
    address: {
      userId: row.owner_id,
      swingId,
      viewId: row.view_id,
      revision: row.artifact_revision,
    },
  };
}

/**
 * The same view as a `ResolvedView`, keyed to the OWNER.
 *
 * `ViewAccess.userId` is whoever is asking; `ResolvedView.userId` is whose namespace the media
 * lives in, and for an approved instructor those are different people. Anything that derives a storage
 * address (`mediaAddress`) must use the owner or it looks in an empty namespace and 404s a swing
 * the caller is entitled to see — the same reasoning that produced `ViewAccess.address`.
 */
export function ownedView(access: ViewAccess): ResolvedView {
  return {
    swingId: access.swingId,
    userId: access.ownerId,
    viewId: access.viewId,
    view: access.view,
    mediaKey: access.mediaKey,
    revision: access.revision,
  };
}

export interface ViewAccess {
  /** Who is asking. May be the owner, or an approved instructor. */
  userId: string;
  /** Who owns the swing — whose namespace the media lives in. */
  ownerId: string;
  swingId: string;
  viewId: string;
  view: ViewType;
  /** The analyzer's working-directory name, not an address (D33). */
  mediaKey: string;
  revision: number;
  /** Where this view's artifacts live. Pass to `lib/media` — never build a key by hand. */
  address: ViewAddress;
}

/** `?view=dtl|face_on` off a request URL, or null when the caller did not ask for one. */
export function viewParam(req: Request): string | null {
  return new URL(req.url).searchParams.get("view");
}
