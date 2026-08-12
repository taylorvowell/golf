import { createClient } from "@supabase/supabase-js";
import "./cliOnly";
import { sql } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";

/**
 * The account lifecycle, proved against the running system: §4.2 multi-device sessions and §4.3
 * deletion.
 *
 * **Why this is a script and not a unit test.** Both claims are about systems this repository does
 * not own. §4.2 asks whether two sessions minted for one identity are independently valid and
 * whether ending one ends the other — a property of the auth provider, not of our code, and
 * getting it wrong is not cosmetic: §12's multi-phone synchronized capture requires two phones
 * signed into one account at once, so a global sign-out hidden inside a "sign out" button would
 * break the product's stated differentiator in a way that only appears with two devices in hand.
 * §4.3 ends in an admin-API call that erases an identity at the vendor, which nothing else in the
 * project executes — mocked, it would ship never having run.
 *
 * It needs a real project and a real server, which is why it is run deliberately rather than in CI:
 *
 *     pnpm --filter web verify:account             # against http://127.0.0.1:3000
 *     pnpm --filter web verify:account <baseUrl>
 *
 * The identity it uses is created and deleted by this script, and is never a real account. Two of
 * the things under test — a global sign-out, and account deletion — would otherwise sign a real
 * person out of their phone or delete their swings.
 */

const BASE_URL = process.argv[2] ?? "http://127.0.0.1:3000";

/**
 * Fixed, not generated. `AUTH_ALLOWED_EMAILS` gates the app boundary, so a random address would
 * come back 401 for a reason that has nothing to do with sessions — and a §4.2 failure and an
 * allowlist rejection look identical from here. A stable address can be allowlisted once.
 *
 * `.invalid` (RFC 2606) so it can never collide with, or be mistaken for, a real account.
 */
const PROBE_EMAIL = "session-probe@swingsage.invalid";
const PROBE_PASSWORD = `probe-${Math.random().toString(36).slice(2)}-Aa1!`;

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is required. Run from apps/web with a populated .env.`);
  return v;
}

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");

/** A fresh client per "device" — separate storage, separate session, exactly like two phones. */
function device() {
  return createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const admin = createClient(SUPABASE_URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * The client version this script claims to be, read from the server rather than invented.
 *
 * A made-up version below the floor gets a 426 on every call, and a 426 looks exactly like a
 * session failure from here — which is the same "the 401 was about something else" trap the
 * allowlist check above exists for.
 */
let clientVersion = "0.0.0";

async function readClientVersion(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/client`);
  if (!res.ok) throw new Error(`${BASE_URL} is not serving /api/v1/client (${res.status}). Is \`pnpm dev\` running?`);
  const body = (await res.json()) as { currentVersion: string };
  clientVersion = body.currentVersion;
}

/** Does this token still get served? The real question, asked of the real API. */
async function apiStatus(token: string): Promise<number> {
  return (await call("swings", token, "GET")).status;
}

async function call(path: string, token: string, method: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-swingsage-client-version": clientVersion },
  });
}

/** Does this identity still exist in the auth system? Asked of the auth system, not of our code. */
async function identityExists(userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  return !error && Boolean(data?.user);
}

const results: { check: string; pass: boolean; detail: string }[] = [];
function record(check: string, pass: boolean, detail: string) {
  results.push({ check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
}

/**
 * Anything a previous run left behind, on BOTH sides of the development split.
 *
 * The auth identity is hosted and the profile row is local (D7), and no cascade crosses that gap:
 * an `admin.deleteUser` erases the identity and leaves the mirror. The next run then mints a new
 * id under the same address and `app.ensure_profile()` hits the UNIQUE constraint on
 * `users.email` — every API call answers 500 and reads as a broken session.
 *
 * This is the same collision D43 found in the development identity, arriving from the other
 * direction, and it is worth being precise about what it does and does not say: the PRODUCT path
 * is unaffected, because `deleteAccount()` deletes the profile row first and the identity last.
 * Only a raw admin delete — which is what a crashed run leaves — can orphan a mirror.
 */
async function removeStaleProbe(): Promise<void> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (u.email === PROBE_EMAIL) await admin.auth.admin.deleteUser(u.id);
  }
  await withOwner("clean up a probe identity this script owns end to end", (tx) =>
    tx.execute(sql`delete from public.users where email = ${PROBE_EMAIL}`),
  );
}

async function main() {
  console.log(`Account lifecycle (§4.2 sessions, §4.3 deletion), against ${BASE_URL}\n`);

  const allowlist = process.env.AUTH_ALLOWED_EMAILS?.trim();
  if (allowlist && !allowlist.toLowerCase().includes(PROBE_EMAIL)) {
    throw new Error(
      `AUTH_ALLOWED_EMAILS is set and does not include ${PROBE_EMAIL}. Every API check below ` +
        `would return 401 for allowlist reasons and read as a session failure. Add it:\n` +
        `  AUTH_ALLOWED_EMAILS=${allowlist},${PROBE_EMAIL}`,
    );
  }

  await readClientVersion();
  await removeStaleProbe();

  // A password identity, because it is the only provider that can mint a session from a script
  // without a browser or a device. What is under test is the SESSION model, which is the same
  // whatever signed the user in — Google's `signInWithIdToken` produces the same session rows.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: PROBE_EMAIL,
    password: PROBE_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`could not create probe identity: ${createErr?.message}`);
  const userId = created.user.id;
  console.log(`probe identity ${userId} (${PROBE_EMAIL})\n`);

  try {
    const phoneA = device();
    const phoneB = device();

    const signIn = async (c: ReturnType<typeof device>, label: string) => {
      const { data, error } = await c.auth.signInWithPassword({
        email: PROBE_EMAIL,
        password: PROBE_PASSWORD,
      });
      if (error || !data.session) throw new Error(`${label} could not sign in: ${error?.message}`);
      return data.session;
    };

    const a = await signIn(phoneA, "phone A");
    const b = await signIn(phoneB, "phone B");

    record(
      "signing in on a second device does not invalidate the first",
      a.access_token !== b.access_token,
      "two distinct sessions for one identity",
    );

    const [statusA, statusB] = await Promise.all([apiStatus(a.access_token), apiStatus(b.access_token)]);
    record(
      "both devices are served concurrently",
      statusA === 200 && statusB === 200,
      `phone A ${statusA}, phone B ${statusB}`,
    );

    // The product's sign-out. `scope: 'local'` is a §4.2 requirement, not a default.
    await phoneA.auth.signOut({ scope: "local" });
    const afterLocalB = await apiStatus(b.access_token);
    record(
      "a local sign-out on one device leaves the other signed in",
      afterLocalB === 200,
      `phone B ${afterLocalB} after phone A signed out`,
    );

    // The failure mode this whole file exists to catch, demonstrated rather than asserted: a
    // global sign-out DOES end the other device's session. If the app ever calls it, §12 breaks.
    await phoneB.auth.signOut({ scope: "global" });
    // Access tokens stay cryptographically valid until they expire, so the observable difference
    // is the refresh: a globally revoked session cannot get a new one, a local one still can.
    const { error: refreshErr } = await phoneB.auth.refreshSession({ refresh_token: b.refresh_token });
    record(
      "a global sign-out is what would break multi-device, and is not what the app calls",
      Boolean(refreshErr),
      refreshErr ? `refresh refused: ${refreshErr.message}` : "refresh SUCCEEDED — scope had no effect",
    );

    // ---- §4.3, and the script's own teardown is what is under test -------------------------
    //
    // The database cascade is covered by `accountDeletion.test.ts`. What is NOT coverable by a
    // unit test is the half this script is uniquely placed to exercise: the route, the media
    // sweep, and the admin-API call that erases the identity at the vendor. Nothing else in the
    // project runs that call, so without this it ships unexecuted.
    const phoneC = device();
    const c = await signIn(phoneC, "phone C");
    const deleteRes = await call("account", c.access_token, "DELETE");
    const body: unknown = await deleteRes.json().catch(() => null);
    record(
      "DELETE /api/v1/account succeeds for the signed-in account",
      deleteRes.status === 200,
      `${deleteRes.status} ${JSON.stringify(body)}`,
    );

    record(
      "the auth identity is gone from the auth system",
      !(await identityExists(userId)),
      "getUserById finds nothing",
    );

    // The token was minted before the deletion and stays cryptographically valid until it
    // expires, so this is the question that matters: does the SERVER still serve it? It must not
    // — `getUser()` verifies against the auth server, which no longer knows this identity.
    const afterDelete = await apiStatus(c.access_token);
    record(
      "a token for a deleted account is no longer served",
      afterDelete === 401,
      `/api/v1/swings answered ${afterDelete}`,
    );
  } finally {
    // Cleanup only if a check failed before deletion ran. On the happy path this is already gone.
    if (await identityExists(userId)) {
      await admin.auth.admin.deleteUser(userId);
      console.log(`\nprobe identity ${userId} cleaned up`);
    }
    // Both sides, always: the local mirror survives a hosted delete (see removeStaleProbe).
    await withOwner("remove the probe's profile row on the local side of the split", (tx) =>
      tx.execute(sql`delete from public.users where email = ${PROBE_EMAIL}`),
    );
    await endOwnerPool();
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks FAILED`);
    process.exit(1);
  }
  console.log(`\nall ${results.length} checks passed`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
