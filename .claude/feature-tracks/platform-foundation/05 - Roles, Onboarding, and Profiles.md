# 05 - Roles, Onboarding, and Profiles

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

The golfer/coach/both role model (§3), the onboarding that establishes it (§4.4), and the
profile and goal data the rest of the product personalizes against (§5).

This step matters more than it looks. §17.2 requires the AI Coach to ground responses in
handedness, height, experience, equipment and goals; §16.1 requires priority to be informed by
golfer goals. Neither can be built later if the fields were never captured. Equally, handedness
currently lives *per swing* rather than on a profile, which is backwards — it is a property of
the golfer.

## Dependencies

- Step 04 complete (real identities exist to attach roles and profiles to).

## Architectural Context

- `PROJECT_MAIN.md` §3 (roles), §4.4 (role onboarding), §5.1–5.3 (profiles and goals),
  §17.2 (what the AI needs), §16.1 (what priority needs).
- `docs/CURRENT-STATE.md` — handedness is a per-swing flag today and height is not captured at
  all, despite being named as a pose sanity-scale input.
- §5 is explicit that sensitive information is not automatically public, and that injury/
  mobility data is voluntary only.

## Files & Areas Touched

- `apps/web/src/db/schema.ts` + `apps/web/drizzle/` — profiles, roles, goals
- `apps/mobile/src/features/onboarding/`, `apps/mobile/src/features/profile/`
- `apps/web/src/lib/auth.ts` — role resolution

## Steps

1. Model roles so one account can hold golfer, coach, or both (§3.3), with room for admin.
   A user must be able to add an eligible role later without a new account.
2. Build onboarding that captures role, then the minimum golfer profile, without demanding
   everything up front — §45's success definition starts with "create an account quickly".
3. Model the golfer profile: handedness, height, age, experience, handicap/skill, common miss,
   typical ball flight, preferred feedback depth, current focus. Voluntary fields are nullable
   and clearly optional.
4. Move handedness to the profile as the default, keeping a per-swing override — a golfer's
   handedness is a property of the golfer, and the analyzer already threads it through all
   angle math.
5. Model goals (§5.3) as editable structured values, not free text, since they must drive
   recommendation priority and progress tracking later.
6. Separate public from private profile fields explicitly, so the coach directory (§23) and
   §34.1's "what appears publicly" question have an answer already in the schema.
7. Answer the §43 product questions this step forces — minimum supported age, whether age is
   exact or a range, which fields are required — and record them in `docs/DECISIONS.md`.

## Quality Standards

- Role checks are enforced server-side and in RLS policy, never only in UI.
- Every profile field the AI Coach or priority engine is documented as needing exists and is
  reachable, or its absence is a recorded decision.
- Optional means nullable in the schema and skippable in the UI.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit
pnpm --filter web db:migrate
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
```

Plus a test that a golfer-only account cannot reach a coach-role endpoint.

## Definition of Done

- [ ] One account can hold multiple roles; roles are addable after signup.
- [ ] Onboarding completes with the minimum viable profile and can be resumed.
- [ ] Handedness defaults from the profile and still overrides per swing.
- [ ] Goals are structured and editable.
- [ ] Public/private field split is explicit in the schema.
- [ ] Role enforcement is test-proven server-side.
- [ ] The §43 questions this step forced are answered in `docs/DECISIONS.md`.

## Notes

Do not build the coach *profile* surface here beyond the role and the fields — the directory,
listings and discovery are `coach-relationships`, in a much later phase.

### Amended 2026-08-11 (D32) — the flow forks at onboarding, not at sign-in

D32 settles how coaches enter the product, and it constrains step 2 above. **Authentication does
not fork.** One sign-in screen, three buttons (D31), no role question — nobody classifies
themselves before they have an account. Three things fork instead:

- **Onboarding defaults to golfer.** Everyone reaches a swing fast; §4.4's role choice is offered
  and never blocks. This is the "simplified flow" — it is the *default* flow, not a variant.
- **Claiming the coach role is free and instant**, and unlocks the coach workspace with an empty
  roster. That is what an exploring coach needs, and it is a role grant on the existing account —
  no re-authentication, no new session, no migration.
- **Being listed in the directory is a reviewed application** and the only real gate (§23.1
  credentials/verified status, §31.5 approval/visibility/suspension). It belongs to `admin-surface`
  and `coach-relationships`, not here.

**What this step must therefore get right**, beyond what is already listed: the split between
*holding a role* and *being listed* has to exist in the schema from the start, because the friction
is supposed to land where a stranger's golf video becomes reachable and nowhere earlier. Step 1's
"room for admin" and step 6's public/private split are both load-bearing for that.

Also note **a coach is a golfer too by default** — coaches film their own swings, and §3.3 expects
it. The golfer surface is never hidden from a coach account, so no part of this step should model
roles as mutually exclusive.
