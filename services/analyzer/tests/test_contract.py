"""The analyzer refuses to write an artifact that does not match the shared contract.

This is the producing-side half of `packages/schema`. The TypeScript side validates what it
reads; this validates what is written, which is the only place a break is cheap. Once a native
build is in a store it cannot be force-updated, so an artifact whose shape changed renders wrong
on every old client for months.

Two things are asserted here and nowhere else:

* the schemas the analyzer validates against are the SAME FILES the TypeScript types are
  generated from — not a copy, because a copy is a thing that can drift
* a deliberately-broken artifact is rejected BEFORE it reaches disk

The real `out/<stem>/analysis.json` artifacts are the input where they exist. They are gitignored
and therefore absent in CI, so those cases skip rather than fail — the synthetic cases below
carry the invariants that must hold with no fixtures at all.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import contract  # noqa: E402

pytestmark = pytest.mark.skipif(not contract.available(),
                                reason="jsonschema not installed in this venv")

ANALYZER_ROOT = Path(__file__).resolve().parents[1]
# None when the analyzer ships without the monorepo around it (the worker container) — there
# SWINGSAGE_SCHEMA_DIR points at the schemas the image carries.
REPO_ROOT = ANALYZER_ROOT.parents[1] if len(ANALYZER_ROOT.parents) >= 2 else None
OUT = ANALYZER_ROOT / "out"


def _artifacts(name: str) -> list[tuple[str, dict]]:
    if not OUT.is_dir():
        return []
    found = []
    for d in sorted(OUT.iterdir()):
        p = d / name
        if p.exists():
            found.append((d.name, json.loads(p.read_text(encoding="utf-8"))))
    return found


ANALYSES = _artifacts("analysis.json")
REPORTS = _artifacts("coach_report.json")
SILHOUETTES = _artifacts("silhouette.json")

needs_artifacts = pytest.mark.skipif(not ANALYSES, reason="no out/<stem>/analysis.json on disk")


@pytest.fixture
def sample() -> dict:
    if not ANALYSES:
        pytest.skip("no out/<stem>/analysis.json on disk")
    return copy.deepcopy(ANALYSES[0][1])


def _broken(doc: dict, mutate) -> dict:
    out = copy.deepcopy(doc)
    mutate(out)
    return out


def test_schemas_are_the_shared_ones_not_a_copy():
    """`packages/schema/schemas/` or nothing. A second copy is how a contract silently forks.

    In the worker container there is no monorepo — SWINGSAGE_SCHEMA_DIR must point at the
    schemas the image ships (copied from the same shared files at build time).
    """
    import os

    override = os.environ.get("SWINGSAGE_SCHEMA_DIR")
    if override:
        assert contract.schema_dir() == Path(override)
    else:
        assert REPO_ROOT is not None, "no monorepo and no SWINGSAGE_SCHEMA_DIR set"
        assert contract.schema_dir() == REPO_ROOT / "packages" / "schema" / "schemas"
    for name in ("analysis", "coach-report", "silhouette"):
        assert (contract.schema_dir() / f"{name}.schema.json").exists()


@pytest.mark.parametrize("stem,doc", ANALYSES, ids=[s for s, _ in ANALYSES] or ["none"])
@needs_artifacts
def test_every_stored_analysis_validates(stem, doc):
    """The schema is only worth anything if the pipeline's own output passes it."""
    assert contract.errors("analysis", doc) == []


@pytest.mark.parametrize("stem,doc", REPORTS, ids=[s for s, _ in REPORTS] or ["none"])
@pytest.mark.skipif(not REPORTS, reason="no coach_report.json on disk")
def test_every_stored_coach_report_validates(stem, doc):
    assert contract.errors("coach-report", doc) == []


@pytest.mark.parametrize("stem,doc", SILHOUETTES, ids=[s for s, _ in SILHOUETTES] or ["none"])
@pytest.mark.skipif(not SILHOUETTES, reason="no silhouette.json on disk")
def test_every_stored_silhouette_validates(stem, doc):
    assert contract.errors("silhouette", doc) == []


def test_rejects_a_missing_event(sample):
    assert contract.errors("analysis", _broken(sample, lambda d: d["events"].pop("impact")))


def test_rejects_a_club_head_that_stopped_being_a_pair(sample):
    """The break that motivates the whole step: a shape change that still looks like data.

    A three-element head renders as a club in the wrong place on every shipped client, with no
    error anywhere — exactly the failure a type system on one side cannot catch.
    """
    frames = (sample.get("club") or {}).get("frames") or []
    if not any(f.get("head") for f in frames):
        pytest.skip("fixture has no detected club head")

    def mutate(d):
        for f in d["club"]["frames"]:
            if f.get("head"):
                f["head"] = [*f["head"], 0.5]
                return

    assert contract.errors("analysis", _broken(sample, mutate))


def test_rejects_keypoints_that_became_strings(sample):
    def mutate(d):
        d["pose"]["frames"][0]["kp"][0] = ["0.5", "0.5", "0.9"]

    assert contract.errors("analysis", _broken(sample, mutate))


def test_rejects_a_shortened_keypoint_block(sample):
    bad = _broken(sample, lambda d: d["pose"].update(keypoint_names=["nose", "neck"]))
    assert contract.errors("analysis", bad)


def test_accepts_an_artifact_that_gains_an_unknown_field(sample):
    """Additive evolution, from the producer's side. A future schema must not fail today's check."""
    forward = _broken(sample, lambda d: d.update(some_future_block={"anything": True}))
    forward["schema_version"] = 99
    assert contract.errors("analysis", forward) == []


def test_write_json_refuses_to_write_a_broken_artifact(tmp_path, sample):
    """The bad artifact must never reach disk — a written file is one a client can read."""
    target = tmp_path / "analysis.json"
    bad = _broken(sample, lambda d: d["events"].pop("top"))
    with pytest.raises(contract.ContractError):
        contract.write_json("analysis", bad, target)
    assert not target.exists()
    assert not list(tmp_path.glob("*.tmp"))


def test_write_json_writes_and_is_readable(tmp_path, sample):
    target = tmp_path / "analysis.json"
    contract.write_json("analysis", sample, target)
    assert json.loads(target.read_text(encoding="utf-8"))["schema_version"] == \
        sample["schema_version"]


def test_coach_report_schema_rejects_a_report_with_no_model_version():
    """No `scoring_model_version` means a score nobody can reproduce — the one field that
    makes an old report re-derivable against the config it was scored with."""
    assert contract.errors("coach-report", {"view": "dtl", "overall": 70})


def test_errors_lists_more_than_one_problem():
    """One fix per round trip is the failure mode `allErrors` exists to avoid."""
    assert len(contract.errors("analysis", {"schema_version": 0, "pose": []})) > 1


def test_frozen_fixture_pose_block_still_matches_the_contract(frozen):
    """The frozen INPUT is not a whole artifact, but its `pose` block is the contract's.

    Worth checking separately: `make_test_data.py` freezes these from real artifacts, so a
    change to the pose shape that skipped the schema would show up here even with `out/` gone.
    """
    schema = contract.load_schema("analysis")
    from jsonschema import Draft7Validator

    pose_schema = {**schema["definitions"]["pose"], "definitions": schema["definitions"]}
    assert list(Draft7Validator(pose_schema).iter_errors(frozen["pose"])) == []


def test_an_error_message_is_a_diagnosis_not_a_dump(sample):
    """A 1.4 MB error is worse than none — it buries the one line that says what broke.

    `T | null` is an `anyOf`, so jsonschema reports a bad value inside `T` at the PARENT with the
    whole parent as the instance. On a real artifact that printed the entire `club` block.
    """
    def mutate(d):
        for f in d["club"]["frames"]:
            if f.get("head"):
                f["head"] = [*f["head"], 0.5]
                return

    frames = (sample.get("club") or {}).get("frames") or []
    if not any(f.get("head") for f in frames):
        pytest.skip("fixture has no detected club head")

    problems = contract.errors("analysis", _broken(sample, mutate))
    assert problems
    assert all(len(p) < 400 for p in problems), problems[0][:200]
    # And it names the field that actually broke, not the block containing it.
    assert any("/club/frames/" in p and "head" in p for p in problems), problems
