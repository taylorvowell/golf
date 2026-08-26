# 03 - Frame Identity & Timeline Correctness

**Phase:** Foundations
**Status:** not-started
**Estimated effort:** 2 sessions

## Overview

**Objective:** one authoritative frame-identity story across analyzer, artifacts, clients and
corrections (plan D3, WP-008/009; conflicts C1/C2/C10) — without introducing a second ID
namespace.

**Current state:** the normalized-CFR frame index is the de-facto identity everywhere.
`source_timing.json` builds the source↔normalized map but has zero consumers, is outside the
contract, and is skipped on retimed clips. 30 fps sources are upsampled to 60 by duplicating
frames. Corrections (`head_markers`, `swing_stages` — the project's only hand club truth) key
on raw frame with no fps/revision provenance: a re-analysis at a different `cfr_target_fps`
silently relocates every one. `frames.fpsDisagrees()` is dead code. `playback_pad` is applied
on web only.

**Target state:** normalized-native-rate index formally declared THE public frame id (1:1 with
source for in-app takes); `source_timing` v2 is the authoritative mapping (all paths, retime
included, schema-validated, in the contract); no duplicated frames (native-rate CFR includes
30); corrections carry `{fps, artifact_revision}` provenance with a mismatch guard; a
permanent timeline fixture suite locks all of it.

## Dependencies

- Step 02 (manifest is the capture-clock authority the mapping reads).

## Architectural Context

Matrix rows 17–21; C1/C2/C10 rulings in `MATRIX-current-vs-target.md`. Matrix #19: client
seek rules stay as measured (`frame/fps` Android, `(frame+0.5)/fps` web) — this step does NOT
touch seek math.

## Files & Areas Touched

- `services/analyzer/swingsage/source_timing.py`, `video.py` (`cfr_target_fps` +30),
  `pipeline.py`
- `packages/schema` (source-timing schema into contract, additive; artifact `video` fields)
- `apps/web/drizzle/` migration + `src/db/schema.ts` (`head_markers`/`swing_stages` +
  `fps`, `artifact_revision` columns), markers/stages routes, `useHeadMarkers`/`useSwingStages`
  + mobile `useCorrections` (tolerate new fields)
- `apps/web/src/lib/jobs/complete.ts` (`markViewReady` correction-consistency check)
- `apps/mobile/src/features/player/frames.ts` (wire `fpsDisagrees`),
  `overlay/playbackWindow` consumers (apply `playback_pad` on mobile)
- `services/analyzer/tests/` timeline fixtures

## Steps

1. **Declare identity.** Artifact `video` gains additive fields: `frame_id_space:
   "normalized"`, `source_map: "source_timing.json" | null` + reason when null. Document in
   `packages/schema` descriptions.
2. **source_timing v2.** Runs on EVERY path including retime (map against the retimed output
   clock); schema-validated via `contract.write_json`; add `real_capture_time_us` derived from
   manifest capture facts (confidence + derivation recorded). Keep the pure
   `map_observations` core.
3. **Native-rate CFR incl. 30.** `cfr_target_fps` returns 30 for ~30 fps sources (snap set
   {240,120,60,30}) — no duplicated frames. Both players already read fps from artifact/row;
   verify the web `(f+0.5)/fps` rule and mobile at 30.
4. **Corrections provenance (C10).** Migration: add `fps` + `artifact_revision` columns
   (nullable); backfill existing rows from their view's current values (they were placed
   against the current artifact). Write path stamps both. Read path (both routes): rows whose
   fps ≠ current artifact fps are returned flagged `stale: true`; clients render them dimmed
   or hidden, never merged as truth. `markViewReady` flags (not deletes) stale corrections
   when fps changed.
5. **Wire `fpsDisagrees`.** VideoLayer/frame-clock path surfaces a `__DEV__` warning +
   telemetry event when container fps disagrees with declared fps.
6. **`playback_pad` on mobile.** Apply the freeze-hold on the window loop as web does (the
   equal-lead-in property side-by-side depends on).
7. **Timeline fixture suite** (plan 03 §10): the ten classes (in-app 60/120/240, 30 import,
   VFR import, 240-capture/30-present, non-keyframe remux start, missing capture fps, bad
   metadata, dual-view differing clocks) as frozen probe fixtures + assertions: unique frame
   count, PTS ordering, real duration, playback duration, mapping, seek/overlay identity
   (unit-level; device pass is Taylor's).

## Quality Standards / Verification

- Analyzer pytest green incl. new fixtures; `compare_analysis.py` on re-analyzed 60 fps
  fixtures: **no geometry drift** (identity change touches only 30 fps sources + additive
  fields).
- Web tsc+lint; mobile tests for pad + stale-marker rendering.
- Migration reversible; `pnpm db:migrate` clean on a copy.

## Migration Considerations

Existing artifacts unaffected (additive fields; old fps values persist). Existing 60 fps
swings re-analyzed → same fps → corrections stay valid. A 30 fps import re-analyzed after
this step changes frame count — exactly the case the stale flag covers. Clients tolerate
missing new fields (schema floor unchanged).

## Technical-Debt Impact

**Reduces** — kills the frame-duplication rule violation, the dead map, the corrections
ambiguity, and two dead-code items (`fpsDisagrees` wired or deleted).

## Observability

fps-disagree events; stale-correction counts per view.

## Rollback

Migration down + revert; artifact fields additive so old readers unaffected.

## Cleanup

`swing_views.analysis_version` dead column: dropped in the same migration (audit debt #5,
server list).
