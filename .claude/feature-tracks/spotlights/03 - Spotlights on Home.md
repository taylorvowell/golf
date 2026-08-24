# 03 - Spotlights on Home

**Phase:** Spotlights
**Status:** not-started
**Estimated effort:** 1 day

## Overview

The spotlight system itself: the card registry with eligibility context, the two shared
templates, the v1 card set, and the Home wiring — the carousel takes the hero slot and the
two legacy stacked intro cards migrate into it, with their old device-local dismissals
honored.

## Dependencies

- Step 01 must be complete (dismissal backbone + `useDismissals`)
- Step 02 must be complete (`SnapCarousel`)

## Architectural Context

`DESIGN-spotlights.md` §"Card registry & eligibility", §"Templates", §"v1 card set",
§"Placement on Home" are binding. Entitlement gating goes through the billing seam
(`features/billing/entitlement.tsx` `can()`) — never an inline tier-name comparison. CTAs
navigate via `useAppNavigation()` (`Record`, `Upgrade`, `Progress` routes already exist in
`navigation.ts`). The counts the context needs (swings, sessions) come from data Home
already fetches — do not add a new fetch for eligibility.

## Files & Areas Touched

- `apps/mobile/src/features/spotlights/registry.tsx` — `SpotlightDef`, `SpotlightContext`,
  the ordered v1 card set
- `apps/mobile/src/features/spotlights/templates/FeatureSpotlight.tsx`,
  `MilestoneSpotlight.tsx`
- `apps/mobile/src/features/spotlights/MultiviewCard.tsx` — the bespoke headline card
- `apps/mobile/src/features/spotlights/SpotlightRail.tsx` — glue: registry × context ×
  `useDismissals` × `SnapCarousel`
- `apps/mobile/src/screens/HomeScreen.tsx` — slot swap; `DeepIntroCard`/`StanceIntroCard`
  inline components retire
- `apps/mobile/src/features/coach/useStanceIntro.ts`, `useDeepIntro.ts` — legacy dismissal
  replay, then retire

## Steps

1. Types + registry per the design doc: `id`, `eligible(ctx)`, `render`; key =
   `spotlight.<id>`; deck = registry order, filtered by eligibility and not-dismissed.
   `ctx.triggers` exists and is always empty in v1 (the personalization seam).
2. Templates: `FeatureSpotlight` (art / eyebrow / title / one-line copy / CTA) and
   `MilestoneSpotlight` (emblem / title / line) on theme tokens, one shared card height.
3. v1 cards per the design-doc table: `multiview.v1` (bespoke, placeholder art with a
   TODO-asset marker, CTA → Record), `pro.v1` (`can()`-gated, CTA → Upgrade),
   `capture-240.v1`, migrated `stance-intro` and `deep-intro` (same behaviour, rendered as
   spotlights), `milestone.swings-50.v1`, `anniversary.1yr.v1`.
4. Legacy migration: on first `useDismissals` sync, if the old AsyncStorage keys
   (`swingsage.stance-intro-dismissed.v1`, deep-intro's twin) read dismissed, replay each
   as `dismiss("spotlight.<id>")`; retire the legacy hooks after.
5. `SpotlightRail` + Home slot swap: first sheet slot, above `FocusHero`; empty deck →
   slot collapses entirely. Debug menu gains "reset dismissals" (the dev-only DELETE +
   mirror clear).
6. HANDOFF row when this step runs: real multiview assets from Taylor (a photo of an
   actual two-phone setup + an app screenshot of multiview).

## Quality Standards

- Every card passes the three CLAUDE.md screen tests (actionable / non-repeating / not
  there-because-we-have-it). No diagnostics on any card.
- A dismissed card never renders again — including cold start offline (mirror), reinstall
  (server), and mid-session (listener push).
- `pro.v1` never renders for a pro-tier user, enforced via `can()` only.
- Eligibility adds zero network requests beyond the dismissals GET.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` (contract untouched —
  this proves it)
- Manual (emulator): fresh state shows the deck in registry order; dismiss `multiview.v1`
  → gone after force-stop + relaunch; legacy-dismissed stance intro does not reappear;
  debug reset restores everything.

## Definition of Done

- [ ] Registry + templates + all seven v1 cards rendering in the carousel on Home
- [ ] Legacy intro cards gone from the sheet flow; their dismissals honored
- [ ] Dismissal survives relaunch (mirror) and is on the server (curl the GET)
- [ ] Empty deck collapses the hero slot
- [ ] Mobile tsc green

## Notes

Multiview itself is future work (dual-device tracks) — the card advertises and routes to
Record regardless; if that reads wrong on the walk, gating `multiview.v1` behind a trigger
later is a one-line registry change.
