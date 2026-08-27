"""Stage 0 — probe + normalize (the architecture spec).

Why normalization is mandatory, demonstrated by the first real fixture:
  * rotation=-90 metadata (phone portrait) — must be baked into pixels or MediaPipe sees a
    sideways golfer.
  * VFR (r_frame_rate 60/1 vs avg_frame_rate 59.945) — breaks frame = round(t * fps) in the
    player, which is the #1 perceived-quality feature.
  * 4K 10-bit HEVC — too slow for CV, and not reliably playable in a browser.

We emit two derivatives, both CFR:
  normalized.mp4  short side 1080 — what the player loads and the burn-in renders onto
  analysis.mp4    short side  720 — what the CV pipeline consumes (the architecture spec: analyze small,
                                    render scaled; normalized coords make it free)
"""
from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"


@dataclass
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float           # authoritative playback fps (avg_frame_rate)
    nominal_fps: float   # r_frame_rate — the container's claimed rate
    frame_count: int
    duration: float
    codec: str
    rotation: int
    is_vfr: bool

    def as_dict(self):
        return asdict(self)


def _rat(s: str) -> float:
    if not s or s == "0/0":
        return 0.0
    if "/" in s:
        n, d = s.split("/")
        return float(n) / float(d) if float(d) else 0.0
    return float(s)


def probe(path: str | Path) -> VideoInfo:
    path = str(path)
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    st = data["streams"][0]

    # Rotation lives in side_data_list on modern ffmpeg; older files use a stream tag.
    rotation = 0
    for sd in st.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(float(sd["rotation"]))
    if rotation == 0 and "rotate" in (st.get("tags") or {}):
        rotation = int(float(st["tags"]["rotate"]))

    avg = _rat(st.get("avg_frame_rate", "0/0"))
    nominal = _rat(st.get("r_frame_rate", "0/0"))
    duration = float(st.get("duration") or data["format"].get("duration") or 0.0)
    nb = int(st.get("nb_frames") or 0)
    if not nb and duration and avg:
        nb = round(duration * avg)

    # Treat as VFR when the container's nominal rate and the realised average disagree,
    # or when frame_count/duration contradicts the average. Either way we must force CFR.
    derived = (nb / duration) if duration else 0.0
    is_vfr = bool(
        (nominal and avg and abs(nominal - avg) > 0.01)
        or (derived and avg and abs(derived - avg) > 0.01)
    )

    return VideoInfo(
        path=path, width=int(st["width"]), height=int(st["height"]),
        fps=avg or nominal, nominal_fps=nominal, frame_count=nb, duration=duration,
        codec=st.get("codec_name", "?"), rotation=rotation, is_vfr=is_vfr,
    )


def probe_capture_fps(path: str | Path) -> float:
    """The `com.android.capture.fps` stamp, or 0.0 — the slow-motion truth of a phone clip.

    A phone slow-mo is CAPTURED at 240 and WRITTEN at 30: every container fact (fps, duration,
    timestamps) describes the slowed playback, and only this tag records what the sensor did.
    Deliberately NOT a `VideoInfo` field: that dict flows into the artifact, and the retime
    decision (below, in the pipeline) already re-expresses the truth as the normalized clip's
    honest fps — a second copy of the number would be a second thing to keep agreeing.
    """
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0", "-print_format", "json",
             "-show_entries", "stream_tags:format_tags", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout
        data = json.loads(out)
        tags = (data.get("streams") or [{}])[0].get("tags") or {}
        tags = {**(data.get("format", {}).get("tags") or {}), **tags}
        return float(tags.get("com.android.capture.fps") or 0.0)
    except Exception:  # noqa: BLE001 — metadata is advisory, never fatal
        return 0.0


def retime_factor(info: VideoInfo, capture_fps: float) -> float | None:
    """The `-itsscale` multiplier that puts a slow-motion clip back on the world's clock,
    or None for a real-time clip.

    None (not 1.0) is the common answer on purpose: retiming is an exceptional transform and
    every consumer branches on whether it happened. The 1.5× threshold keeps rounding noise
    (a 29.97 container with a 30 stamp) from ever counting as slow motion.
    """
    if capture_fps <= 0 or info.fps <= 0:
        return None
    if capture_fps < info.fps * 1.5:
        return None
    return info.fps / capture_fps


def cfr_target_fps(info: VideoInfo) -> int:
    """The CFR rate a source normalizes to: its own capture rate, snapped to a clean step.

    60 was the only answer until the in-app recorder arrived. Its takes carry 120/240 real
    sensor frames on a REAL-TIME timeline, and resampling those to 60 silently discards
    3 of every 4 observations — the exact footage the ≥60fps capture constraint exists to
    keep (a 2s take at 240 is ~480 frames, the same work as an 8s fixture at 60, so the old
    cap was not protecting compute either). Slow-motion playback needs no retime: the player
    presents the same CFR file slower, and at ≤¼x every sensor frame reaches the screen.

    Snapped to {240, 120, 60, 30}, never the raw probe: a healthy 240 take probes ~237.6 avg
    (the HAL's real cadence), and frame = round(t * fps) needs the container's honest nominal
    rate, not that measurement. The 5fps tolerance accepts those real-world rates without
    ever promoting a source to a step above itself.

    30 joined the set in the frame-identity step: a 30fps gallery import used to be upsampled
    to 60 by showing every frame twice, which made half the public frame ids duplicates of
    the other half — the normalized index is THE frame identity (`video.frame_id_space`), and
    an identity space where adjacent ids name one observation is the rule violation this
    removes. The snap is to the smallest step that keeps every observation (50fps → 60, never
    30: dropping real frames is the one forbidden direction), capped at 240.

    An unknown rate (both probes 0) stays 60 — the historical default, and the honest "we
    cannot say" middle rather than a confident 30 derived from nothing.
    """
    rate = max(info.nominal_fps or 0.0, info.fps or 0.0)
    if rate <= 0:
        return 60
    for step in (30, 60, 120):
        if rate <= step + 5:
            return step
    return 240


def normalize(
    src: str | Path, dst: str | Path, short_side: int, fps: int = 60,
    itsscale: float | None = None,
) -> VideoInfo:
    """Transcode to CFR H.264 8-bit with rotation baked in and the short side scaled.

    ffmpeg applies the display matrix during decode, so the scale filter sees the upright
    frame; we then strip the rotation metadata so nothing double-applies it downstream.
    `-fps_mode cfr` replaces the deprecated `-vsync cfr` (ffmpeg 8.x).

    `itsscale` (see `retime_factor`) multiplies the SOURCE timestamps before the CFR resample
    — the slow-motion retime. It must precede `-i`; the same recipe `scripts/trimswing.py` has
    always applied by hand to phone slow-mo, now in the one place every clip passes through.

    The GOP is forced to 10 frames. libx264's default 250 put two keyframes in a whole
    6s clip, which made every browser seek decode up to 250 frames of 1080p and froze the
    picture during a scrub. 10 caps that at 9 frames for ~2x the bytes.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Scale whichever dimension is smaller to short_side, keeping AR. yuv420p requires even
    # dimensions in both axes.
    #
    # `force_divisible_by=2` is load-bearing and NOT redundant with the `-2` below:
    # `force_original_aspect_ratio` recomputes both dimensions from the aspect ratio *after*
    # `-2` has done its even-rounding, so the even constraint is silently lost and libx264
    # rejects the result. Measured: a 1148x2068 portrait clip scaled to 720x1297 and the whole
    # normalize step died with "height not divisible by 2" — the two fixture clips only ever
    # worked because their aspect ratios happened to land even.
    vf = (f"scale=w=if(lt(iw\\,ih)\\,{short_side}\\,-2):"
          f"h=if(lt(iw\\,ih)\\,-2\\,{short_side}):"
          f"force_original_aspect_ratio=decrease:force_divisible_by=2")

    retime = ["-itsscale", f"{itsscale:.10f}"] if itsscale else []
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", *retime, "-i", str(src),
         "-vf", vf, "-fps_mode", "cfr", "-r", str(fps),
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-g", "10", "-keyint_min", "10", "-sc_threshold", "0",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         "-metadata:s:v", "rotate=0", "-an", str(dst)],
        check=True, capture_output=True, text=True,
    )
    return probe(dst)


def upright_dims(info: VideoInfo) -> tuple[int, int]:
    """Display dimensions after rotation metadata is applied."""
    if abs(info.rotation) in (90, 270):
        return info.height, info.width
    return info.width, info.height
