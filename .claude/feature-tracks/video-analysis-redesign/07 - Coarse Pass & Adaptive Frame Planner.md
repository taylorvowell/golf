# 07 - Coarse Pass & Adaptive Frame Planner

**Phase:** Analysis Core
**Status:** not-started
**Estimated effort:** 3 sessions

## Overview

**Objective:** the plan's central decoupling (D2, WP-014/015, E2.1): inference cadence
becomes a versioned per-subsystem policy produced by an explicit planner, instead of
"every stage touches every frame". This is what makes a 240 fps swing meet latency/cost
gates.

**Current state:** MediaPipe, RTMW, YOLO, club, face, metrics all run every normalized frame.
Events already run per-clip on pose signals (effectively a coarse pass). No policy concept;
`postprocess` interpolation is the only sub-sampling machinery.

**Target state:** S2 coarse pass (~30 Hz body over full clip, motion curve, ROI, candidate
event neighborhoods, active swing interval) → planner emits explicit frame sets per subsystem
(`pose_direct_frames`, `pose_forced_frames`, `club_native_window`, `ball_windows`,
`event_refine_windows`, `silhouette_frames`), serialized into the artifact for
reproducibility; body refinement runs direct inference up to ~60 Hz over the active swing +
ALL forced event/scoring frames; display frames between direct observations are propagated
with provenance and confidence decay. Cadence numbers are set by the E2.1 ablation on the
step-04 harness, not by opinion.

## Dependencies

- Step 06 (FrameProvider — sparse sampling needs the decode abstraction).
- Step 04 (ablation needs the evaluators; body labels for event frames).
- Step 03 (frame identity stable).

## Architectural Context

Matrix rows 22, 25–26, 47; C5 (no pipeline fork — ONE pipeline consuming a
`frame_policy_version`; the legacy shape is policy "v0-dense" so old behavior stays
reproducible). Plan 02 §planner, 04 §4–6. Silhouette: stays riding whatever pass MediaPipe
makes (it's +2 s); if the coarse pass reduces MediaPipe to 30 Hz, silhouette density drops
with it — the player's even-odd fill tolerates sparse rings; verify visually via checkbutt.

## Files & Areas Touched

- `services/analyzer/swingsage/planner.py` (new), `pipeline.py` (stage order S2→plan→refine),
  `pose.py`/`pose_rtm.py` (frame-set driven), `postprocess.py` (propagation between direct
  frames, provenance-aware), `metrics.py` (reads what exists per frame)
- `packages/schema` — artifact gains `frame_policy {version, sets}` (additive)
- `services/analyzer/scripts/` — `ablate_cadence.py` (E2.1 harness)
- `services/analyzer/tests/` — planner determinism, forced-frame guarantees

## Steps

1. **Policy plumbing first, dense default.** `frame_policy` object threaded through pose/club
   stages; policy "v0-dense" = today's behavior; artifact records it. Zero behavior change;
   parity-verified (compare_analysis).
2. **Coarse pass.** ~30 Hz MediaPipe+RTMW over full clip via the provider; motion curve from
   wrist speeds; active swing interval (events.swing_window already does this — reuse);
   candidate event neighborhoods from the existing detect logic at coarse cadence.
3. **Planner.** Pure function (manifest facts, capture fps, coarse outputs, club type, view,
   required scoring checks) → frame sets; deterministic (same inputs+version → same sets;
   unit-tested); serialized into artifact.
4. **Body refinement.** Direct inference on planned frames (≤60 Hz active swing) + forced
   frames (all event frames + scoring-critical frames — the full forced list lands with step
   08's config; until then force all 8 event frames + 10 checkpoints). Propagated display
   frames: linear interpolation first (E2.2 compares alternatives later), `st` extended with
   PROPAGATED, confidence decays with distance from observation.
5. **E2.1 cadence ablation.** On 240 fps + 60 fps golden clips: dense vs 120/80/60/30 Hz
   direct; metrics: angle MAE/p95 at event frames vs dense reference + labels, score
   agreement, event error, GPU seconds. Decision recorded (docs/decisions/) → default policy
   set to the largest stride inside gates.
6. **Events at coarse + refine windows.** events.detect consumes coarse series; refine
   windows recorded for step 10 (native refinement lands there; until then club.refine_events
   continues on its det_heads path).

## Quality Standards / Verification

- Policy v0-dense parity: compare_analysis clean on 10/10.
- Planner determinism test; forced-frame test: every event/checkpoint frame has a DIRECT
  observation in the output (st==OK/PROVISIONAL, never INTERP/PROPAGATED).
- Ablation report exists with the plan's experiment output format; chosen default within
  gates on the golden set.
- Analyzer pytest green; goldens re-frozen deliberately when the default policy changes
  (diff reviewed — that's the decision moment).

## Migration Considerations

Per-artifact `frame_policy` means old artifacts (implicitly dense) and new ones coexist;
clients render what's present (skeleton density drops between direct frames only if
propagation is off — it isn't; the propagated points render as today's interp points do).
Re-analysis upgrades old swings on demand, never forced (plan 12 §7).

## Technical-Debt Impact

**Temporarily increases** (two policies live: v0-dense + adaptive) — removal: step 14 deletes
v0-dense from the default path once rollout completes; it stays addressable for
reproducibility of old artifacts only.

## Observability

Step-05 spans gain `frames_selected` per stage; policy version in every job record.

## Rollback

Policy pin back to v0-dense (env/config), no deploy needed — the flag mechanism IS the
rollback.

## Cleanup

Owned by 14: v0-dense default removal; ablation harness stays (it's evaluation infra).
