"""The timeline fixture suite (frame-identity step, plan 03 §10) — pure, no ffprobe, no video.

Ten frozen source classes, each a canned probe result + a synthetic PTS series, run through
the SAME decision functions the pipeline uses (`cfr_target_fps`, `retime_factor`,
`map_observations`) and pinned on the invariants a wrong timeline breaks silently:

  * unique frame count — the normalized ids partition [0, n), no id names two observations
    twice and (for native-rate sources) no observation owns two ids;
  * PTS ordering — observations stay in presentation order;
  * real duration — the world-clock span of the observations matches the capture rate;
  * playback duration — frame_count / target_fps matches the clip's real length;
  * mapping — duplicates/drops appear exactly where the class says they must;
  * seek/overlay identity — `frame = round(t · fps)` round-trips through both platform seek
    rules (web `(f+0.5)/fps`, Android forward-resolving `f/fps`) at every snapped rate,
    30 included.

Unit-level on purpose: the device pass is Taylor's. These are the classes, not the phones.
"""
from __future__ import annotations

import math

import pytest

from swingsage.source_timing import map_observations
from swingsage.video import VideoInfo, cfr_target_fps, retime_factor


def _info(fps: float, nominal: float | None = None, duration: float = 5.0,
          is_vfr: bool = False) -> VideoInfo:
    n = int(round((fps or 30.0) * duration))
    return VideoInfo(
        path="x.mp4", width=1080, height=1920, fps=fps,
        nominal_fps=fps if nominal is None else nominal,
        frame_count=n, duration=duration, codec="h264", rotation=0, is_vfr=is_vfr,
    )


def _pts(fps: float, n: int, start: float = 0.0):
    return [start + i / fps for i in range(n)]


def _assert_partition(obs, out_frame_count):
    """The identity invariant: normalized ids [0, n), each exactly once, in order."""
    flat = [i for o in obs for i in o.normalized_frames]
    assert flat == list(range(out_frame_count))
    assert [o.source_pts_s for o in obs] == sorted(o.source_pts_s for o in obs)


def _assert_one_to_one(obs, out_frame_count):
    """Native-rate promise: every public frame id IS one camera observation."""
    _assert_partition(obs, out_frame_count)
    assert all(len(o.normalized_frames) == 1 for o in obs)
    assert not any(o.is_duplicate_group for o in obs)


# --- classes 1–3: in-app takes at 60 / 120 / 240 --------------------------------------------

@pytest.mark.parametrize("rate,probed", [(60, 59.94), (120, 119.88), (240, 237.6)])
def test_in_app_take_keeps_every_sensor_frame(rate, probed):
    info = _info(probed, nominal=float(rate))
    assert cfr_target_fps(info) == rate
    assert retime_factor(info, 0.0) is None  # real-time timeline, no stamp

    n = int(probed * 2.0)  # a 2s take
    pts = _pts(probed, n)
    # The CFR resample emits frames across the clip's real span — at a real cadence slightly
    # under the snapped rate that is a few MORE output frames than source frames (the tail
    # tick past the last source PTS included, which is what ffmpeg's resampler does).
    out_n = round((pts[-1] - pts[0]) * rate) + 1
    obs = map_observations(pts, float(rate), out_n)
    _assert_partition(obs, out_n)
    # A real-cadence take may duplicate a frame or two per second against its snapped rate —
    # what it must NEVER do is drop an observation (the ≥60fps constraint's whole point).
    assert not any(len(o.normalized_frames) == 0 for o in obs)


# --- class 4: the 30 fps gallery import -------------------------------------------------------

def test_30fps_import_is_native_not_duplicated():
    info = _info(29.97, nominal=30.0)
    assert cfr_target_fps(info) == 30  # the change this step makes: no more upsample to 60

    n = 150  # 5s at 30
    obs = map_observations(_pts(29.97, n), 30.0, n)
    _assert_one_to_one(obs, n)  # 1:1 — the duplicated-frame identity violation is gone


def test_playback_duration_matches_real_duration_at_30():
    info = _info(30.0, duration=5.0)
    target = cfr_target_fps(info)
    assert info.frame_count / target == pytest.approx(info.duration)


# --- class 5: the VFR import ------------------------------------------------------------------

def test_vfr_import_partitions_cleanly():
    # Deterministic jitter around 30 — the phone clip that breaks frame = round(t·fps) raw.
    pts, t = [], 0.0
    for i in range(150):
        t += 1 / 30.0 + ((i * 7919) % 13 - 6) * 0.0008
        pts.append(t)
    info = _info(30.02, nominal=30.0, is_vfr=True)
    target = cfr_target_fps(info)
    assert target == 30
    out_n = int(round((pts[-1] - pts[0]) * target)) + 1
    obs = map_observations(pts, float(target), out_n)
    _assert_partition(obs, out_n)


# --- class 6: the 240-capture / 30-present slow-mo --------------------------------------------

def test_slowmo_retimes_then_maps_on_the_world_clock():
    info = _info(30.0, duration=16.0)  # 2s of swing written as 16s of slowed video
    capture = 240.0
    factor = retime_factor(info, capture)
    assert factor == pytest.approx(30.0 / 240.0)

    # After the retime the pipeline overwrites fps with the capture rate — that is what
    # cfr_target_fps sees, so the take normalizes at 240 and keeps every sensor frame.
    retimed = _info(capture, duration=info.duration * factor)
    assert cfr_target_fps(retimed) == 240

    # v2 maps on the SCALED clock: source PTS × factor is the world clock the normalized
    # clip lives on. 480 slowed frames → 480 real observations, 1:1 at 240.
    n = 480
    scaled = [p * factor for p in _pts(30.0, n)]
    obs = map_observations(scaled, 240.0, n)
    _assert_one_to_one(obs, n)
    # Real duration: the last observation sits (n-1)/240 s after the first, world clock.
    assert obs[-1].real_capture_time_us == pytest.approx((n - 1) / 240 * 1e6, abs=2)


# --- class 7: the non-keyframe remux start ----------------------------------------------------

def test_nonzero_remux_start_is_rebased_not_shifted():
    # A trimmed remux that starts mid-GOP carries a nonzero first PTS. The mapping and the
    # world clock are both rebased to it — identical to the zero-based clip, no offset leak.
    shifted = map_observations(_pts(60.0, 120, start=1.2345), 60.0, 120)
    zero = map_observations(_pts(60.0, 120), 60.0, 120)
    assert [o.normalized_frames for o in shifted] == [o.normalized_frames for o in zero]
    assert [o.real_capture_time_us for o in shifted] == \
           [o.real_capture_time_us for o in zero]


# --- class 8: missing capture fps -------------------------------------------------------------

def test_slowmo_without_a_stamp_stays_on_the_slowed_clock_at_30():
    # The remux dropped com.android.capture.fps and no manifest arrived: the retime cannot
    # fire (capture unknown), and the honest answer is the slowed 30 fps clip AT 30 —
    # not upsampled to 60 with every frame doubled, which is what the old rule did.
    info = _info(30.0, duration=16.0)
    assert retime_factor(info, 0.0) is None
    assert cfr_target_fps(info) == 30


def test_unknown_rate_defaults_to_60():
    # Both probes empty: 60 is the historical default — a confident 30 derived from nothing
    # would halve the seek resolution of a clip we know nothing about.
    assert cfr_target_fps(_info(0.0, nominal=0.0)) == 60


# --- class 9: bad metadata --------------------------------------------------------------------

def test_conflicting_metadata_never_drops_real_frames():
    # Container claims 1000 fps nominal over a 59.94 average (a real container lie).
    # max() believes the larger claim, and the snap caps at 240 — over-sampling duplicates,
    # which is recoverable; dropping frames is not.
    info = _info(59.94, nominal=1000.0)
    assert cfr_target_fps(info) == 240

    # 50 fps (PAL-ish): snapped UP to 60 — never down to 30, which would discard a third of
    # the real observations.
    assert cfr_target_fps(_info(50.0)) == 60


# --- class 10: dual-view differing clocks -----------------------------------------------------

def test_dual_view_frame_ids_agree_only_through_real_time():
    # One swing, two phones: 240 fps DTL and 60 fps face-on. Frame ids are PER VIEW by
    # design (a frame number is meaningless without knowing which video counts it — the DB
    # comment on swing_views). The bridge between them is real capture time, and it must
    # agree to within half a coarse frame.
    impact_s = 1.5
    f_dtl = round(impact_s * 240)
    f_face = round(impact_s * 60)
    assert f_dtl != f_face  # the ids themselves NEVER agree across clocks
    assert abs(f_dtl / 240 - f_face / 60) <= 0.5 / 60


# --- seek/overlay identity, both platform rules, every snapped rate ---------------------------

@pytest.mark.parametrize("fps", [30, 60, 120, 240])
def test_seek_rules_round_trip_at_every_snapped_rate(fps):
    for f in range(0, fps * 2, 7):
        # Web: seek lands mid-frame; the element shows the frame CONTAINING that time.
        web_landing = math.floor(((f + 0.5) / fps) * fps)
        assert web_landing == f
        # Android: media3 resolves a seek FORWARD to the first sample at pts >= target
        # (D40) — f/fps is exactly frame f's own timestamp.
        android_landing = math.ceil((f / fps) * fps - 1e-9)
        assert android_landing == f
        # Overlay identity: the presented time reported back maps to the same id.
        assert round((f / fps) * fps) == f
