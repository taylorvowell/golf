# 02 - Shared Data Model, Test Interface, and Registry

**Phase:** Phase 0 — Ground truth and shared infrastructure
**Status:** complete
**Estimated effort:** 1 day

## Overview

Every one of the 12 tracking tests consumes the same inputs (pose/grip, events, source
timing, video geometry) and must produce the same output shape so the evaluation harness
(step 04), the path-fit registry (step 05), and the `analysis.json` experiment schema
(step 06) can treat them interchangeably. This step builds that shared skeleton: the plan
§5 dataclasses, the §9 `ClubTrackingTest` protocol with its context/result types, and the
test registry keyed by the canonical 12 ids — with zero test implementations yet.

## Dependencies

- Step 01 must be complete (`SourceObservation` and the `source_timing.json` sidecar exist —
  this step *reuses* `swingsage.source_timing.SourceObservation`, never redefines it).

## Architectural Context

- Plan §5: `ClubObservation` (mode observed/mixed/inferred, source enum, visibility,
  optional covariance), `ClubCandidate` (features dict), `BlurTrajectoryObservation` (a blur
  interval is a segment, not a fake center point), `EventEvidence` (address/top/impact
  likelihood; `audio_event` never supplies x/y).
- Plan §9: `ClubTrackingTest` protocol — `id`, `label`, `version`, `run(ctx) -> result`.
  Tests remain isolated modules; shared expert adapters are allowed later.
- Plan §2.7: all geometry normalized [0,1], x right, y down, confidence-bearing, append-only.
- The canonical 12 test ids (t1_candidate_graph … t12_av_impact) become the single enum the
  later safe-reanalysis flow (plan §29) validates against — define them ONCE here.
- Registry style: a `@register` decorator populating `TESTS`, plus the full `TEST_IDS`
  id→label catalogue declared up front. `get_test()` on an unimplemented id raises a clear
  "declared but not implemented yet" error — the debug menu can then grey those out honestly
  rather than the registry pretending 12 trackers exist.
- Context assembly follows the same seam discipline as step 01: pure
  `ClubTrackingContext.from_artifacts(doc, timing_doc)` (hermetic-testable) + a thin
  `load(out_dir)` I/O wrapper.
- Keypoint indexing must go through `keypoint_names.index(...)`, never hardcoded indices
  (D25/D47 append-only order). Handedness rides along in the context (non-negotiable
  threading rule).

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/__init__.py` — new package, re-exports
- `services/analyzer/swingsage/club_tracking/model.py` — plan §5 dataclasses + serialization
- `services/analyzer/swingsage/club_tracking/interface.py` — protocol, context, result
- `services/analyzer/swingsage/club_tracking/registry.py` — TEST_IDS catalogue + registry
- `services/analyzer/tests/test_club_tracking_interface.py` — new hermetic tests

## Steps

1. **`model.py`**: `ClubObservation(frame, source_time_s, x, y, confidence, mode, source,
   visibility, covariance=None)`; `ClubCandidate(frame, source_time_s, x, y, confidence,
   source, features)`; `BlurTrajectoryObservation(frame, source_time_s, start_x, start_y,
   end_x, end_y, confidence)`; `EventEvidence(event, time_s, confidence, source)`. Each with
   `to_dict()`/`from_dict()`. Validate in `__post_init__`: mode/event enums, confidence in
   [0,1]. Declare the `source` vocabulary from plan §5.2 as a module constant
   (`KNOWN_SOURCES`) but accept unknown strings with a warning-free pass-through — experts
   added later must not require editing the model.
2. **`interface.py`**: `ClubTrackingContext` — video geometry (fps, frame_count, width,
   height, view, handedness), `grip: list[tuple[x, y, conf] | None]` extracted from pose
   frames via `keypoint_names.index("grip_center")`, the eight GolfDB event frames,
   `source_timing: SourceTiming | None`, `out_dir: Path | None`, and the raw `doc` for
   experts that need more. Pure `from_artifacts(doc, timing_doc=None)` classmethod; thin
   `load(out_dir)` reading `analysis.json` + `source_timing.json`. `ClubTrackingResult` —
   `test_id`, `label`, `version`, `observations: list[ClubObservation]`,
   `event_evidence: list[EventEvidence]`, `diagnostics: dict`, `to_dict()`.
   `ClubTrackingTest` as a `Protocol` (id/label/version attrs + `run`).
3. **`registry.py`**: `TEST_IDS: dict[str, str]` — the canonical 12 id→label pairs from plan
   §9/§27. `TESTS: dict[str, type]` populated by a `@register` decorator (asserts the id is
   in `TEST_IDS`, rejects duplicates). `get_test(test_id)` returns an instance; unknown id →
   `KeyError` listing valid ids; known-but-unimplemented → `NotImplementedError` naming the
   step that will build it. `available()` → sorted implemented ids.
4. **`__init__.py`**: re-export the dataclasses, context/result, `TEST_IDS`, `get_test`,
   `register`, `available`.
5. **Tests** (`test_club_tracking_interface.py`, hermetic): dataclass validation (bad mode /
   confidence rejected; covariance optional), serialization round-trips,
   `from_artifacts` on a synthesized minimal doc (grip extracted at the right index — build
   the synthetic `keypoint_names` with `grip_center` NOT at a hardcoded position; missing
   pose frame → None; handedness carried), registry mechanics (12 declared ids, 0
   implemented, duplicate registration rejected, unknown id error message lists ids,
   `@register` on a dummy test makes it `available()` and `get_test` returns a working
   instance whose `run` produces a serializable `ClubTrackingResult`).

## Quality Standards

- No I/O anywhere except `ClubTrackingContext.load`.
- No numpy dependency in model/interface (plain floats — experts convert at their edges).
- `EventEvidence` with source `audio_event` carrying coordinates is impossible by
  construction (it has no x/y fields) — keep it that way.
- The 12-id catalogue exists in exactly one place (`registry.TEST_IDS`); later TS enums
  (plan §29.1) will be generated from or checked against it, never a second hand copy.

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — full suite green including the new interface tests.
2. `python -c "from swingsage.club_tracking import TEST_IDS, available; assert len(TEST_IDS)==12; assert available()==[]; print('registry: 12 declared, 0 implemented')"`

## Definition of Done

- [ ] `pytest tests` exits 0 with `test_club_tracking_interface.py` collected and passing.
- [ ] `TEST_IDS` contains exactly the 12 canonical ids in plan §9.
- [ ] `get_test("t1_candidate_graph")` raises `NotImplementedError` (not `KeyError`);
      `get_test("nonsense")` raises `KeyError` naming the valid ids.
- [ ] `ClubTrackingContext.from_artifacts` works on a dict with no `source_timing` (None) —
      legacy artifacts must load.
- [ ] No existing file outside `swingsage/club_tracking/` + `tests/` modified.

## Notes

- `ClubTrackingResult` deliberately has no `trace`/`variants` field yet — path-fit variants
  are step 05's registry output, computed FROM a result's observations. Adding them here
  would bake in a shape before the fitting code exists.
- The `checkpoints`/`metrics` stages must never import this package — club tracking
  experiments are strictly downstream of the existing pipeline until a winner is
  productionized (step 20).
