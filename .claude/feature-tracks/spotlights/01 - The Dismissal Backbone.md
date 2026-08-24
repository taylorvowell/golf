# 01 - The Dismissal Backbone

**Phase:** Spotlights
**Status:** not-started
**Estimated effort:** 0.5–1 day

## Overview

The generic per-user dismissal store, end to end: a `user_dismissals` table, additive
`/api/v1/dismissals` contract + routes, and the mobile `useDismissals()` hook with an
AsyncStorage mirror and offline replay. Nothing spotlight-specific in this layer — any
future one-time banner or "got it" tip uses the same store. Server-persisted because
"dismiss once, never again" must hold across devices and reinstalls.

## Dependencies

- None. (platform-foundation's existing auth + versioned API + shared contract are already
  live and are what this builds on.)

## Architectural Context

`DESIGN-spotlights.md` §"Dismissal backbone" is binding. House patterns: migration 0012
(RLS enable + **force**, per-user policies `user_id = (select auth.uid())`, explicit
grants) with an RLS proof test like `apps/web/src/db/notificationsRls.test.ts`; route style
per `apps/web/src/app/api/v1/notifications/route.ts`; contract additive-only in
`packages/schema`. Load the `supabase-postgres-best-practices` skill before writing the
migration.

## Files & Areas Touched

- `apps/web/drizzle/00NN_user_dismissals.sql` (next number in `meta/_journal.json`)
- `apps/web/src/db/schema.ts` — `user_dismissals` table + inferred types
- `apps/web/src/db/userDismissalsRls.test.ts` — RLS proof
- `apps/web/src/lib/dismissals.ts` — list/upsert/delete via `withUser`
- `apps/web/src/app/api/v1/dismissals/route.ts` — GET/POST (DELETE dev-only reset)
- `packages/schema/schemas/api.schema.json` — additive request/response shapes
- `apps/mobile/src/features/spotlights/useDismissals.ts` — hook, mirror, replay queue

## Steps

1. Migration: `user_dismissals(user_id uuid FK cascade, key text, dismissed_at timestamptz
   default now(), PK(user_id, key))`, RLS enabled+forced, per-user select/insert/delete
   policies, grants — the 0012 template. Apply locally (`pnpm --filter web db:migrate`).
2. Schema.ts table + types; RLS proof test asserting another user's rows are invisible and
   uninsertable.
3. Contract: `DismissalListResponse { keys: string[] }`, `DismissKeyRequest { key }`,
   response `{ ok: true }`. Regenerate + shape-check.
4. Routes: GET list, POST idempotent upsert (`onConflictDoNothing`), 401 via
   `requireUserIdOrNull`, `Cache-Control: no-store`. DELETE guarded to non-production for
   the debug-menu reset.
5. Mobile hook: module-level cache + listener set (pattern: `useStanceIntro` ×
   `useNotifications`), AsyncStorage mirror `swingsage.dismissals.v1`
   `{ keys: string[], pending: string[] }`; `dismiss(key)` = optimistic local + mirror +
   background POST, failures land in `pending` and replay on next fetch; first fetch merges
   server ∪ local.
6. Do NOT touch prod Supabase in this step — the prod migration rides the normal deploy
   path when the track's UI actually ships.

## Quality Standards

- RLS is forced, and proven by test, not by reading the policy.
- The POST is idempotent — double-dismiss is a no-op, never an error.
- A dismissal with the network down survives an app restart and reaches the server later.
- No spotlight-specific naming anywhere in this layer (`user_dismissals`, not
  `spotlight_dismissals`).

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter web test -- userDismissalsRls` (RLS proof passes)
- `pnpm schema:generate && pnpm schema:check` (contract additive, shape-locked)
- `pnpm --filter mobile exec tsc --noEmit`
- curl the local route: unauthenticated GET → 401; authenticated GET → `{"keys":[]}`; POST
  a key twice → `{ ok: true }` both times, GET shows it once.

## Definition of Done

- [ ] Migration applied locally; `user_dismissals` in schema.ts with types exported
- [ ] RLS proof test green
- [ ] GET/POST live under `/api/v1/dismissals`, contract entries generated + checked
- [ ] `useDismissals()` returns the union of server + mirrored keys and replays pending
- [ ] Both oracles green (web tsc/lint + mobile tsc)

## Notes

The step 03 migration of the two legacy intro-card dismissals consumes this hook — keep
`dismiss(key)`'s signature free of card assumptions.
