"""Path-fit registry (track step 04, plan §22) — hermetic tests over synthetic
observations. These are unit tests of the MATH (noise suppression, gap honesty,
determinism), not swing-accuracy evaluation — the user judges real traces by eye."""
from __future__ import annotations

import numpy as np
import pytest

from swingsage.club_tracking.model import ClubObservation
from swingsage.club_tracking.pathfit import VARIANT_IDS, VARIANT_LABELS, fit_variants

FPS = 60.0
RNG = np.random.default_rng(7)


def _truth(t):
    """A smooth swing-arc-ish parametric curve inside [0,1]^2."""
    return (0.5 + 0.3 * np.sin(1.7 * t), 0.5 + 0.25 * np.cos(1.3 * t))


def _make_obs(n=40, noise=0.004, gap=None, outlier_at=None, conf=0.9):
    obs = []
    for i in range(n):
        f = 100 + i
        if gap and gap[0] <= i < gap[1]:
            continue
        t = f / FPS
        x, y = _truth(t)
        x += RNG.normal(0, noise)
        y += RNG.normal(0, noise)
        if outlier_at is not None and i == outlier_at:
            x += 0.3
        obs.append(ClubObservation(frame=f, source_time_s=t, x=float(np.clip(x, 0, 1)),
                                   y=float(np.clip(y, 0, 1)), confidence=conf,
                                   mode="observed", source="detector",
                                   visibility="visible"))
    return obs


FRAME_RANGE = (100, 139)


class TestRegistryShape:
    def test_all_ten_variants_same_grid(self):
        v = fit_variants(_make_obs(), FPS, FRAME_RANGE)
        assert set(v) == set(VARIANT_IDS) == set(VARIANT_LABELS)
        for vid, pts in v.items():
            assert [p["frame"] for p in pts] == list(range(100, 140)), vid

    def test_coords_in_unit_square_and_json_ready(self):
        v = fit_variants(_make_obs(), FPS, FRAME_RANGE)
        for vid, pts in v.items():
            for p in pts:
                assert 0.0 <= p["x"] <= 1.0 and 0.0 <= p["y"] <= 1.0, vid
                assert p["mode"] in ("observed", "mixed", "inferred")
                assert 0.0 <= p["confidence"] <= 1.0
                assert isinstance(p["x"], float) and isinstance(p["frame"], int)

    def test_deterministic(self):
        obs = _make_obs()
        assert fit_variants(obs, FPS, FRAME_RANGE) == fit_variants(obs, FPS, FRAME_RANGE)

    def test_empty_and_degenerate(self):
        assert fit_variants([], FPS, FRAME_RANGE) == {}
        few = _make_obs(n=3)
        v = fit_variants(few, FPS, (100, 102))
        assert set(v) == set(VARIANT_IDS)  # linear fallback, no crash


class TestFitQuality:
    def test_approximators_suppress_noise(self):
        obs = _make_obs(noise=0.006)
        v = fit_variants(obs, FPS, FRAME_RANGE)

        def rms(pts):
            e = []
            for p in pts:
                tx, ty = _truth(p["frame"] / FPS)
                e.append((p["x"] - tx) ** 2 + (p["y"] - ty) ** 2)
            return float(np.sqrt(np.mean(e)))

        raw_rms = rms([{"frame": o.frame, "x": o.x, "y": o.y} for o in obs])
        for vid in ("default", "b", "h"):
            assert rms(v[vid]) < raw_rms, f"{vid} did not smooth below raw noise"

    def test_interpolant_g_passes_through_anchors(self):
        obs = _make_obs(noise=0.0, conf=1.0)
        v = fit_variants(obs, FPS, FRAME_RANGE)
        by_frame = {p["frame"]: p for p in v["g"]}
        for o in obs:
            p = by_frame[o.frame]
            assert abs(p["x"] - o.x) < 1e-6 and abs(p["y"] - o.y) < 1e-6

    def test_outlier_rejected_by_default_fit(self):
        clean = fit_variants(_make_obs(noise=0.0), FPS, FRAME_RANGE)
        dirty = fit_variants(_make_obs(noise=0.0, outlier_at=20), FPS, FRAME_RANGE)
        f = 120
        pc = next(p for p in clean["default"] if p["frame"] == f)
        pd = next(p for p in dirty["default"] if p["frame"] == f)
        assert abs(pd["x"] - pc["x"]) < 0.03, "0.3 outlier moved the robust fit > 10%"

    def test_endpoints_pinned(self):
        obs = _make_obs(noise=0.003)
        v = fit_variants(obs, FPS, FRAME_RANGE)
        for vid, pts in v.items():
            assert abs(pts[0]["x"] - obs[0].x) < 5e-3, vid
            assert abs(pts[-1]["x"] - obs[-1].x) < 5e-3, vid

    def test_phase_split_join_is_continuous(self):
        v = fit_variants(_make_obs(), FPS, FRAME_RANGE, top_frame=120)
        pts = v["d"]
        for a, b in zip(pts, pts[1:]):
            step = abs(b["x"] - a["x"]) + abs(b["y"] - a["y"])
            assert step < 0.05, f"variant d jumps {step:.3f} at frame {b['frame']}"


class TestGapHonesty:
    def test_gap_interior_is_inferred_with_decayed_confidence(self):
        obs = _make_obs(gap=(15, 25))
        v = fit_variants(obs, FPS, FRAME_RANGE)
        pts = v["default"]
        gap_frames = range(100 + 17, 100 + 23)  # interior, clear of the edges
        near = next(p for p in pts if p["frame"] == 100 + 10)
        for f in gap_frames:
            p = next(q for q in pts if q["frame"] == f)
            assert p["mode"] == "inferred", f"frame {f} in a 10-frame gap not inferred"
            assert p["confidence"] < near["confidence"], "bridge as confident as data"

    def test_observed_frames_marked_observed(self):
        v = fit_variants(_make_obs(), FPS, FRAME_RANGE)
        modes = {p["mode"] for p in v["default"]}
        assert "observed" in modes

    def test_bridge_never_exceeds_bounding_confidence(self):
        obs = _make_obs(gap=(15, 25), conf=0.6)
        v = fit_variants(obs, FPS, FRAME_RANGE)
        for p in v["default"]:
            assert p["confidence"] <= 0.6 + 1e-9
