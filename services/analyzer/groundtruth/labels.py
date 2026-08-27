"""Load and validate ground-truth label files against their frozen schemas."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import jsonschema

SCHEMA_DIR = Path(__file__).parent / "schemas"

# Canonical temporal order of labelable events: the artifact's eight GolfDB
# events plus takeaway (which the artifact does not emit).
EVENT_ORDER = (
    "address",
    "takeaway",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
)

# schema name (the "schema" field inside a label file) -> schema file
SCHEMAS = {
    "club-pose-labels": "club-pose-labels.schema.json",
    "event-labels": "event-labels.schema.json",
    "trim-labels": "trim-labels.schema.json",
    "body-pose-labels": "body-pose-labels.schema.json",
}


@lru_cache(maxsize=None)
def _schema(name: str) -> dict:
    if name not in SCHEMAS:
        raise KeyError(f"unknown label schema {name!r}; known: {sorted(SCHEMAS)}")
    with open(SCHEMA_DIR / SCHEMAS[name], encoding="utf-8") as f:
        return json.load(f)


def validate(doc: dict) -> str:
    """Validate a label document against the schema its 'schema' field names.

    Returns the schema name on success; raises jsonschema.ValidationError (or
    KeyError for an unknown/missing schema name) on failure.
    """
    name = doc.get("schema")
    if not isinstance(name, str):
        raise KeyError("label document has no 'schema' field")
    jsonschema.validate(doc, _schema(name))
    _check_semantics(name, doc)
    return name


def load(path: str | Path) -> dict:
    """Load one label file, validated. Raises on schema violation."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    try:
        validate(doc)
    except jsonschema.ValidationError as e:
        raise jsonschema.ValidationError(f"{path}: {e.message}") from e
    return doc


def _check_semantics(name: str, doc: dict) -> None:
    """Cross-field rules JSON Schema can't express."""
    if name == "club-pose-labels":
        for iv in doc["labeled_intervals"]:
            if iv["end_frame"] < iv["start_frame"]:
                raise jsonschema.ValidationError(
                    f"labeled interval end {iv['end_frame']} < start {iv['start_frame']}"
                )
        rows = {f["frame"] for f in doc["frames"]}
        for iv in doc["labeled_intervals"]:
            missing = [n for n in range(iv["start_frame"], iv["end_frame"] + 1) if n not in rows]
            if missing:
                raise jsonschema.ValidationError(
                    f"labeled interval {iv['start_frame']}-{iv['end_frame']} has no row for "
                    f"frames {missing[:5]}{'...' if len(missing) > 5 else ''} - every frame in a "
                    "committed interval needs a row (blur='unusable' if nothing is defensible)"
                )
        direct_head_ok = doc.get("provenance") == "player_correction"
        for row in doc["frames"]:
            if row["blur"] == "unusable" and row["points"]:
                raise jsonschema.ValidationError(
                    f"frame {row['frame']}: blur='unusable' must carry no points"
                )
            if row.get("head_hidden") and row["points"]:
                raise jsonschema.ValidationError(
                    f"frame {row['frame']}: head_hidden must carry no points - "
                    "'not visible' and 'at (x,y)' are mutually exclusive statements"
                )
            if "head_center" in row["points"] and not direct_head_ok:
                raise jsonschema.ValidationError(
                    f"frame {row['frame']}: head_center is direct-labeled only for "
                    "provenance='player_correction'; manual labels derive it from head_a/head_b"
                )
    elif name == "event-labels":
        ev = doc["events"]
        order = [
            ev[k]["frame"]
            for k in EVENT_ORDER
            if ev.get(k) and ev[k]["frame"] is not None
        ]
        if order != sorted(order):
            raise jsonschema.ValidationError(f"event frames out of order: {order}")
    elif name == "trim-labels":
        chosen = doc.get("chosen_swing_ms")
        strikes = doc["strikes_ms"]
        if chosen is not None and chosen not in strikes:
            raise jsonschema.ValidationError(
                f"chosen_swing_ms {chosen} is not a member of strikes_ms"
            )
        if chosen is None and len(strikes) > 1:
            raise jsonschema.ValidationError(
                "chosen_swing_ms is required when a raw clip has more than one strike"
            )
