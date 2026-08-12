# 03 - Supabase Project and Data Platform Migration

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2 days

## Overview

Stand up Supabase as the account and data platform (§4.1, §39) and move the existing schema
onto it. Supabase is Postgres, so the seven existing tables and their Drizzle migrations move
rather than get rewritten — this step is a migration and a boundary decision, not a redesign.

The boundary that matters: §24.3 and §34.2 make coach access to golfer data a **data-access**
rule, not a UI check. Whatever this step decides about row-level security is what every later
track inherits, so it is settled here rather than discovered during `coach-relationships`.

## Dependencies

- Step 01 complete (data platform + RLS boundary decided).

## Architectural Context

- `PROJECT_MAIN.md` §4.1 (Supabase required), §24.3 (access boundaries), §34 (privacy and data
  control), §39.
- `docs/CURRENT-STATE.md` §7 — the current seven tables, and the fact that every user-scoped
  table already carries a real `user_id` FK from its first migration. That groundwork is why
  auth is a data change here rather than a schema rewrite.
- Local Docker Postgres on port 5433 is the current dev database; decide whether it stays for
  local dev or is replaced by a Supabase local stack.

## Files & Areas Touched

- `apps/web/src/db/` — client, schema, seed
- `apps/web/drizzle/` — migrations
- `docker-compose.yml` — local dev database
- `infra/` — project/environment declarations
- `docs/decisions/`

## Steps

1. Create the Supabase project(s) per the environment set decided in step 01.
2. Point the existing Drizzle migrations at Supabase and apply them; confirm the schema lands
   intact.
3. Implement the query-layer decision from step 01 (Drizzle retained, or Supabase client). If
   Drizzle is retained, confirm it coexists with Supabase Auth's own schema without collision.
4. Establish the RLS posture: enable row-level security on every user-scoped table and write
   the baseline policy that a user reads and writes only their own rows. Coach access is *not*
   built here — but the policy shape must have an obvious place for it.
4a. **Write the coach-access policy tests now, against a synthetic relationship**, even though
   the coach feature is five phases away in `coach-relationships`. This is the highest-risk
   authorization surface in the product — one user reading another user's video of themselves —
   and the gap between designing the policy here and exercising it there is exactly where a
   wrong shape survives unnoticed. Prove: an approved coach can read the linked golfer's swings;
   a coach cannot read an unlinked golfer's swings; revoking the relationship immediately ends
   read access.
4b. **Define the analyzer's privilege boundary.** The worker needs to write artifacts for
   users it is not authenticated as, so it runs with a service role that bypasses RLS. Scope
   that role to exactly the tables and operations it needs, and make it impossible to reach
   from the API surface — a service role that leaks into request handling silently voids every
   policy above it.
4c. **Design the deletion cascade** decided in step 01, in schema terms: which rows are
   `on delete cascade`, which need an explicit sweep because they live in object storage or a
   third party, and what tombstone (if any) survives for records that must be retained. Every
   later track that creates user data inherits this, so the shape must exist before those
   tracks do. Enforcement and the retention scheduler belong to `production-readiness`.
5. Replace the seeded-admin assumption in `db/seed.ts` with something that works against real
   auth users, without breaking local development.
6. Confirm `pnpm db:backfill` still indexes local `out/` folders during development, or replace
   it with whatever step 07's storage decision implies.
7. Record the outcome in `docs/decisions/`.

## Quality Standards

- RLS is **on** for every user-scoped table, with a test that proves a second user cannot read
  the first user's swings. A policy that exists but is unproven is not a boundary.
- Coach access is test-covered in all three states — linked, unlinked, revoked — before any
  coach feature exists.
- The analyzer's service role cannot be reached from request-handling code.
- No table loses its `user_id` FK, and no new table is added without one.
- Local development still works without cloud credentials wherever that is feasible; where it
  is not, the requirement is documented rather than assumed.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter web db:migrate
```

Plus an automated access-boundary check: a test that authenticates as user B and fails to read
user A's swing row.

Manual: `pnpm db:studio` (or the Supabase dashboard) shows the migrated schema with RLS
enabled on user-scoped tables.

## Definition of Done

- [ ] Supabase project exists per environment; migrations applied.
- [ ] RLS enabled on every user-scoped table, with a passing cross-user denial test.
- [ ] Coach-access policy tests pass for linked, unlinked and revoked relationships.
- [ ] The analyzer service role is scoped and unreachable from the API surface.
- [ ] The deletion cascade is expressed in the schema; storage-side sweeps are enumerated.
- [ ] Seed path works against real auth users.
- [ ] Query-layer decision from step 01 is implemented, not deferred.
- [ ] Oracles pass.

## Notes

Do not take the opportunity to redesign the swing schema here — that is step 06, and mixing it
with the platform migration makes both harder to verify. This step moves what exists and sets
the access boundary.

The coach-access tests in 4a will look premature — they test a feature nobody can use yet. They
are the cheapest possible insurance against the one bug in this product that would be genuinely
unrecoverable: showing one golfer another golfer's video.
