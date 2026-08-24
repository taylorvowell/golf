"""Source timing — what the camera actually observed, preserved before CFR conversion.

Stage 0 resamples every upload to CFR at its capture rate (`video.cfr_target_fps` — 60 for
ordinary uploads, 120/240 for high-speed takes), which rewrites the source's real
presentation timestamps: a 30 fps upload becomes 60 fps with every frame shown twice, and
none of those duplicates is a new observation of the club. Club tracking needs the
distinction back: a normalized output sample is not a genuine camera observation.

This module reads per-packet PTS from the ORIGINAL upload (demux only — no decode), maps each
source frame to the normalized CFR frames that display it, and persists the result as a
sidecar artifact `out/<stem>/source_timing.json`. `analysis.json` is untouched: the player is
not required to consume source timing at all, so this stays out of the contract.

PTS-from-packets is the primary method by design; duplicate-image detection is a fallback for
containers that lie about their timestamps, and is deliberately not built here.
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from swingsage.video import FFPROBE

SIDECAR_NAME = "source_timing.json"
SCHEMA_VERSION = 1


@dataclass
class SourceObservation:
    """One genuine camera observation (plan §5.1).

    `normalized_frames` are the CFR-60 indices that display this source frame; empty when a
    high-fps source frame was dropped by the resample (still a real observation — Tests 9/11
    can mine it), and longer than 1 when a slow source was duplicated up to 60.
    """
    source_frame: int
    source_pts_s: float
    normalized_frames: list[int] = field(default_factory=list)
    is_duplicate_group: bool = False

    def to_dict(self) -> dict:
        return {
            "source_frame": self.source_frame,
            "source_pts_s": self.source_pts_s,
            "normalized_frames": list(self.normalized_frames),
            "is_duplicate_group": self.is_duplicate_group,
        }


@dataclass
class SourceTiming:
    nominal_fps: float
    avg_fps: float
    time_base: str
    start_time_s: float
    duration_s: float
    has_audio: bool
    audio_sample_rate: int | None
    audio_codec: str | None
    observations: list[SourceObservation] = field(default_factory=list)

    @property
    def distinct_observation_count(self) -> int:
        return len(self.observations)

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "nominal_fps": self.nominal_fps,
            "avg_fps": self.avg_fps,
            "time_base": self.time_base,
            "start_time_s": self.start_time_s,
            "duration_s": self.duration_s,
            "has_audio": self.has_audio,
            "audio_sample_rate": self.audio_sample_rate,
            "audio_codec": self.audio_codec,
            "distinct_observation_count": self.distinct_observation_count,
            "observations": [o.to_dict() for o in self.observations],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SourceTiming":
        return cls(
            nominal_fps=d["nominal_fps"],
            avg_fps=d["avg_fps"],
            time_base=d["time_base"],
            start_time_s=d["start_time_s"],
            duration_s=d["duration_s"],
            has_audio=d["has_audio"],
            audio_sample_rate=d["audio_sample_rate"],
            audio_codec=d["audio_codec"],
            observations=[
                SourceObservation(
                    source_frame=o["source_frame"],
                    source_pts_s=o["source_pts_s"],
                    normalized_frames=list(o["normalized_frames"]),
                    is_duplicate_group=o["is_duplicate_group"],
                )
                for o in d["observations"]
            ],
        )


def _parse_probe(data: dict) -> dict:
    """Pure extraction from a parsed `ffprobe -show_streams -show_format` document.

    Unlike video.probe(), the ffprobe call behind this one uses NO -select_streams, so the
    audio stream (if any) is visible. Returns a plain dict so tests can feed canned JSON.
    """
    vstream = next((s for s in data.get("streams", [])
                    if s.get("codec_type") == "video"), None)
    astream = next((s for s in data.get("streams", [])
                    if s.get("codec_type") == "audio"), None)
    if vstream is None:
        raise ValueError("no video stream in probe output")

    def _rat(s: str) -> float:
        if not s or s == "0/0":
            return 0.0
        if "/" in s:
            n, d = s.split("/")
            return float(n) / float(d) if float(d) else 0.0
        return float(s)

    fmt = data.get("format", {}) or {}
    return {
        "nominal_fps": _rat(vstream.get("r_frame_rate", "0/0")),
        "avg_fps": _rat(vstream.get("avg_frame_rate", "0/0")),
        "time_base": vstream.get("time_base", "?"),
        "start_time_s": float(vstream.get("start_time")
                              or fmt.get("start_time") or 0.0),
        "duration_s": float(vstream.get("duration") or fmt.get("duration") or 0.0),
        "has_audio": astream is not None,
        "audio_sample_rate": int(astream["sample_rate"])
        if astream is not None and astream.get("sample_rate") else None,
        "audio_codec": astream.get("codec_name") if astream is not None else None,
    }


def probe_source(path: str | Path) -> tuple[list[float], dict]:
    """Demux the original upload: (sorted video-packet PTS seconds, stream metadata).

    Two ffprobe calls, both demux-only. Packets arrive in decode order, so PTS are sorted
    into presentation order; packets without a pts_time (rare, corrupt tails) are skipped.
    """
    path = str(path)
    meta_raw = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True,
    ).stdout
    meta = _parse_probe(json.loads(meta_raw))

    pkt_raw = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-print_format", "json",
         "-show_entries", "packet=pts_time", path],
        capture_output=True, text=True, check=True,
    ).stdout
    pts = sorted(
        float(p["pts_time"]) for p in json.loads(pkt_raw).get("packets", [])
        if p.get("pts_time") is not None
    )
    return pts, meta


def map_observations(pts: list[float], out_fps: float,
                     out_frame_count: int) -> list[SourceObservation]:
    """Map every source frame to the normalized CFR frames that display it. Pure.

    ffmpeg's CFR resample shows, at output time t = n / out_fps, the most recent source
    frame presented by then. A half-output-frame epsilon dodges boundary rounding — the same
    philosophy as the player's `(frame + 0.5) / fps` seek. PTS are re-based to the first
    packet so container start offsets don't shift the mapping.

    Invariant: the union of `normalized_frames` over the result is exactly
    [0, out_frame_count), each index appearing once, in order. Source frames the resample
    dropped (high-fps sources) keep an empty `normalized_frames`.
    """
    if not pts or out_fps <= 0 or out_frame_count <= 0:
        return []
    base = pts[0]
    rel = [p - base for p in pts]
    eps = 0.5 / out_fps

    obs = [SourceObservation(source_frame=i, source_pts_s=p)
           for i, p in enumerate(pts)]
    j = 0
    for n in range(out_frame_count):
        t = n / out_fps + eps
        while j + 1 < len(rel) and rel[j + 1] <= t:
            j += 1
        obs[j].normalized_frames.append(n)
    for o in obs:
        o.is_duplicate_group = len(o.normalized_frames) > 1
    return obs


def build(src: str | Path, out_fps: float, out_frame_count: int) -> SourceTiming:
    """Probe the original upload and assemble the full SourceTiming artifact."""
    pts, meta = probe_source(src)
    return SourceTiming(
        observations=map_observations(pts, out_fps, out_frame_count), **meta,
    )


def write_sidecar(timing: SourceTiming, out_dir: str | Path) -> Path:
    """Atomic tmp + os.replace, same pattern as silhouette.json."""
    out_dir = Path(out_dir)
    dst = out_dir / SIDECAR_NAME
    tmp = out_dir / (SIDECAR_NAME + ".tmp")
    tmp.write_text(json.dumps(timing.to_dict()), encoding="utf-8")
    os.replace(tmp, dst)
    return dst
