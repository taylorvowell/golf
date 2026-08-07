# 03 - Ground Truth Schema, Labeling Tool, and Mirrored Fixtures

**Phase:** Phase 0 — Ground truth and shared infrastructure
**Status:** complete
**Estimated effort:** 1–2 days (tooling; the labeling itself is human work that follows)

## Overview

No acceptance percentage in this project is independently verifiable (CLAUDE.md) because
there is no hand-labelled truth. The 12-test evaluation is meaningless without it: every
metric in plan §8 compares against manual club-head annotation, and the event criterion
needs human-accepted address/top/impact intervals. This step builds the annotation
*format* (plan §7.1–7.3), a click-through labeling *tool* over genuine source observations
(riding on step 01's sidecar), and the mirrored hermetic *fixtures* plan §7.4 wants
immediately — mirroring proves coordinate/handedness invariants without new footage.

The actual labeling of the fixtures is deliberately NOT a completion criterion — it is
human work this step unlocks, surfaced as a USER-ACTION-NEEDED item when the tooling lands.

## Dependencies

- Step 01 complete (labels attach to source observations, not CFR frames).
- Step 02 complete (ground-truth loader lives beside the shared model).

## Architectural Context

- Plan §7.1: per genuine source observation inside address→impact, one of
  `visible` (point + confidence), `blur_streak` (start/end trajectory + confidence),
  `unobservable`. Coordinates normalized [0,1] in the UPRIGHT source frame — same
  convention as `analysis.json` so evaluation needs no coordinate gymnastics.
- Plan §7.2: address/top/impact as a frame interval or fractional timestamp — never force a
  single frame when the truth is between exposures.
- Plan §7.3: optional audio annotation (candidate strike transient, ambiguity, competing
  noise, A/V alignment uncertainty).
- Labels live in `fixtures/labels/<stem>.club.json` — beside the videos they describe,
  committed to git, keyed by source frame + PTS so they survive any future re-normalize.
- Mirroring (plan §7.4): x → 1−x on frozen pose input + handedness flip is sufficient for
  coordinate/invariant testing (not visual-domain validation). Event detection must be
  mirror-invariant — same event frames to within a small tolerance — and `metrics.sides`
  must resolve lead/trail consistently under the flip (the D29/handedness contract).
- The labeling tool reads ORIGINAL source frames (full resolution — plan §18 pass 2 wants
  source-quality pixels) sequentially via OpenCV; VFR sources make index-seeking unreliable,
  so it decodes forward and stops at observation frames.

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/ground_truth.py` — schema dataclasses,
  load/save, validation
- `services/analyzer/scripts/label_club.py` — interactive labeling tool (OpenCV window)
- `services/analyzer/tests/test_ground_truth.py` — schema round-trip + validation tests
- `services/analyzer/tests/test_mirrored.py` — mirrored-fixture invariants
- `fixtures/labels/` — new directory (empty until a human labels; `.gitkeep` or README)

## Steps

1. **`ground_truth.py`**: `ClubLabel` (source_frame, source_pts_s, visibility:
   visible|blur_streak|unobservable, point | trajectory | None, confidence);
   `EventLabel` (event: address|top|impact, kind: frame_interval|fractional, frame_lo/hi or
   time_s, notes); `AudioLabel` (transient_time_s | None, ambiguity, notes);
   `GroundTruth` (stem, view, handedness, labeler, labeled_at, club: list[ClubLabel],
   events: list[EventLabel], audio: AudioLabel | None) with `to_dict`/`from_dict`,
   `validate()` (coords in [0,1], visibility/shape agreement — a `visible` label must carry
   a point, a `blur_streak` a trajectory, an `unobservable` neither), and
   `load(path)`/`save(path)` (atomic write, sorted by source_frame).
2. **`scripts/label_club.py`**: given `out/<stem>` (needs `analysis.json` +
   `source_timing.json` + readable `video.source.path`): iterate genuine source observations
   from address→impact (pad ±10 observations), decode the source sequentially, show each
   frame upright at a fit-to-screen scale with grip/last-label overlays. Interactions:
   left-click = visible point; click-drag = blur streak (start→end); `u` = unobservable;
   `n`/`p` = next/prev; `s` = save; `q` = save+quit. Writes
   `fixtures/labels/<stem>.club.json` via `ground_truth.save`; re-opening resumes existing
   labels. Also `--events` mode: step frame-by-frame near each of address/top/impact and
   record interval labels. `--validate <file>` loads + validates + prints coverage (no GUI —
   CI-safe).
3. **Mirroring helper** in `tests/conftest.py` (or `test_mirrored.py`): `mirror_frozen(frozen)`
   — x → 1−x for every keypoint with conf > 0 (zeroed keypoints stay zero), handedness
   right↔left, view unchanged. Pure, no I/O.
4. **`tests/test_mirrored.py`**: for each frozen fixture — (a) `events.detect` on mirrored
   input yields the same event frames within ±2 frames; (b) mirrored run passes the same
   structural invariants (normalized coords, strict ordering); (c) `metrics.compute` on
   mirrored input resolves `sides` to the opposite anatomical side (lead stays lead
   geometrically); (d) mirroring twice is identity on the keypoints.
5. **`fixtures/labels/README.md`**: one paragraph — what lives here, the schema file,
   the labeling command, and the rule that labels attach to SOURCE frames (D54), never CFR
   frames.
6. On completion, surface the USER-ACTION-NEEDED item: fixtures need human labeling with
   `label_club.py` before step 04's evaluation harness can report accuracy (it can still be
   built and tested against synthetic truth in the meantime).

## Quality Standards

- Schema validation is pure and total: any structurally invalid file fails `--validate`
  with a path to the offending entry, exit 1.
- The tool never writes a label for a frame it did not display; saving is atomic; a crash
  mid-session loses at most the unsaved tail.
- Mirror helper touches only x coordinates and handedness — asserting y untouched is part
  of the tests.
- No production `swingsage/` stage imports `ground_truth` (evaluation-only, like the rest
  of the package until step 20).

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — suite green including `test_ground_truth.py` and
   `test_mirrored.py`.
2. `python scripts/label_club.py --selftest` — headless: synthesizes a tiny GroundTruth,
   saves, reloads, validates round-trip, exits 0 (no GUI needed).
3. Manual (human): launch `python scripts/label_club.py out/swing1`, label a handful of
   observations, confirm resume-on-reopen. This is prose-confirmed, not auto-verified.

## Definition of Done

- [ ] `pytest tests` exits 0 with both new test files collected.
- [ ] `GroundTruth` round-trips and `validate()` rejects: point on a blur_streak,
      trajectory on a visible, coords outside [0,1], unknown visibility.
- [ ] `label_club.py --selftest` exits 0; `--validate` on a synthesized file exits 0 and on
      a corrupted one exits 1.
- [ ] Mirrored invariants pass on all frozen fixtures (events within ±2 frames, sides
      flipped, double-mirror identity).
- [ ] `fixtures/labels/README.md` exists; labeling itself is explicitly NOT done and is
      surfaced as the user's next action.

## Notes

- Do not build a browser labeling UI — the OpenCV window is the v1 tool; if labeling
  throughput becomes the bottleneck the icebox is the place for a web annotator idea.
- `test_hand_labeled.py`'s null `hand_labeled` in `tests/fixtures.json` stays null in this
  step; wiring real labels into that gate happens once labels exist (step 04 consumes them).
