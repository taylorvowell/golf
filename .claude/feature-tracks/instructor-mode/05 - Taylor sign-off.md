# 05 - Taylor sign-off

**Phase:** Instructor Mode
**Status:** not-started
**Estimated effort:** iteration-bound (his gate)
**human-review-required:** true

## Overview

Taylor walks the whole surface on the S25+ and iterates to explicit sign-off — his
mandated gate (the D61/coach-surface pattern). Wiring may not start before it. This step
is exempt from the execute-human-review-steps-autonomously rule: it IS the user gate the
track exists to reach.

## Dependencies

- Step 04 complete.

## Steps

1. Install on the S25+ (`pnpm --filter mobile phone`; `:native` if native config changed
   in the track — it should not have).
2. Add the walk row to `docs/HANDOFF.md` (OPEN): the mode toggle both directions, the
   charcoal theme on every instructor screen, all eight surfaces, both halves of each
   loop via the persona switcher (instructor persona ↔ a golfer persona), every debug
   state chip.
3. Iterate on his feedback — edits land here, appended to this file's notes, never
   rewriting steps 01–04's records.
4. On his explicit "signed off": mark complete, update `_PROGRESS.md`, and record any
   design decisions his walk produced in `docs/decisions/mobile-client.md`.

## Verification

- Taylor's explicit sign-off in chat. No automated oracle can close this step; the
  typecheck/test oracles still gate each iteration commit.

## Definition of Done

- [ ] Taylor has said "signed off" (or equivalent) on the instructor-mode surface
- [ ] Every piece of walk feedback either shipped or recorded as a named deferral
- [ ] HANDOFF row marked DONE with the date
