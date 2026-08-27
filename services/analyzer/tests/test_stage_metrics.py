"""Stage telemetry: the span tracker, the accumulator, and the one vocabulary.

The property under test throughout is ATTRIBUTION — that the seconds reported per stage add up
to the job, that nesting does not double-count them, and that whatever is left over is stated
rather than hidden. A telemetry record that always looked fully accounted-for would be useless
for the thing this step exists to enable.
"""

import json
from pathlib import Path

import pytest

from swingsage import stages


def _collect():
    """A fake emitter: returns (events list, emit callable) in the pipeline's shape."""
    events: list[tuple] = []

    def emit(kind, stage, **fields):
        events.append((kind, stage, fields))
    return events, emit


# ------------------------------------------------------------------ SpanTracker

def test_span_measures_and_reports_depth_zero():
    events, emit = _collect()
    t = stages.SpanTracker(emit)
    with t.span("normalize"):
        pass
    kinds = [(k, s) for k, s, _ in events]
    assert kinds == [("stage_started", "normalize"), ("stage_done", "normalize")]
    done = events[-1][2]
    assert done["elapsed_s"] >= 0.0 and done["depth"] == 0


def test_nested_span_reports_depth_one_and_parent_keeps_full_duration():
    """`variants` runs INSIDE `club`. The parent's span must still cover the child's time —
    the pre-existing bench accumulator closed a span when the next one opened, charging club
    only the time before variants began."""
    events, emit = _collect()
    t = stages.SpanTracker(emit)
    with t.span("club"):
        with t.span("variants"):
            pass
        assert t.depth == 1  # back inside club, not closed by the child
    spans = {s: f for k, s, f in events if k == "stage_done"}
    assert spans["variants"]["depth"] == 1
    assert spans["club"]["depth"] == 0
    assert spans["club"]["elapsed_s"] >= spans["variants"]["elapsed_s"]


def test_span_reports_time_even_when_the_stage_raises():
    """The span you most want on a failed job is the one that failed."""
    events, emit = _collect()
    t = stages.SpanTracker(emit)
    with pytest.raises(ValueError):
        with t.span("club"):
            raise ValueError("boom")
    assert events[-1][0] == "stage_done" and events[-1][1] == "club"
    assert events[-1][2]["elapsed_s"] is not None
    assert t.depth == 0  # the stack unwound; a later span is not reported as nested


def test_unbalanced_end_does_not_raise():
    """A bookkeeping bug must never take down a run that is producing a correct artifact."""
    events, emit = _collect()
    t = stages.SpanTracker(emit)
    t.end("never_started")
    assert events[-1][0] == "stage_done"


# ---------------------------------------------------------------- accumulation

class _Ev:
    def __init__(self, kind, stage, elapsed_s=None, frames=None, depth=0):
        self.kind, self.stage = kind, stage
        self.elapsed_s, self.frames, self.depth = elapsed_s, frames, depth


def test_nested_seconds_are_not_added_to_the_total():
    acc = stages.StageAccumulator()
    acc.on_event(_Ev("stage_done", "club", elapsed_s=10.0))
    acc.on_event(_Ev("stage_done", "variants", elapsed_s=7.0, depth=1))
    acc.on_event(_Ev("stage_done", "render", elapsed_s=2.0))
    # 10 + 2, NOT 10 + 7 + 2 — variants' seconds are already inside club's.
    assert acc.attributed_s() == pytest.approx(12.0)
    rec = acc.record(total_s=12.5)
    assert rec["attributedS"] == 12.0
    assert rec["unattributedS"] == pytest.approx(0.5)
    assert rec["attributedPct"] == pytest.approx(96.0)


def test_record_states_the_remainder_rather_than_hiding_it():
    acc = stages.StageAccumulator()
    acc.on_event(_Ev("stage_done", "pose", elapsed_s=10.0))
    rec = acc.record(total_s=100.0)
    assert rec["unattributedS"] == 90.0 and rec["attributedPct"] == 10.0


def test_a_re_entered_stage_sums_rather_than_overwrites():
    acc = stages.StageAccumulator()
    acc.on_event(_Ev("stage_done", "pose", elapsed_s=3.0, frames=100))
    acc.on_event(_Ev("stage_done", "pose", elapsed_s=4.0, frames=50))
    span = acc.spans["pose"]
    assert span.seconds == pytest.approx(7.0) and span.count == 2 and span.frames == 150


def test_stages_are_reported_in_execution_order():
    acc = stages.StageAccumulator()
    for name in ("render", "probe", "pose"):
        acc.on_event(_Ev("stage_done", name, elapsed_s=1.0))
    order = [s["stage"] for s in acc.record(total_s=3.0)["stages"]]
    assert order == ["probe", "pose", "render"]


def test_an_unnamed_stage_is_surfaced_not_dropped():
    """An unknown stage reaching telemetry is a vocabulary bug; hiding it hides the fix."""
    acc = stages.StageAccumulator()
    acc.on_event(_Ev("stage_done", "mystery", elapsed_s=1.0))
    assert acc.record(total_s=1.0)["unknownStages"] == ["mystery"]


def test_events_without_a_measured_duration_are_ignored():
    acc = stages.StageAccumulator()
    acc.on_event(_Ev("stage_started", "pose"))
    acc.on_event(_Ev("stage_progress", "pose"))
    acc.on_event(_Ev("stage_done", "pose"))  # no elapsed_s
    assert acc.spans == {}


# ------------------------------------------------------------------ vocabulary

def test_every_stage_the_pipeline_emits_is_in_the_vocabulary():
    """The parity check that keeps the two lists from drifting apart again: every stage name
    passed to stage_begin in pipeline.py must be a known id."""
    import re
    src = (Path(__file__).resolve().parents[1] / "swingsage" / "pipeline.py").read_text(
        encoding="utf-8")
    emitted = set(re.findall(r'stage_begin\("([a-z_0-9]+)"\)', src))
    assert emitted, "no stage_begin call sites found — did the emitter get renamed?"
    unknown = sorted(n for n in emitted if not stages.is_known(n))
    assert not unknown, f"pipeline emits stages missing from the vocabulary: {unknown}"


def test_jobrun_reexports_the_one_vocabulary():
    """jobrun.STAGE_PCT used to be a second hand-maintained copy."""
    from service import jobrun
    assert jobrun.STAGE_PCT is stages.STAGE_PCT


def test_the_web_stage_map_matches_this_vocabulary():
    """apps/web ships a JSON mirror of this table; a rename on one side must fail here rather
    than silently produce job rows the reader cannot group."""
    mirror = (Path(__file__).resolve().parents[3] / "packages" / "schema" / "stages.json")
    if not mirror.exists():
        pytest.skip("stage mirror not present")
    data = json.loads(mirror.read_text(encoding="utf-8"))
    assert data["stagePct"] == stages.STAGE_PCT
    assert data["labels"] == stages.LABELS
    assert sorted(data["nested"]) == sorted(stages.NESTED)


def test_out_of_pipeline_stages_are_named():
    """download/guard/upload happen outside pipeline.run. Leaving them nameless is what would
    put them in the unattributed remainder."""
    for name in ("download", "guard", "upload"):
        assert stages.is_known(name)
