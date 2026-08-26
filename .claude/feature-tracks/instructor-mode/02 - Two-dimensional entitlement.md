# 02 - Two-dimensional entitlement

**Phase:** Instructor Mode
**Status:** complete
**Estimated effort:** 0.5–1 day

## Overview

Replace the client's one-ladder `Tier = free | pro | instructor` with the plan's §2 model:
**personal tier** (free/pro) × **instructor membership** (free/gold/platinum), with the one
derivation rule (Gold/Platinum ⇒ personal Pro, `source: "included"`). Client mock only —
the server engine (platform-foundation step 08) builds the same shape later, and this step
amends that step file so it does.

## Dependencies

- Step 01 complete (the `instructor` role/name is settled).

## Architectural Context

`.claude/architecture/instructor-platform-2026-08-24.md` §2–§3.
`docs/decisions/commerce-entitlement.md` — the seam rules stand: entitlements are a system,
status outranks tier, the Denial mirrors the server's 402 body (now with a dimension).

## Files & Areas Touched

- `apps/mobile/src/features/billing/plans.ts`, `entitlement.tsx`, `BillingDebug.tsx`,
  `storeProducts.ts` (four new instructor SKU ids, mock products)
- Consumers: `ProfileScreen.tsx`, `SettingsScreen.tsx`, `SubscriptionScreen.tsx`,
  `UpgradeScreen.tsx`, `features/spotlights/SpotlightRail.tsx` + `registry.tsx`,
  `features/debug/persona.tsx`
- `.claude/feature-tracks/platform-foundation/08 - Entitlement Engine.md` (design
  amendment appended as a note — never rewrite its Steps in place)
- `docs/decisions/commerce-entitlement.md`, `.claude/ai-instructions/PROJECT_MAIN.md` §30
  amendment note
- `docs/HANDOFF.md` IAP row (four instructor SKUs join it, prices TBD)

## Steps

1. `plans.ts`: `PersonalTier`, `InstructorMembership`, `REQUIRED_PERSONAL`,
   `REQUIRED_MEMBERSHIP`, `MEMBERSHIP_LIMITS` (all §30.1 dials incl. broadcast reach,
   annotations, plans — placeholder values, clearly marked TBD-with-pricing), plans copy
   for Gold/Platinum (pitch + unlocks; price fallback `null` until priced).
   `canHaveInstructor(tier)` → `canHaveInstructor(entitlement)` keyed on
   `entitlement.instructor == null`.
2. `entitlement.tsx`: the two-dimension `Entitlement` shape from the plan (personal
   {tier, source, status, usage} + instructor {membership, status} | null), the derivation
   rule, `Denial` gains `dimension: "personal" | "instructor"`. `can()/deny()/
   useCapability()/useGuard()` signatures unchanged for golfer capabilities.
3. Scenarios: keep the ten golfer states; replace the single `instructor` scenario with the
   coherent instructor set — membership free + personal free, free + personal pro, gold
   (pro included), platinum (pro included), gold in grace, gold on hold — and wire
   `PERSONA_SCENARIOS` so the instructor persona sees the instructor set.
4. `BillingDebug.tsx`: the Subscription state group renders both dimensions' chips.
5. Translate the six consumer sites mechanically (`tier === "free"` →
   `personal.tier === "free"`, etc.); spotlights' `SpotlightContext.tier` becomes the
   personal tier and gains `instructor` for future instructor cards.
6. `storeProducts.ts`: add `com.swingsage.app.instructor.gold.monthly|annual` and
   `.platinum.monthly|annual` ids + mock products; note the one-subscription-group /
   ReplacementMode design (§3) in the file header comment. Update the HANDOFF IAP row.
7. Register edits in place: `commerce-entitlement.md` — rewrite "Three plans" into the
   membership model (Free/Pro golfer ladder + instructor memberships, inclusion rule,
   one-live-subscription invariant, store-native crossgrade proration) and fold the
   "Coaches are free" entry into it (free membership stays the on-ramp; supersede note);
   PROJECT_MAIN §30 gains the Gold/Platinum amendment block (also touch §26.4/§30.1's
   Coach Standard/Pro cross-references and §43's open-question wording).
8. Append the design amendment to platform-foundation step 08: the entitlement record and
   402 body are two-dimensional from birth.

## Quality Standards

- No screen compares a membership or tier string inline; everything routes through the
  seam (grep proves it: `"gold"`/`"platinum"` appear only in `plans.ts`,
  `entitlement.tsx`, `storeProducts.ts`, tests, and debug files).
- The old `Tier` union and `TIER_RANK` are gone, not aliased — a rank compare across
  dimensions must be a type error.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- `pnpm --filter web exec tsc --noEmit` (schema/HANDOFF edits touch nothing typed on web,
  but the oracle is cheap — run it)

## Definition of Done

- [ ] Every existing golfer scenario still renders every screen it did (tests green)
- [ ] The instructor persona can force all six instructor states from the debug sheet
- [ ] Gold/Platinum grant golfer capabilities via `source: "included"` and the allowance
      still meters
- [ ] Denials carry the dimension; the refusal sheet renders both kinds without hardcoding
- [ ] All register/spec amendments from step 7 landed in place
