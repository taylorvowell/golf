# 13 - Implementation Backlog for a Coding AI

Each work package should be independently reviewable, testable, and feature-flagged where behavior changes.

## WP-001 - Source manifest schema

**Goal:** Define the authoritative pre-remux source/capture timing contract.

**Deliverables:**

- TypeScript schema;
- Python schema/model;
- JSON Schema;
- hash/canonical serialization helper;
- fixtures for 30/60/120/240 + slow motion.

**Acceptance:** same fixture validates identically client/server; capture FPS can be known/unknown with provenance.

## WP-002 - Client trim manifest writer

**Goal:** Write source facts before remux and actual trim boundaries after remux.

**Acceptance:** slow-motion capture FPS survives even when output container tag is absent.

## WP-003 - Local post-remux preflight

**Goal:** Validate output before upload.

**Acceptance:** malformed slow-motion fixture never uploads; normal trim latency regression is negligible.

## WP-004 - Audio detector confidence API

**Goal:** Formalize `confident / ambiguous / none` rather than only returning a winning timestamp.

**Acceptance:** stores top candidate scores and threshold version.

## WP-005 - Conditional visual trim fallback prototype

**Goal:** Sparse low-res motion interval detection.

**Acceptance:** feature-flagged; runs only on weak audio; benchmark output persisted.

## WP-006 - Trim window sanity check

**Goal:** Warn on a selected interval with no plausible swing motion.

**Acceptance:** cannot affect server exact impact logic; user can override.

## WP-007 - Server media guard

**Goal:** Validate source manifest, object size, duration, frame budget before GPU.

**Acceptance:** oversized/malformed workloads become terminal pre-GPU failures with user-readable reason.

## WP-008 - Immutable source-frame manifest

**Goal:** Stable source-frame IDs, source PTS, real-capture time, playback mapping.

**Acceptance:** all timeline fixtures have exact expected frame counts and durations.

## WP-009 - Canonical playback mapping

**Goal:** Decouple analysis samples from playback timing.

**Acceptance:** frame-exact seek test passes on Android/web/iOS implementation when available.

## WP-010 - Analysis run manifest + version IDs

**Goal:** Make pipeline/model/policy/scoring versions explicit.

**Acceptance:** identical run inputs produce stable idempotency fingerprint.

## WP-011 - Stage checkpoint framework

**Goal:** Immutable stage outputs and resume logic.

**Acceptance:** simulated failure after club stage resumes without rerunning club/body.

## WP-012 - Failure/retry taxonomy

**Goal:** retryable versus terminal failure classes.

**Acceptance:** deterministic timeout fixture is never blindly retried.

## WP-013 - Stage timing/cost telemetry

**Goal:** Attribute wall time and billed work.

**Acceptance:** >=95% of job wall time belongs to named spans in benchmark report.

## WP-014 - Coarse pose/event pass

**Goal:** ~30 Hz ROI/body/motion/event neighborhoods.

**Acceptance:** outputs active swing interval and coarse revision under target latency on benchmark hardware.

## WP-015 - Adaptive refinement planner

**Goal:** Explicit frame sets per subsystem.

**Acceptance:** policy serialized; same inputs/version produce same selected frames.

## WP-016 - Direct-only geometry provenance

**Goal:** `model/tracked/propagated/derived/manual/missing` throughout body pipeline.

**Acceptance:** propagated frame cannot satisfy a `direct_only` scoring dependency.

## WP-017 - Forced scoring-frame body inference

**Goal:** Once events finalize, infer exact scoring-critical frames if not already direct.

**Acceptance:** impact check always references direct geometry when configured.

## WP-018 - Body cadence benchmark harness

**Goal:** Compare 30/60/80/120/native direct cadence.

**Acceptance:** machine-readable quality/latency/cost report.

## WP-019 - Pose runtime benchmark harness

**Goal:** current RTMW vs candidate resolution/model/runtime variants.

**Acceptance:** no runtime is promoted without golden geometry parity gate.

## WP-020 - Club annotation schema/export

**Goal:** five-keypoint club labels + visibility/blur attributes.

**Acceptance:** CVAT/equivalent export validates into evaluator schema.

## WP-021 - Club ground-truth evaluator

**Goal:** positional, shaft, gap, jump, confidence metrics.

**Acceptance:** generates per-swing and aggregate reports from labels + predictions.

## WP-022 - Sparse club-region detector interface

**Goal:** high-recall full-frame localization as crop acquisition.

**Acceptance:** supports adaptive stride and explicit reacquisition state.

## WP-023 - Five-keypoint club-pose model prototype

**Goal:** high-res crop model.

**Acceptance:** trained/evaluated model exports five points + confidence and beats a defined baseline on dev set before further integration.

## WP-024 - Club candidate retention

**Goal:** keep bounded low-confidence plausible candidates.

**Acceptance:** K candidates/frame with deterministic ranking and memory cap.

## WP-025 - Club sequence solver v2

**Goal:** select observed sequence using geometry + temporal constraints.

**Acceptance:** reduces p95 error or catastrophic jumps versus local-best baseline on holdout.

## WP-026 - Honest gap renderer contract

**Goal:** preserve missing/estimated states through client.

**Acceptance:** no estimated point serialized as measured; dashed gaps remain visually identifiable.

## WP-027 - Blur annotation + augmentation experiment

**Goal:** test motion-blur-aware training/confidence.

**Acceptance:** documented adopt/reject decision from positional metrics.

## WP-028 - Ball address/impact window detector

**Goal:** remove full-clip ball processing.

**Acceptance:** produces present/disappearance evidence with confidence only in planned windows.

## WP-029 - Event coarse baseline harness

**Goal:** compare current heuristic, SwingNet-style, pose temporal candidates.

**Acceptance:** candidate-window recall/cost report.

## WP-030 - Native event refinement

**Goal:** exact-frame local refinement around coarse candidates.

**Acceptance:** lower event p95 ms error than coarse-only.

## WP-031 - Server audio feature extractor

**Goal:** sample-accurate transient candidates + quality, timestamped against source clock.

**Acceptance:** A/V offset/path metadata recorded; no claim that audio timestamp equals visual impact.

## WP-032 - Impact fusion model v2

**Goal:** calibrated audio + club + ball + body evidence.

**Acceptance:** improves catastrophic miss and calibration on holdout; user trim mark is absent from features.

## WP-033 - Metrics/scoring dependency engine

**Goal:** confidence/provenance-aware rule evaluation.

**Acceptance:** every check can abstain with structured reason.

## WP-034 - Progressive artifact revisions

**Goal:** coarse/body/club/final immutable revisions.

**Acceptance:** old client still gets final compatible artifact; new client can consume partials.

## WP-035 - Client progressive rendering

**Goal:** render provisional skeleton/events then atomically replace with final stages.

**Acceptance:** no frame-lock regression; provisional state visually distinct where necessary.

## WP-036 - Deferred presentation rendering

**Goal:** move burn-in/contact/share output after `analysis_ready`.

**Acceptance:** analysis-ready timestamp no longer waits on optional render.

## WP-037 - Intra-clip batch sweep

**Goal:** benchmark batch 1/4/8/16/32.

**Acceptance:** selected batch recorded per model/GPU and does not regress geometry.

## WP-038 - GPU decode benchmark

**Goal:** compare current decode path with NVDEC/GPU-resident path.

**Acceptance:** adopt only on measured wall-time or cost improvement.

## WP-039 - FP16/TensorRT benchmark

**Goal:** compare production runtime candidates.

**Acceptance:** golden-set parity + improved dollars/view.

## WP-040 - GPU class benchmark

**Goal:** compare L4 with at least one cheaper/slower and faster alternative.

**Acceptance:** documented dollars/accepted-view choice.

## WP-041 - Session-aware warm strategy

**Goal:** compare scale-to-zero, longer scaledown, buffer, upload-overlap, minimum warm container.

**Acceptance:** measured p95 and incremental cost; no default permanent warm pool without evidence.

## WP-042 - Golden-set CI

**Goal:** automatic regression gate.

**Acceptance:** model/runtime/policy PRs produce deterministic quality diff and block on hard regressions.

## WP-043 - Shadow-mode dual-run framework

**Goal:** run current + candidate stages on sampled production views without changing user output.

**Acceptance:** cost caps, privacy controls, and artifact separation in place.

## WP-044 - Rollout dashboards and stop rules

**Goal:** promotion metrics and auto/manual stop criteria.

**Acceptance:** 1/5/20/50/100 rollout can be paused/rolled back by version flag.

## Suggested dependency order

```text
001-003 -> 007-013
004 -> 005-006
008-010 -> 014-019
020-021 -> 022-027
014-015 -> 028-032
016-017 + 030-032 -> 033
010-013 -> 034-036
019/023 -> 037-040
013 -> 041-044
```
