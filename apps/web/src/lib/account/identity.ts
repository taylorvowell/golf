import { createClient } from "@supabase/supabase-js";

/**
 * The one operation in this application that reaches the auth system with an elevated credential:
 * erasing the caller's own identity.
 *
 * **Why this exists at all.** §4.3 requires account deletion, and §34 requires that a golfer can
 * remove their data. Everything a golfer owns lives behind `on delete cascade` from
 * `public.users`, which `app.delete_own_account()` handles with no elevation at all. The auth
 * identity itself does not: it lives in the hosted Supabase project, it is owned by the auth
 * service, and the only supported way to remove it is the admin API. Leaving it behind would mean
 * "delete my account" quietly meant "delete my swings" — the address, the provider link and the
 * identifier would all survive at the vendor.
 *
 * **Why it is shaped like this.** `db/admin.ts` and the analyzer's service role are unreachable
 * from request handling (D26, D42) because a general-purpose privileged handle on a request path
 * voids the authorization boundary for every endpoint at once, and nothing about the code would
 * look wrong. That reasoning applies here too, so this module is built to be the opposite of
 * general-purpose:
 *
 *   * it exports exactly one function, which does exactly one thing
 *   * the admin client is constructed inside that function and never returned or cached
 *   * the id is re-asserted against the resolved caller by the only caller
 *     (`lib/account/deleteAccount.ts`), so "delete a user by id" is not an exposed capability
 *   * `src/db/service-role.test.ts` fails the suite if a second module under `src/` constructs an
 *     admin auth client, so this stays the only one by test rather than by intention
 *
 * There is no read path here and there never should be. Reading another user's data with this
 * credential is precisely the D26 defect; deleting the caller's own identity is the single
 * operation the request path cannot express any other way.
 */

/**
 * Whether an auth identity can be erased in this environment.
 *
 * False when Supabase is not configured — the local development split (D7) keeps auth hosted and
 * data local, and a fresh clone with no credentials still has to be able to run. A deletion in
 * that environment removes everything that exists locally and says so, rather than failing.
 */
export function canDeleteAuthIdentity(): boolean {
  return Boolean(supabaseUrl() && process.env.SUPABASE_SECRET_KEY);
}

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Erase one auth identity. The caller is responsible for having proved that `userId` is the
 * identity that made the request — this function cannot check, which is exactly why it has one
 * caller and a test keeping it that way.
 *
 * Throws on failure. Deletion is ordered so that this runs LAST (see `deleteAccount.ts`): a throw
 * here leaves an identity that can sign in to an empty account and try again, which is the least
 * bad of the available failure states.
 */
export async function deleteAuthIdentity(userId: string): Promise<void> {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Cannot delete the auth identity: Supabase is not configured. Check with " +
        "canDeleteAuthIdentity() before calling.",
    );
  }

  const admin = createClient(url, key, {
    // No session handling of any kind. This client authenticates as the project, exists for one
    // call, and must never pick up or persist a user session from the surrounding request.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth identity deletion failed: ${error.message}`);
}
