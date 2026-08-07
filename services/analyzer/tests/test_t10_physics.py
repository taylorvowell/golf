"""Test 10 physics/conic solver + event refiner (track step 09) — hermetic math checks.

Unit tests of the solver's behavior on synthetic data (noise suppression with outliers
present, gap honesty, conic locality, reversal detection) — not accuracy evaluation."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import available, get_test
from swingsage.club_tracking.event_refiner import refine
from swingsage.club_tracking.model import ClubCandidate, EventEvidence
from swingsage.club_tracking.physics_fit import solve

FPS = 60.0
RNG = np.random.default_rng(11)


def _truth(t):
    return 0.5 + 0.33 * np.sin(1.6 * t), 0.5 + 0.28 * np.cos(1.2 * t)


def _grip(n):
    ts = np.arange(n) / FPS
    return np.stack([0.45 + 0.03 * np.sin(ts), 0.5 - 0.02 * ts], axis=1)


def _cands(n=60, noise=0.006, gap=None, outliers=()):
    out, times = [], []
    for i in range(n):
        t = i / FPS
        times.append(t)
        if gap and gap[0] <= i < gap[1]:
            out.append([])
            continue
        x, y = _truth(t)
        slot = [ClubCandidate(frame=i, source_time_s=t,
                              x=float(np.clip(x + RNG.normal(0, noise), 0, 1)),
                              y=float(np.clip(y + RNG.normal(0, noise), 0, 1)),
                              confidence=0.6, source="detector", features={})]
        if i in outliers:
            slot.append(ClubCandidate(frame=i, source_time_s=t, x=0.9, y=0.1,
                                      confidence=0.95, source="detector", features={}))
        out.append(slot)
    return out, times


class TestSolve:
    def test_noise_suppressed_with_outliers_present(self):
        cands, times = _cands(outliers=(12, 25, 40))
        solved = solve(cands, times, _grip(60), downswing_from=30)
        assert solved is not None
        pts, assoc = solved
        errs = [np.hypot(pts[i, 0] - _truth(times[i])[0],
                         pts[i, 1] - _truth(times[i])[1]) for i in range(60)]
        assert float(np.mean(errs)) < 0.006, "solver did not beat raw noise"
        # the parked outliers must not capture the fit
        for i in (12, 25, 40):
            assert np.hypot(pts[i, 0] - 0.9, pts[i, 1] - 0.1) > 0.2

    def test_gap_solved_continuously(self):
        cands, times = _cands(gap=(20, 32))
        solved = solve(cands, times, _grip(60), downswing_from=None)
        assert solved is not None
        pts, assoc = solved
        assert all(a is None for a in assoc[20:32])
        for i in range(20, 32):
            tx, ty = _truth(times[i])
            assert np.hypot(pts[i, 0] - tx, pts[i, 1] - ty) < 0.08

    def test_too_few_candidates_returns_none(self):
        cands, times = _cands(n=8)
        for i in range(3, 8):
            cands[i] = []
        assert solve(cands, times, _grip(8)) is None

    def test_deterministic(self):
        cands, times = _cands()
        a = solve(cands, times, _grip(60), downswing_from=30)
        b = solve(cands, times, _grip(60), downswing_from=30)
        assert np.allclose(a[0], b[0])


class TestEventRefiner:
    def test_top_found_at_reversal(self):
        # out-and-back along an arc: reversal at i=40
        ts = np.arange(80) / FPS
        s = np.concatenate([np.linspace(0, 1.2, 40), np.linspace(1.2, 0.1, 40)])
        pts = np.stack([0.4 + 0.3 * np.sin(s), 0.8 - 0.4 * s], axis=1)
        ev = refine(pts, ts, artifact_top_time=40 / FPS)
        top = next(e for e in ev if e.event == "top")
        assert abs(top.time_s - 40 / FPS) <= 2.5 / FPS
        assert all(isinstance(e, EventEvidence) for e in ev)

    def test_impact_at_fast_corridor_pass(self):
        # hold still, swing away, return through the start region fast
        ts = np.arange(90) / FPS
        pts = np.zeros((90, 2))
        pts[:20] = (0.6, 0.8)                                # address hold
        up = np.linspace(0, 1, 35)
        pts[20:55] = np.stack([0.6 - 0.35 * up, 0.8 - 0.45 * up], axis=1)
        down = np.linspace(1, 0, 35) ** 0.5                  # accelerating INTO impact
        pts[55:] = np.stack([0.6 - 0.35 * down[:35], 0.8 - 0.45 * down[:35]], axis=1)
        ev = refine(pts, ts)
        imp = next((e for e in ev if e.event == "impact"), None)
        assert imp is not None
        assert imp.time_s > 55 / FPS
        addr = next((e for e in ev if e.event == "address"), None)
        assert addr is not None and addr.time_s <= 22 / FPS

    def test_short_input_is_silent(self):
        assert refine(np.zeros((5, 2)), np.arange(5) / FPS) == []


class TestTracker:
    def test_registered(self):
        assert "t10_physics_conic" in available()

    def test_runs_on_synthetic_artifact(self):
        n = 60
        names = ["kp", "grip_center"]
        frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.45, 0.5, 0.9]], "st": 1,
                   "interp": False} for f in range(n)]
        boxes = []
        for f in range(n):
            x, y = _truth(f / FPS)
            boxes.append({"f": f, "d": [{"c": 0, "xy": [float(x), float(y)],
                                         "wh": [0.02, 0.02], "p": 0.5},
                                        {"c": 1, "xy": [0.5, 0.5],
                                         "wh": [1.2, 1.2], "p": 0.9}]})
        doc = {
            "video": {"fps": FPS, "frame_count": n, "width": 1080, "height": 1920,
                      "view": "dtl", "handedness": "right",
                      "source": {"path": "x.mp4"}},
            "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
            "events": {"address": {"frame": 0, "conf": 0.9},
                       "top": {"frame": 30, "conf": 0.5},
                       "impact": {"frame": n - 1, "conf": 0.9}},
            "club": {"frames": [], "detector": {"names": {"0": "clubhead"},
                                                "boxes": boxes}},
        }
        from swingsage.club_tracking import ClubTrackingContext
        res = get_test("t10_physics_conic").run(ClubTrackingContext.from_artifacts(doc))
        assert len(res.observations) >= 50
        assert res.diagnostics["association_fraction"] > 0.9
        modes = {o.mode for o in res.observations}
        assert modes <= {"observed", "mixed", "inferred"}
