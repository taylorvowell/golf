"""The shared test interface (plan §9): context in, result out, tests interchangeable.

`ClubTrackingContext.from_artifacts` is the pure seam (hermetic-testable on a synthesized
doc); `load` is the only I/O in the package. Tests never re-read `analysis.json` themselves —
everything a tracker needs arrives through the context, which is what keeps the 12 test
modules isolated and the harness able to run any of them on any analysed swing.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from swingsage.source_timing import SIDECAR_NAME, SourceTiming

from .model import ClubObservation, EventEvidence

GOLFDB_EVENTS = ("address", "toe_up", "mid_backswing", "top", "mid_downswing",
                 "impact", "mid_follow_through", "finish")


@dataclass
class ClubTrackingContext:
    """Everything a tracking test may consume, extracted once from the artifacts.

    `grip[f]` is (x, y, conf) from the pose's `grip_center` (or None when the frame is
    absent) — consumers apply their own confidence gate, same contract as the artifact
    itself (D33). `handedness` rides along because every geometric prior downstream is
    mirrored by it (non-negotiable threading rule).
    """
    fps: float
    frame_count: int
    width: int
    height: int
    view: str
    handedness: str
    source_path: str | None
    grip: list[tuple[float, float, float] | None]
    events: dict[str, int]                      # GolfDB event -> normalized frame
    event_confs: dict[str, float]
    source_timing: SourceTiming | None = None
    out_dir: Path | None = None
    doc: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_artifacts(cls, doc: dict, timing_doc: dict | None = None,
                       out_dir: Path | None = None) -> "ClubTrackingContext":
        video = doc["video"]
        pose = doc["pose"]
        # Index by name, never position — the keypoint block is append-only (D25/D47) but
        # nothing guarantees where grip_center sits in a future model's ordering.
        gi = pose["keypoint_names"].index("grip_center")
        grip: list[tuple[float, float, float] | None] = [None] * video["frame_count"]
        for fr in pose["frames"]:
            f = fr["f"]
            if 0 <= f < len(grip):
                x, y, c = fr["kp"][gi]
                grip[f] = (x, y, c)

        events = {name: ev["frame"] for name, ev in doc.get("events", {}).items()}
        event_confs = {name: ev.get("conf", 0.0)
                       for name, ev in doc.get("events", {}).items()}

        return cls(
            fps=video["fps"], frame_count=video["frame_count"],
            width=video["width"], height=video["height"],
            view=video["view"], handedness=video["handedness"],
            source_path=(video.get("source") or {}).get("path"),
            grip=grip, events=events, event_confs=event_confs,
            source_timing=SourceTiming.from_dict(timing_doc) if timing_doc else None,
            out_dir=out_dir, doc=doc,
        )

    @classmethod
    def load(cls, out_dir: str | Path) -> "ClubTrackingContext":
        out_dir = Path(out_dir)
        doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
        timing_path = out_dir / SIDECAR_NAME
        timing_doc = (json.loads(timing_path.read_text(encoding="utf-8"))
                      if timing_path.exists() else None)
        return cls.from_artifacts(doc, timing_doc, out_dir=out_dir)


@dataclass
class ClubTrackingResult:
    """What every test returns: observations + event evidence + diagnostics.

    Deliberately no trace/variants field — path-fit variants are the smoothing registry's
    output (track step 05), computed FROM these observations, not part of a tracker's job.
    """
    test_id: str
    label: str
    version: str
    observations: list[ClubObservation] = field(default_factory=list)
    event_evidence: list[EventEvidence] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "test": {"id": self.test_id, "label": self.label, "version": self.version},
            "observations": [o.to_dict() for o in self.observations],
            "event_evidence": [e.to_dict() for e in self.event_evidence],
            "diagnostics": dict(self.diagnostics),
        }


@runtime_checkable
class ClubTrackingTest(Protocol):
    id: str
    label: str
    version: str

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        ...
