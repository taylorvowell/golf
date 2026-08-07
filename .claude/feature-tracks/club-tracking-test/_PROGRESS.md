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

## SECOND WAVE — 2026-08-08 (user brainstorm: tracking "not matching all that well")
The catalogue grew 12 → 15 (append-only): **t13 Motion Composite / Long-Exposure
Envelope** (accumulate motion energy, take the outer envelope from the grip hub — the
head sweeps the outermost arc; per-frame position pinned by that frame's motion against
the envelope band, body-zone bins suppressed), **t14 Silhouette-Subtracted Motion**
(motion mask minus the Stage-2b body silhouette; head = the grip-connected blob's
farthest reach), **t15 Envelope-Constrained Graph** (t13's envelope as a corridor prior
decaying off-path candidates inside t1's solver). Path-fit registry grew 10 → 13
variants: **j Robust LOWESS, k Fourier low-pass, l Total-variation** (edge-preserving —
keeps the sharp top reversal). UI: the club-solution and smoothing pickers moved OUT of
the video's Overlay menu into Debug (engineering comparisons live in Debug; Overlay stays
a viewer control), sharing one state via `lib/clubVariants.ts`. Endpoint anchoring
(anchors.py) now guarantees EVERY test's trace starts on the measured club head at
address and ends on it at impact, structurally pinned across all 13 variants. Suite: 225
passed. Full 15×7 sweep regenerating all experiments in background.

---

## 16 - Test 11: Synthetic Temporal Densification (reordered)
**Completed:** 2026-08-08 00:05 UTC
**Phase:** Phase 5 content (10/12 selectable once t7 lands)
**Summary:** `vfi.py` — flow-warped symmetric mid-frames (RIFE has no maintained package;
the §20 acceptance rule judges results, not pedigree) with the §3.10 cap law enforced
structurally: `cap_synthetic_conf` clamps every synthetic detection below its bounding
real observations minus a 35% penalty. t11 densifies the downswing 2× between genuine
source observations, runs the SAME Stage-4b YOLO club-head detector on the synthetic
frames, and re-solves the identical candidate graph — so t11 vs t1 in the menu IS the
plan's required with/without-VFI ablation, judged visually. Suite 200 passed.
**Notes:** Real numbers tell the §20 story already: on 60 fps sources VFI contributes
almost nothing (swing1: 1 synthetic candidate, 0 chosen), on the 30 fps `perfect` it
contributes 74 candidates / 4 chosen — synthetic densification only matters where real
temporal density is poor, exactly as predicted.

## 15 - Test 7: Claude Bounded Adjudication (reordered; in flight)
**Status note:** implemented with triggers/validation/retry/cache/fallback + real CLI
calls; a delivery bug (cmd.exe truncates argv at the first newline — the model saw ONE
LINE of the prompt and honestly answered "insufficient_evidence") was found and fixed by
moving the prompt to stdin, with a hermetic TestCliProvider pinning that. Stale cached
refusals need clearing and a clean re-run across fixtures before this step closes.

---

## 14 - Test 8: Phase-Adaptive Multi-Tracker Fusion (reordered)
**Completed:** 2026-08-07 22:50 UTC
**Phase:** Phase 7 content executed early (8/12 selectable)
**Summary:** `fusion.py` (pure): per-frame IRLS weighted mean over the six cached expert
experiments' default variants, weighted by the §17 phase table × confidence × mode honesty
(observed 1.0 / mixed 0.6 / inferred 0.25), outlier gate ejects parked experts,
disagreement is a first-class diagnostic. Event evidence inherits the best non-artifact
refinement across experiments (t12's audio impact, t10's top). All 7 fused (45–80%
observed-consensus). Suite 179 passed.
**Notes:** §17's empirical reliability calibration (confidence → observed error per phase)
deliberately replaced by the v1 prior table — it requires truth data this project doesn't
collect; the table is module data so menu-driven A/B can vary it. t8 requires cached
expert runs (plan §28) and says so honestly when they're missing.

---

## 13 - Test 12: Audio-Visual Impact Anchor (reordered ahead of T2)
**Completed:** 2026-08-07 22:20 UTC
**Phase:** Phase 4 content executed early per the fill-the-menu reorder (7/12 selectable)
**Summary:** `audio_impact.py` — deterministic §21 detector: ffmpeg mono extraction from
the ORIGINAL upload (derivatives are `-an`), HF-emphasis onset envelope, salience vs local
floor, ambiguity flag for competing transients, ±30 ms A/V uncertainty. The t12 tracker
fuses: agreement within 150 ms → audio refines impact (EventEvidence source `audio`, no
coordinates by construction); disagreement → exposed in diagnostics, never used; no
audio → structural silent fallback. All 7 merged; suite 171 passed.
**Notes:** Real findings: 6iron-1/2/3 agree within −5…+20 ms and swing2 +47 ms (audio
refined impact on four fixtures); swing1 has a 292-salience transient +177 ms late —
correctly EXPOSED as disagreement (likely a second noise after the strike); perfect and
pro_2 show no salient strike in-window (fallback stood). Exactly §3.11's
agreement-raises/disagreement-exposes contract, on first real contact with data.

---

## 12 - Test 5: Blur + Flow + Deblatting
**Completed:** 2026-08-07 21:55 UTC
**Phase:** Phase 2 — Zero-shot visual experts (completes Phase 2 — 6/12 selectable)
**Summary:** `blur.py` (pure): streak extraction from frame differences — elongation via
PCA, area/grip/direction filters, head at the LEADING tip, emitted as `mixed`/`deblatting`
with `blur_streak` visibility, never a fake crisp center (§5.4). Flow advection
(torchvision RAFT-small — SEA-RAFT has no packaged distribution; plan sanctions "strongest
compatible flow model"; source tag is honestly `raft`) fills frames still empty, `inferred`
with decaying confidence. All 7 merged (1–5 s each). Suite 161 passed; gates clean.
**Notes:** Camera-motion compensation skipped (tripod fixtures — revisit for handheld).
Overlapping consecutive streaks cancel in difference images; appearance/disappearance
diffs are what streaks actually serve — encoded in the test. TACTICAL REORDER ahead: T12
(audio), T7 (Claude), T8 (fusion), T11 (VFI) land before T2 (needs training) and T9
(needs the strongest experts) so the menu fills fastest.

---

## 11 - Test 4: Video Object Segmentation
**Completed:** 2026-08-07 21:25 UTC
**Phase:** Phase 2 — Zero-shot visual experts
**Summary:** SAM 2.1 small via ultralytics (already-pinned dependency, 71 MB
auto-cached; API verified against the installed package by docs-researcher before
coding). Per-frame point prompts at a velocity-predicted position rather than the
stateful video propagator — a poisoned memory bank can't drag forward; §13's drift stays
one frame big. Pure logic in `segmentation.py` (mask stats, area/grip/jump sanity gate,
branch death + anchor reseed) hermetic-tested with a fake segmenter. All 7 merged; suite
153 passed; mirror 5/12.
**Notes:** Honest zero-shot result: 39–51 usable observations on the 60 fps clips, but
`perfect` (1) and `pro_2` (2) die immediately — precisely §13's "tiny blurred head below
mask granularity" prediction, now visible in the menu. Test-fake lesson: encode the frame
index in pixels, not a call counter — branch deaths desync counters.

---

## 10 - Test 3: Modern Point Tracking
**Completed:** 2026-08-07 20:55 UTC
**Phase:** Phase 2 — Zero-shot visual experts
**Summary:** CoTracker3 offline (torch.hub, 97 MB cached user-globally, GTX 1080) behind
the §12 adapter seam (`point_trackers/base.py` defines the tracker-callable interface so
TAPIR/LocoTrack can drop in later). Seeds = 4 most-confident classical anchors spread
across address→impact, each with 4 support offsets; bidirectional offline tracking; merge
= visibility-gated weighted median with multi-seed agreement deciding observed vs mixed.
Tracker + loader are constructor-injected — pytest runs on fakes (no GPU/network). All 7
fixtures merged (12–16 s each; `perfect` 185 s — 30 fps source means double frames).
Suite 143 passed; tsc/lint clean; mirror 4/12.
**Notes:** Real-data findings: (1) multi-seed agreement rarely clears the 2% gate during
the fast phases — most t3 output is honestly `mixed`; (2) `6iron-1` kept only 23
observations and correctly triggered `split_at_top` (§2.4 gate's first real firing);
(3) fixed a genuine pathfit crash — the odd-window formula overshot on even-length phase
segments (savgol `window_length > x`), regression-tested now.

---

## 09 - Test 10: Physics-Conic + Event Refiner
**Completed:** 2026-08-07 20:10 UTC
**Phase:** Phase 1 — Deterministic baselines (completes Phase 1)
**Summary:** `physics_fit.py` solves the trajectory as Huber least squares over the frozen
baseline candidate source (per §19 — deliberately blind to t6/other experts): robust
nearest-candidate association re-done per IRLS round, accel+jerk penalties, soft
second-difference grip-radius factor (slowly varying, never constant), and a Fitzgibbon
ellipse conic prior confined to the lower half of the downswing (`conic.py`,
degenerate-safe). `event_refiner.py` is the shared §24 refiner: address = still-RUN then
moving-RUN (single-frame dips like the top turnaround can't fire it), top = velocity
direction reversal, impact = fastest pass through the address-anchored corridor; T10
attaches the evidence and `build_experiment` prefers it. All 7 fixtures merged (0.5–4.6 s;
association 74–100%). Suite 135 passed; tsc/lint clean; mirror 3/12.
**Notes:** First real event disagreement surfaced: on swing1, t10's club-trajectory top is
frame 191 vs the artifact's hand-landmark 198 — D49 (OPEN) predicts club-based tops
DISAGREE with hand tops, and the debug menu now shows the difference visually (blue/green
transition). §19's metric ablation grid intentionally not built (visual ablation via the
menu); factor weights are module constants for easy A/B.

---

## 08 - Test 1: Global Candidate Graph
**Completed:** 2026-08-07 19:38 UTC
**Phase:** Phase 1 — Deterministic baselines
**Summary:** `candidates.py` harvests the artifact's raw low-threshold detector stream
(class looked up from `detector.names`, never a hardcoded index) plus classical heads at
0.6 weight; `graph.py` is a pure Viterbi-style DP with skip edges (§10 edge costs:
speed-beyond-plausible, velocity-CHANGE, skip penalty, grip-band prior, low-weight
confidence per §3.4). The t1 tracker builds one evidence slot per genuine SOURCE
observation (D54 dedup — `perfect` correctly yields 162 observations from its 30 fps
stream, not 322). All seven fixtures merged; suite 126 passed; tsc/lint clean; TS mirror
updated (2/12 implemented).
**Notes:** Two DP bugs found by the hermetic tests, both instructive: (1) SKIP_PENALTY must
exceed max node cost or the min-cost "chain" is one node; (2) a direction-only turn penalty
gates off at v=0, letting a high-confidence decoy be entered slowly via skip edges and
camped on for free — the fix is plan §10's literal "velocity change" term (W_DVEL), which
prices teleport-in/stop/teleport-out symmetrically. Motion-blob candidate generation
deliberately not built (raw stream is dense on these fixtures); revisit if a fixture shows
starved slots.

---

## 07 - Debug Menu, Club-Test API, and Experiment Trace Rendering
**Completed:** 2026-08-07 19:05 UTC
**Phase:** Phase 0/1 boundary — the user's visual-judgment surface
**Summary:** The Debug Menu now has the plan §27 radio groups: 12 tracking tests
(unimplemented disabled, cached dotted, un-run implemented ones spawn the runner) and the
10 path fits (instant switch). `SwingStage` renders the selected experiment's precomputed
trace in place of the legacy one — analyzer points drawn as-is (no client smoothing, plan
§37), backswing blue / downswing green from `color_role`, nothing after impact, bridges
dashed, `cutAt` playhead growth reused. New `POST/GET /api/swings/[id]/club-test` follows
the jobs-table protocol (new `club_test` type — text enum is type-level, no migration;
type-filtered lookups so club-test and re-analyze jobs never collide; reconcile reads
`.experiment.lock` + the artifact). `useClubTest` refreshes via `router.refresh()`, not a
reload (video untouched). TS mirror `lib/clubTests.ts` is lock-stepped to the Python
registry by a new pytest that parses the TS literals. Gates: pytest 120 passed, tsc clean,
eslint clean.
**Notes:** The request body carries ONLY the enum-validated testId (plan §29); Python
re-validates via argparse choices. Manual visual check remains for the user: open a swing →
Debug → Tracking test t6 → play.

---

## 06 - Test 6: Grip-Centered Kinematic Reconstruction
**Completed:** 2026-08-07 18:26 UTC
**Phase:** Phase 1 — Deterministic baselines (revised arc)
**Summary:** First registered tracker. `tests_impl/t6_grip_kinematic.py` anchors on the
existing Stage 4 head detections (conf ≥ 0.35, interp half-weight), decomposes head−grip
into unwrapped angle + projected radius, fits weighted splines (radius heavily smoothed —
the plan §15 "never constant" correction), and reconstructs unanchored frames as honest
`inferred` kinematic observations with decaying confidence. Hermetic test: a hidden 31%
anchor span reconstructs within 0.03 normalized units. Ran over all 7 fixtures — every
artifact now carries `club_tracking.experiments.t6_grip_kinematic` with 10 variants and
correct phase spans (~0.1–0.4 s each). Suite: 116 passed.
**Notes:** TACTICAL REORDER (autonomy directive): T6 executed as step 06, the player/debug
menu moves to step 07 — so the UI step builds against real experiment data instead of
empty menus. Anchor fractions are 97–100% on these fixtures (the classical solve already
covers them); T6's reconstruction value shows on gaps, and it is the designated gap-filler
expert for Tests 8/9.

---

## 05 - Experiment Schema and Atomic Merge
**Completed:** 2026-08-07 18:10 UTC
**Phase:** Phase 0 — Ground truth and shared infrastructure (revised arc)
**Summary:** `experiment_store.py` builds plan-§25 experiment entries (snake_case,
append-only optional `club_tracking` block; address→impact trace scope with
backswing/downswing phase spans; continuity gate v1: split_at_top iff the default fit
bridges top on inferred samples > 150 ms) and merges them atomically under a stale-safe
per-swing lock — a re-merge replaces only its own experiment. `scripts/club_test.py` is the
runner the debug menu's API will call (`--list`, exit 2 on declared-but-unbuilt tests).
7 new tests; suite: 111 passed. Logged as D55. Executed WITHOUT an approval stop per the
user's autonomy directive — the block is append-only so it stays reversible.
**Notes:** burnin's SCHEMA_VERSION deliberately untouched (D48-style optional-block
reasoning). Cached experiments are never recomputed by the runner; re-run is an explicit
caller choice (plan §28).

---

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
