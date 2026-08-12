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
**See:** ARCHIVE D31, which supersedes D25's provider choice but not its reasoning.

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
**Gotchas:** `users.email` is **UNIQUE**. A development fallback identity holding a real address
breaks that person's first real sign-in with a unique violation. The development identity is
`dev@swingsage.invalid`, id `00000000-0000-4000-8000-0000000000de`, and must never hold a real one.
**See:** ARCHIVE D31, D43.

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

### Account deletion must reach everything, and the window is published rather than over-promised

**Decision:** Deletion reaches and is verifiable across: database rows (FK cascade), object
storage (source video and every derived artifact), AI conversation history, coach-visible copies
(access revoked; coach-authored annotations retained only where the coach owns them, detached from
the golfer's identity), analytics (pseudonymised, not retained against the user), and backups
(removed within a **stated, published window**).
**Scope:** Every new table or bucket declares its deletion behaviour when it is introduced.
**Gotchas:** "Deleted everywhere immediately" is not truthfully claimable while backups exist.
Tier-driven retention reuses the same machinery on a schedule rather than an event.
**Status:** Designed, not built.
**See:** ARCHIVE D15.
