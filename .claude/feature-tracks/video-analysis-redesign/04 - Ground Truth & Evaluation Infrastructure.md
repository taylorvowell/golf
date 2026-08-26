# 04 - Ground Truth & Evaluation Infrastructure

**Phase:** Foundations
**Status:** not-started
**Estimated effort:** 3 sessions (+ labeling time, partly Taylor's)

## Overview

**Objective:** make club, event and body accuracy falsifiable BEFORE the algorithm rewrites
(plan 08, WP-020/021/042, E3.1). This step delivers the club/event ground-truth scope the
planned `analysis-ground-truth` track promised — that track RECONCILEs against this instead
of duplicating (C12).

**Current state:** the only ground truth anywhere: `audio_truth.json` (5 clips, audio strike
times) and hand-placed `head_markers` rows. No event-frame labels (`fixtures.json:
hand_labeled` null), no club position-error metric ever, coverage has overstated club quality
three times, one known 40-frame impact miss, an earlier "verified ±2 frames" claim was false.
Frozen test inputs (2 clips, 2026-08-06) and goldens (2026-08-08) predate retime/audio/cfr.

**Target state:** annotation schemas (5-pt club + events + trim labels), a labeled golden set
(never trained on), a dev set, an untouched golfer-disjoint holdout; evaluators emitting the
plan's metric families; golden-set CI producing a machine-readable diff that blocks hard
regressions; refreshed frozen/golden test data.

## Dependencies

- Step 03 (labels key on stable frame identity — labeling before identity is settled would
  need re-mapping).

## Architectural Context

Plan 08 in full; matrix rows 34, 39, 42. Split rule: by golfer and source recording, never
adjacent frames across train/eval. Metrics are the plan's lists (club: PCK@2/5/10,
head-center median/p95, hosel, shaft angle, visible-frame P/R, FP rate, calibration, gap
count/duration, catastrophic jumps, reacquisition, impact-window error; events: exact/±1/±2/
±4, median/p95 ms, catastrophic + high-confidence-catastrophic, abstention, calibration —
reported per fps). Body labels: scoring/event frames + the joints current metrics consume,
not all-joints-all-frames.

## Files & Areas Touched

- `services/analyzer/groundtruth/` (new): `schemas/` (club_pose_labels, event_labels,
  trim_labels JSON Schemas), `evaluate_club.py`, `evaluate_events.py`, `evaluate_body.py`,
  `goldenset.py` (manifest + diff), `import_cvat.py`
- `services/analyzer/tests/` (harness integration; refreshed frozen inputs + goldens)
- `fixtures/` conventions (labels live beside clips, gitignored like footage; label MANIFEST
  committed)
- `docs/HANDOFF.md` (labeling + new-footage rows for Taylor)

## Steps

1. **Annotation schemas.** Club per native frame in labeled intervals: grip, shaft_mid,
   hosel, head_a, head_b + per-point visibility, occluded, out_of_frame, blur severity
   (none/mild/heavy/shaft_streak/head_streak/unusable), annotator confidence. Events per
   swing: address/top/impact/finish source frames + ms, optional takeaway, audio waveform
   region, ball last-present/first-moving, annotator confidence, second-annotator slot. Trim
   labels per RAW clip: all strike times, practice-swing intervals, chosen swing, true
   address→finish interval, audio quality, slow-mo facts. Freeze head_a/head_b definitions in
   an annotation manual (per club type) BEFORE labeling starts.
2. **Import path.** CVAT (or equivalent) export → schema validation → evaluator input. The
   tool is replaceable; the schema is not. Existing `head_markers` rows import as
   head-center-only labels (provenance `player_correction`).
3. **Evaluators.** Club/event/body metric families above; per-swing + aggregate reports;
   JSON + human table. Trace metric = frame-aligned point error over visible GT frames
   (smoothness explicitly diagnostic-only).
4. **Dataset tiers.** Golden manifest (start: the 10 fixtures + defect-class clips; grow),
   dev set, holdout (golfer- and recording-disjoint — needs new footage: HANDOFF rows for a
   face-on set, a left-handed golfer, outdoor, other clubs).
5. **Golden-set CI (WP-042).** One command runs analyzer over golden inputs (or frozen
   outputs where hardware-bound), evaluates against labels, diffs against the last accepted
   report; hard gates (frame-identity mismatch 0, propagated-as-direct 0, high-conf
   catastrophic impact miss 0) fail the run. Wire as a pytest marker + a script; not blocking
   default `pytest tests` runtime (~4 s stays).
6. **Label the existing ten fixtures' events** (frames + ms) — Claude does a first pass with
   `checkstrip.py` sheets; Taylor verifies (HANDOFF row). Club-position labeling for the
   golden active intervals is the long pole — start with impact-window ±12 frames per fixture,
   grow via the active-learning loop later (step 09).
7. **Refresh frozen test data + goldens** (`make_test_data.py --all`, `--update-golden`) —
   deliberately, reviewing diffs, since Stage 0 changed under them (retime/audio/cfr).

## Quality Standards / Verification

- Analyzer pytest green including evaluator unit tests (synthetic label/prediction pairs with
  known metric values).
- `evaluate_events.py` on the ten fixtures reproduces the known 7wood-1 40-frame impact miss
  from labels — the evaluator catches the known defect or it isn't working.
- Golden CI produces a byte-stable machine-readable report for identical inputs.

## Migration Considerations

None to production; internal-only (plan Phase B). Labeling effort is the schedule risk — the
step is complete when schemas/evaluators/CI + event labels for the ten fixtures exist; corpus
growth continues in the background via HANDOFF rows.

## Technical-Debt Impact

**Reduces** (retires "almost no accuracy number is verifiable"). No temporary mechanisms.

## Observability

The evaluation reports ARE the observability; stored under `groundtruth/reports/` with code/
model/policy versions stamped.

## Rollback

Internal tooling; revert freely.

## Cleanup

`tests/fixtures.json:hand_labeled` nulls replaced; the xfail fixture-count test updated to
track the golden manifest instead.
