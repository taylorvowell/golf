# 01 - Instructor rename

**Phase:** Instructor Mode
**Status:** complete
**Estimated effort:** 0.5–1 day

## Overview

"Instructor" everywhere, including internal identifiers — the plan's §1. The 2026-08-19
terminology split (Coach = the AI, Instructor = the human) already governs user-facing copy;
this step lifts its internals carve-out while the window is cheap: dev-only data, one seeded
persona, one role-gated route, and the coach-platform tracks unstarted. After this step,
`coach` in non-analyzer code means the AI persona only.

## Dependencies

- None (first step).

## Architectural Context

`.claude/architecture/instructor-platform-2026-08-24.md` §1 (ACCEPTED 2026-08-26).
**One correction to the plan's §1 table, decided here:** the `coach-surface` track id is
NOT renamed — that track's subject is the AI Coach tab (coach = AI is the correct spelling);
only the three human-coach track ids rename (`coach-relationships`, `coach-collaboration`,
`coach-video-lessons` → `instructor-*`). Note this correction in the plan doc in place.

## Files & Areas Touched

- `apps/web/drizzle/` — one new migration (rename table, role value, function, column,
  policies, notification kinds)
- `apps/web/src/db/schema.ts`, `apps/web/src/lib/roles.ts`
- `apps/web/src/app/api/v1/coach/roster/` → `apps/web/src/app/api/v1/instructor/roster/`
- Test suites: `rls.test.ts`, `roleEnforcement.test.ts`, `profileRls.test.ts`,
  `sessionsRls.test.ts`, `notificationsRls.test.ts`, `accountDeletion.test.ts`,
  `route-auth.test.ts`
- `apps/web/scripts/persona-seed.sql`, `persona-manifest.json`
- `packages/schema/schemas/api.schema.json` + regenerated `src/generated/`
- `apps/mobile/src/features/onboarding/OnboardingScreen.tsx` (`claimRoles` role string)
- `.claude/ROADMAP.json` (three human-coach track ids)
- `docs/decisions/mobile-client.md`, `docs/decisions/auth-identity.md`

## Steps

1. Write migration `NNNN_instructor_rename.sql` (next number in `apps/web/drizzle/`):
   - `user_roles`: update rows `coach` → `instructor`; recreate the role check constraint
     as `('golfer','instructor','admin')`; update `app.claim_role`'s whitelist.
   - `coach_links` → `instructor_links`, renaming its indexes
     (`coach_links_pair`, `coach_links_coach_idx`), the `coach_links_no_self` constraint,
     the `coach_id` column → `instructor_id`, and recreating its RLS policies under the new
     names. Keep RLS enabled + forced.
   - `private.has_coach_access(uuid)` → `private.has_instructor_access(uuid)`; recreate
     every policy that referenced it (users, profiles, swings, sessions, golfer_profiles,
     goals) with the new function; re-apply the revoke/grant pair.
   - `swings.coach_reviewed_at` → `instructor_reviewed_at`.
   - `notifications.kind` values `coach_*` → `instructor_*`: update existing rows and the
     check constraint.
2. Sweep `apps/web/src`: `schema.ts` (tables, types `CoachLinkRow` → `InstructorLinkRow`,
   `coachReviewedAt`), `roles.ts` (`CLAIMABLE_ROLES`, comments), move the roster route
   directory to `api/v1/instructor/roster`, update all seven test suites and both persona
   seed artifacts. No deprecation shim on the route — no production client exists.
3. `packages/schema`: rename the `coach_*` notification kinds in `api.schema.json`,
   regenerate (`pnpm --filter schema generate` or the repo's codegen script — check
   `packages/schema/package.json`).
4. Mobile: `claimRoles` posts `instructor`; grep `apps/mobile/src` for any remaining
   human-coach `"coach"` string (persona.tsx's persona id `coach` may stay — it is a debug
   label — but relabel to `instructor` for consistency where cheap).
5. `.claude/ROADMAP.json`: rename the three human-coach track ids and their `dependsOn`
   references. `coach-surface` stays. Update the launch differentiator prose only where it
   says "human coach" naming is affected (leave AI-coach wording alone).
6. Apply the migration to the local docker Postgres (`pnpm db:migrate` from `apps/web`).
   Do NOT touch `swingsage-prod` in this step — hosted migration rides the normal deploy
   path later; record that in `_PROGRESS.md`.
7. Decision registers, edited in place: `mobile-client.md` terminology entry (internals
   carve-out lifted, cite the plan doc), `auth-identity.md` roles entry (role value is
   `instructor`). One line in the plan doc noting the `coach-surface` correction.

## Quality Standards

- `grep -ri "coach" apps/web/src packages/schema/src --include="*.ts"` returns only
  AI-coach meanings (coach_report artifact naming stays — it is the analyzer contract) —
  reviewed by hand, listed in `_PROGRESS.md`.
- The migration is one file, forward-only, and runs green on a fresh
  `pnpm db:migrate` from zero (drizzle replays all migrations).

## Verification

- From `apps/web`: `pnpm db:migrate` exits 0 against the running docker Postgres.
- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter web test` (the RLS + role suites are the point of this step)
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`

## Definition of Done

- [ ] Migration applied locally; all seven touched test suites green under the new names
- [ ] `/api/v1/instructor/roster` is the only roster route; the old path is gone
- [ ] `packages/schema` regenerated; no `coach_*` notification kind remains
- [ ] ROADMAP.json carries `instructor-relationships`, `instructor-collaboration`,
      `instructor-video-lessons`; `coach-surface` untouched
- [ ] Both decision-register entries edited in place
- [ ] `analysis.json` / `coach_report.json` artifact contracts untouched (analyzer side is
      out of scope — coach there means the AI)

## Notes

`coach_report.json` and everything under `services/analyzer` keep their names — the
artifact contract is versioned and the word means the AI narrative there.
