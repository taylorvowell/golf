# 05 - Achievement, Celebration, Maintenance

**Phase:** Improvement Tracking
**Status:** not-started
**Estimated effort:** 1–2 days

## Overview

The payoff and the afterwards: achievement detected at the exact completing swing, celebrated
once on that swing's after-swing screen and on Home, the next proposal ready, then quiet
maintenance monitoring with honest re-opening when a fix regresses. Also the event emissions
other tracks will deliver (notifications, coach visibility, telemetry).

## Dependencies

- Step 04 complete.

## Architectural Context

- §16.3.5. Celebration is a real moment, once — no badge economy. Achieved goals archive into
  the improvement record (§21 — history-and-trends surfaces them among trends).
- Maintenance: monitoring continues with no meter on screen; a **sustained** regression
  (maintenance window rule in `goal_config`, not a single bad swing) re-proposes the goal
  carrying its history — never silently, never as fake-new.
- Notifications and coach delivery are seams: emit domain events now; `notifications` and
  `coach-collaboration` deliver them when those tracks land. AI-narrative celebration copy is
  an enhancement — deterministic copy first (D55 / "AI is never a hard dependency").

## Files & Areas Touched

- `apps/web/src/lib/goals/evaluate.ts` — achievement + maintenance/regression transitions.
- `apps/web/src/lib/jobs.ts` — domain events: `goal.assigned`, `goal.achieved`,
  `goal.regressed` (durable, consumer-agnostic).
- `apps/mobile/src/features/goals/` — CelebrationMoment, achieved/maintained states, re-open
  proposal rendering.
- `apps/mobile/src/features/player/AfterSwing*` — celebration lands on the completing swing.

## Steps

1. **Transitions in the evaluator.** active → achieved (window met; completing swing id
   pinned), achieved → maintained, maintained → reopened-proposal (maintenance rule met).
   All deterministic, all config-versioned, all unit-tested — including the re-analysis edge
   from step 02 (an invalidated completing swing).
2. **Celebration UI.** On the after-swing screen of the completing swing: one clear moment —
   what was fixed, in the golfer's words from the template, and the archived meter. Home
   reflects it until dismissed; then the slot shows the next proposal. Seen once —
   idempotent, keyed on the achievement, survives app restart without replaying.
3. **Re-open honestly.** A reopened proposal says "this has crept back" with the original
   achievement date and the regression evidence — reuses the proposal flow, visually distinct
   from new.
4. **Events.** Emit the three domain events durably (transactional with the state change).
   No push delivery here — that is `notifications`' job; assert emission, not delivery.
5. **Telemetry seam.** Product events (§37: assigned/achieved/declined/reopened) through
   whatever `observability-and-slos` has established by then; if nothing exists yet, a named
   deferral in `_PROGRESS.md`, not a silent skip.
6. **On-glass pass** on the emulator: drive a goal to achievement with seeded evidence, watch
   the celebration land on the completing swing, verify once-ness across an app restart, then
   drive a regression and verify the re-open wording.

## Quality Standards

- Achievement is provably pinned: the evidence row of the completing swing is referenced by
  the achievement record (FK, asserted in a test).
- Celebration idempotence is server-recorded (seen-at), not client-only state.
- Event emission is transactional with the state transition — no achieved goal without its
  event, no event without its transition.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web test`
- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- Emulator run of the full loop (assign → progress → celebrate → maintain → regress →
  re-open) recorded with screenshots in `_PROGRESS.md` (manual).

## Definition of Done

- [ ] All state transitions unit-tested, including regression and the invalidated-completing-
      swing edge.
- [ ] Celebration renders once on the completing swing's after-swing screen and once on Home;
      restart does not replay it.
- [ ] Reopened goals carry their history in the proposal UI.
- [ ] `goal.assigned` / `goal.achieved` / `goal.regressed` events emitted transactionally
      (integration test).
- [ ] Both oracles green; full-loop emulator pass filed.

## Notes

When this step closes, the track closes — update PRODUCT-COVERAGE §16.3 and the D55 register
entry's gotchas if reality diverged from the plan, per documentation discipline.
