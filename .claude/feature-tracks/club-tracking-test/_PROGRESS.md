# club-tracking-test — Progress Log

Track scaffolded 2026-08-07 from `docs/SwingSage_Club_Tracking_Comprehensive_12_Test_Plan.md`
(the comprehensive 12-test club-head tracking plan). Step files are authored lazily on first
run, per the feature-orchestrator's lazy-scaffolding rule.

## Planned step arc (from the plan's §32 build sequence)

Phase 0 — Ground truth and shared infrastructure:
- **01** Source-time & audio metadata preservation (Stage 0 amendment, plan §6, §3.1)
- **02** Shared club-tracking data model + `ClubTrackingTest` interface + registry (plan §5, §9)
- **03** Ground-truth annotation schema, fixture labels, mirrored-handedness fixtures (plan §7)
- **04** Evaluation-metrics harness + trace-quality gate (plan §8, §23)
- **05** Analyzer-side path-fit registry: Default + A–I smoothing variants (plan §22)
- **06** `analysis.json` `clubTracking` experiment schema + atomic artifact merge (plan §25, §29.7)
- **07** Debug menu, safe re-analysis enum flow, player rendering (blue/green, address→impact), scrub segments (plan §27–31)

Phase 1 — Deterministic baselines:
- **08** Test 6 Grip-Centered Kinematic Reconstruction
- **09** Test 1 Global Candidate Graph
- **10** Test 10 Physics-Constrained Conic/Factor-Graph + common event refiner + impact corridor (plan §24)

Phase 2 — Zero-shot visual experts:
- **11** Test 3 Modern Point Tracking
- **12** Test 4 Video Object Segmentation
- **13** Test 5 Blur + SEA-RAFT + Deblatting

Phase 3 — Learned temporal model:
- **14** Test 2 Club-Specific Temporal Heatmap (training; needs labels beyond committed fixtures)

Phases 4–6 — Specialist experiments:
- **15** Test 12 Audio-Visual Impact Anchor
- **16** Test 11 Synthetic Temporal Densification (strict VFI ablation)
- **17** Test 7 Claude Bounded Adjudication

Phase 7 — Hybrids:
- **18** Test 8 Phase-Adaptive Multi-Tracker Fusion (+ mandatory ablations, plan §33)
- **19** Test 9 Coarse-to-Fine Source-Time Forensic Fusion (+ ablations)

Phase 8 — Production reduction:
- **20** Reduce the winning hybrid, freeze versions, lock regression fixtures, final benchmark report (plan §35–36)

## 04 - Analyzer-Side Path-Fit Registry
**Completed:** 2026-08-07 17:52 UTC
**Phase:** Phase 0 — Ground truth and shared infrastructure (revised arc)
**Summary:** `swingsage/club_tracking/pathfit.py` implements all ten plan-§22 variants
(Default/A/B robust IRLS-Tukey weighted smoothing splines, C RTS constant-acceleration
smoother, D phase-split Hermite joined at top, E minimum-jerk, F few-knot LSQ B-spline,
G centripetal Catmull-Rom α=0.5, H Whittaker-Henderson with GCV-picked λ, I SG+Catmull-Rom)
over one shared sample grid, JSON-ready for step 05's schema. Gap samples are `inferred`
with decayed confidence capped by bounding observations; endpoints pinned (D43). 12 new
hermetic tests over synthetic arcs with noise/gaps/outliers — suite: 104 passed. No new
dependencies (scipy 1.18 already in venv).
**Notes:** These tests are unit tests of the MATH (noise suppression, gap honesty,
determinism), not accuracy evaluation — consistent with the user-judges-visually directive.
F is few-knot LSQ B-spline rather than literal Schneider fit-and-subdivide; revisit only if
the user's eye dislikes F.

---

## ARC REVISION — 2026-08-07 (user directive: no automated accuracy tests)
The user will judge tracking quality VISUALLY by playing a swing in the player — no plan-§8
accuracy-metrics harness, no hand-labeling drive, no label-based gates. The original step 04
(evaluation harness) is REMOVED and the arc compresses to 19 steps; player-visible surfaces
move up so visual judging is possible as early as possible. Step 03's schema + labeling tool
stay committed but dormant (only relevant again if a learned model ever needs TRAINING
labels — user's call). Structural/invariant tests remain; ablations (§33) happen visually
via the debug menu. Revised arc from here:

- **04** Analyzer-side path-fit registry: Default + A–I variants (plan §22)
- **05** `analysis.json` `clubTracking` experiment schema + atomic merge (plan §25, §29.7) — human-review-required
- **06** Debug menu, safe re-analysis enum flow, player rendering (blue/green, address→impact), scrub segments (plan §27–31)
- **07** Test 6 Grip Kinematic · **08** Test 1 Candidate Graph · **09** Test 10 Physics/Conic + event refiner + impact corridor
- **10** Test 3 Point Tracking · **11** Test 4 Segmentation · **12** Test 5 Blur/SEA-RAFT/Deblatting
- **13** Test 2 Temporal Heatmap · **14** Test 12 A/V Impact · **15** Test 11 VFI Densification
- **16** Test 7 Claude Adjudication · **17** Test 8 Phase Fusion · **18** Test 9 Forensic Fusion
- **19** Production reduction of the user-picked winner + final visual sign-off

---

## 03 - Ground Truth Schema, Labeling Tool, and Mirrored Fixtures
**Completed:** 2026-08-07 17:28 UTC
**Phase:** Phase 0 — Ground truth and shared infrastructure
**Summary:** `ground_truth.py` implements plan §7's label schema (visible point /
blur-streak trajectory / unobservable — mutually exclusive by construction; event intervals
or fractional times; optional audio transient labels), keyed to SOURCE frames so labels
survive re-normalization. `scripts/label_club.py` is the click-through OpenCV labeling tool
over the address→impact source-observation window (click=point, drag=streak,
u=unobservable, --events mode, --validate and --selftest CI-safe paths).
`tests/test_mirrored.py` adds the plan §7.4 mirrored hermetic fixtures: proved events are
mirror-invariant within ±2 frames and `metrics.sides` flips under handedness mirroring on
both frozen fixtures. Suite: 92 passed. `fixtures/labels/README.md` documents the format.
**Notes:** Labeling itself is HUMAN work — logged as a non-blocking USER-ACTION-NEEDED
blocker: run `label_club.py` over the 7 analysed fixtures (and eyeball that the GUI works —
not auto-verifiable). `tests/fixtures.json:hand_labeled` deliberately stays null until real
labels exist.

---

## 02 - Shared Data Model, Test Interface, and Registry
**Completed:** 2026-08-07 17:14 UTC
**Phase:** Phase 0 — Ground truth and shared infrastructure
**Summary:** New `swingsage/club_tracking/` package: plan §5 dataclasses (`ClubObservation`
with observed/mixed/inferred modes, `ClubCandidate`, `BlurTrajectoryObservation`,
`EventEvidence` with no x/y by construction), `ClubTrackingContext` (pure `from_artifacts`
seam + `load`, grip extracted by keypoint name never index, handedness threaded), and the
registry declaring the canonical 12 test ids with 0 implemented — `get_test` distinguishes
NotImplementedError from KeyError so the debug menu can grey honestly. 19 new hermetic tests
(suite: 70 passed). Smoke-verified `load('out/swing1')` picks up the D54 sidecar (399 obs).
**Notes:** `ClubTrackingResult` deliberately has no trace/variants field — that shape belongs
to step 05's path-fit registry. Production stages must never import this package until
step 20.

---

## 01 - Source-Time and Audio Metadata Preservation
**Completed:** 2026-08-07 17:07 UTC
**Phase:** Phase 0 — Ground truth and shared infrastructure
**Summary:** New `swingsage/source_timing.py` demuxes the original upload's per-packet PTS +
audio metadata and maps every genuine source frame onto the normalized CFR-60 timeline;
`burnin.py` Stage 0 writes the `source_timing.json` sidecar (degrades to a warning), and
`scripts/retiming.py` backfilled all 7 out/ folders without re-running anything. 23 new
hermetic tests (suite: 51 passed, 2 skipped, 1 xfailed). `analysis.json` deliberately
untouched — contract changes wait for step 06. Logged as DECISIONS.md D54.
**Notes:** Real data confirmed the plan's premise: `perfect`/`pro_2` are 30 fps sources with
every observation duplicated into CFR; `swing1` even drops 3 source frames (>60 fps stretch).
All 7 fixtures carry 48 kHz AAC audio — Test 12 (step 15) is viable on all of them.
Windows console gotcha: cp1252 can't print `→`; scripts must stay ASCII in stdout.

---

**Scaffolding decisions (tactical, recorded per blocker-protocol's filter):**
- Track marked `spine: true` in `ROADMAP.json` — it is the only track, the roadmap consistency
  check requires exactly one active spine, and this is the project's current main effort.
- Step arc mirrors the plan's own build sequence rather than inventing a new order; the plan's
  phase gating (deterministic baselines before learned models, hybrids last) is preserved.

---
