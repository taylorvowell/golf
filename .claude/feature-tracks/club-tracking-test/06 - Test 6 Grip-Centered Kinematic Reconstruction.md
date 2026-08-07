# 06 - Test 6: Grip-Centered Kinematic Reconstruction

**Phase:** Phase 1 — Deterministic baselines (revised arc; swapped ahead of the player step
so the debug menu is built against REAL experiment data — tactical reorder, logged in
_PROGRESS.md)
**Status:** complete
**Estimated effort:** 1 day

## Overview

The first registered tracker (plan §15): represent the club head relative to `grip_center`
in polar form, anchor on confident visual head detections (the existing Stage 4 solve),
and reconstruct the head between anchors from the grip path + smoothed angular motion +
a slowly-varying projected-radius prior. Cheapest test in the plan (~seconds), no new
dependencies, and it makes `scripts/club_test.py` produce real `club_tracking` blocks on
all seven analysed fixtures — the data the step-07 player work renders.

## Dependencies

- Steps 02, 04, 05 complete.

## Architectural Context

- Plan §15's critical correction: do NOT impose a constant 2D grip-to-head radius —
  perspective and out-of-plane orientation change projected length. The radius series gets
  a heavily-smoothed spline (slowly varying), never a constant.
- Anchors: existing `club.frames[*].head` with conf ≥ 0.35 inside address→impact;
  `interp: true` anchors get half weight (they're already synthetic). `from_model` is fine
  (the detector is real evidence).
- Angle series must be UNWRAPPED before fitting (the swing sweeps far beyond ±π).
- Modes: anchor frames emit `observed` at the anchor position; reconstructed frames emit
  `inferred` (source `kinematic`) with confidence decaying with time-distance from the
  nearest anchor, capped by grip confidence — honesty rules from D54/§8.5.
- Main failure mode (plan §15): 2D pose cannot uniquely determine an out-of-plane club.
  This is a BASELINE, not the product.

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/tests_impl/__init__.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t6_grip_kinematic.py`
- `services/analyzer/swingsage/club_tracking/registry.py` — import hook so `@register` runs
- `services/analyzer/tests/test_t6_kinematic.py`

## Steps

1. `tests_impl/t6_grip_kinematic.py`: `@register class GripKinematicTracker` (id
   `t6_grip_kinematic`, version 1.0.0). `run(ctx)`: harvest anchors from
   `ctx.doc["club"]["frames"]` (head + conf gate) and grip from `ctx.grip` (linear-interp
   gaps); polar decompose at anchors; unwrap angle; weighted smoothing splines —
   angle lightly smoothed, radius heavily smoothed; emit per-frame observations over
   address→impact: anchors as `observed` (exact anchor position), the rest reconstructed
   `inferred` as `grip(f) + radius(f)·[cos θ(f), sin θ(f)]`; diagnostics (anchor count,
   anchor fraction, radius spread).
2. Registry import: `registry.py` (or package `__init__`) imports `tests_impl` so
   registration happens on package import without circulars.
3. Hermetic test: synthetic swing — grip moving along a path, head on a rotating arm with
   slowly varying radius; hide a contiguous 30% span of anchors; T6 must reconstruct the
   hidden heads within 0.03 normalized units, mark them `inferred`, mark anchor frames
   `observed`, and `available()` now includes t6.
4. Run `scripts/club_test.py out/<stem> --test t6_grip_kinematic` over all seven fixtures —
   every artifact gains a real experiment block.

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — green, t6 test included.
2. `python scripts/club_test.py --list` — shows `[x] t6_grip_kinematic`, 1/12 implemented.
3. Loop all seven `out/*/` through the runner — exit 0 each, then verify one artifact has
   `club_tracking.experiments.t6_grip_kinematic.trace.variants` with 10 keys and
   phase spans matching its events.

## Definition of Done

- [ ] Suite green; t6 registered and runnable.
- [ ] All seven fixtures carry a merged t6 experiment with 10 variants.
- [ ] Hidden-anchor reconstruction within tolerance in the hermetic test.
