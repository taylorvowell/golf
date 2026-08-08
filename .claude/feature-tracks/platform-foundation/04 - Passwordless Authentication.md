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
- Step 02 complete (mobile workspace exists to host the sign-in flow).

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
