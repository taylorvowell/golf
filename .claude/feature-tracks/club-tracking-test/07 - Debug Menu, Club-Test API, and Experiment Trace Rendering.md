# 07 - Debug Menu, Club-Test API, and Experiment Trace Rendering

**Phase:** Phase 0/1 boundary (revised arc; the user's visual-judgment surface)
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

The surface the whole track is judged on: pick a tracking test and a path-fit variant in
the Debug Menu, the player renders that precomputed trace over the video (backswing blue,
downswing green, address→impact only), and picking an un-run test fires the analyzer runner
and refreshes when merged (plan §27–31). No CV, no smoothing, no geometry in the browser —
scale-and-draw only.

## Dependencies

- Steps 05–06 complete (experiment block exists on all seven artifacts; t6 implemented).

## Architectural Context / Decisions

- `analysis.json` already reaches the client whole (`getAnalysis` → RSC props), so the
  `club_tracking` block is a pure TYPE addition (`Analysis["club_tracking"]?`).
- **TS mirror with enforced sync**: `lib/clubTests.ts` mirrors the Python registry's test
  ids/labels, implemented set, and variant labels. A new analyzer pytest parses that file
  and diffs it against `registry.TEST_IDS` / `available()` / `pathfit.VARIANT_LABELS` — the
  mirror exists but cannot drift silently.
- **Rendering**: build `TracePiece[]` directly from the selected variant's points (x·vw,
  y·vh; contiguous `mode==="observed"` runs solid, `mixed`/`inferred` runs dashed bridges),
  reuse `cutAt` for playhead growth, and BYPASS `buildTracePath`/client smoothing entirely
  (plan §37). Colors from `color_role`: backswing `#2E9BFF` (matches legacy), downswing
  **green** `#22C55E` (plan §2.2 — legacy violet stays for the legacy trace).
  `display_mode: "split_at_top"` renders the spans as separate pieces with no join.
  The experiment trace REPLACES the legacy trace while a test is selected; "Off" restores
  legacy behavior untouched.
- **API**: `POST /api/swings/[id]/club-test` takes `{testId}`, validated against the
  implemented subset of the TS enum (unknown → 400); if `experiments[testId]` already
  exists → `{status:"done", cached:true}` without spawning (plan §28); else spawn
  `club_test.py <outDir> --test <id>` (args array, `shell:false`, `cwd` analyzer — the
  jobs.ts pattern). **In-memory job map only, no DB migration** — this is an eval surface;
  a jobs-table `club_test` type is step-19 productionization work if the winner keeps the
  flow. `GET` polls the map. Client refreshes via `router.refresh()` (video untouched — no
  full reload).
- Menu UI copies `DebugMenu`'s existing section idiom and `OverlayMenu`'s picker-button
  treatment verbatim; unimplemented tests are disabled rows (the registry distinction
  surfaced honestly), cached tests show a dot.

## Files & Areas Touched

- `apps/web/src/lib/clubTests.ts` (new) — ids, labels, implemented set, variant labels, colors, types
- `apps/web/src/lib/useClubTest.ts` (new) — start/poll/refresh hook
- `apps/web/src/app/api/swings/[id]/club-test/route.ts` (new) — POST + GET
- `apps/web/src/lib/swings.ts` — `Analysis` type gains `club_tracking?`
- `apps/web/src/components/DebugMenu.tsx` — two new sections
- `apps/web/src/components/SwingStage.tsx` — experiment trace path + draw
- `apps/web/src/components/SwingWorkspace.tsx` — selection state + hook ownership
- `services/analyzer/tests/test_ts_mirror.py` (new) — mirror sync check

## Steps

1. `clubTests.ts`: `TRACKING_TEST_IDS` (12), `TEST_LABELS`, `IMPLEMENTED_TESTS`
   (`["t6_grip_kinematic"]` today), `VARIANT_IDS`/`VARIANT_LABELS` (10), `PHASE_COLORS`
   by `color_role`, and the `ClubTracking*` TS types matching `experiment_store.py`'s
   snake_case shape.
2. `swings.ts`: `club_tracking?: ClubTrackingBlock` on `Analysis` (import type from
   `clubTests.ts`).
3. Route: module-level `Map<swingId, ClubTestJob>`; POST validates id + implemented +
   cached-check + single-flight per swing; GET returns `{status}`; both `no-store`.
4. `useClubTest.ts`: `{job, busy, start(testId), }`; poll 1s while running; on `done` →
   `router.refresh()`; rejoin on mount like `useReanalyze`.
5. `SwingWorkspace`: `const [clubTest, setClubTest] = useState<TestId | null>(null)`,
   `const [clubVariant, setClubVariant] = useState<VariantId>("default")`, hook owned here;
   pass to `DebugMenu` + `SwingStage`.
6. `DebugMenu`: "Tracking test" section — Off + 12 rows (disabled when unimplemented;
   cached dot when `analysis.club_tracking?.experiments[id]`; picking un-run implemented id
   → `start(id)` and select); "Path fit" section — 10 rows, visible when a test selected.
7. `SwingStage`: `experimentPieces` memo (selected experiment + variant → per-span
   `TracePiece[]` with mode-run splitting); in `draw`, when experiment active, stroke these
   with `PHASE_COLORS[color_role]`, dashed bridges, `cutAt` growth, and skip the legacy
   trace + smoothing entirely.
8. `test_ts_mirror.py`: regex-extract the TS arrays/objects from `clubTests.ts`; assert
   ids == `TEST_IDS`, implemented == `available()`, variant labels == `VARIANT_LABELS`.

## Verification

1. From repo root: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` — clean.
2. From `services/analyzer`: `python -m pytest tests` — green including the mirror test.
3. Manual (the user's judgment surface): open a swing, Debug Menu → Tracking test t6 →
   trace draws blue/green address→impact, variant switch is instant, "Off" restores the
   legacy trace.

## Definition of Done

- [ ] tsc + lint clean; pytest green with `test_ts_mirror.py` collected.
- [ ] Selecting t6 renders its variants with correct colors and no follow-through samples.
- [ ] Unimplemented tests are visibly disabled; cached tests marked; un-run implemented
      test triggers the runner and auto-refreshes.
- [ ] Legacy trace behavior with the menu Off is byte-identical (no regression).
