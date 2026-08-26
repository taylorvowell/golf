# 10 - Events & Impact Fusion v2

**Phase:** Analysis Core
**Status:** not-started
**Estimated effort:** 3 sessions

## Overview

**Objective:** impact (and events generally) become calibrated multimodal fusion with an
evidence breakdown, confidence, and the ability to abstain (plan D5, WP-029..032, E4.x) —
fixing the class of error where the stored Impact is 40 frames wrong and only an unread
agree-flag knows.

**Current state:** events.detect (pose heuristics, per-clip, cheap — effectively the coarse
pass) + club.refine_events (impact snaps to club-head low point, bounded by neighbors) +
independent witnesses that never fuse: `audio_impact` (agree-flag only, never moves Impact),
ball disappearance (off by default), body phase. Event confidences are sharpness-derived,
floors hardcoded. The user's trim mark never reaches the server (D1 satisfied by
construction — keep it that way: fusion features MUST NOT include it).

**Target state:** coarse event neighborhoods (from step 07's planner) → native-frame local
refinement inside windows → per-event output {frame, real_time_ms, confidence, evidence
breakdown, method_version, search_window}; impact fused from audio transient + club-head/ball
proximity + club motion + ball transition + body phase, each with quality weights, via an
inspectable calibrated model (logistic regression / simple probabilistic fusion first);
ordering constraints soft (abstain/lower confidence rather than force order).

## Dependencies

- Step 04 HARD (event ground truth — calibration without labels is unfalsifiable).
- Step 07 (refine windows planned; native-window frame access via provider).
- Step 09 recommended for final fusion quality (v2 club evidence) but NOT blocking: fusion
  v2 works over current club output first (E4.3 ablations include club-visual-only arms).

## Architectural Context

Matrix rows 37–40; C7 (shadow, then the old impact snap demotes to one evidence input, not a
deleted capability — the low-point geometry IS the club_ball feature). Audio rules (plan 06
§6): sample-level timestamps, per-path A/V offset estimated (record path measured 121–148 ms;
import path unknown — manifest records the source path class), calibrated on GT, never
globally authoritative. SwingNet/GolfDB is a benchmark baseline for the coarse pass (E4.1),
not a requirement.

## Files & Areas Touched

- `services/analyzer/swingsage/events.py` (windowed refinement), `impact_fusion.py` (new),
  `audio_impact.py` (sample timestamps + offset fields), `club.py:refine_events` (demoted to
  evidence extraction after promotion), `pipeline.py`
- `packages/schema` (additive event evidence fields)
- `services/analyzer/scripts/ablate_impact.py` (E4.3 harness)
- `services/analyzer/tests/`

## Steps

1. **E4.1 coarse baseline harness.** Current heuristics vs (optionally) a SwingNet-style
   temporal model vs pose-sequence candidates — measured on candidate-window RECALL and cost,
   not exact frames. Adopt the cheapest with sufficient recall (current heuristics are the
   incumbent; replace only on measured win).
2. **Native local refinement (WP-030).** Inside each planned window, compute per-frame
   features at native rate (club-head kinematics, wrist speed extrema, ball state where
   windows exist); refine top/impact/finish/address per plan 06 §4 (static-boundary events
   lean on stability signals).
3. **Server audio features (WP-031).** Extend audio_impact: emit candidate list with
   sample-accurate times + quality; record capture-path class + estimated A/V offset (from
   manifest source type + the measured record-path latency; import path calibrated on GT
   where labels allow).
4. **Fusion (WP-032).** Feature vector per candidate frame (plan 06 §5 list); calibrated
   logistic/probabilistic fusion; output evidence breakdown + confidence; abstain below
   floor. **Assert: no feature derives from the user mark or trim window center.**
5. **E4.3 ablation.** club-only / audio-only / club+audio / club+ball / all — exact/±1/±2
   frames, ms p95, catastrophic misses, calibration; report per fps class; decision recorded.
6. **Shadow (Phase E).** Old and new impact computed on sampled jobs; disagreement > threshold
   reviewed (especially high-confidence large deltas — the 7wood-1 class); promote past gates
   (median ≤1 native frame aspiration, high-conf catastrophic = 0 on golden set, calibration
   not worse).
7. **Post-promotion wiring.** events/phases/tempo/playback_window rebuild from fused events
   (refine_events' rebuild machinery reused); `audio_impact.agrees` kept as a legacy field,
   now derived from the fusion evidence (additive supersession, documented).

## Quality Standards / Verification

- Fusion reproduces or beats every fixture's labeled events; the known 7wood-1 40-frame miss
  is CORRECTED (labeled truth from step 04) — this is the step's acceptance headline.
- No-audio clips and muted imports produce valid (possibly lower-confidence) events — audio
  quality never fails a job alone.
- Analyzer pytest green; goldens re-frozen deliberately at promotion.
- Invariant: event ordering maintained or confidence lowered — never forced.

## Migration Considerations

Event schema additive (evidence breakdown alongside existing {frame, conf}); old clients read
frame/conf as today. Tempo/phase consumers (scoring, clients) see corrected frames only on
new/re-analyzed artifacts.

## Technical-Debt Impact

**Temporarily increases** (impact_fusion_v2 shadow — owner this step, gate = promotion gates,
removal = this step item 7 + step 14 sweep). Net reduces: one impact authority with evidence,
instead of three unfused witnesses.

## Observability

Per-job event confidence + evidence summary + disagreement metrics in the step-05 record;
high-confidence disagreement alert threshold defined (dashboards live with
observability-and-slos).

## Rollback

Policy pin to pre-fusion event path (kept until step 14).

## Cleanup

`checktop.py`/`checkstrip.py` retargeted to show fused evidence; hardcoded confidence floors
(0.7/0.75/0.8 raises in refine_events) retired in favor of fusion confidence.
