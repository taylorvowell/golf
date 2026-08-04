"""Stage 0 — probe + normalize (doc 02).

Why normalization is mandatory, demonstrated by the first real fixture:
  * rotation=-90 metadata (phone portrait) — must be baked into pixels or MediaPipe sees a
    sideways golfer.
  * VFR (r_frame_rate 60/1 vs avg_frame_rate 59.945) — breaks frame = round(t * fps) in the
    player, which is the #1 perceived-quality feature.
  * 4K 10-bit HEVC — too slow for CV, and not reliably playable in a browser.

We emit two derivatives, both CFR:
  normalized.mp4  short side 1080 — what the player loads and the burn-in renders onto
  analysis.mp4    short side  720 — what the CV pipeline consumes (doc 02: analyze small,
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


def normalize(src: str | Path, dst: str | Path, short_side: int, fps: int = 60) -> VideoInfo:
    """Transcode to CFR H.264 8-bit with rotation baked in and the short side scaled.

    ffmpeg applies the display matrix during decode, so the scale filter sees the upright
    frame; we then strip the rotation metadata so nothing double-applies it downstream.
    `-fps_mode cfr` replaces the deprecated `-vsync cfr` (ffmpeg 8.x) — see DECISIONS.md D3.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Scale whichever dimension is smaller to short_side, keeping AR; -2 keeps even dims,
    # which yuv420p requires. Never upscale.
    vf = (f"scale=w=if(lt(iw\\,ih)\\,{short_side}\\,-2):"
          f"h=if(lt(iw\\,ih)\\,-2\\,{short_side}):force_original_aspect_ratio=decrease")

    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", str(src),
         "-vf", vf, "-fps_mode", "cfr", "-r", str(fps),
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
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


def crop_scale(src, dst, bbox, info: VideoInfo, long_side: int = 768, fps: int = 60):
    """Crop to `bbox` (normalized, upright space) straight from the ORIGINAL source.

    Cropping before scaling is what makes small-in-frame golfers tractable: MediaPipe's
    landmark model sees a ~256px ROI regardless of input size, so a golfer occupying 17% of
    frame width wastes almost all of it on background. Cropping from the 4K original instead
    of the downscaled analysis video keeps the real detail that the first pass discarded.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)

    uw, uh = upright_dims(info)
    x0, y0, x1, y1 = bbox
    cw = max(16, int(round((x1 - x0) * uw)) // 2 * 2)
    ch = max(16, int(round((y1 - y0) * uh)) // 2 * 2)
    cx = min(max(0, int(round(x0 * uw)) // 2 * 2), max(0, uw - cw))
    cy = min(max(0, int(round(y0 * uh)) // 2 * 2), max(0, uh - ch))

    # Scale the crop up/down so its long side hits long_side — the golfer then fills the
    # frame the landmark model actually sees.
    if ch >= cw:
        vf = f"crop={cw}:{ch}:{cx}:{cy},scale=-2:{long_side}"
    else:
        vf = f"crop={cw}:{ch}:{cx}:{cy},scale={long_side}:-2"

    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", str(src),
         "-vf", vf, "-fps_mode", "cfr", "-r", str(fps),
         "-c:v", "libx264", "-preset", "medium", "-crf", "16",
         "-pix_fmt", "yuv420p", "-metadata:s:v", "rotate=0", "-an", str(dst)],
        check=True, capture_output=True, text=True,
    )
    # Return the crop actually applied, in normalized source coords, for coordinate remap.
    applied = (cx / uw, cy / uh, (cx + cw) / uw, (cy + ch) / uh)
    return probe(dst), applied
