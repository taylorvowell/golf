"""Test 1 candidate graph (track step 08) — the DP must prefer the coherent path.

Hermetic: synthetic candidate streams. The load-bearing check is decoy rejection — a
high-confidence detection far off the path (the 'shoe') loses to low-confidence
detections that form a smooth chain (plan §3.4)."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available, get_test
from swingsage.club_tracking.graph import solve
from swingsage.club_tracking.model import ClubCandidate

FPS = 60.0


def _cand(f, x, y, conf, source="detector"):
    return ClubCandidate(frame=f, source_time_s=f / FPS, x=x, y=y,
                         confidence=conf, source=source,
                         features={"det_score": conf})


def _path(f):
    t = f / FPS
    return 0.3 + 0.35 * np.sin(1.9 * t), 0.55 + 0.3 * np.cos(1.4 * t)


class TestSolve:
    def test_decoy_rejected_for_coherent_chain(self):
        cands, times = [], []
        for f in range(40):
            x, y = _path(f)
            slot = [_cand(f, float(x), float(y), 0.35)]      # weak but on-path
            if 10 <= f <= 30:
                slot.append(_cand(f, 0.85, 0.95, 0.95))      # strong, parked on a shoe
            cands.append(slot)
            times.append(f / FPS)
        chain = solve(cands, times)
        assert len(chain) >= 35
        for _, c in chain:
            assert c.confidence == 0.35, "DP picked the stationary decoy"

    def test_gap_bridged_by_skip_edges(self):
        cands, times = [], []
        for f in range(40):
            x, y = _path(f)
            slot = [] if 15 <= f < 23 else [_cand(f, float(x), float(y), 0.8)]
            cands.append(slot)
            times.append(f / FPS)
        chain = solve(cands, times)
        picked = [i for i, _ in chain]
        assert any(i < 15 for i in picked) and any(i >= 23 for i in picked), \
            "chain did not survive an 8-observation gap"

    def test_empty_input(self):
        assert solve([], []) == []
        assert solve([[], [], []], [0.0, 0.1, 0.2]) == []

    def test_deterministic(self):
        cands = [[_cand(f, *map(float, _path(f)), 0.5)] for f in range(20)]
        times = [f / FPS for f in range(20)]
        a = solve(cands, times)
        b = solve(cands, times)
        assert [(i, c.x, c.y) for i, c in a] == [(i, c.x, c.y) for i, c in b]


def _make_doc(dup=False):
    """Artifact with raw detector boxes; `dup=True` adds source timing where every
    observation shows on two CFR frames (30->60 style)."""
    n = 60
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.45, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = []
    for f in range(n):
        x, y = _path(f)
        dets = [{"c": 0, "xy": [float(x), float(y)], "wh": [0.02, 0.02], "p": 0.4},
                {"c": 1, "xy": [0.5, 0.5], "wh": [0.3, 0.2], "p": 0.9}]  # stick ignored
        boxes.append({"f": f, "d": dets})
    doc = {
        "video": {"fps": FPS, "frame_count": n, "width": 1080, "height": 1920,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": [], "detector": {"names": {"0": "clubhead", "1": "stick"},
                                            "boxes": boxes}},
    }
    timing = None
    if dup:
        obs = [{"source_frame": i, "source_pts_s": i / 30.0,
                "normalized_frames": [2 * i, 2 * i + 1], "is_duplicate_group": True}
               for i in range(n // 2)]
        timing = {"nominal_fps": 30.0, "avg_fps": 30.0, "time_base": "1/30000",
                  "start_time_s": 0.0, "duration_s": 1.0, "has_audio": False,
                  "audio_sample_rate": None, "audio_codec": None,
                  "distinct_observation_count": len(obs), "observations": obs}
    return doc, timing


class TestTracker:
    def test_registered(self):
        assert "t1_candidate_graph" in available()

    def test_runs_and_ignores_stick_class(self):
        doc, _ = _make_doc()
        res = get_test("t1_candidate_graph").run(
            ClubTrackingContext.from_artifacts(doc))
        assert len(res.observations) >= 50
        for o in res.observations:
            tx, ty = _path(o.frame)
            assert abs(o.x - tx) < 0.02 and abs(o.y - ty) < 0.02, \
                "picked the stick-class decoy"

    def test_duplicated_cfr_frames_are_one_observation(self):
        doc, timing = _make_doc(dup=True)
        res = get_test("t1_candidate_graph").run(
            ClubTrackingContext.from_artifacts(doc, timing_doc=timing))
        # One chosen point per SOURCE observation, at each group's first normalized frame.
        frames = [o.frame for o in res.observations]
        assert all(f % 2 == 0 for f in frames), \
            "evidence attributed to duplicated CFR frames, not source observations"
        assert res.diagnostics["observation_slots"] <= 30
