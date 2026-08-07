# 10 - Test 3: Modern Point Tracking

**Phase:** Phase 2 — Zero-shot visual experts
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

Plan §12: track the same physical club head through time with a pretrained
Tracking-Any-Point model instead of redetecting every frame. Zero-shot CoTracker3
(offline mode, forward+backward) via torch.hub on the GTX 1080, seeded from multiple
reliable frames, with multi-seed agreement as the confidence signal.

## Decisions

- **CoTracker3 offline first**; the adapter interface (`point_trackers/base.py`) is the
  §12 "one adapter, benchmark several" seam — TAPIR/LocoTrack drop in later if the user's
  eye wants alternatives. torch.hub caches weights user-globally (~/.cache), nothing lands
  in the repo.
- Tracks run on `analysis.mp4` (720p CFR60) over the address→impact window ±0.5 s,
  downscaled to ≤512 px width for 8 GB VRAM; coordinates map back to normalized.
- Seeds (plan §12): 4 anchor frames spread across the window where the classical solve is
  most confident; each seed = center + 4 support offsets; forward+backward via offline
  mode. Merge = visibility-gated, agreement-weighted median per frame; disagreement wide →
  `mixed`, tracker-invisible → dropped (pathfit bridges honestly).
- Dependency injection throughout: the tracker callable and the frame loader are
  constructor args; pytest uses fakes (no GPU, no network). The real path is exercised by
  the fixture runs in Verification.
- Evidence dedup to source observations, same as t1/t10.

## Files

- `services/analyzer/swingsage/club_tracking/point_trackers/{__init__,base,cotracker}.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t3_point_tracking.py` (+ import)
- `services/analyzer/tests/test_t3_point_tracking.py`
- `apps/web/src/lib/clubTests.ts` — IMPLEMENTED_TESTS

## Verification

1. `python -m pytest tests` green (fake-tracker hermetic tests + mirror 4/12).
2. `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` clean.
3. `scripts/club_test.py out/<stem> --test t3_point_tracking` on all seven fixtures — exit
   0, merged experiments (GPU inference, expect ~10–60 s each).

## Definition of Done

- [ ] Suite green; t3 registered; fixtures merged; mirror in sync.
- [ ] No repo-committed model weights; torch imported only inside the adapter.
