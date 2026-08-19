# achievements — progress

## 2026-08-19 — Track created; step 01 complete

Taylor directed the gamification layer (points/ranks, badges, celebration toasts — D62,
PROJECT_MAIN §16.3.5 amendment). DESIGN.md holds the system design; steps 02–05 are declared
there and their step files get authored when each starts.

**Step 01 — Celebration Surface and Debug Trigger: complete.**
- `apps/mobile/src/features/achievements/` — `celebration.ts` (types + pure queue),
  `Confetti.tsx`, `CelebrationToast.tsx`, `CelebrationProvider.tsx` (+ debug group).
- Mounted in `App.tsx` between `DebugProvider` and `Root`.
- Debug sheet gains a "Celebrations" group with sample badge / rank-up / personal-best runs.
- Typecheck + jest green. Device pass is Taylor's.
