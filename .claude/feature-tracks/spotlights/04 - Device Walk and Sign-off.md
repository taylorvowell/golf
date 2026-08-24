# 04 - Device Walk and Sign-off

**Phase:** Spotlights
**Status:** not-started
**Estimated effort:** iteration until sign-off
**human-review-required:** true

## Overview

Taylor walks the carousel on the S25+ and iterates to explicit sign-off — the same gate
session-mode and coach-surface carry. Swipe feel (snap weight, peek amount, loop
seamlessness), card visual quality, and dismissal behaviour are judgement calls that only
survive contact with a real thumb on real glass.

## Dependencies

- Step 03 must be complete

## Architectural Context

The final verification is Taylor's (CLAUDE.md). Claude installs and relaunches
(`pnpm --filter mobile phone`) without asking; driving the phone needs a go-ahead.
Gesture feel is exactly the kind of thing the emulator cannot answer — this walk is on
hardware.

## Files & Areas Touched

- Whatever the iteration touches — expected: `SnapCarousel.tsx` constants (peek, gap,
  deceleration), template styling, card copy/art.

## Steps

1. Put the build on the S25+ (`pnpm --filter mobile phone`, `:native` if step 02/03 added
   native config — they should not have).
2. Add/refresh the HANDOFF row: walk the Home spotlight carousel — swipe, loop both
   directions, dismiss down to empty, relaunch, judge every card in both themes.
3. Iterate on his feedback until explicit sign-off; log each round in `_PROGRESS.md`.
4. On sign-off: mark the HANDOFF row DONE, record any standing design calls in
   `docs/decisions/mobile-client.md` (edit in place), and note the multiview-asset row's
   state (real art in, or still placeholder — placeholder art is a named shortfall, not a
   silent one).

## Quality Standards

- Sign-off is Taylor's word "signed off / looks good / approved" in chat — nothing softer
  closes this step.

## Verification

- `pnpm --filter mobile exec tsc --noEmit` (still green after iteration)
- Taylor's explicit sign-off recorded in `_PROGRESS.md`.

## Definition of Done

- [ ] Walked on the S25+, both themes
- [ ] All feedback rounds applied and logged
- [ ] Explicit sign-off recorded
- [ ] Decisions register updated where iteration changed a standing call

## Notes

If sign-off stalls on the multiview card's placeholder art alone, the step may close with
that named as the remaining item on its HANDOFF row — the system shouldn't idle behind an
asset.
