# Auth & Identity

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Sign-in is phone OTP, Google and Apple — and only those three

**Decision:** The target sign-in surface is **phone OTP + Google + Sign in with Apple**. There is
no password, and no magic link. Email OTP was the earlier choice and is now a **temporary
transition path**, deleted — not disabled — once Google *and* phone are both live on Android.
**Sequence:** Google (free, native) → phone (built against a local Supabase stack's test OTP) →
Apple (needs $99 + Apple hardware) → real SMS delivery (needs A2P 10DLC).
**Gotchas:** A hosted Supabase project has no test-number setting, so the free phone path requires
a local `supabase start` stack. There is no `supabase/` directory in the repo yet.
**Status:** Google is live on Android. **Phone OTP is HELD** (D46) — no SMS provider is set up, and
the build is on core functionality instead. Three things stay in place because of that hold and
must not be deleted until phone lands: **email OTP**, the **`DEV_USER_EMAIL`** identity, and the
absence of **identity linking** (which needs a second provider to link to).
**See:** ARCHIVE D31, which supersedes D25's provider choice but not its reasoning; D46 for the hold.

### Google sign-in is native, and the server takes the session as a bearer token

**Decision:** `signInWithIdToken` against `@react-native-google-signin/google-signin` — never
`signInWithOAuth`. No browser, no app-switch. The session persists in `AsyncStorage` with
`processLock` and foreground-only auto-refresh. `lib/auth.ts` reads `Authorization: Bearer` and
passes the token to `getUser(jwt)`; a cookie request is unchanged.
**Gotchas:** Google mints the ID token with `aud` = **web** client and `azp` = Android client.
Passing the *Android* id to `GoogleSignin.configure` yields a token Supabase rejects, and Google
returns a valid-looking user with `idToken: null` rather than failing. `lock: processLock` is
mandatory — React Native has no `navigator.locks`, so two screens refreshing an expiring token
both spend the same single-use refresh token and the loser is signed out.
**Status:** Live and verified on the S25+. Client ids, the bound package and the SHA-1 are in
[`../ENVIRONMENT.md`](../ENVIRONMENT.md) — read that before touching a provider dashboard.
**See:** ARCHIVE D43.

### Every account carries an email address, whatever it signed in with

**Decision:** Email is a recovery and delivery attribute on every account regardless of provider.
A phone-only account is lost permanently when the golfer changes carrier.
**Gotchas:** `users.email` is **UNIQUE** *and* `NOT NULL`. A development fallback identity holding
a real address breaks that person's first real sign-in with a unique violation. The development
identity is `dev@swingsage.invalid`, id `00000000-0000-4000-8000-0000000000de`, and must never hold
a real one.
**Status:** Enforced by the schema. `app.ensure_profile()` raises `SS_EMAIL_REQUIRED` for an
identity that arrives without an address — match the code, never the prose. Phone OTP is the
provider that produces that case, and the constraint landed before it deliberately.
**See:** ARCHIVE D31, D43, D45.

### One identity for everyone; a coach is a golfer who also coaches

**Decision:** Authentication is **one system with one identity**. There is no coach sign-in, no
separate coach account, and no role question on the sign-in screen. What differs for a coach is
onboarding and directory listing — never authentication.
**See:** ARCHIVE D32.

### Identity linking is explicit, never inferred from the email address

**Decision:** One person signing in with Google and later with Apple must land on **one** account,
and that link is made explicitly.
**Gotchas:** Apple's Hide My Email relay defeats match-by-email, so linking can never be inferred
from the address. Not yet built — it needs a second provider to link to.
**See:** ARCHIVE D31.

### The same account stays signed in on several devices at once

**Decision:** Signing in on a second device does not invalidate the first. Both the mobile and web
paths sign out with `scope: "local"` precisely for this.
**Scope:** Not a nice-to-have — it is the prerequisite for multi-phone synchronized recording.
**Gotchas:** `scope: "global"` revokes every session on the account. It is one call away from the
one the app makes, and calling it would break §12 in a way that only appears with two devices in
hand — which is why the verification below demonstrates that failure rather than merely asserting
the correct behaviour.
**Status:** Verified against the running system — `pnpm --filter web verify:account` signs one
account in twice, serves both concurrently, and shows a local sign-out leaving the other alive.
**See:** ARCHIVE D45.

### Account deletion must reach everything, and the window is published rather than over-promised

**Decision:** Deletion reaches and is verifiable across: database rows (FK cascade), object
storage (source video and every derived artifact), AI conversation history, coach-visible copies
(access revoked; coach-authored annotations retained only where the coach owns them, detached from
the golfer's identity), analytics (pseudonymised, not retained against the user), and backups
(removed within a **stated, published window**).
**Scope:** Every new table or bucket declares its deletion behaviour when it is introduced.
**Gotchas:** "Deleted everywhere immediately" is not truthfully claimable while backups exist.
Tier-driven retention reuses the same machinery on a schedule rather than an event.
**Status:** Media, database rows and the sign-in identity are **built and verified end to end**
(`DELETE /api/v1/account`). AI history, coach-visible copies, analytics and backups are still
designed-only and belong to `production-readiness`.
**See:** ARCHIVE D15, D45.

### Deletion runs media → rows → identity, and that order is the recoverability guarantee

**Decision:** `DELETE /api/v1/account` sweeps object storage first, then runs
`app.delete_own_account()` (SECURITY DEFINER, no argument, identity from `auth.uid()`), then
erases the auth identity through the admin API. No id appears in the path or the body — the only
account the route can delete is the one that authenticated the request.
**Scope:** `lib/account/identity.ts` is the **only** module allowed to touch `auth.admin`, and a
route may not import it directly; both are enforced by `src/db/service-role.test.ts`.
**Gotchas:** Reversing media and rows orphans bytes nothing can enumerate. Deleting the identity
first strands the data with no owner. Deleting a hosted auth identity does **not** remove its local
`public.users` mirror — the next sign-in under that address then 500s on the UNIQUE email.
**See:** ARCHIVE D45.
