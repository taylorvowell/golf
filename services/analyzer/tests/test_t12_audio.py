"""Test 12 audio impact (track step 13) — synthetic waveforms, no ffmpeg."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.audio_impact import SR, find_impact, onset_strength
from swingsage.club_tracking.tests_impl.t12_av_impact import AudioVisualImpactTracker

FPS = 60.0
RNG = np.random.default_rng(3)


def _wav(seconds=6.0, clicks=(), noise=0.004):
    w = RNG.normal(0, noise, int(SR * seconds)).astype(np.float32)
    for t, amp in clicks:
        i = int(t * SR)
        n = int(0.004 * SR)                      # 4 ms strike transient
        w[i:i + n] += amp * np.sign(RNG.normal(0, 1, n)).astype(np.float32)
    return w


class TestFindImpact:
    def test_click_found(self):
        wav = _wav(clicks=[(3.2, 0.6)])
        hit = find_impact(wav, (2.8, 3.6))
        assert hit is not None
        assert abs(hit["time_s"] - 3.2) < 0.02
        assert not hit["ambiguous"]

    def test_click_outside_window_ignored(self):
        wav = _wav(clicks=[(1.0, 0.6)])
        assert find_impact(wav, (2.8, 3.6)) is None

    def test_competing_click_flags_ambiguity(self):
        wav = _wav(clicks=[(3.2, 0.6), (3.45, 0.5)])
        hit = find_impact(wav, (2.8, 3.6))
        assert hit is not None and hit["ambiguous"]

    def test_pure_noise_returns_none(self):
        assert find_impact(_wav(), (2.8, 3.6)) is None

    def test_no_audio_returns_none(self):
        assert find_impact(None, (0.0, 1.0)) is None
        assert find_impact(np.zeros(0, dtype=np.float32), (0.0, 1.0)) is None

    def test_onset_strength_shape(self):
        env = onset_strength(_wav(seconds=1.0))
        assert env.ndim == 1 and env.size > 50


def _make_doc(n=240, impact=200):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club_frames = [{"f": f, "head": [0.3 + 0.001 * f, 0.6], "conf": 0.9,
                    "interp": False} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 20, "conf": 0.9},
                   "top": {"frame": 140, "conf": 0.5},
                   "impact": {"frame": impact, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


class TestTracker:
    def test_registered(self):
        assert "t12_av_impact" in available()

    def test_agreeing_audio_becomes_impact_evidence(self):
        # visual impact at frame 200 -> 3.333 s; click 40 ms later (mic delay)
        wav = _wav(clicks=[(200 / FPS + 0.04, 0.6)])
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = AudioVisualImpactTracker(audio_loader=lambda c: wav).run(ctx)
        imp = [e for e in res.event_evidence if e.event == "impact"]
        assert len(imp) == 1
        assert imp[0].source == "audio"
        assert abs(imp[0].time_s - (200 / FPS + 0.04)) < 0.02
        assert imp[0].confidence >= 0.85
        assert abs(res.diagnostics["av_delta_ms"] - 40) < 20

    def test_disagreeing_audio_exposed_not_used(self):
        wav = _wav(clicks=[(200 / FPS + 0.4, 0.8)])   # 400 ms off — not the strike
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = AudioVisualImpactTracker(audio_loader=lambda c: wav).run(ctx)
        assert res.event_evidence == []
        assert res.diagnostics.get("av_disagreement") is True

    def test_no_audio_falls_back_silently(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = AudioVisualImpactTracker(audio_loader=lambda c: None).run(ctx)
        assert res.observations and res.event_evidence == []
        assert res.diagnostics["has_audio"] is False
