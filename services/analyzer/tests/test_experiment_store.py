"""Experiment schema + atomic merge (track step 05, D55). Hermetic: tmp dirs only."""
from __future__ import annotations

import json

from swingsage.club_tracking import (ClubObservation, ClubTrackingContext,
                                     ClubTrackingResult, EventEvidence)
from swingsage.club_tracking.experiment_store import (LOCK_NAME, build_experiment,
                                                      merge_experiment, split_gate)
from swingsage.club_tracking.pathfit import VARIANT_IDS, fit_variants

FPS = 60.0


def _ctx(frame_count=60):
    names = [f"kp_{i}" for i in range(5)] + ["grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0]] * 5 + [[0.5, 0.5, 0.9]],
               "st": 1, "interp": False} for f in range(frame_count)]
    doc = {
        "video": {"fps": FPS, "frame_count": frame_count, "width": 1080,
                  "height": 1920, "view": "dtl", "handedness": "right",
                  "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.6},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": 45, "conf": 0.9}},
        "metrics": {"untouched": True},
    }
    return doc, ClubTrackingContext.from_artifacts(doc)


def _result(frames=range(5, 46), mode="observed"):
    return ClubTrackingResult(
        test_id="t6_grip_kinematic", label="Grip-Centered Kinematic Reconstruction",
        version="1.0.0",
        observations=[ClubObservation(frame=f, source_time_s=f / FPS,
                                      x=0.3 + 0.004 * (f - 5), y=0.6 - 0.003 * (f - 5),
                                      confidence=0.8, mode=mode, source="kinematic",
                                      visibility="visible")
                      for f in frames],
        diagnostics={"anchors": 12},
    )


def _experiment():
    doc, ctx = _ctx()
    res = _result()
    variants = fit_variants(res.observations, FPS, (5, 45), top_frame=25)
    return doc, ctx, build_experiment(res, ctx, variants)


class TestBuild:
    def test_shape_snake_case_and_variants(self):
        _, _, exp = _experiment()
        assert exp["test"]["id"] == "t6_grip_kinematic"
        assert set(exp["trace"]["variants"]) == set(VARIANT_IDS)
        assert exp["trace"]["phase_spans"]["backswing"] == {
            "start_frame": 5, "end_frame": 25, "color_role": "backswing"}
        assert exp["trace"]["phase_spans"]["downswing"]["end_frame"] == 45
        assert exp["events"]["impact"]["source"] == "artifact"
        # snake_case discipline — no camelCase keys anywhere in the block
        def walk(d):
            if isinstance(d, dict):
                for k, v in d.items():
                    assert k == k.lower(), f"camelCase key {k}"
                    walk(v)
            elif isinstance(d, list):
                for v in d:
                    walk(v)
        walk(exp)

    def test_event_evidence_overrides_artifact(self):
        doc, ctx = _ctx()
        res = _result()
        res.event_evidence.append(EventEvidence(event="impact", time_s=44.4 / FPS,
                                                confidence=0.95, source="audio"))
        exp = build_experiment(res, ctx, fit_variants(res.observations, FPS, (5, 45),
                                                      top_frame=25))
        assert exp["events"]["impact"]["frame"] == 44
        assert exp["events"]["impact"]["source"] == "experiment"

    def test_all_observed_is_continuous(self):
        _, _, exp = _experiment()
        assert exp["trace"]["display_mode"] == "continuous"

    def test_split_gate_fires_on_long_inferred_top_gap(self):
        pts = []
        for f in range(5, 46):
            mode = "inferred" if 20 <= f <= 32 else "observed"  # 13 frames @60 = 217ms
            pts.append({"frame": f, "x": 0.5, "y": 0.5, "confidence": 0.5, "mode": mode})
        assert split_gate(pts, top_frame=25, fps=FPS) == "split_at_top"
        assert split_gate(pts, top_frame=45, fps=FPS) == "continuous"  # gap not at top


class TestMerge:
    def _write_artifact(self, tmp_path, doc):
        (tmp_path / "analysis.json").write_text(json.dumps(doc), encoding="utf-8")
        return tmp_path

    def test_merge_creates_block_and_preserves_rest(self, tmp_path):
        doc, ctx, exp = _experiment()
        out = self._write_artifact(tmp_path, doc)
        merge_experiment(out, exp)
        merged = json.loads((out / "analysis.json").read_text())
        assert merged["metrics"] == {"untouched": True}
        assert merged["video"] == doc["video"]
        assert merged["club_tracking"]["schema_version"] == 1
        assert "t6_grip_kinematic" in merged["club_tracking"]["experiments"]
        assert not (out / LOCK_NAME).exists()

    def test_remerge_replaces_own_entry_only(self, tmp_path):
        doc, ctx, exp = _experiment()
        out = self._write_artifact(tmp_path, doc)
        merge_experiment(out, exp)
        other = json.loads(json.dumps(exp))
        other["test"]["id"] = "t1_candidate_graph"
        merge_experiment(out, other)
        exp2 = json.loads(json.dumps(exp))
        exp2["diagnostics"]["anchors"] = 99
        merge_experiment(out, exp2)
        merged = json.loads((out / "analysis.json").read_text())
        exps = merged["club_tracking"]["experiments"]
        assert set(exps) == {"t6_grip_kinematic", "t1_candidate_graph"}
        assert exps["t6_grip_kinematic"]["diagnostics"]["anchors"] == 99
        assert exps["t1_candidate_graph"]["diagnostics"]["anchors"] == 12

    def test_stale_lock_is_broken(self, tmp_path):
        doc, ctx, exp = _experiment()
        out = self._write_artifact(tmp_path, doc)
        lock = out / LOCK_NAME
        lock.write_text("dead")
        import os
        old = lock.stat().st_mtime - 400
        os.utime(lock, (old, old))
        merge_experiment(out, exp)  # must not hang or raise
        assert not lock.exists()
