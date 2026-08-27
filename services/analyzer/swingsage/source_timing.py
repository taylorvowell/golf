"""Source timing — what the camera actually observed, preserved before CFR conversion.

Stage 0 resamples every upload to CFR at its capture rate (`video.cfr_target_fps`), which
rewrites the source's real presentation timestamps. Club tracking and any future frame-mining
need the distinction back: a normalized output sample is not a genuine camera observation.

This module reads per-packet PTS from the ORIGINAL upload (demux only — no decode), maps each
source frame to the normalized CFR frames that display it, and persists the result as a
sidecar artifact `out/<stem>/source_timing.json`.

v2 (the frame-identity step): the sidecar is IN the contract. It runs on every path including
the slow-motion retime — the mapping is built on the RETIMED clock (source PTS × the same
`-itsscale` multiplier ffmpeg applied before the CFR resample), so the map and the normalized
clip always describe one timeline. It is schema-validated on write
(`packages/schema/schemas/source-timing.schema.json` via `contract.write_json`), and
`analysis.json` names it (`video.source_map`) instead of pretending it does not exist.

PTS-from-packets is the primary method by design; duplicate-image detection is a fallback for
containers that lie about their timestamps, and is deliberately not built here.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from swingsage import contract
from swingsage.video import FFPROBE

SIDECAR_NAME = "source_timing.json"
SCHEMA_VERSION = 2


@dataclass
class SourceObservation:
    """One genuine camera observation (plan §5.1).

    `normalized_frames` are the normalized CFR indices that display this source frame; empty
    when a high-fps source frame was dropped by the resample (still a real observation —
    Tests 9/11 can mine it), and longer than 1 when a slow source was duplicated up.

    `source_pts_s` stays on the SOURCE clock exactly as demuxed; `real_capture_time_us` is the
    same instant on the WORLD clock, rebased to the clip's first frame — directly comparable
    with `normalized_frame / video.fps`. Two fields rather than one scaled value because a
    debugging session against the original file needs the container's own number, unmodified.
    """
    source_frame: int
    source_pts_s: float
    real_capture_time_us: int = 0
    normalized_frames: list[int] = field(default_factory=list)
    is_duplicate_group: bool = False

    def to_dict(self) -> dict:
        return {
            "source_frame": self.source_frame,
            "source_pts_s": self.source_pts_s,
            "real_capture_time_us": self.real_capture_time_us,
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
    # v2: the retime multiplier the mapping was built on (1.0 = real-time), and where the
    # capture rate behind it came from — the derivation every real_capture_time_us inherits.
    pts_scale: float = 1.0
    capture_fps: float = 0.0
    capture_fps_source: str = "none"
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
            "pts_scale": self.pts_scale,
            "capture_fps": self.capture_fps,
            "capture_fps_source": self.capture_fps_source,
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
            # v1 sidecars predate these three and never described a retimed clip.
            pts_scale=d.get("pts_scale", 1.0),
            capture_fps=d.get("capture_fps", 0.0),
            capture_fps_source=d.get("capture_fps_source", "none"),
            observations=[
                SourceObservation(
                    source_frame=o["source_frame"],
                    source_pts_s=o["source_pts_s"],
                    real_capture_time_us=o.get("real_capture_time_us", 0),
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

    The caller hands PTS on the clock the normalized clip was BUILT on — for a retimed
    slow-mo that means already multiplied by the itsscale factor (see `build`), because that
    is exactly what ffmpeg saw. `real_capture_time_us` is derived from the same rebased
    values, so the two can never disagree.

    Invariant: the union of `normalized_frames` over the result is exactly
    [0, out_frame_count), each index appearing once, in order. Source frames the resample
    dropped (high-fps sources) keep an empty `normalized_frames`.
    """
    if not pts or out_fps <= 0 or out_frame_count <= 0:
        return []
    base = pts[0]
    rel = [p - base for p in pts]
    eps = 0.5 / out_fps

    obs = [SourceObservation(source_frame=i, source_pts_s=p,
                             real_capture_time_us=max(0, round(r * 1_000_000)))
           for i, (p, r) in enumerate(zip(pts, rel))]
    j = 0
    for n in range(out_frame_count):
        t = n / out_fps + eps
        while j + 1 < len(rel) and rel[j + 1] <= t:
            j += 1
        obs[j].normalized_frames.append(n)
    for o in obs:
        o.is_duplicate_group = len(o.normalized_frames) > 1
    return obs


def build(src: str | Path, out_fps: float, out_frame_count: int, *,
          pts_scale: float = 1.0, capture_fps: float = 0.0,
          capture_fps_source: str = "none") -> SourceTiming:
    """Probe the original upload and assemble the full SourceTiming artifact.

    `pts_scale` is the retime multiplier the pipeline applied via `-itsscale` (None → pass
    1.0): the mapping is built on scaled PTS because that is the clock the normalized clip
    lives on, while each observation keeps its UNSCALED `source_pts_s` for anyone holding the
    original file.
    """
    pts, meta = probe_source(src)
    scaled = [p * pts_scale for p in pts]
    obs = map_observations(scaled, out_fps, out_frame_count)
    for o, p in zip(obs, pts):
        o.source_pts_s = p
    return SourceTiming(
        observations=obs, pts_scale=pts_scale, capture_fps=capture_fps,
        capture_fps_source=capture_fps_source, **meta,
    )


def write_sidecar(timing: SourceTiming, out_dir: str | Path) -> Path:
    """Schema-validated + atomic — the same `contract.write_json` gate as analysis.json.

    v1 hand-rolled the tmp+replace; going through the contract module is what puts the
    sidecar IN the contract: a malformed map fails the run here rather than shipping a file
    two clients would misread.
    """
    dst = Path(out_dir) / SIDECAR_NAME
    contract.write_json("source-timing", timing.to_dict(), dst)
    return dst
