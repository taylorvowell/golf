# Step 01 — Coach page UI, stubbed

## Goal

Rebuild the Coach tab as the AI coach surface: top tip (next-up + suggested drill), priority
focus areas ranked by impact with personal scores and per-area iconography/swing imagery, a
drills block (~4), and the guided-stance-analysis door. No wiring — a flagged stub view-model
feeds the screen.

## Steps

1. Create `apps/mobile/src/features/coach/coachStubs.ts` — the flagged stub view-model
   (top tip, ranked focus areas with scores/levels/figures, four drills). One swap point,
   `placeholder: true` on everything canned, categories named only from what the scoring
   config actually scores.
2. Rebuild `apps/mobile/src/screens/CoachScreen.tsx` on the hero+sheet scaffold
   (`HeroBackdrop` + `SheetOverBackdrop`, like Progress): coach persona hero, top-tip card,
   ranked focus-area cards (score + priority pill + stick-thumb/icon), drills list, stance
   analysis door.
3. Keep the tab's identity: label stays "Coach" — it now means the AI coach.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green.
- Manual (device/emulator, deferred to step 05): Coach tab renders hero + tip + ranked areas +
  drills in both themes; no borders/shadows; nothing dev-only visible.
