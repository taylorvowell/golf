# 12 - Test 5: Blur + Flow + Deblatting

**Phase:** Phase 2 — Zero-shot visual experts
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

Plan §14: treat high-speed motion as a motion-estimation problem, not a failed-detector
problem. In the hard interval (downswing), extract elongated motion structures from frame
differences as blur streaks — the streak IS intra-frame trajectory (§3.6) — and use optical
flow to advect the last known head across frames nothing else measured.

## Decisions

- **Flow model: torchvision RAFT (small)** — SEA-RAFT has no packaged distribution;
  vendoring a research repo loses to torchvision's maintained RAFT, which the plan
  sanctions ("SEA-RAFT or the strongest compatible flow model"). Source tag is `raft`,
  not `sea_raft` — the artifact never claims a model it didn't run. Logged here as the
  §37 amendment deviation.
- Streak logic is pure (`blur.py`): scipy connected components on a thresholded
  difference image; keep components that are elongated (PCA ratio), area-banded,
  grip-banded, and direction-consistent with expected motion; the head observation is the
  streak's LEADING tip (the far end along the motion direction). A streak emits `mixed`,
  source `deblatting` — never a fake crisp center (§5.4).
- Flow advection fills only frames still empty after streaks: advect the last known
  position by the mean flow in a patch around it — `inferred`, source `raft`, decaying
  confidence.
- Camera-motion compensation skipped: every fixture is tripod-mounted; noted as the known
  limit for handheld uploads (§14 lists it — revisit when a handheld fixture exists).
- Full deblatting inverse model (§14's "optional fuller" stage) not built — staged
  implementation stops at streak extraction + robust fit, per the plan's own suggestion.

## Files

- `services/analyzer/swingsage/club_tracking/blur.py` (pure)
- `services/analyzer/swingsage/club_tracking/point_trackers/raft_adapter.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t5_blur_flow.py` (+ import)
- `services/analyzer/tests/test_t5_blur.py`
- `apps/web/src/lib/clubTests.ts`

## Verification

1. `python -m pytest tests` green; web gates clean.
2. `scripts/club_test.py out/<stem> --test t5_blur_flow` — all seven exit 0.
