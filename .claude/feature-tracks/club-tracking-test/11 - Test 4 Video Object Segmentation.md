# 11 - Test 4: Video Object Segmentation

**Phase:** Phase 2 — Zero-shot visual experts
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

Plan §13: track a temporally propagated club-head mask, using mask stability rather than
boxes/points. Implementation: SAM 2.1 (small) prompted per frame at a Kalman-predicted
point (§13 explicitly wants motion-model assistance), with branch termination when the
mask explodes, attaches to the golfer, or leaves the swing corridor — then reseeding at
the next reliable anchor. Backend goes through ultralytics' SAM wrapper (already a pinned
dependency — no new vendor); the exact API is being verified against the installed
package before the adapter is written.

## Decisions

- Segmenter is an injected callable `(frame_rgb, point_px) -> bool mask` — pytest runs a
  fake; the pure logic (mask stats, sanity gating, Kalman predict, branch/reseed
  orchestration) is hermetic-tested.
- Mask sanity (§13): area within [~0.00005, 0.004] of frame; eccentricity unbounded (a
  blurred head smears); centroid must stay within the grip-radius band and within a jump
  gate of the prediction. Violation terminates the branch (no observation emitted — the
  known §13 weakness surfaces honestly as gaps).
- Observations: centroid as `observed` when the mask is tight and agrees with prediction,
  `mixed` when marginal; area/eccentricity ride in diagnostics.

## Files

- `services/analyzer/swingsage/club_tracking/segmentation.py` (pure logic)
- `services/analyzer/swingsage/club_tracking/point_trackers/sam2_adapter.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t4_video_segmentation.py` (+ import)
- `services/analyzer/tests/test_t4_segmentation.py`
- `apps/web/src/lib/clubTests.ts`

## Verification

1. `python -m pytest tests` green; web gates clean.
2. `scripts/club_test.py out/<stem> --test t4_video_segmentation` — all seven exit 0.
