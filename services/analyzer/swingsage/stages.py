"""The ONE stage vocabulary, and the accumulator that turns spans into job telemetry.

Before this module there were two lists that disagreed: `jobrun.STAGE_PCT` (16 names) and
`jobs.ts STAGES` (11 regex-scraped names). The percentages always agreed — both were measured
off the same fixtures — but four stages were spelled differently on each side
(`pose_localiser`/`pose (localiser)`, `stage3`/`pose-post`, `scoring`/`coach`) and six stages
were invisible to the scraper entirely. A job's stage string therefore meant something
different depending on which runner produced it, which makes "p95 of the pose stage" a
question nobody could answer without knowing who wrote the row.

Names here are MACHINE ids: snake_case, stable, safe to group by in a query. `LABELS` carries
the human wording, so renaming what a golfer sees never moves a telemetry key.

Three names exist here that the pipeline never emits, because they happen outside it:
`download` (fetching the source), `guard` (the workload refusal check) and `upload` (pushing
artifacts to object storage). They are stages of the JOB, and leaving them nameless is exactly
what would put them in the unattributed remainder — on a slow link the download alone is a
double-digit share of wall time.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field


#: Progress-bar percentage reached when each stage BEGINS, from measured wall-clock on the
#: fixtures — deliberately uneven spacing (normalize and the two pose passes are most of the
#: run; an evenly spaced bar reads as a hang). Order is execution order.
STAGE_PCT: dict[str, int] = {
    "download": 1,
    "guard": 2,
    "probe": 3,
    "normalize": 22,
    "pose_localiser": 42,
    "pose": 66,
    "stage3": 72,
    "events": 76,
    "topup": 78,
    "detector": 80,
    "club": 88,
    "variants": 89,
    "face": 90,
    "checkpoints": 91,
    "metrics": 93,
    "silhouette": 95,
    "contract": 96,
    "scoring": 97,
    "render": 99,
    "upload": 99,
}

#: Human wording for a machine id. The UI reads this; telemetry never does.
LABELS: dict[str, str] = {
    "download": "fetching video",
    "guard": "checking",
    "probe": "probe",
    "normalize": "normalize",
    "pose_localiser": "pose (localiser)",
    "pose": "pose",
    "stage3": "pose-post",
    "events": "events",
    "topup": "re-checking key frames",
    "detector": "detector",
    "club": "club",
    "variants": "variants",
    "face": "face",
    "checkpoints": "checkpoints",
    "metrics": "metrics",
    "silhouette": "silhouette",
    "contract": "contract",
    "scoring": "coach",
    "render": "render",
    "upload": "upload",
}

#: Stages that run INSIDE another stage's span. Their seconds are real work, but adding them
#: to the top-level total would count the same wall-clock twice — the exact bug in the
#: pre-existing `modal_app.bench` accumulator, which closed each span when the next one
#: opened and so charged `club` only the time before `variants` began.
NESTED: frozenset[str] = frozenset({"variants"})

STAGE_ORDER: tuple[str, ...] = tuple(STAGE_PCT)


def label(stage: str) -> str:
    """Human wording for a stage id, falling back to the id itself."""
    return LABELS.get(stage, stage)


def is_known(stage: str) -> bool:
    return stage in STAGE_PCT


class SpanTracker:
    """Measures stage spans at the source and reports depth for nested ones.

    Lives here rather than as a closure inside `pipeline.run` so it is directly testable: the
    nesting rule (`variants` inside `club`) and the failure tolerance below are exactly the
    behaviours worth pinning, and neither is reachable through a closure without running a
    full analysis over a real video.

    `emit` is the pipeline's own event emitter, taking (kind, stage, **fields).
    """

    def __init__(self, emit):
        self._emit = emit
        self._open: list[tuple[str, float]] = []

    @property
    def depth(self) -> int:
        return len(self._open)

    def begin(self, name: str) -> None:
        self._emit("stage_started", name, depth=len(self._open))
        self._open.append((name, _now()))

    def end(self, name: str, frames: int | None = None) -> None:
        """Close the innermost span and report its MEASURED duration.

        Tolerant of a mismatched or unbalanced name — it closes the innermost span regardless
        and still emits — because a telemetry bookkeeping error must never raise out of a
        pipeline that is otherwise producing a correct artifact.
        """
        if not self._open:
            self._emit("stage_done", name, frames=frames)
            return
        opened, t0 = self._open.pop()
        self._emit("stage_done", opened, elapsed_s=_now() - t0, frames=frames,
                   depth=len(self._open))

    @contextmanager
    def span(self, name: str):
        """`finally` so a stage that raises still reports the time it burned — exactly the
        span you want on a failed job."""
        self.begin(name)
        try:
            yield
        finally:
            self.end(name)


def _now() -> float:
    return time.time()


@dataclass
class StageSpan:
    """One completed stage: what ran, how long, and over how many frames."""
    stage: str
    seconds: float
    frames: int | None = None
    #: Spans nested inside another stage (see NESTED). Excluded from the top-level sum.
    nested: bool = False
    #: How many times this stage ran, when a stage is entered more than once.
    count: int = 1

    def as_dict(self) -> dict:
        d: dict = {"stage": self.stage, "seconds": round(self.seconds, 3)}
        if self.frames is not None:
            d["frames"] = self.frames
        if self.nested:
            d["nested"] = True
        if self.count != 1:
            d["count"] = self.count
        return d


@dataclass
class StageAccumulator:
    """Collects `stage_done` events into one telemetry record.

    Deliberately driven by stage_done and its MEASURED `elapsed_s` rather than by reconstructing
    durations from consecutive stage_started events. The reconstruction approach cannot express
    nesting, silently mis-attributes a re-entered stage, and charges any gap between stages to
    whichever stage happened to run before it. Measuring at the source and reporting the
    unattributed remainder explicitly is what makes the >=95% attribution claim checkable
    instead of true by construction.
    """
    spans: dict[str, StageSpan] = field(default_factory=dict)
    unknown: list[str] = field(default_factory=list)

    def add(self, stage: str, seconds: float, frames: int | None = None,
            nested: bool | None = None) -> None:
        if not is_known(stage):
            # Kept rather than dropped: an unnamed stage reaching telemetry is a vocabulary
            # bug, and silently discarding it would hide the thing worth fixing.
            if stage not in self.unknown:
                self.unknown.append(stage)
        nested = NESTED.__contains__(stage) if nested is None else nested
        cur = self.spans.get(stage)
        if cur is None:
            self.spans[stage] = StageSpan(stage=stage, seconds=seconds, frames=frames,
                                          nested=nested)
            return
        cur.seconds += seconds
        cur.count += 1
        if frames is not None:
            cur.frames = (cur.frames or 0) + frames

    def on_event(self, ev) -> None:
        """Feed a `PipelineEvent` straight in — the whole integration for a consumer."""
        if getattr(ev, "kind", None) == "stage_done" and getattr(ev, "elapsed_s", None) is not None:
            self.add(ev.stage, ev.elapsed_s, getattr(ev, "frames", None),
                     nested=bool(getattr(ev, "depth", 0)))

    def attributed_s(self) -> float:
        """Wall time inside top-level spans. Nested spans are already inside their parent."""
        return sum(s.seconds for s in self.spans.values() if not s.nested)

    def record(self, total_s: float, **facts) -> dict:
        """The persisted shape: ordered spans, the remainder, and whatever facts the caller
        knows (fps class, frames, cold/warm, versions...).

        `unattributed_s` is reported even when it is embarrassing — a shrinking remainder is
        the point of the step, and a record that only ever showed accounted-for time could not
        show that.
        """
        attributed = self.attributed_s()
        ordered = sorted(
            self.spans.values(),
            key=lambda s: STAGE_ORDER.index(s.stage) if is_known(s.stage) else len(STAGE_ORDER),
        )
        rec: dict = {
            "schema": "stage-metrics",
            "schemaVersion": 1,
            "totalS": round(total_s, 3),
            "attributedS": round(attributed, 3),
            "unattributedS": round(max(0.0, total_s - attributed), 3),
            "attributedPct": round(100.0 * attributed / total_s, 1) if total_s > 0 else None,
            "stages": [s.as_dict() for s in ordered],
        }
        if self.unknown:
            rec["unknownStages"] = list(self.unknown)
        rec.update({k: v for k, v in facts.items() if v is not None})
        return rec
