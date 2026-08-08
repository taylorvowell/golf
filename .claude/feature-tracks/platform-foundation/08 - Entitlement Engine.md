# 08 - Entitlement Engine

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

Build the capability seam that every gated feature will call, long before there is anything to
bill for.

§30.1 is unusually explicit: "Features and usage should be controlled by subscription
entitlement rather than being hard-coded into isolated screens." §14.1 requires overlays to
respect entitlements. §17 requires per-tier AI limits. §20.3 requires professional swings to be
tier-restricted. §21 and §30.1 make history depth, storage duration and retention
entitlement-driven.

Those features are built across phases 2 through 5. If the entitlement system arrives with
billing in phase 6, every one of them gets retrofitted with gating — which is precisely the
per-screen hard-coding §30.1 forbids, arrived at by scheduling rather than by intent.

So the **engine** ships here and the **billing** that feeds it ships in `billing-iap`. Between
now and then every capability resolves to "allowed" for everyone, and that is fine: the seam is
the deliverable, not the answer it returns.

## Dependencies

- Step 05 complete (roles exist — entitlement resolves against a real user with real roles).
- Step 07 complete (capability names cross the API and belong in the shared schema).

## Architectural Context

- `PROJECT_MAIN.md` §30.1 (the entitlement dimensions list), §30.2 (upgrade experience),
  §30.3 (lifecycle states), §31.4 (admin-configurable tiers).
- `docs/DECISIONS.md` D1 — billing is native in-app purchase, so entitlement is fed by store
  transactions and server-side receipt validation, never by a client-reported purchase. That
  makes the entitlement record our own, not a mirror of a billing provider's state, which is
  also what makes admin-granted complimentary access possible without a store transaction.
- §30.1's dimensions are a mix of **binary capabilities** (dual-phone recording, professional
  comparison, coach annotations) and **metered quotas** (swings analysed, AI messages, storage
  duration, roster size). The engine must model both; a boolean-only design fails half the list.

## Files & Areas Touched

- `apps/web/src/lib/entitlements.ts`
- `apps/web/src/db/schema.ts`, `apps/web/drizzle/` — entitlement + usage tables
- `packages/schema` — capability names and the entitlement payload
- `apps/web/src/app/api/**` — server-side enforcement

## Steps

1. **Enumerate capabilities from §30.1** as a closed, named set in `packages/schema` — every
   dimension the doc lists, whether or not the feature behind it exists yet. A capability that
   is not named cannot be gated later without touching the feature's code, which is the failure
   this step prevents.
2. **Model both shapes**: binary capabilities and metered quotas with a reset period. Quotas
   need usage accounting that is correct under concurrency — two simultaneous uploads must not
   both pass a "one remaining" check.
3. **Implement the resolution seam**: a single server-side `can(user, capability)` /
   `consume(user, quota)` API. Every enforcement point calls it. **Enforcement is server-side
   only** — a client-side check is a UX affordance, never the boundary.
4. **Make tier definitions configuration, not code**, so §31.4's admin surface can edit limits
   later without a deploy, and so §43's still-unanswered "exact limits for Free/Pro/Coach
   Standard/Coach Pro" can be filled in when the product decides rather than now.
5. **Default everything to allowed** while no billing exists, behind an explicit "no billing
   configured" state — not by leaving the checks out. The call sites must be real from day one.
6. **Build the §30.2 upgrade surface as a contract**: when a capability is denied, the response
   says which capability, which tier unlocks it, and what the current usage is — enough for any
   client to render the upgrade prompt without inventing its own copy of the rules.
7. **Handle §30.3's downgrade problem now**, at least in design: what happens to stored swings
   when a plan's retention limit shrinks below what the user already has. §43 flags this as an
   open product decision; the engine must be able to express whichever answer is chosen
   (grace period, read-only, refuse-to-downgrade) rather than assuming deletion.
8. **Provide admin-granted access** as a first-class grant type, independent of any store
   transaction.
9. Record the capability model in `docs/DECISIONS.md`.

## Quality Standards

- Every gated feature reaches entitlement through the one seam; `grep` finds no tier name
  (`"pro"`, `"free"`) compared inline in a feature file.
- Quota consumption is atomic — proven by a concurrent test, not by inspection.
- Denial responses carry capability, required tier, and current usage.
- Tier limits live in configuration and are changeable without a code deploy.
- No entitlement decision is made client-side.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter web db:migrate
```

Plus tests: a denied capability returns the structured upgrade payload; a metered quota is not
over-consumed under concurrent requests; an admin grant overrides the absence of a purchase.

## Definition of Done

- [ ] Every §30.1 dimension exists as a named capability in `packages/schema`.
- [ ] Binary capabilities and metered quotas both supported; quota accounting is atomic under
      a concurrency test.
- [ ] Single server-side resolution seam; no client-side enforcement.
- [ ] Tier limits are configuration, editable without deploy.
- [ ] Denial responses carry capability + required tier + current usage.
- [ ] Admin-granted access works with no store transaction.
- [ ] Downgrade-overflow behaviour is expressible and the chosen answer recorded.
- [ ] Capability model recorded in `docs/DECISIONS.md`.

## Notes

Do not set the actual tier limits here. §43 leaves "exact limits for Free / Pro / Coach Standard
/ Coach Pro" explicitly open, and guessing them now would bake a product decision into the
platform. The engine must make those numbers trivial to change; that is the whole point.
