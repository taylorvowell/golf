"""Experiment results in the artifact: the `club_tracking` block (plan §25) + atomic merge.

The block is APPEND-ONLY and OPTIONAL — it appears the first time an experiment merges, and
a legacy artifact simply lacks it. Keys are snake_case to match the rest of analysis.json
(the plan's sketch is camelCase; artifact consistency wins — D55). burnin's SCHEMA_VERSION
is untouched for the same reason resegment's posture patch leaves it alone: the artifact
gains an optional block, it does not assert a new full-contract version.

Merging is single-writer per swing (plan §29.7): a stale-safe lock file beside the
artifact, tmp write, os.replace. Two tests can never partially overwrite each other.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .interface import ClubTrackingContext, ClubTrackingResult

BLOCK_KEY = "club_tracking"
BLOCK_SCHEMA_VERSION = 1
LOCK_NAME = ".experiment.lock"
LOCK_STALE_S = 300
SPLIT_GAP_S = 0.15   # inferred bridge at top longer than this -> split_at_top (plan §2.4)


def split_gate(default_variant: list[dict], top_frame: int, fps: float) -> str:
    """`continuous` unless the default fit bridges the top on inferred samples for longer
    than SPLIT_GAP_S — the plan's 'bridging would create an unjustified trajectory' rule.
    Minimum viable §23 gate; the full quality metrics land with a real tracker."""
    if not default_variant:
        return "continuous"
    run = 0
    best_run_touching_top = 0
    run_start = None
    for p in default_variant:
        if p["mode"] == "inferred":
            if run == 0:
                run_start = p["frame"]
            run += 1
            if run_start is not None and run_start <= top_frame <= p["frame"]:
                best_run_touching_top = max(best_run_touching_top, run)
        else:
            run = 0
            run_start = None
    return "split_at_top" if best_run_touching_top / fps > SPLIT_GAP_S else "continuous"


def build_experiment(result: ClubTrackingResult, ctx: ClubTrackingContext,
                     variants: dict[str, list[dict]],
                     models: dict[str, str] | None = None) -> dict:
    """Assemble one experiment entry (plan §25 shape, snake_case)."""
    ev_frames = dict(ctx.events)
    ev_confs = dict(ctx.event_confs)
    # A test's own event evidence overrides the artifact's frames for the big three.
    refined: dict[str, tuple[float, float]] = {}
    for e in result.event_evidence:
        cur = refined.get(e.event)
        if cur is None or e.confidence > cur[1]:
            refined[e.event] = (e.time_s, e.confidence)

    def event_entry(name: str) -> dict | None:
        if name in refined:
            t, c = refined[name]
            frame = int(round(t * ctx.fps))
            return {"frame": frame, "time_s": round(t, 5), "confidence": round(c, 3),
                    "source": "experiment"}
        if name in ev_frames:
            f = ev_frames[name]
            return {"frame": f, "time_s": round(f / ctx.fps, 5),
                    "confidence": round(ev_confs.get(name, 0.0), 3),
                    "source": "artifact"}
        return None

    events = {n: e for n in ("address", "top", "impact")
              if (e := event_entry(n)) is not None}
    address_f = events.get("address", {}).get("frame")
    top_f = events.get("top", {}).get("frame")
    impact_f = events.get("impact", {}).get("frame")

    phase_spans = {}
    if address_f is not None and top_f is not None:
        phase_spans["backswing"] = {"start_frame": address_f, "end_frame": top_f,
                                    "color_role": "backswing"}
    if top_f is not None and impact_f is not None:
        phase_spans["downswing"] = {"start_frame": top_f, "end_frame": impact_f,
                                    "color_role": "downswing"}

    display_mode = ("continuous" if top_f is None else
                    split_gate(variants.get("default", []), top_f, ctx.fps))

    timing = ctx.source_timing
    source_summary = ({"nominal_fps": timing.nominal_fps,
                       "distinct_observation_count": timing.distinct_observation_count,
                       "has_audio": timing.has_audio}
                      if timing is not None else None)

    obs_modes = [o.mode for o in result.observations]
    return {
        "test": {"id": result.test_id, "label": result.label,
                 "version": result.version},
        "models": models or {},
        "source_timing": source_summary,
        "events": events,
        "trace": {
            "display_mode": display_mode,
            "phase_spans": phase_spans,
            "variants": variants,
        },
        "diagnostics": {
            **result.diagnostics,
            "observation_count": len(result.observations),
            "observed_fraction": round(
                obs_modes.count("observed") / len(obs_modes), 4) if obs_modes else 0.0,
        },
    }


class _MergeLock:
    """Single writer per swing artifact (plan §29.7). Stale locks are broken by age."""

    def __init__(self, out_dir: Path):
        self.path = out_dir / LOCK_NAME

    def __enter__(self):
        deadline = time.time() + 30
        while True:
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > LOCK_STALE_S:
                        self.path.unlink(missing_ok=True)
                        continue
                except OSError:
                    continue
                if time.time() > deadline:
                    raise TimeoutError(f"could not acquire {self.path}")
                time.sleep(0.2)

    def __exit__(self, *exc):
        self.path.unlink(missing_ok=True)
        return False


def merge_experiment(out_dir: str | Path, experiment: dict) -> Path:
    """Merge one experiment into out_dir/analysis.json atomically. Replaces only its own
    `experiments[test_id]` entry; every other artifact key is untouched."""
    out_dir = Path(out_dir)
    analysis = out_dir / "analysis.json"
    test_id = experiment["test"]["id"]
    with _MergeLock(out_dir):
        doc = json.loads(analysis.read_text(encoding="utf-8"))
        block = doc.setdefault(BLOCK_KEY, {"schema_version": BLOCK_SCHEMA_VERSION,
                                           "experiments": {}})
        block["experiments"][test_id] = experiment
        tmp = out_dir / "analysis.json.tmp"
        tmp.write_text(json.dumps(doc), encoding="utf-8")
        os.replace(tmp, analysis)
    return analysis
