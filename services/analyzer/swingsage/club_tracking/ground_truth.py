"""Hand-labelled club-head truth (test plan §7) — the only thing that proves correctness.

Labels attach to SOURCE frames (step 01's genuine camera observations), never CFR frames:
a re-normalize changes the 60 fps timeline but not what the camera recorded, so truth keyed
by (source_frame, source_pts_s) survives it. Coordinates are normalized [0,1] in the upright
source frame — the same convention as analysis.json.

Three visibility states, mutually exclusive by construction (plan §7.1):

    visible       — one crisp point
    blur_streak   — an intra-frame trajectory (start -> end), not a fake center point
    unobservable  — the camera did not record the head; labeling a point would be fiction

Event truth (plan §7.2) is an interval or a fractional time — never forced to one frame when
contact happened between exposures. Files live at fixtures/labels/<stem>.club.json.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

VISIBILITIES = ("visible", "blur_streak", "unobservable")
EVENT_NAMES = ("address", "top", "impact")
SCHEMA_VERSION = 1


@dataclass
class ClubLabel:
    source_frame: int
    source_pts_s: float
    visibility: str
    point: tuple[float, float] | None = None            # visible only
    trajectory: tuple[float, float, float, float] | None = None  # blur_streak: x0,y0,x1,y1
    confidence: float = 1.0

    def validate(self) -> None:
        if self.visibility not in VISIBILITIES:
            raise ValueError(f"frame {self.source_frame}: visibility "
                             f"{self.visibility!r} not one of {VISIBILITIES}")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"frame {self.source_frame}: confidence outside [0,1]")
        if self.visibility == "visible":
            if self.point is None or self.trajectory is not None:
                raise ValueError(f"frame {self.source_frame}: visible needs a point "
                                 "and no trajectory")
            coords = self.point
        elif self.visibility == "blur_streak":
            if self.trajectory is None or self.point is not None:
                raise ValueError(f"frame {self.source_frame}: blur_streak needs a "
                                 "trajectory and no point")
            coords = self.trajectory
        else:  # unobservable
            if self.point is not None or self.trajectory is not None:
                raise ValueError(f"frame {self.source_frame}: unobservable carries "
                                 "no coordinates")
            coords = ()
        for v in coords:
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"frame {self.source_frame}: coordinate {v} "
                                 "outside [0,1]")

    def to_dict(self) -> dict:
        d: dict = {"source_frame": self.source_frame,
                   "source_pts_s": self.source_pts_s,
                   "visibility": self.visibility,
                   "confidence": self.confidence}
        if self.point is not None:
            d["point"] = {"x": self.point[0], "y": self.point[1]}
        if self.trajectory is not None:
            x0, y0, x1, y1 = self.trajectory
            d["trajectory"] = {"start": {"x": x0, "y": y0}, "end": {"x": x1, "y": y1}}
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "ClubLabel":
        p = d.get("point")
        t = d.get("trajectory")
        return cls(
            source_frame=d["source_frame"], source_pts_s=d["source_pts_s"],
            visibility=d["visibility"], confidence=d.get("confidence", 1.0),
            point=(p["x"], p["y"]) if p else None,
            trajectory=(t["start"]["x"], t["start"]["y"],
                        t["end"]["x"], t["end"]["y"]) if t else None,
        )


@dataclass
class EventLabel:
    event: str
    kind: str                       # "frame_interval" | "fractional"
    frame_lo: int | None = None     # frame_interval (source frames, inclusive)
    frame_hi: int | None = None
    time_s: float | None = None     # fractional (source seconds)
    notes: str = ""

    def validate(self) -> None:
        if self.event not in EVENT_NAMES:
            raise ValueError(f"event {self.event!r} not one of {EVENT_NAMES}")
        if self.kind == "frame_interval":
            if self.frame_lo is None or self.frame_hi is None or self.time_s is not None:
                raise ValueError(f"event {self.event}: frame_interval needs "
                                 "frame_lo/frame_hi and no time_s")
            if self.frame_hi < self.frame_lo:
                raise ValueError(f"event {self.event}: frame_hi < frame_lo")
        elif self.kind == "fractional":
            if self.time_s is None or self.frame_lo is not None or self.frame_hi is not None:
                raise ValueError(f"event {self.event}: fractional needs time_s only")
        else:
            raise ValueError(f"event {self.event}: kind {self.kind!r} unknown")

    def to_dict(self) -> dict:
        d: dict = {"event": self.event, "kind": self.kind}
        if self.kind == "frame_interval":
            d["frame_lo"], d["frame_hi"] = self.frame_lo, self.frame_hi
        else:
            d["time_s"] = self.time_s
        if self.notes:
            d["notes"] = self.notes
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "EventLabel":
        return cls(event=d["event"], kind=d["kind"], frame_lo=d.get("frame_lo"),
                   frame_hi=d.get("frame_hi"), time_s=d.get("time_s"),
                   notes=d.get("notes", ""))


@dataclass
class AudioLabel:
    """Plan §7.3 — the strike transient as heard, with its ambiguity on the record."""
    transient_time_s: float | None = None
    ambiguity: str = ""             # e.g. "clean" | "competing range impacts" | "none found"
    av_offset_uncertainty_s: float | None = None
    notes: str = ""

    def to_dict(self) -> dict:
        return {"transient_time_s": self.transient_time_s,
                "ambiguity": self.ambiguity,
                "av_offset_uncertainty_s": self.av_offset_uncertainty_s,
                "notes": self.notes}

    @classmethod
    def from_dict(cls, d: dict) -> "AudioLabel":
        return cls(transient_time_s=d.get("transient_time_s"),
                   ambiguity=d.get("ambiguity", ""),
                   av_offset_uncertainty_s=d.get("av_offset_uncertainty_s"),
                   notes=d.get("notes", ""))


@dataclass
class GroundTruth:
    stem: str
    view: str
    handedness: str
    labeler: str = ""
    labeled_at: str = ""            # ISO-8601, set by the tool at save
    club: list[ClubLabel] = field(default_factory=list)
    events: list[EventLabel] = field(default_factory=list)
    audio: AudioLabel | None = None

    def validate(self) -> None:
        seen: set[int] = set()
        for lb in self.club:
            lb.validate()
            if lb.source_frame in seen:
                raise ValueError(f"duplicate label for source frame {lb.source_frame}")
            seen.add(lb.source_frame)
        seen_ev: set[str] = set()
        for ev in self.events:
            ev.validate()
            if ev.event in seen_ev:
                raise ValueError(f"duplicate event label {ev.event}")
            seen_ev.add(ev.event)

    def get(self, source_frame: int) -> ClubLabel | None:
        return next((lb for lb in self.club if lb.source_frame == source_frame), None)

    def upsert(self, label: ClubLabel) -> None:
        self.club = [lb for lb in self.club if lb.source_frame != label.source_frame]
        self.club.append(label)
        self.club.sort(key=lambda lb: lb.source_frame)

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "stem": self.stem, "view": self.view, "handedness": self.handedness,
            "labeler": self.labeler, "labeled_at": self.labeled_at,
            "club": [lb.to_dict() for lb in sorted(self.club,
                                                   key=lambda x: x.source_frame)],
            "events": [ev.to_dict() for ev in self.events],
            "audio": self.audio.to_dict() if self.audio else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "GroundTruth":
        return cls(
            stem=d["stem"], view=d["view"], handedness=d["handedness"],
            labeler=d.get("labeler", ""), labeled_at=d.get("labeled_at", ""),
            club=[ClubLabel.from_dict(x) for x in d.get("club", [])],
            events=[EventLabel.from_dict(x) for x in d.get("events", [])],
            audio=AudioLabel.from_dict(d["audio"]) if d.get("audio") else None,
        )

    def save(self, path: str | Path) -> Path:
        self.validate()
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        os.replace(tmp, path)
        return path

    @classmethod
    def load(cls, path: str | Path) -> "GroundTruth":
        gt = cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
        gt.validate()
        return gt


def labels_path(stem: str, root: str | Path | None = None) -> Path:
    """fixtures/labels/<stem>.club.json, relative to the repo root by default."""
    base = Path(root) if root else Path(__file__).resolve().parents[4] / "fixtures" / "labels"
    return base / f"{stem}.club.json"
