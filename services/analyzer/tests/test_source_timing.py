"""Source-timing invariants — pure functions only, no ffprobe, no video.

`map_observations` is the single place mapping logic lives; these tests pin its contract:
the union of normalized_frames is exactly [0, out_frame_count), each index once, in order,
regardless of the source cadence. `_parse_probe` is pinned against canned ffprobe JSON so
audio metadata extraction never needs a media file.
"""
from __future__ import annotations

import pytest

from swingsage.source_timing import (SourceTiming, _parse_probe, map_observations)


def _flat(obs):
    return [n for o in obs for n in o.normalized_frames]


def _assert_partition(obs, out_frame_count):
    assert _flat(obs) == list(range(out_frame_count))
    assert [o.source_pts_s for o in obs] == sorted(o.source_pts_s for o in obs)
    for o in obs:
        assert o.is_duplicate_group == (len(o.normalized_frames) > 1)


def _pts(fps: float, n: int, start: float = 0.0):
    return [start + i / fps for i in range(n)]


class TestMapObservations:
    def test_30_to_60_every_observation_duplicated(self):
        obs = map_observations(_pts(30.0, 100), out_fps=60.0, out_frame_count=200)
        _assert_partition(obs, 200)
        assert all(len(o.normalized_frames) == 2 for o in obs)
        assert all(o.is_duplicate_group for o in obs)

    def test_exact_60_is_one_to_one(self):
        obs = map_observations(_pts(60.0, 150), out_fps=60.0, out_frame_count=150)
        _assert_partition(obs, 150)
        assert all(len(o.normalized_frames) == 1 for o in obs)
        assert not any(o.is_duplicate_group for o in obs)

    def test_ntsc_5994_to_60_mostly_one_to_one(self):
        # 59.94 -> 60: roughly one duplicate per second, never a drop.
        obs = map_observations(_pts(59.94, 300), out_fps=60.0, out_frame_count=301)
        _assert_partition(obs, 301)
        sizes = [len(o.normalized_frames) for o in obs]
        assert min(sizes) >= 1
        assert max(sizes) == 2
        assert sizes.count(2) <= 2

    def test_120_to_60_drops_half(self):
        obs = map_observations(_pts(120.0, 200), out_fps=60.0, out_frame_count=100)
        _assert_partition(obs, 100)
        dropped = [o for o in obs if not o.normalized_frames]
        assert len(dropped) == pytest.approx(100, abs=2)
        assert not any(o.is_duplicate_group for o in dropped)

    def test_vfr_jitter_keeps_partition(self):
        # Deterministic pseudo-jitter around 45 fps — between duplicate and drop regimes.
        pts, t = [], 0.0
        for i in range(120):
            t += 1 / 45.0 + ((i * 7919) % 13 - 6) * 0.0005
            pts.append(t)
        obs = map_observations(pts, out_fps=60.0, out_frame_count=160)
        _assert_partition(obs, 160)

    def test_nonzero_start_time_is_rebased(self):
        shifted = map_observations(_pts(30.0, 50, start=3.7), 60.0, 100)
        zero = map_observations(_pts(30.0, 50), 60.0, 100)
        assert [o.normalized_frames for o in shifted] == \
               [o.normalized_frames for o in zero]

    def test_empty_and_degenerate_inputs(self):
        assert map_observations([], 60.0, 100) == []
        assert map_observations([0.0, 0.5], 0.0, 100) == []
        assert map_observations([0.0, 0.5], 60.0, 0) == []

    def test_trailing_output_frames_stick_to_last_observation(self):
        # Output timeline longer than the source: the tail pads on the final frame,
        # never invents an observation.
        obs = map_observations(_pts(60.0, 10), out_fps=60.0, out_frame_count=15)
        _assert_partition(obs, 15)
        assert obs[-1].normalized_frames == [9, 10, 11, 12, 13, 14]


class TestParseProbe:
    VIDEO_STREAM = {
        "codec_type": "video", "codec_name": "hevc",
        "r_frame_rate": "60/1", "avg_frame_rate": "59284/1000",
        "time_base": "1/600", "start_time": "0.000000", "duration": "8.65",
        "width": 3840, "height": 2160,
    }

    def test_audio_present(self):
        meta = _parse_probe({
            "streams": [self.VIDEO_STREAM,
                        {"codec_type": "audio", "codec_name": "aac",
                         "sample_rate": "48000"}],
            "format": {"duration": "8.66"},
        })
        assert meta["has_audio"] is True
        assert meta["audio_sample_rate"] == 48000
        assert meta["audio_codec"] == "aac"
        assert meta["nominal_fps"] == 60.0
        assert meta["avg_fps"] == pytest.approx(59.284)
        assert meta["time_base"] == "1/600"
        assert meta["duration_s"] == pytest.approx(8.65)

    def test_audio_absent(self):
        meta = _parse_probe({"streams": [self.VIDEO_STREAM], "format": {}})
        assert meta["has_audio"] is False
        assert meta["audio_sample_rate"] is None
        assert meta["audio_codec"] is None

    def test_stream_order_does_not_matter(self):
        meta = _parse_probe({
            "streams": [{"codec_type": "audio", "codec_name": "aac",
                         "sample_rate": "44100"}, self.VIDEO_STREAM],
            "format": {},
        })
        assert meta["has_audio"] is True
        assert meta["audio_sample_rate"] == 44100

    def test_no_video_stream_raises(self):
        with pytest.raises(ValueError):
            _parse_probe({"streams": [{"codec_type": "audio"}], "format": {}})

    def test_missing_fields_degrade_to_defaults(self):
        meta = _parse_probe({"streams": [{"codec_type": "video"}], "format": {}})
        assert meta["nominal_fps"] == 0.0
        assert meta["start_time_s"] == 0.0
        assert meta["duration_s"] == 0.0
        assert meta["time_base"] == "?"


class TestSourceTimingRoundTrip:
    def test_to_dict_from_dict_round_trip(self):
        t = SourceTiming(
            nominal_fps=30.0, avg_fps=30.02, time_base="1/30000",
            start_time_s=0.0, duration_s=13.8, has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            observations=map_observations(_pts(30.0, 40), 60.0, 80),
        )
        d = t.to_dict()
        assert d["schema_version"] == 1
        assert d["distinct_observation_count"] == 40
        assert SourceTiming.from_dict(d) == t
