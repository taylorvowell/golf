"""Tests for Stage 8 (doc 05 Part C1) — the deterministic scoring engine.

Same golden-snapshot + invariant split as `test_stages.py`, plus a structural test that reuses
`scripts/validate_scoring_config.py`'s `validate()` directly so a config edit that breaks a
field reference fails the suite, not just a manual script run (CLAUDE.md's "how do we update
criteria" answer — see the plan's Phase 2).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from conftest import assert_golden  # noqa: E402
from swingsage import checkpoints, events, metrics, scoring  # noqa: E402
import validate_scoring_config  # noqa: E402


def _score(frozen):
    v = frozen["video"]
    res, sg = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    cps = checkpoints.build(res, sg, frozen["pose"]["frames"], v["handedness"], club=None,
                            n_frames=len(frozen["pose"]["frames"]))
    mt = metrics.compute(frozen["pose"]["frames"], res, v["view"], v["handedness"],
                         aspect=v["width"] / v["height"], fps=v["fps"],
                         club_frames=frozen.get("club_frames"), checkpoints=cps)
    cfg = scoring.load_config()
    report = scoring.compute(cfg, mt["checkpoints"], mt["summary"], mt["glossary"],
                             res["tempo"], v["view"], club_type="irons")
    return report, cfg


def test_scoring_config_validates():
    """The config that ships must resolve against the real pipeline — the same check
    `scripts/validate_scoring_config.py` runs standalone, wired into the suite so it can't be
    forgotten before a commit."""
    cfg = scoring.load_config()
    errors = validate_scoring_config.validate(cfg)
    assert not errors, (f"scoring_config/{cfg['version']}.json has unresolved fields:\n  "
                        + "\n  ".join(errors))


def test_scorecard_golden(request, fx, frozen):
    """Snapshot of the full scorecard over frozen pose/club data — proves the scoring engine
    hasn't drifted, the same way test_stages.py's snapshots do for the stages underneath it."""
    report, _ = _score(frozen)
    assert_golden(request, f"{fx['stem']}.scorecard", report)


def test_scorecard_invariants(fx, frozen):
    """Contract invariants that need no golden file, so they keep working as fixtures are
    added — mirrors test_invariants.py's role for the deterministic stages below Stage 8."""
    report, cfg = _score(frozen)

    if report["overall"] is not None:
        assert 0.0 <= report["overall"] <= 100.0
        assert report["band"] in {"Elite", "Pure", "Solid", "Building", "Reset"}

    seen_ids = set()
    for cat_name, cat in report["categories"].items():
        assert cat_name in cfg["categories"]
        assert cat["n_measurable"] <= cat["n_total"]
        if cat["score"] is not None:
            assert 0.0 <= cat["score"] <= 100.0
            assert cat["n_measurable"] > 0
        else:
            assert cat["n_measurable"] == 0

        for check in cat["checks"]:
            assert check["id"] not in seen_ids, f"{check['id']} scored in two categories"
            seen_ids.add(check["id"])
            # A check is either scored with a real value, or skipped with a reason — never both
            # states at once, and never a score with no explanation for why it's absent.
            if check["score"] is None:
                assert check["skip_reason"], f"{check['id']} has no score AND no skip_reason"
            else:
                assert 0.0 <= check["score"] <= 100.0
                assert check["skip_reason"] is None
                # Leverage exists for every scored check and is built from real, bounded parts.
                assert 0.0 <= check["leverage"] <= 100.0
                lb = check["leverage_breakdown"]
                assert 0.0 <= lb["severity"] <= 100.0
                assert 1.0 <= lb["impact"] <= 100.0
                assert 0.0 <= lb["ease"] <= 100.0
                # A check exactly on target has nothing to fix; a check outside the band always
                # does — advice is the thing that must never be wrong-direction silently.
                if check["score"] >= 100.0:
                    assert check["advice"] is None
                else:
                    assert check["advice"], f"{check['id']} scored below 100 with no advice"

    # Every check in the config appears in exactly one category's results.
    assert seen_ids == {c["id"] for c in cfg["checks"]}

    for p, cp in report["checkpoints"].items():
        assert cp["n_measurable"] > 0  # only present in the rail when something scored there
        assert 0.0 <= cp["score"] <= 100.0
        assert cp["p"] == p


def test_scoring_is_deterministic(frozen):
    """Same input twice, same scorecard — guards the same class of bug D-era history already
    found once in events.detect (test_stages.py's test_determinism)."""
    a, _ = _score(frozen)
    b, _ = _score(frozen)
    assert a == b


def test_club_type_gating(frozen):
    """A club-scoped check (e.g. ANG-56, irons-only) must be skipped, not scored, when the
    swing's club type is unknown — doc 05 C1's "club-type aware targets" requirement."""
    v = frozen["video"]
    res, sg = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    cps = checkpoints.build(res, sg, frozen["pose"]["frames"], v["handedness"], club=None,
                            n_frames=len(frozen["pose"]["frames"]))
    mt = metrics.compute(frozen["pose"]["frames"], res, v["view"], v["handedness"],
                         aspect=v["width"] / v["height"], fps=v["fps"],
                         club_frames=frozen.get("club_frames"), checkpoints=cps)
    cfg = scoring.load_config()

    report_unknown = scoring.compute(cfg, mt["checkpoints"], mt["summary"], mt["glossary"],
                                     res["tempo"], v["view"], club_type=None)
    club_scoped = [c for c in cfg["checks"] if c["club"] != "both"]
    assert club_scoped, "expected at least one club-scoped check in the config"

    scored_ids = {
        c["id"] for cat in report_unknown["categories"].values() for c in cat["checks"]
        if c["score"] is not None
    }
    for check in club_scoped:
        assert check["id"] not in scored_ids, (
            f"{check['id']} is scoped to club={check['club']} but scored with no club type set")
