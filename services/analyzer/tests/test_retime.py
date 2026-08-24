"""The slow-motion retime decision: when a clip's timeline is put back on the world's clock.

Pure — no ffmpeg, no files. The decision is the part that can be quietly wrong in both
directions: retiming a real-time clip stretches a good swing into nonsense, and NOT retiming
a phone slow-mo analyses a swing that appears to take twenty seconds (every tempo and
velocity number 8x wrong — the first hosted import, 2026-08-23).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage.video import VideoInfo, retime_factor  # noqa: E402


def _info(fps: float) -> VideoInfo:
    return VideoInfo(
        path="x.mp4", width=1080, height=1920, fps=fps, nominal_fps=fps,
        frame_count=int(fps * 5), duration=5.0, codec="h264", rotation=0, is_vfr=False,
    )


def test_phone_slowmo_retimes_to_the_capture_clock():
    # 240 captured, written at 30 — the classic 8x slow-mo.
    assert retime_factor(_info(30.0), 240.0) == 30.0 / 240.0


def test_realtime_clip_never_retimes():
    assert retime_factor(_info(60.0), 0.0) is None       # no stamp at all
    assert retime_factor(_info(30.0), 30.0) is None      # stamp equals the container
    assert retime_factor(_info(29.97), 30.0) is None     # rounding noise, not slow motion


def test_threshold_blocks_near_rate_stamps():
    # Below 1.5x the stamp is treated as measurement noise, never as slow motion.
    assert retime_factor(_info(30.0), 44.0) is None
    assert retime_factor(_info(30.0), 45.0) == 30.0 / 45.0


def test_unreadable_container_rate_refuses_rather_than_divides():
    assert retime_factor(_info(0.0), 240.0) is None
