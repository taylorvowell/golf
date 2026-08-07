"""Shared club-tracking data model (test plan §5).

Every one of the 12 tracking tests speaks these shapes so the evaluation harness, path-fit
registry and experiment schema can treat them interchangeably. The load-bearing distinction
the whole plan is built on lives in `ClubObservation.mode`:

    observed  — the camera saw it (crisp or blurred, but real sensor evidence)
    mixed     — partly measured, partly model (e.g. a solver pulled an observed point)
    inferred  — no direct measurement; kinematics/solver/VFI hypothesis

A bulletproof system never collapses those into one unqualified (x, y) point (plan §39).

All geometry is normalized [0,1], x right, y down (plan §2.7). Plain floats only — expert
adapters convert numpy at their own edges, so importing this module never costs anything.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MODES = ("observed", "mixed", "inferred")

EVENTS = ("address", "top", "impact")

# Plan §5.2's source vocabulary. Advisory, not enforced: an expert added later must not
# require editing this module to emit its own source tag.
KNOWN_SOURCES = (
    "detector", "temporal_heatmap", "point_tracker", "segmentation", "sea_raft",
    "deblatting", "kinematic", "vfi", "audio_event", "ball_departure", "claude_choice",
    "fused",
)


def _check_conf(confidence: float) -> None:
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence {confidence} outside [0,1]")


@dataclass
class ClubObservation:
    """One club-head sample on the timeline, tagged with how much of it is real."""
    frame: int
    source_time_s: float | None
    x: float
    y: float
    confidence: float
    mode: Literal["observed", "mixed", "inferred"]
    source: str
    visibility: str
    covariance: tuple[float, float, float] | None = None

    def __post_init__(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"mode {self.mode!r} not one of {MODES}")
        _check_conf(self.confidence)
        if self.covariance is not None:
            self.covariance = tuple(float(v) for v in self.covariance)  # type: ignore[assignment]
            if len(self.covariance) != 3:
                raise ValueError("covariance is (xx, yy, xy) — exactly 3 values")

    def to_dict(self) -> dict:
        d = {
            "frame": self.frame, "source_time_s": self.source_time_s,
            "x": self.x, "y": self.y, "confidence": self.confidence,
            "mode": self.mode, "source": self.source, "visibility": self.visibility,
        }
        if self.covariance is not None:
            d["covariance"] = list(self.covariance)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "ClubObservation":
        cov = d.get("covariance")
        return cls(frame=d["frame"], source_time_s=d["source_time_s"], x=d["x"],
                   y=d["y"], confidence=d["confidence"], mode=d["mode"],
                   source=d["source"], visibility=d["visibility"],
                   covariance=tuple(cov) if cov is not None else None)


@dataclass
class ClubCandidate:
    """A hypothesis for the global solver to accept or reject — never a conclusion.

    A low-confidence candidate exactly where other experts expect the head is useful; a
    high-confidence one far outside the swing corridor is wrong (plan §3.4). `features`
    carries whatever the generator measured (detector score, grip distance, flow magnitude…).
    """
    frame: int
    source_time_s: float
    x: float
    y: float
    confidence: float
    source: str
    features: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _check_conf(self.confidence)

    def to_dict(self) -> dict:
        return {"frame": self.frame, "source_time_s": self.source_time_s,
                "x": self.x, "y": self.y, "confidence": self.confidence,
                "source": self.source, "features": dict(self.features)}

    @classmethod
    def from_dict(cls, d: dict) -> "ClubCandidate":
        return cls(frame=d["frame"], source_time_s=d["source_time_s"], x=d["x"],
                   y=d["y"], confidence=d["confidence"], source=d["source"],
                   features=dict(d.get("features", {})))


@dataclass
class BlurTrajectoryObservation:
    """A motion streak as an intra-frame path segment (plan §5.4).

    A blurred fast-moving head is not located at one crisp coordinate during the exposure —
    forcing a fake center-point label throws the trajectory information away.
    """
    frame: int
    source_time_s: float
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    confidence: float

    def __post_init__(self) -> None:
        _check_conf(self.confidence)

    def to_dict(self) -> dict:
        return {"frame": self.frame, "source_time_s": self.source_time_s,
                "start_x": self.start_x, "start_y": self.start_y,
                "end_x": self.end_x, "end_y": self.end_y,
                "confidence": self.confidence}

    @classmethod
    def from_dict(cls, d: dict) -> "BlurTrajectoryObservation":
        return cls(**{k: d[k] for k in ("frame", "source_time_s", "start_x", "start_y",
                                        "end_x", "end_y", "confidence")})


@dataclass
class EventEvidence:
    """A timing likelihood for address/top/impact (plan §5.5).

    Deliberately has no x/y — an `audio_event` source can never supply coordinates by
    construction, only timing.
    """
    event: Literal["address", "top", "impact"]
    time_s: float
    confidence: float
    source: str

    def __post_init__(self) -> None:
        if self.event not in EVENTS:
            raise ValueError(f"event {self.event!r} not one of {EVENTS}")
        _check_conf(self.confidence)

    def to_dict(self) -> dict:
        return {"event": self.event, "time_s": self.time_s,
                "confidence": self.confidence, "source": self.source}

    @classmethod
    def from_dict(cls, d: dict) -> "EventEvidence":
        return cls(event=d["event"], time_s=d["time_s"],
                   confidence=d["confidence"], source=d["source"])
