"""Run one analysis job from a job-spec JSON.

Usage:
    python -m service.worker <spec.json>
    python -m service.worker -          # spec on stdin

The spec is a versioned JSON object mapping 1:1 onto `swingsage.pipeline.AnalysisRequest`
fields (same names, same defaults), plus a required `"schema": 1`:

    {"schema": 1, "video": "fixtures/pro_2.mp4", "view": "dtl", "handedness": "right",
     "club_detector": "runs/clubhead/weights/best.pt"}

Unknown fields are rejected, not ignored — a typo'd field silently falling back to a default
is how a job runs with the wrong handedness. `club_detector` follows the pipeline rule: no
default, ever; an omitted detector is the deliberate classical-only path.

Output protocol (new, additive — no existing consumer): the worker writes ONE JSON object
per line to stdout — `PipelineEvent`s plus a terminal `{"kind": "result", ...}` on success or
`{"kind": "failed", ...}` on refusal. Human-readable diagnostics go to stderr. Caveat: the
pipeline's own print() lines ALSO still reach stdout today, because they are the protocol
`apps/web/src/lib/jobs.ts` regex-parses and may not change shape yet. A consumer of this
module must therefore skip lines that do not parse as JSON objects; moving the prints behind
a flag is a later step of this track, once jobs.ts consumes events in-process.
"""
from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path
from typing import Any, Optional

from swingsage.pipeline import AnalysisRequest, PipelineError, PipelineEvent, run

SPEC_SCHEMA = 1

# Fields a spec may set, derived from the dataclass so the two can never drift.
_REQUEST_FIELDS = {f.name: f for f in dataclasses.fields(AnalysisRequest)}
# Path-typed fields need str -> Path coercion (json has no Path).
_PATH_FIELDS = {"video", "out_dir"}

_CHOICES = {
    "view": {"dtl", "face_on"},
    "handedness": {"right", "left"},
    "club_type": {"driver", "irons", None},
    "pose_model": {"mediapipe", "rtmpose"},
    "rtm_mode": {"performance", "balanced"},
    "club_detector_inject": {"none", "heads", "sticks", "both"},
}


class SpecError(ValueError):
    """A job spec that must not run: wrong schema, unknown field, bad value."""


def request_from_spec(spec: dict[str, Any]) -> AnalysisRequest:
    """Validate a job-spec dict and build the AnalysisRequest.

    Strict on purpose: unknown fields and wrong schema versions are refusals, because the
    caller is a machine (a queue consumer), and a machine's typo must fail loudly.
    """
    if not isinstance(spec, dict):
        raise SpecError("job spec must be a JSON object")
    schema = spec.get("schema")
    if schema != SPEC_SCHEMA:
        raise SpecError(f"unsupported job spec schema {schema!r} (expected {SPEC_SCHEMA})")

    body = {k: v for k, v in spec.items() if k != "schema"}
    unknown = sorted(set(body) - set(_REQUEST_FIELDS))
    if unknown:
        raise SpecError(f"unknown job spec field(s): {', '.join(unknown)}")
    if "video" not in body:
        raise SpecError("job spec is missing required field 'video'")

    kwargs: dict[str, Any] = {}
    for name, value in body.items():
        if name in _CHOICES and value not in _CHOICES[name]:
            allowed = sorted(str(c) for c in _CHOICES[name] if c is not None)
            raise SpecError(f"invalid {name}={value!r} (allowed: {', '.join(allowed)})")
        if name in _PATH_FIELDS and value is not None:
            if not isinstance(value, str):
                raise SpecError(f"{name} must be a string path")
            value = Path(value)
        kwargs[name] = value

    try:
        return AnalysisRequest(**kwargs)
    except TypeError as e:  # wrong types the loop above didn't catch
        raise SpecError(str(e)) from e


def _emit(obj: dict[str, Any], out=None) -> None:
    out = out or sys.stdout
    out.write(json.dumps(obj, separators=(",", ":")) + "\n")
    out.flush()


def event_line(ev: PipelineEvent) -> dict[str, Any]:
    """A PipelineEvent as a JSON-safe dict, Nones dropped."""
    d = {"kind": ev.kind, "stage": ev.stage}
    if ev.message is not None:
        d["message"] = ev.message
    if ev.done is not None:
        d["done"] = ev.done
    if ev.total is not None:
        d["total"] = ev.total
    return d


def run_spec(spec: dict[str, Any], out=None) -> int:
    """Run one job spec; emit JSON-line events; return the process exit code."""
    try:
        req = request_from_spec(spec)
    except SpecError as e:
        _emit({"kind": "failed", "reason": str(e), "where": "spec"}, out)
        return 2

    try:
        result = run(req, on_event=lambda ev: _emit(event_line(ev), out))
    except PipelineError as e:
        # Same failure text the CLI exits with; the reason is user-readable by contract.
        _emit({"kind": "failed", "reason": str(e), "where": "pipeline"}, out)
        return 1

    _emit(
        {
            "kind": "result",
            "out_dir": str(result.out_dir),
            "artifacts": [str(p) for p in result.artifacts],
            "schema_version": result.schema_version,
            "elapsed_s": result.elapsed_s,
            "warnings": list(result.warnings),
        },
        out,
    )
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: python -m service.worker <spec.json | ->", file=sys.stderr)
        return 2
    raw = sys.stdin.read() if argv[0] == "-" else Path(argv[0]).read_text(encoding="utf-8")
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as e:
        _emit({"kind": "failed", "reason": f"spec is not valid JSON: {e}", "where": "spec"})
        return 2
    return run_spec(spec)


if __name__ == "__main__":
    raise SystemExit(main())
