# 03 - UX iteration and Taylor sign-off

**Phase:** Session Mode — UI
**Status:** not-started
**Estimated effort:** open-ended (iteration rounds)
**human-review-required: true**

## Overview

Taylor walks the stubbed experience, and the UI iterates on his feedback until he signs off.
**This gate is his explicit instruction (2026-08-18, D61)** — it overrides the standing
"execute human-review steps rather than stopping" rule. Wiring (steps 04+) must not start
before sign-off in chat.

## Dependencies

- Steps 01 and 02 complete (the loop is walkable end to end).

## Architectural Context

- The three screen-tests from CLAUDE.md bind every iteration: would a golfer act on it; does
  it repeat something visible; is it there because we have the value. The FPS pill stays
  (Taylor's named exception).
- §41 conditions frame the judgement: bright sunlight, one-handed, phone on a stand several
  steps away — countdown and record/stop must read from the ball.

## Files & Areas Touched

- `apps/mobile/src/features/session/**`, `design/system/Sheet.tsx` — whatever feedback
  demands. No scope beyond the session-mode surface.

## Steps

1. Get the current build onto devices: install on the emulator; add the `docs/HANDOFF.md`
   row for the S25+ pass (the phone is Taylor's — never driven without his say-so).
2. Present the loop to Taylor: what to walk, in what order, what is stub vs real.
3. Iterate: apply each round of feedback, keep changes inside the session surface, note
   material design calls in this track's `_PROGRESS.md` (register-worthy ones → D61's
   register entry, edited in place).
4. Repeat until Taylor says it's signed off. Record the sign-off (date, any conditions) in
   `_PROGRESS.md`.

## Quality Standards

- Each iteration lands green (`tsc` + `jest`) before it is presented again.
- Feedback is applied verbatim where stated, judgement fills gaps — Taylor's words win over
  the original spec doc where they differ, and the DESIGN doc is updated in place to match.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile test`
- Sign-off: **Taylor's explicit approval in chat.** This cannot be auto-verified and must
  not be assumed, inferred, or marked from silence.

## Definition of Done

- [ ] Taylor has walked the full loop on a device
- [ ] All feedback rounds applied and green
- [ ] Explicit sign-off recorded in `_PROGRESS.md` with date
- [ ] `DESIGN-session-mode.md` updated to match what was approved

## Notes

If sign-off stalls on something outside UI (e.g. "I can't judge it without a real camera"),
that is a scope decision for Taylor: either iterate after step 04 lands, or accept
conditionally. Ask, don't assume — this step is the one place asking is the job.
