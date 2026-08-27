# 09 - Club Pipeline v2 (Five-Keypoint Club Pose + Sequence Solver)

**Phase:** Analysis Core
**Status:** not-started
**Estimated effort:** 4+ sessions (training + shadow evaluation elapsed time)

## Overview

**Objective:** the plan's club architecture (D6/D7, WP-022..027, E3.2..E3.5): sparse
high-recall full-frame club-region localization → crop propagation → high-res 5-keypoint club
pose → bounded candidate retention → sequence-level solver → observed path with explicit
observed/missing states. Promoted over the current pipeline ONLY past the step-04 positional
gates; superseded paths deleted after promotion (C6).

**Current state:** YOLO head+stick boxes every frame full-frame 640 + classical
motion/gradient shaft profile + global DP over angle bins; 27 stored variants;
`clubpath.viterbi_refine` is already a candidate-sequence DP (the solver seed); all raw
detector boxes stored; provenance flags (`from_model/from_ball/interp`) clean; honest dashed
gaps (KEEP, plan affirms); no positional ground truth (step 04 fixes); **the documented
green-box head-in-shaft-box gate does not exist in code**.

**Target state:** club-pose v2 behind a policy flag, shadow-evaluated on GT; on promotion:
classical every-frame solve, the 11 full-solve variants and 15 trace modes deleted; the trace
renderer consumes the same trace/trace_frames contract (client-invisible swap); green-box
rule either implemented as solver evidence or formally retired with the memory/docs
corrected.

## Dependencies

- Step 04 HARD (E3.1: no algorithm comparison before the positional evaluator + labels).
- Steps 06 (crops need the provider), 07 (planner supplies club_native_window / detector
  stride sets).
- Taylor's open HANDOFF row (club-trace winner verdict) settles what the CURRENT pipeline's
  best output is — the baseline v2 must beat.

## Architectural Context

Matrix rows 30–33, 35–36; plan 05 in full. CADDIE is architecture evidence, not a dependency.
ByteTrack/OC-SORT/point trackers are candidate generators to benchmark at most (E3.4), never
authoritative. Physics/trajectory logic ranks and rejects candidates; it never converts
missing evidence into geometry. Training data: own consented corpus (labels from step 04);
external datasets license-checked before any use (several golf sets are non-commercial).

## Files & Areas Touched

- `services/analyzer/swingsage/clubpose/` (new: region detector interface, crop propagation,
  5-pt pose model wrapper, candidate store, solver), `clubpath.py` (extended — the viterbi
  DP generalizes), `club.py` (demoted after promotion), `pipeline.py` (policy switch)
- `services/analyzer/runs/` (training runs), `scripts/train_clubpose.py`
- `packages/schema` (additive club v2 fields: 5-pt keypoints, state
  observed/tracked/estimated_for_display/missing, candidate_rank, provenance)
- Shadow artifacts under the existing `r<n>` prefix as `clubpose_shadow.json` (worker PUTs
  by name — registry gains one name)

## Steps

1. **Freeze the label geometry** (with step 04's manual): grip, shaft_mid, hosel, head_a,
   head_b — reviewed against annotation ergonomics per club type BEFORE training.
2. **Region detector (WP-022).** Start from the trained YOLO (it already finds heads/sticks);
   task = generous club-region crop acquisition, high recall; adaptive stride interface
   (locked ~every 5th native frame / dense reacquisition — E3.3 sweeps 1/2/5/10 on own
   footage before freezing).
3. **Crop pose model (WP-023).** High-res crop → 5 points + per-point confidence; trained on
   the step-04 corpus; must beat a defined baseline (current head-center error on labeled
   frames) on the dev set before integration proceeds.
4. **Candidate retention (WP-024).** Top K=3–5 after plausibility filters, per frame, with
   shaft-image evidence, grip-hand consistency, apparent-length score, blur severity;
   deterministic ranking; memory-capped.
5. **Sequence solver (WP-025).** Extend the viterbi DP: score local pose evidence + shaft
   evidence + grip proximity + length consistency + feasible angular velocity + phase
   direction + crop continuity − impossible jumps. **Candidate selection, not smoothing.**
   Gap policy unchanged: unsupported gaps are `missing`; display chords stay dashed
   (WP-026 — the client contract already renders exactly this).
6. **Green-box resolution.** Implement head-in-region corroboration as one solver evidence
   term and MEASURE it on GT; if it wins, it ships as solver evidence (rule realized); if it
   loses, record the retirement in docs/decisions/ and fix the auto-memory. Either way the
   fiction ends.
7. **Blur experiment (E3.5, optional).** Blur labels exist from step 04; augmentation +
   confidence conditioning only if positional metrics improve.
8. **Shadow evaluation (Phase D).** Policy `club_pose_v2: shadow` runs both paths on sampled
   jobs (cost-capped), v2 output to the shadow artifact; evaluator compares both against GT
   (gates: lower median AND p95 head-center error, FP rate not worse, fewer catastrophic
   jumps, shaft angle ≥, impact-window coverage ≥, calibration not worse, latency/cost within
   SLO).
9. **Promote + delete.** Flip policy default; artifact club section carries v2 fields;
   clients keep rendering trace/trace_frames unchanged. DELETE: classical every-frame solve
   path, VARIANTS + TRACE_MODES machinery (per Taylor's verdict), `addvariant/
   injectvariants` scripts, unreferenced weights (sam2.1_s.pt, yolo11s*.pt,
   yolov8s-worldv2.pt, runs/clubhead_seg/). Keep: checkclub/checktrace/clubdebug (retargeted
   to v2), refine_events consumers (fed by v2 heads).

## Quality Standards / Verification

- Every gate above measured on golden + holdout, reported in the experiment format; promotion
  requires ALL hard gates (no averaging away a regression).
- Analyzer pytest green; goldens re-frozen at promotion with reviewed diffs;
  compare_analysis documents the expected club-section change.
- checkclub/checktrace sheets on all ten fixtures eyeballed (the standing "look at the club
  drawn over the real frame" rule survives GT).

## Migration Considerations

Shadow phase changes nothing user-visible. Promotion is per-new-job; old artifacts stay
readable (trace contract unchanged). head_markers corrections continue to override per frame
regardless of which path produced the head.

## Technical-Debt Impact

**Temporarily increases** (two club paths during shadow — flag `club_pose_v2`, owner this
step, success gate = the promotion gates, removal task = this step's item 9 + step 14 sweep).
Net **reduces** heavily after deletion (2,652-line club.py shrinks; 27-variant machinery
gone).

## Observability

Per-job club quality summary (coverage, gap count, solver score, candidate stats) in the
step-05 record; shadow-vs-current disagreement metrics.

## Rollback

Policy flip back to classical path (kept until step 14's sweep confirms rollout stability).

## Cleanup

Item 9 list above; step 14 verifies nothing lingers.

## Note appended 2026-08-26 — owner requirements from the first position measurement

Taylor's stated requirements after hand-labeling 6iron2 (85 frames) and seeing every variant
fail (dense solves median 250–315 px, parked on the body through the fast phases, confident
heads on all 22 human-invisible frames):

1. **Lean on the shaft.** The stick class already out-detects the head (~2:1) and the shaft
   stays legible long after the head smears; v2 should treat the shaft line (+ hands anchor)
   as the primary evidence and the head as a point ON that line, not an independent blob.
2. **A physical-plausibility gate against hallucination.** Not a raw pixel-jump limit (real
   inter-frame motion near impact is huge at 60 fps) but: fixed-ish club length from the
   tracked hands, smooth angular sweep around the grip, jump tolerance scaled by swing phase.
3. **Failing the gate means ABSTAIN, never reconstruct** — the dashed-gap contract stands;
   smoothing into gaps has already been measured preferring wrong answers.

Acceptance is via the evaluator, not judgment: catastrophic-jump rate, false-positive rate on
human-hidden frames, and confidence calibration against `fixtures/labels/*.club.json` — the
6iron2 set today, plus the 240 fps clip when labeled (sharp-truth anchor).
