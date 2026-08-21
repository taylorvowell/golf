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
**Cost of keeping the fallback, measured:** an unauthenticated request is *answered as the
development identity* rather than refused, so a missing credential surfaces as **404** ("no such
swing for this owner") instead of **401**. That turned a one-line client bug into a full diagnosis
cycle once already (D48). Whenever a media or swing route 404s inexplicably, check whether the
request carried a bearer token at all before checking anything else.
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

### Roles are rows, claiming coach is instant, and admin is not claimable

**Decision:** `user_roles` holds one row per (account, role) — `golfer | coach | admin` — so §3.3's
"both" is data rather than a schema change and §4.4's "addable later" is an insert. Every account
gets `golfer` from `app.ensure_profile()`, so "signed in but holds no role" is unreachable.
Claiming `coach` is **free and instant** and unlocks the workspace with an empty roster; being
**listed** in the directory is the reviewed application, and that gate belongs to
`coach-relationships`/`admin-surface`. `user_roles` has **no INSERT policy at all** — grants go
through `app.claim_role(role)`, SECURITY DEFINER, identity read from `auth.uid()` internally and
the role checked against a whitelist, so both "grant myself admin" and "grant someone else a role"
are inexpressible rather than merely rejected. Server-side enforcement is `requireRole()`
(`lib/roles.ts`), which answers 403 `role_required`; the first route behind it is
`GET /api/v1/coach/roster`.
**Gotchas:** The role gate answers "may this account use the coach surface", never "whose data may
it see" — the relationship is still enforced by RLS on `coach_links`, and conflating the two is how
a role check ends up standing in for an access-control boundary. Roles are readable only by their
holder, not by an approved coach: which roles an account holds is not part of what §24 grants.
**See:** ARCHIVE D32; `PROJECT_MAIN.md` §3, §4.4, §31.

### The profile splits public from private by TABLE, and age is a range

**Decision:** §5.1's "sensitive information is not automatically public" is expressed as shape, not
as a flag. `public.users` is the public face — display name, avatar, bio, region — and is already
readable by an approved coach; `golfer_profiles` holds the SIX answers the product asks a golfer
(2026-08-20 final shape — handedness, swing style, handicap, age, driver speed, 7-iron carry; see
mobile-client.md "The profile is six answers"; migrations 0014/0015 dropped every unasked column
rather than parking them, and `golfer_goals` was dropped with the goal questions — goals belong to
the guidance features, not the profile) and is owner-or-approved-coach read, owner-only write. A
per-column `is_public` boolean would have put the answer in application code where every future
reader has to remember to ask; two tables make putting a field in the wrong one a visible design
mistake. `handedness` moved off `users` onto the profile in migration 0012 — a golfer's handedness
is a property of the golfer — while `swings.handedness` stays NOT NULL so an old swing keeps the
answer it was analysed under.

These are §43's questions, answered: **minimum supported age is 13**, self-attested, matching the
store baseline; **age is stored as a RANGE, never a birthdate**, because age only feeds tolerance
framing and mobility expectations and a birthdate would be the most sensitive field in the schema
for no gain; **the only required answer is handedness** (§5.4), and even it is nullable in the
schema — "required" is a property of the onboarding flow, because a NOT NULL would make a
half-finished profile unstorable and therefore unresumable.
**Gotchas:** The self-reported swing style is stored separately from any measured classification
(§15.4), because §5.4 requires a disagreement to be surfaced rather than silently overridden — one
shared column would destroy the evidence at the moment it became interesting. Tier-2 equipment
specs live in `clubs` (§6) and are linked, never duplicated onto the profile.
**See:** ARCHIVE D54; `PROJECT_MAIN.md` §5, §34.1, §43.

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
