# Auth & Identity

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Sign-in is Google, phone OTP and email OTP; Apple joins when iOS ships

**Decision:** The sign-in roster is **Google + phone OTP + email OTP** on both surfaces — mobile
offers all three (Apple added once there is Apple hardware; the App Store mandates it alongside
Google anyway), the web offers all three with Google as a PKCE redirect through `/auth/callback`.
There is no password and **no magic link**: every email flow delivers a six-digit `{{ .Token }}`
code, never a link, because a link forces an app-switch and lands the session in whichever browser
the mail client picks. **Email OTP is permanent, not a transition path** — it is the only free
channel (every SMS is a Twilio charge), the natural identifier at a desk, and one of the two
identifiers that keep one golfer one account across surfaces. An account may hold both an email
and a phone; either signs into the same account.
**SMS goes through Twilio Verify, never Programmable SMS.** Verify is Twilio's managed OTP service:
verification-only traffic is exempt from US A2P 10DLC brand/campaign registration, and Fraud Guard
covers SMS pumping, which is the standard way an open OTP endpoint becomes a large bill. The costs
are ~$0.058 per verification against ~$0.008 for a raw SMS — noise until roughly 100k
verifications/yr — and Twilio owns the message copy and code length, so Supabase has no template to
configure. Do not "save money" by moving to Programmable SMS; that re-opens the registration gate.
**Testing costs nothing.** A hosted project's Auth → Providers → Phone → **Test OTP** maps a fixed
number to a fixed code and short-circuits both the send and the verify, so the whole flow is
exercisable without an SMS or a charge. This supersedes D31's belief that a free phone path needed
a local `supabase start` stack — it does not, and there is still no `supabase/` directory.
**Status:** Google (native) and phone are live on Android; email OTP ships on both surfaces —
mobile `features/auth/email.ts` + `EmailSignInScreen`, web `/signin` (email or phone tab, Google
button). The **production** auth project is not yet configured, and the `golf-swing` email
templates still send the default link until the auth-config HANDOFF row is done. The
**`DEV_USER_EMAIL`** identity stays until step 04 completes.
**Cost of keeping the fallback, measured:** an unauthenticated request is *answered as the
development identity* rather than refused, so a missing credential surfaces as **404** ("no such
swing for this owner") instead of **401**. That turned a one-line client bug into a full diagnosis
cycle once already (D48). Whenever a media or swing route 404s inexplicably, check whether the
request carried a bearer token at all before checking anything else.
**See:** ARCHIVE D31, which supersedes D25's provider choice but not its reasoning; D46 for the hold.

### The app boundary allowlist has two lists, and the phone one fails closed

**Decision:** `AUTH_ALLOWED_EMAILS` gates entry to the application at identity resolution
(`lib/auth.ts`), not at signup — sign-up is open by construction, because the Supabase project is
on the public internet and the publishable key ships in the client bundle. Phone OTP introduced an
identity carrying **no address at all**, which the email list can neither admit nor describe, so
phone numbers get their own list: `AUTH_ALLOWED_PHONES`, compared on digits alone because GoTrue
stores the number without its `+` and a hand-written list will have one.
**It fails closed.** While `AUTH_ALLOWED_EMAILS` is set, an unlisted phone identity resolves to
"nobody". The tempting reading — no phone list means no phone restriction — would have meant that
turning phone sign-in on silently opened a LAN-reachable app to anyone able to receive an SMS.
**Consequence:** phone sign-in does nothing until a number is in `apps/web/.env`. That is the
intended shape, and `isAllowed` is exported and directly tested because a list that admits the
wrong person is not observable through a route.

### Phone sign-in has a session but not yet an account

**Decision:** A phone-only identity is signed in as far as Supabase is concerned and still has no
row in `public.users`, because `users.email` is `NOT NULL` — an address is a recovery and delivery
attribute rather than a property of the email provider, and a phone-only account is lost the day
its owner changes carrier (migration 0009). `app.ensure_profile()` raises `SS_EMAIL_REQUIRED` for
such an identity, which is a **prompt for onboarding, not a failure**.
**Status: the prompt exists — onboarding's first question.** A phone-only account's onboarding
opens with a required add-your-email step (`AttachEmailStep`): `supabase.auth.updateUser({ email })`
then `verifyOtp(type: "email_change")` — pure auth calls, **no API route involved**, which is what
sidesteps the `requireUserId`-raises problem entirely. The step is first and not skippable because
every later onboarding save goes through the API and would 500 until the address lands. Attachment
must go through `updateUser`, never a fresh `signInWithOtp` — that would mint a second, empty
account. `email_exists` is surfaced to the golfer plainly: the address belongs to another account,
sign in with it instead. Nothing catches `SS_EMAIL_REQUIRED` outside that flow, so a golfer who
kills the app mid-onboarding still cannot store anything until they return.

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

### One identity for everyone; an instructor is a golfer who also teaches

**Decision:** Authentication is **one system with one identity**. There is no instructor sign-in,
no separate instructor account, and no role question on the sign-in screen. What differs for an
instructor is onboarding and directory listing — never authentication.
**See:** ARCHIVE D32.

### Roles are rows, claiming instructor is instant, and admin is not claimable

**Decision:** `user_roles` holds one row per (account, role) — `golfer | instructor | admin`
(the value renamed from `coach` in migration 0021, per the accepted instructor-platform
architecture) — so §3.3's "both" is data rather than a schema change and §4.4's "addable later"
is an insert. Every account gets `golfer` from `app.ensure_profile()`, so "signed in but holds
no role" is unreachable. Claiming `instructor` is **free and instant** and unlocks the workspace
with an empty roster; being **listed** in the directory is the reviewed application, and that
gate belongs to `instructor-relationships`/`admin-surface`. `user_roles` has **no INSERT policy
at all** — grants go through `app.claim_role(role)`, SECURITY DEFINER, identity read from
`auth.uid()` internally and the role checked against a whitelist, so both "grant myself admin"
and "grant someone else a role" are inexpressible rather than merely rejected. Server-side
enforcement is `requireRole()` (`lib/roles.ts`), which answers 403 `role_required`; the first
route behind it is `GET /api/v1/instructor/roster`.
**Gotchas:** The role gate answers "may this account use the instructor surface", never "whose
data may it see" — the relationship is still enforced by RLS on `instructor_links`, and
conflating the two is how a role check ends up standing in for an access-control boundary. Roles
are readable only by their holder, not by an approved instructor: which roles an account holds is
not part of what §24 grants.
**See:** ARCHIVE D32; `PROJECT_MAIN.md` §3, §4.4, §31.

### Debug personas are real seeded accounts, and the picker signs in as them

**Decision:** The mobile debug menu's persona picker ("New user", "Newby", "Existing", "Trial",
"Pro", "Coach", "Admin") is an **account swap, not a render swap**: each persona is a real auth
user on the dev auth project with its own name, and the populated personas own real analysed
swings (fixture clones) in the data project with artifacts in object storage — so every surface
shows exactly what that user sees. One shared password (`PERSONA_PASSWORD` /
`EXPO_PUBLIC_PERSONA_PASSWORD`, machine-local env) drives `signInWithPassword`; the picker
signs OUT first so the SIGNED_OUT event clears every per-user cache before the next identity
loads. The active persona is DERIVED from the session's email — whoever is signed in IS the
state — and there is no mock mode: real data always. The picker's first tile is Taylor's own
account (avatar remembered device-locally); the subscription-state chips filter to the states
the active persona can coherently be in. `apps/mobile/src/features/debug/persona.tsx` owns
the email ↔ persona mapping; the seeders live in `apps/web/scripts/`
(`seed-persona-auth.mjs`, `gen-persona-seed.mjs` + `persona-manifest.json`,
`publish-persona-media.ts`).
**Scope:** Entitlement scenarios are still forced client-side per persona — billing has no
server state yet; the seeded subscription rows take over when it does. Admin is a role row on
Alex Morgan's account; true view-any-user impersonation stays a future server-side,
audited feature — never shared credentials.
**Gotchas:** The manifest's uuids are load-bearing — media addresses derive from
(owner, swing, view, revision), so re-minting the manifest orphans the published objects.
Persona emails must be in `AUTH_ALLOWED_EMAILS` wherever that gate is set, or every persona
request 401s in a way that reads as a broken session.

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

### Identity linking: same verified email links automatically; everything else attaches explicitly

**Decision:** One person must land on **one** account whatever they sign in with. Two mechanisms,
by case: GoTrue's default **automatic linking on a matching verified email** connects a Google
sign-in to an existing email-OTP account (both sides verified — this is the safe case and it stays
on); an identifier that carries no matching address — a phone number, or Apple behind its Hide My
Email relay — is attached **explicitly** from inside the signed-in account via
`supabase.auth.updateUser`, confirmed by a code (the onboarding email step is this mechanism).
**Gotchas:** Apple's relay defeats match-by-email, so an Apple-first user starts fresh and the
onboarding attach step is what stitches them in. Explicit attachment must never be a fresh
`signInWithOtp` — that creates a second account instead of linking the first.
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
