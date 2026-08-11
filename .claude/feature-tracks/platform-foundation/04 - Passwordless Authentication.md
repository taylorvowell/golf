# 04 - Passwordless Authentication

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2 days

## Overview

Real passwordless authentication on Supabase (§4.1), replacing the single seeded admin user
that currently owns every swing. This is the step that turns `user_id` from a constant into an
identity.

§4.2 requires the same account to stay signed in on multiple phones simultaneously — that is
not a nice-to-have, it is the prerequisite for multi-phone synchronized recording (§12), so the
session model has to support it from the start rather than be retrofitted.

## Dependencies

- Step 03 complete (Supabase project, schema and RLS in place).
- ~~Step 02 complete~~ — **amended 2026-08-11 (D27):** only the mobile *workspace* is needed and
  it exists. Step 02's open item is device *measurements*, which are blocked on hardware and have
  nothing to do with sign-in. As written this made auth look blocked by a phone purchase.

## Architectural Context

- `PROJECT_MAIN.md` §4.1 (passwordless), §4.2 (multi-device), §4.3 (lifecycle incl. deletion).
- `docs/CURRENT-STATE.md` §7 — `users.email` is currently nullable and no provider is wired.
- §34 requires users understand what deletion removes; the account-deletion path is designed
  here even though the retention policy itself belongs to `production-readiness`.

## Files & Areas Touched

- `apps/web/src/lib/auth.ts` — replaces the seeded-user shim
- `apps/mobile/src/features/auth/`
- `apps/web/src/db/schema.ts` — user table reconciled with Supabase Auth
- `apps/web/src/app/api/**` — route protection

## Steps

1. Wire Supabase passwordless sign-in (magic link and/or OTP per step 01's decision) on both
   surfaces.
2. Reconcile the app's `users` table with Supabase Auth's user records — one identity, one id,
   no shadow user table drifting out of sync.
3. Implement session handling that survives app restart and works on multiple devices at once
   for the same account.
4. Protect every existing API route: no route may read or write swing data without a resolved
   user, and every query must be scoped by that user rather than by a hardcoded id.
5. Delete the seeded-admin code path entirely — not disable it. A fallback identity that still
   exists will be used by accident.
6. Implement sign-out and account deletion, including what deletion does to the user's swings
   and media.
7. Migrate existing local development swings onto a real user account so the fixtures remain
   usable.

## Quality Standards

- `grep -rn "admin"` across `apps/web/src` returns no hardcoded owner id.
- Every API route resolves identity server-side; no route trusts a client-supplied user id.
- Signing in on a second device does not invalidate the first.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit
```

Plus tests: an unauthenticated request to each swing-scoped API route is rejected; an
authenticated request scoped to user A cannot read user B's swing.

Manual: sign in on two devices with the same account; both stay signed in.

## Definition of Done

- [ ] Passwordless sign-in works on web and mobile.
- [ ] The seeded-admin path is deleted, not bypassed.
- [ ] Every swing-scoped API route rejects unauthenticated requests (test-proven).
- [ ] Two simultaneous device sessions on one account, verified.
- [ ] Account deletion implemented, with its data consequences stated.
- [ ] Oracles pass.

## Notes

Roles are deliberately **not** in this step — §3's golfer/coach/both model is step 05. Keeping
authentication and authorization separate makes each verifiable on its own.

### Amended 2026-08-11 (D31) — the provider set changed; Android leads

Step 1 above says "magic link and/or OTP", and D25 resolved that to emailed OTP. **D31 supersedes
that provider choice:** the target surface is **phone OTP + Google + Sign in with Apple, and only
those three**. Email OTP is now the transition path and is deleted — not disabled — once Google and
phone are live on Android, under the same rule step 5 applies to the seeded admin.

Sequencing, per D31's amendment:

1. **Google** — free; native `signInWithIdToken`, Android client first. Needs OAuth client IDs
   created interactively in Google Cloud Console (Android needs the signing-key SHA-1).
2. **Phone** — built against `[auth.sms.test_otp]` on a local `supabase start` stack, using a
   reserved `+1 555 555 01xx` test number as the development identity. No provider, no spend, no
   personal number in a config file. Always paired with `SMS_TEST_OTP_VALID_UNTIL`.
3. **Apple** — deferred until the Android client is complete and working, because there is no Apple
   hardware here to sign with. Still mandatory before any iOS submission (Guideline 4.8), so this
   is sequencing, not descope. Pulls $99/yr forward from step 10 when it lands.
4. **Real SMS delivery** — last, gated on A2P 10DLC registration clearing.

Two additions to this step's Definition of Done follow from D31, and neither is in the checklist
above:

- **Every account carries an email address regardless of provider**, as a recovery and delivery
  attribute. A phone-only account is lost permanently when the golfer changes carrier — which is
  the objection D25 raised against phone auth and was right about.
- **Explicit identity linking.** One person signing in with Google and later with Apple must land
  on one account, and Apple's Hide My Email relay defeats match-by-email, so linking cannot be
  inferred from the address.

A hosted Supabase project has no test-number setting, so the free phone path requires the local
stack. There is no `supabase/` directory in the repo yet; step 09 wants that same local stack for
its credential-free media path.

### Progress note 2026-08-11 (D43) — Google is live on Android; the step stays open

D31's first sequenced provider is built and the automated oracles are green, but this step is not
finished and is not being marked so. What landed:

- **Google native sign-in** (`apps/mobile/src/features/auth/`): `signInWithIdToken` against
  `@react-native-google-signin/google-signin`, not `signInWithOAuth` — no browser, no app-switch.
  Session persisted in `AsyncStorage` with `processLock` and foreground-only auto-refresh.
- **`AuthGate`** in front of the whole app, with a three-state status so a cold start does not
  flash the sign-in screen at a returning golfer. No role question on the screen (D32).
- **The server accepts a native session**: `lib/auth.ts` reads `Authorization: Bearer` and passes
  the token to `getUser(jwt)`; a cookie request is unchanged. `parseBearer` is split out and tested
  against the near-miss cases.
- **The bearer path beats `DEV_USER_EMAIL`.** With the fallback in front, every native sign-in test
  would have passed whatever the token said. This was found by looking, not by a failure.
- **A collision that would have broken the first real sign-in**, found the same way: the
  development identity held Taylor's real address and `users.email` is UNIQUE, so
  `app.ensure_profile()` would have raised a unique violation the moment he signed in with Google.
  The fallback now stores `dev@swingsage.invalid` (`lib/devIdentity.ts`), and `db:claim-fixtures`
  claims from the development identity as well as the legacy `admin` row — otherwise the ten local
  fixtures strand on an identity that disappears with the fallback.

Verified: web tsc/lint clean, **157 vitest** (8 new), mobile tsc clean, **84 jest** (14 new),
**100 schema vitest**, Android `assembleDebug` **BUILD SUCCESSFUL** with
`com.reactnativegooglesignin.RNGoogleSigninPackage` in the generated `PackageList.java`. A real
Supabase session was minted against the hosted project and driven through the running server: a
valid token authenticates (200), a garbage token is **401 rather than the dev fallback**, and a
brand-new account sees zero swings.

**Not done, and each has a named reason:**

| | |
|---|---|
| On-device verification | Needs the phone. `adb mdns services` finds nothing — wireless debugging is off. The procedure is written out in `docs/RUNBOOK.md` §6. |
| Phone OTP | Needs the local Supabase stack (a hosted project has no test-number setting, D31). No `supabase/` directory exists yet; the CLI is installed (2.104.0). |
| Sign in with Apple | $99 + Apple hardware (D31). Sequencing, not descope. |
| Real SMS delivery | A2P 10DLC registration (D31). |
| Deleting email OTP, the seeded admin and `DEV_USER_EMAIL` | D31's rule is that email OTP dies once Google **and** phone are live on Android. Deleting the development identity now would leave no way to use the app in between. |
| Account deletion (§4.3) and explicit identity linking (D31) | Untouched. Deletion needs the D15 cascade and an admin-API path; linking needs a second provider to link *to*. |
