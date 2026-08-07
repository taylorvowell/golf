"""Validates scoring_config/*.json against what the analyzer actually computes.

This is the concrete guard behind CLAUDE.md's "how do we update criteria" answer (see the
plan's Phase 2): a config that references a field `metrics.py` doesn't produce should fail
loudly here, not silently score `null` forever in production. Runs the real Stage 5/5b/6
pipeline (`events.detect` -> `checkpoints.build` -> `metrics.compute`) over one frozen fixture
— the same frozen input `tests/test_stages.py`'s golden snapshots replay over — so this checks
real field names, not a hand-maintained whitelist that could drift from `metrics.py`.

Usage:
    .venv/Scripts/python.exe scripts/validate_scoring_config.py [scoring_config/v2.json]

Exit code is nonzero on any unresolved field, so this is safe to wire into CI / pytest
(`tests/test_scoring.py` imports `validate()` directly for exactly that).
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from swingsage import checkpoints as checkpoints_mod, events, metrics  # noqa: E402

VALID_SOURCES = {"checkpoint", "checkpoint_delta", "summary", "glossary", "tempo"}
VALID_KINDS = {"band", "categorical"}
VALID_CATEGORIES = {
    "setup_posture", "takeaway", "backswing_top", "transition_tempo",
    "downswing_plane", "impact", "follow_through_balance",
}
VALID_CLUBS = {"both", "driver", "irons"}
VALID_VIEWS = {"both", "dtl", "face_on"}
CHECKPOINT_IDS = {p for p, *_ in checkpoints_mod.CHECKPOINTS}


def _load_frozen(stem: str) -> dict:
    path = ROOT / "tests" / "data" / f"{stem}.input.json.gz"
    if not path.exists():
        raise SystemExit(
            f"no frozen fixture data at {path} — run scripts/make_test_data.py --all first"
        )
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def compute_reference(stem: str = "swing1"):
    """Runs the real pipeline once, returning (checkpoint_values_by_p, summary, glossary, tempo).

    `checkpoint_values_by_p` unions every checkpoint's `values` dict — a field only needs to
    exist at ONE checkpoint's frame to be a real field name; whether a specific check's chosen
    checkpoint is a sensible place to read it is a review question, not a structural one.
    """
    frozen = _load_frozen(stem)
    v = frozen["video"]
    res, sg = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    cps = checkpoints_mod.build(res, sg, frozen["pose"]["frames"], v["handedness"],
                                club=None, n_frames=len(frozen["pose"]["frames"]))
    mt = metrics.compute(frozen["pose"]["frames"], res, v["view"], v["handedness"],
                         aspect=v["width"] / v["height"], fps=v["fps"],
                         club_frames=frozen.get("club_frames"), checkpoints=cps)

    values_by_p = {}
    for item in mt["checkpoints"]:
        values_by_p[item["p"]] = set(item["values"].keys())
    return values_by_p, set(mt["summary"].keys()), set(mt["glossary"].keys()), set(res["tempo"].keys())


def validate(config: dict, values_by_p=None, summary_keys=None, glossary_keys=None,
             tempo_keys=None) -> list[str]:
    """Returns a list of error strings; empty means the config is structurally sound."""
    if values_by_p is None:
        values_by_p, summary_keys, glossary_keys, tempo_keys = compute_reference()

    errors = []
    seen_ids = set()
    for check in config.get("checks", []):
        cid = check.get("id", "<missing id>")
        if cid in seen_ids:
            errors.append(f"{cid}: duplicate check id")
        seen_ids.add(cid)

        if check.get("category") not in VALID_CATEGORIES:
            errors.append(f"{cid}: unknown category {check.get('category')!r}")
        if check.get("club") not in VALID_CLUBS:
            errors.append(f"{cid}: unknown club {check.get('club')!r}")
        if check.get("view") not in VALID_VIEWS:
            errors.append(f"{cid}: unknown view {check.get('view')!r}")
        if not (1 <= check.get("weight", 0) <= 100):
            errors.append(f"{cid}: weight {check.get('weight')!r} outside 1-100")

        kind = check.get("kind")
        if kind not in VALID_KINDS:
            errors.append(f"{cid}: unknown kind {kind!r}")
            continue

        source = check.get("source")
        if source not in VALID_SOURCES:
            errors.append(f"{cid}: unknown source {source!r}")
            continue

        field = check.get("field")
        if source in ("checkpoint", "checkpoint_delta"):
            # A delta reads the SAME field at two checkpoints, so both ends have to resolve —
            # a valid `checkpoint` against a typo'd `ref_checkpoint` would silently never score.
            ps = [check.get("checkpoint")]
            if source == "checkpoint_delta":
                if not check.get("ref_checkpoint"):
                    errors.append(f"{cid}: checkpoint_delta needs a ref_checkpoint")
                else:
                    ps.append(check["ref_checkpoint"])
            for p in ps:
                if p not in CHECKPOINT_IDS:
                    errors.append(f"{cid}: checkpoint {p!r} is not a real P-code")
                elif field not in values_by_p.get(p, set()):
                    errors.append(f"{cid}: field {field!r} not found at checkpoint {p} "
                                  f"(metrics.per_frame does not emit this key)")
        elif source == "summary" and field not in summary_keys:
            errors.append(f"{cid}: field {field!r} not in metrics.summary")
        elif source == "glossary" and field not in glossary_keys:
            errors.append(f"{cid}: field {field!r} not in metrics.glossary")
        elif source == "tempo" and field not in tempo_keys:
            errors.append(f"{cid}: field {field!r} not in analysis.tempo")

        if kind == "band":
            b = check.get("band") or {}
            if not ("min" in b and "max" in b and "falloff" in b):
                errors.append(f"{cid}: band check missing min/max/falloff")
            elif b["min"] > b["max"]:
                errors.append(f"{cid}: band min > max ({b['min']} > {b['max']})")
            elif b.get("falloff", 0) <= 0:
                errors.append(f"{cid}: band falloff must be > 0")
        elif kind == "categorical" and not check.get("good_values"):
            errors.append(f"{cid}: categorical check has no good_values")

        guard = check.get("guard_field")
        if guard and check.get("source") in ("checkpoint", "checkpoint_delta"):
            p = check.get("checkpoint")
            if guard not in values_by_p.get(p, set()):
                errors.append(f"{cid}: guard_field {guard!r} not found at checkpoint {p}")

    return errors


def main():
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        ROOT / "scoring_config" / "v2.json")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    errors = validate(config)
    if errors:
        print(f"{len(errors)} problem(s) in {config_path.name}:")
        for e in errors:
            print(f"  - {e}")
        raise SystemExit(1)
    print(f"{config_path.name}: {len(config.get('checks', []))} checks, all fields resolve "
          f"against the real pipeline output.")


if __name__ == "__main__":
    main()
