# 04 - Goal Surfaces - Home, After-Swing, Detail

**Phase:** Improvement Tracking
**Status:** not-started
**Estimated effort:** 2 days

## Overview

The golfer-facing surfaces: active goal cards with meters on Home, the per-goal readout on the
after-swing analysis, the goal detail screen with the evidence history, and the proposal
accept/swap flow. Function first, skin later — but every field passes the three screen tests,
because this feature is the poster child for the temptation to dump numbers.

## Dependencies

- Step 03 complete (lifecycle over the API).

## Architectural Context

- §16.3.4. Home: what the golfer is working on *is* the home state. After-swing: verdict +
  updated meter, the tightest feedback loop in the product. Detail: definition, why it
  matters, drills (placeholder link until `drill-library`), per-swing history.
- The home screen's existing "focus right now" card (mobile-client.md, D54 note) is
  recurrence-only today — active goals **replace** it when at least one exists; it remains
  the fallback when none do.
- UI dims or flags low confidence everywhere: a `no_evidence` swing renders as "couldn't
  judge this one" — never as failure, never omitted as if the swing didn't happen.
- Match existing surfaces (`src/design/`, the gauges and StatusMessage patterns) — one system
  for the skinning pass to change, not five.

## Files & Areas Touched

- `apps/mobile/src/features/goals/` — GoalCard, GoalMeter, GoalDetailScreen, ProposalSheet,
  useGoals (server state per the app's stale-while-revalidate conventions).
- `apps/mobile/src/features/home/` — goal cards section + fallback logic.
- `apps/mobile/src/features/player/AfterSwingDock.tsx` / `AfterSwingSummary.tsx` — per-goal
  readout strip.
- `apps/mobile/src/navigation.ts` — goal detail route.

## Steps

1. **useGoals** on the generated schema types; loading/error/empty states per the app's
   "abstain rather than fake" home conventions (unreachable → "cannot reach", never empty).
2. **Home:** up to 3 GoalCards — title, meter, plain-sentence progress ("clean in 7 of your
   last 10"), one glance each. Empty slot with a pending proposal renders the proposal
   (one-tap accept); no goals and no proposals renders the recurrence fallback.
3. **After-swing:** a compact strip on the after-swing surface — per active goal: verdict
   glyph + updated meter delta. `no_evidence` says so in words. No check ids, no raw values,
   no confidence percentages on the product surface (instruments stay in `__DEV__`).
4. **Detail:** the four plain-language parts from §16.3.1, the meter, the per-swing evidence
   timeline (tapping an evidencing swing opens that swing), drills placeholder.
5. **Proposal/swap flow:** accept, decline, and the swap sheet when accepting with 3 active.
   View-excluded proposals render their "film face-on to work on this" line.
6. **On-glass pass** on the desktop emulator (yours — drive it freely): seed goals via API
   against the dev server, screenshot Home, after-swing, detail, proposal, swap, and the
   no-evidence state.

## Quality Standards

- Every visible field passes the three tests: golfer would act on it / not a repeat / not
  there merely because we have the value.
- Jest component tests: meter states (no-evidence-yet, partial, near-complete), fallback
  logic on Home, after-swing strip verdict rendering, swap sheet slot logic.
- No new design primitives where an existing one fits.

## Verification

- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- Metro bundles for Android (HTTP 200 on the virtual entry) — JS-only change, Reload not
  rebuild.
- Emulator screenshots of the six states reviewed and noted in `_PROGRESS.md` (manual —
  layout judgment).

## Definition of Done

- [ ] Home shows goal cards with the recurrence fallback intact when no goals exist.
- [ ] After-swing strip renders all three verdicts correctly, including the no-evidence
      wording.
- [ ] Goal detail renders definition, meter, history; evidencing swing taps navigate to the
      swing.
- [ ] Proposal accept / decline / swap all work against the running dev server on the
      emulator.
- [ ] Mobile oracle green; screenshots taken and filed.

## Notes

Frame rates, drift, evaluator internals: `__DEV__` panel only, standing rule. Anything
measured (scroll feel, animation cost) is a phone question, not an emulator result.
