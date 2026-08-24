# 02 - The Snap Carousel

**Phase:** Spotlights
**Status:** not-started
**Estimated effort:** 1 day

## Overview

`SnapCarousel` — the reusable design-system primitive: horizontal, center-aligned cards
with both neighbours peeking, snap-to-center, infinite looping, a uniform dismiss
affordance rendered by the frame, and graceful 0/1/2-card behaviour. Purely presentational:
it takes items and callbacks and knows nothing about spotlights, dismissal storage, or
eligibility. This becomes the house carousel — there is no snap-scroll precedent in the app
today, so what this step builds is the pattern every later rail inherits.

## Dependencies

- None (parallel-safe with step 01).

## Architectural Context

`DESIGN-spotlights.md` §"Carousel mechanics" is binding. Hard constraints: core
`ScrollView` only — `react-native-gesture-handler` is excluded from autolinking (D47) and
reanimated is not in the app; do not add either. `SwingSwipe`'s PanResponder approach is
NOT the precedent here — its comment explains it exists to win responder fights with inner
scrub controls, which these cards don't have. Ideal Swing system rules apply: theme tokens,
flat fills, no borders (`.claude/rules/react-native.md`), `SCROLL_PRESS_DELAY_MS` on every
pressable inside the scroller, exported through `design/system/index.ts`. Deck is frozen —
no Deck imports.

## Files & Areas Touched

- `apps/mobile/src/design/system/SnapCarousel.tsx` (new)
- `apps/mobile/src/design/system/index.ts` (export)

## Steps

1. Geometry: `cardWidth = containerWidth − 2·(PEEK + GAP)` with PEEK ≈ 24–32 (pick once,
   token-ize in the component); `snapToInterval = cardWidth + GAP`,
   `decelerationRate="fast"`, `disableIntervalMomentum`, content insets so a centered card
   shows both peeks. `showsHorizontalScrollIndicator={false}`.
2. Loop: render 3 copies of the deck keyed `copy:index`; start scrolled to the middle copy;
   on `onMomentumScrollEnd` (and `onScrollEndDrag` when momentum won't fire), if the
   settled index is outside the middle copy, `scrollTo` the same logical index in the
   middle copy with `animated: false`.
3. Degenerate decks: length 1 → static centered card, `scrollEnabled={false}`, no copies;
   length 0 → return `null`.
4. API: `items: { key: string; render: (w: number) => ReactNode }[]`,
   `onDismiss?: (key: string) => void`, `cardHeight: number`. When `onDismiss` is set the
   frame renders one X (top-right over the centered card, ≥44pt hit slop, house icon
   language from the existing intro cards). Dismissal animates the deck re-flow with
   `LayoutAnimation` and keeps the snap position on a valid logical card.
5. Page dots for deck ≥ 2 — logical position (modulo the copies), token colors, small.
6. A `__DEV__`-only harness entry (debug menu) rendering the carousel with 0/1/2/5 dummy
   cards so every deck size can be eyeballed without real spotlight data.

## Quality Standards

- Releasing a swipe always settles a card exactly centered — no resting between-cards
  state.
- The loop jump is imperceptible: never during a touch, never animated.
- Dismissing the last card collapses the component (parent slot reclaims the space).
- No new dependencies. No gesture-handler, no reanimated, no carousel library.
- Component is generic — a grep for "spotlight" in `SnapCarousel.tsx` returns nothing.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile lint` (if the mobile lint script exists; otherwise tsc is the
  oracle)
- Manual (emulator is appropriate here — layout/gesture behaviour, nothing measured): the
  `__DEV__` harness at deck sizes 0, 1, 2, 5 — snap, peek both sides, loop past both ends,
  dismiss down to empty.

## Definition of Done

- [ ] `SnapCarousel` exported from `design/system` with the API above
- [ ] Loop, snap, peek, dismiss, dots working at deck sizes 0/1/2/5 in the harness
- [ ] Zero new package.json dependencies
- [ ] Mobile tsc green

## Notes

Android `contentInset` is unreliable — center via leading/trailing spacer views or
`contentContainerStyle` padding, not `contentInset` (iOS-only). Test on the Android
emulator, not just reasoning.
