# 04 - Analyzer-Side Path-Fit Registry (Default + A–I)

**Phase:** Phase 0 — Ground truth and shared infrastructure (revised arc, 2026-08-07)
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

Plan §22: every tracking test exports ten precomputed trajectory variants (Default + A–I) so
the player switches path fits instantly with zero client-side smoothing — and, after the arc
revision, so the USER can visually judge each fit by playing a swing. This step builds the
shared fitting registry all 12 tests will call; no test exists yet, so it is exercised
hermetically over synthetic observations.

## Dependencies

- Step 02 complete (`ClubObservation` is the input shape).

## Architectural Context

- Plan §22.1: the Default is a confidence-weighted robust APPROXIMATING fit, not an
  interpolating display spline — an interpolant faithfully passes through tracking error.
- Plan §22.2 variants: A light / B strong robust B-spline; C Kalman/RTS constant-
  acceleration; D phase-split cubic Hermite joined at top; E minimum-jerk; F few-segment
  Bézier-style fit; G centripetal Catmull-Rom α=0.5 (interpolating, NEW); H Whittaker-
  Henderson penalized spline with auto λ (NEW); I Savitzky-Golay pre-filter + centripetal
  Catmull-Rom (NEW). §22.3: chordal CR and PCHIP deliberately excluded.
- Fits run in TIME domain (x(t), y(t) against source/frame time), per §22 H's
  parameterization warning; scipy 1.18 + numpy 2.3 are already in the venv — no new deps.
- Mode/confidence honesty (plan §8.5 spirit, kept even without the metrics harness): a
  sample far from any real observation is `inferred` and must not carry observed-level
  confidence. Gap interiors never silently look measured.
- Render-time smoothing (`lib/traceSmoothing.ts`, D46) is untouched — it serves the LEGACY
  trace. New-schema traces bypass it (plan §37 "client can apply smoothing — not for the
  new tracker contract").
- D43's endpoint discipline: every variant keeps endpoints pinned so the head of the drawn
  line lands on the playhead.

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/pathfit.py` — the registry
- `services/analyzer/tests/test_pathfit.py` — hermetic tests over synthetic observations

## Steps

1. **`pathfit.py`** with `VARIANT_IDS = ("default","a","b","c","d","e","f","g","h","i")`
   and `fit_variants(observations, fps, frame_range, top_frame=None) ->
   dict[variant, list[TracePoint]]`, where `TracePoint = {frame, x, y, confidence, mode}`;
   observations sorted, conf-weighted; every variant samples the SAME frame range
   (inclusive) so the player can switch without re-indexing. Endpoint observations get
   pinned (high-weight anchors). Per-sample mode: `observed` at a real observation's frame,
   `mixed` within the typical source interval of one, `inferred` beyond (gap bridging);
   confidence decays with gap distance and never exceeds the bounding observations'.
2. Implement variants: default/a/b robust weighted smoothing splines (IRLS Tukey
   reweighting, three smoothing strengths); c RTS constant-acceleration smoother
   (measurement noise ∝ 1/conf²); d phase-split Hermite joined at `top_frame`; e
   minimum-jerk (third-difference penalized weighted least squares); f few-knot LSQ cubic
   B-spline (Bézier-style economy of segments); g centripetal Catmull-Rom α=0.5 through
   confidence-filtered anchors; h Whittaker-Henderson (second-difference penalty, λ by
   small-grid GCV); i Savitzky-Golay pre-filter then centripetal Catmull-Rom.
3. Degenerate-input handling: < 4 usable observations → every variant falls back to the
   same piecewise-linear conf-weighted result rather than crashing; empty input → `{}`.
4. **`test_pathfit.py`** (hermetic, synthetic arc + seeded noise + a deliberate gap +
   outliers): all 10 keys present; identical frame coverage per variant; coords clipped to
   [0,1]; determinism; approximating variants (default/b/h) reduce RMS deviation from the
   noiseless generator vs raw noisy input while G (interpolant) passes through its anchors;
   outlier rejection: a single 0.3-off outlier moves the default fit < 10% of the outlier
   offset at that frame; gap interior marked `inferred` with confidence below neighbors;
   endpoints within 1e-6 of the endpoint anchors; `top_frame` join continuity for d
   (no jump > one sample step).

## Quality Standards

- Pure numerics: no I/O, no cv2, no artifact reads — observations in, samples out.
- No new pip dependencies (scipy/numpy already present).
- Every variant returns plain-float dicts ready for JSON (step 05 stores them verbatim).

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — suite green including `test_pathfit.py`.
2. `python -c "from swingsage.club_tracking.pathfit import VARIANT_IDS; assert len(VARIANT_IDS)==10"`

## Definition of Done

- [ ] `pytest tests` exits 0 with `test_pathfit.py` collected and passing.
- [ ] All ten §22.2 variants implemented; chordal CR and PCHIP absent (§22.3).
- [ ] Gap samples are `inferred` with decayed confidence — verified by test.
- [ ] No changes outside `swingsage/club_tracking/` + `tests/`.

## Notes

- The §23 trace-quality gate (curvature spikes, publishMode continuous/split_at_top) is
  deferred to step 05/06 territory where a real result exists to gate — it is geometry
  diagnostics, not accuracy testing, so it survives the arc revision.
- F is implemented as a few-knot LSQ B-spline rather than literal Schneider
  fit-and-subdivide; same "cleanest broadcast geometry" intent, far less code. Revisit only
  if the user's eye dislikes F specifically.
