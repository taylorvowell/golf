"""Unit tests for the groundtruth package: schema validation and evaluators
against synthetic label/prediction pairs with known metric values, plus the
goldenset-marked run over real artifacts (excluded from the default run).
"""

import copy
import json
from pathlib import Path

import jsonschema
import pytest

from groundtruth import evaluate_body, evaluate_club, evaluate_events, goldenset
from groundtruth import labels as gt_labels
from groundtruth.import_head_markers import build_docs


# ---------------------------------------------------------------- label docs

def event_doc(**over):
    doc = {
        "schema": "event-labels",
        "schema_version": 1,
        "clip": "synthetic",
        "clock": "normalized",
        "fps": 60.0,
        "annotator": "test",
        "events": {
            "address": {"frame": 100, "confidence": 1.0},
            "top": {"frame": 160, "confidence": 0.9},
            "impact": {"frame": 200, "confidence": 1.0},
            "finish": {"frame": 240, "confidence": 0.8},
        },
    }
    doc.update(over)
    return doc


def club_doc(frames, intervals, **over):
    doc = {
        "schema": "club-pose-labels",
        "schema_version": 1,
        "clip": "synthetic",
        "clock": "normalized",
        "fps": 60.0,
        "annotator": "test",
        "labeled_intervals": intervals,
        "frames": frames,
    }
    doc.update(over)
    return doc


def five_points(x, y, v="visible"):
    """A colinear synthetic club: grip at (x,y), head 0.1 right of it."""
    return {
        "grip": {"x": x, "y": y, "v": v},
        "shaft_mid": {"x": x + 0.05, "y": y, "v": v},
        "hosel": {"x": x + 0.09, "y": y, "v": v},
        "head_a": {"x": x + 0.095, "y": y, "v": v},
        "head_b": {"x": x + 0.105, "y": y, "v": v},
    }


# ------------------------------------------------------------------- schemas

def test_valid_docs_pass():
    gt_labels.validate(event_doc())
    gt_labels.validate(club_doc(
        [{"frame": 5, "blur": "none", "annotator_confidence": 1.0,
          "points": five_points(0.4, 0.5)}],
        [{"start_frame": 5, "end_frame": 5}]))
    gt_labels.validate({
        "schema": "trim-labels", "schema_version": 1, "raw_clip": "raw/x.mp4",
        "annotator": "test", "strikes_ms": [20450.0], "audio_quality": "good",
    })


def test_event_order_enforced():
    doc = event_doc()
    doc["events"]["top"]["frame"] = 500  # after impact
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)


def test_event_missing_required_event_rejected():
    doc = event_doc()
    del doc["events"]["impact"]
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)


def test_event_abstention_is_explicit_null():
    doc = event_doc()
    doc["events"]["address"] = {"frame": None, "confidence": 0.2, "notes": "waggles"}
    gt_labels.validate(doc)


def test_club_interval_must_be_fully_rowed():
    doc = club_doc(
        [{"frame": 5, "blur": "none", "annotator_confidence": 1.0,
          "points": five_points(0.4, 0.5)}],
        [{"start_frame": 5, "end_frame": 7}])
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)


def test_club_unusable_frame_carries_no_points():
    doc = club_doc(
        [{"frame": 5, "blur": "unusable", "annotator_confidence": 0.1,
          "points": five_points(0.4, 0.5)}],
        [{"start_frame": 5, "end_frame": 5}])
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)


def test_head_center_reserved_for_player_corrections():
    frames = [{"frame": 5, "blur": "none", "annotator_confidence": 1.0,
               "points": {"head_center": {"x": 0.5, "y": 0.5, "v": "visible"}}}]
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(club_doc(frames, [{"start_frame": 5, "end_frame": 5}]))
    gt_labels.validate(club_doc(frames, [{"start_frame": 5, "end_frame": 5}],
                                provenance="player_correction", annotator="player"))


def test_trim_chosen_strike_membership():
    doc = {
        "schema": "trim-labels", "schema_version": 1, "raw_clip": "raw/x.mp4",
        "annotator": "test", "strikes_ms": [1000.0, 2000.0], "audio_quality": "good",
    }
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)  # two strikes, no chosen
    doc["chosen_swing_ms"] = 1500.0
    with pytest.raises(jsonschema.ValidationError):
        gt_labels.validate(doc)  # chosen not a member
    doc["chosen_swing_ms"] = 2000.0
    gt_labels.validate(doc)


# ------------------------------------------------------------------- events

def predictions(fps=60.0, **events):
    out = {"fps": fps}
    out.update(events)
    return out


def test_events_known_errors():
    rep = evaluate_events.evaluate_swing(event_doc(), predictions(
        address={"frame": 100, "conf": 0.9},   # exact
        top={"frame": 162, "conf": 0.5},        # +2
        impact={"frame": 240, "conf": 0.9},     # +40 -> catastrophic, high conf
        finish={"frame": 236, "conf": 0.7},     # -4
    ))
    ev = rep["events"]
    assert ev["address"]["error_frames"] == 0 and not ev["address"]["catastrophic"]
    assert ev["top"]["error_frames"] == 2
    assert ev["impact"]["error_frames"] == 40
    assert ev["impact"]["error_ms"] == pytest.approx(666.667, abs=0.01)
    assert ev["impact"]["catastrophic"] and ev["impact"]["high_confidence_catastrophic"]
    assert ev["finish"]["error_frames"] == -4 and not ev["finish"]["catastrophic"]

    agg = evaluate_events.aggregate([rep])["60"]
    assert agg["address"]["exact_rate"] == 1.0
    assert agg["top"]["within_2_rate"] == 1.0
    assert agg["impact"]["catastrophic"] == 1
    assert agg["impact"]["high_confidence_catastrophic"] == 1
    assert agg["finish"]["within_2_rate"] == 0.0 and agg["finish"]["within_4_rate"] == 1.0


def test_events_catastrophic_is_fps_relative():
    # 12 frames at 60 fps = 200 ms -> at the boundary, NOT catastrophic;
    # the same 12 frames at 30 fps = 400 ms -> catastrophic.
    doc60 = event_doc()
    rep60 = evaluate_events.evaluate_swing(doc60, predictions(
        impact={"frame": 212, "conf": 0.9}))
    assert rep60["events"]["impact"]["catastrophic"] is False
    doc30 = event_doc(fps=30.0)
    rep30 = evaluate_events.evaluate_swing(doc30, predictions(fps=30.0,
        impact={"frame": 212, "conf": 0.9}))
    assert rep30["events"]["impact"]["catastrophic"] is True


def test_events_stale_labels_refused():
    rep = evaluate_events.evaluate_swing(event_doc(fps=30.0), predictions(
        impact={"frame": 200, "conf": 0.9}))
    assert rep["stale_labels"] is True and rep["events"] == {}
    assert evaluate_events.aggregate([rep]) == {}


def test_events_abstentions_counted():
    doc = event_doc()
    doc["events"]["address"] = {"frame": None, "confidence": 0.2}
    rep = evaluate_events.evaluate_swing(doc, predictions(
        top={"frame": 160, "conf": 0.9},
        impact={"frame": 200, "conf": 0.9}))
    ev = rep["events"]
    assert ev["address"]["status"] == "label_abstained"
    assert ev["finish"]["status"] == "prediction_abstained"
    agg = evaluate_events.aggregate([rep])["60"]
    assert agg["finish"]["abstention_rate"] == 1.0


def test_events_takeaway_never_a_pipeline_abstention():
    doc = event_doc()
    doc["events"]["takeaway"] = {"frame": 120, "confidence": 0.9}
    rep = evaluate_events.evaluate_swing(doc, predictions(
        address={"frame": 100, "conf": 0.9},
        top={"frame": 160, "conf": 0.9},
        impact={"frame": 200, "conf": 0.9},
        finish={"frame": 240, "conf": 0.9}))
    assert rep["events"]["takeaway"]["status"] == "not_pipeline_scope"


def test_predictions_from_analysis_dict_shape():
    analysis = {
        "video": {"fps": 60.0},
        "events": {"impact": {"frame": 221, "conf": 0.98},
                   "address": {"frame": 150, "conf": 0.6},
                   "unknown_event": {"frame": 5, "conf": 0.5}},
    }
    pred = evaluate_events.predictions_from_analysis(analysis)
    assert pred["fps"] == 60.0
    assert pred["impact"] == {"frame": 221, "conf": 0.98}
    assert "unknown_event" not in pred


# --------------------------------------------------------------------- club

VIDEO = {"fps": 60.0, "width": 1000.0, "height": 1000.0}


def club_pred_frame(f, head, conf=0.9, interp=False, from_ball=False,
                    shaft_angle=0.0):
    return {"f": f, "head": list(head), "butt": [head[0] - 0.1, head[1]],
            "shaft": [[head[0] - 0.1, head[1]], list(head)], "conf": conf,
            "interp": interp, "from_ball": from_ball,
            "shaft_angle_deg": shaft_angle}


def test_club_known_errors():
    # Three labeled frames: exact hit, 6 px off, one propagated (gap).
    frames = [
        {"frame": 0, "blur": "none", "annotator_confidence": 1.0,
         "points": five_points(0.4, 0.5)},
        {"frame": 1, "blur": "mild", "annotator_confidence": 1.0,
         "points": five_points(0.42, 0.5)},
        {"frame": 2, "blur": "none", "annotator_confidence": 1.0,
         "points": five_points(0.44, 0.5)},
    ]
    doc = club_doc(frames, [{"start_frame": 0, "end_frame": 2}])
    # GT head centers: x + 0.1 -> 0.5, 0.52, 0.54 (y 0.5), in a 1000px image.
    club = {"frames": [
        club_pred_frame(0, (0.5, 0.5)),                       # 0 px
        club_pred_frame(1, (0.52, 0.506)),                    # 6 px (y)
        club_pred_frame(2, (0.54, 0.5), interp=True),         # gap frame
    ]}
    rep = evaluate_club.evaluate_clip(doc, club, VIDEO)
    assert rep["scored_frames"] == 2
    assert rep["pck_px"]["2"] == 0.5      # only the exact one within 2 px
    assert rep["pck_px"]["10"] == 1.0
    assert rep["head_center_median_px"] == pytest.approx(3.0)
    assert rep["visible_recall"] == pytest.approx(2 / 3, abs=1e-4)
    assert rep["visible_precision"] == 1.0
    assert rep["gap_count"] == 1 and rep["gap_frames_max"] == 1
    # GT shaft is horizontal (0 deg); predictions say 0 deg.
    assert rep["shaft_angle_mae_deg"] == pytest.approx(0.0)


def test_club_false_positive_on_unusable_frame():
    frames = [
        {"frame": 0, "blur": "unusable", "annotator_confidence": 0.1, "points": {}},
    ]
    doc = club_doc(frames, [{"start_frame": 0, "end_frame": 0}])
    club = {"frames": [club_pred_frame(0, (0.5, 0.5))]}  # direct claim on unusable GT
    rep = evaluate_club.evaluate_clip(doc, club, VIDEO)
    assert rep["false_positive_rate"] == 1.0
    assert rep["scored_frames"] == 0


def test_club_catastrophic_jump_detected():
    frames = [
        {"frame": 0, "blur": "none", "annotator_confidence": 1.0,
         "points": five_points(0.1, 0.5)},
        {"frame": 1, "blur": "none", "annotator_confidence": 1.0,
         "points": five_points(0.1, 0.5)},
    ]
    doc = club_doc(frames, [{"start_frame": 0, "end_frame": 1}])
    club = {"frames": [
        club_pred_frame(0, (0.1, 0.1)),
        club_pred_frame(1, (0.9, 0.9)),  # corner-to-corner in one frame
    ]}
    rep = evaluate_club.evaluate_clip(doc, club, VIDEO)
    assert rep["catastrophic_jumps"] == 1


def test_club_stale_labels_refused():
    doc = club_doc(
        [{"frame": 0, "blur": "none", "annotator_confidence": 1.0,
          "points": five_points(0.4, 0.5)}],
        [{"start_frame": 0, "end_frame": 0}], fps=30.0)
    rep = evaluate_club.evaluate_clip(doc, {"frames": []}, VIDEO)
    assert rep["stale_labels"] is True


def test_club_head_center_only_labels_score():
    doc = club_doc(
        [{"frame": 0, "blur": "none", "annotator_confidence": 1.0,
          "points": {"head_center": {"x": 0.5, "y": 0.5, "v": "visible"}}}],
        [{"start_frame": 0, "end_frame": 0}],
        provenance="player_correction", annotator="player")
    club = {"frames": [club_pred_frame(0, (0.5, 0.508))]}  # 8 px off
    rep = evaluate_club.evaluate_clip(doc, club, VIDEO)
    assert rep["scored_frames"] == 1
    assert rep["head_center_median_px"] == pytest.approx(8.0)
    assert rep["pck_px"]["5"] == 0.0 and rep["pck_px"]["10"] == 1.0


def test_club_impact_window():
    frames = [
        {"frame": f, "blur": "none", "annotator_confidence": 1.0,
         "points": five_points(0.4, 0.5)}
        for f in range(0, 30)
    ]
    doc = club_doc(frames, [{"start_frame": 0, "end_frame": 29}])
    club = {"frames": [
        club_pred_frame(f, (0.5, 0.5 + (0.02 if f == 20 else 0.0)))
        for f in range(0, 30)
    ]}
    rep = evaluate_club.evaluate_clip(doc, club, VIDEO, impact_frame=20)
    assert rep["impact_window_max_px"] == pytest.approx(20.0)
    assert rep["head_center_median_px"] == pytest.approx(0.0)


# --------------------------------------------------------------------- body

def test_body_known_errors():
    doc = {
        "schema": "body-pose-labels", "schema_version": 1, "clip": "synthetic",
        "clock": "normalized", "fps": 60.0, "annotator": "test",
        "frames": [{
            "frame": 10, "event": "impact", "annotator_confidence": 1.0,
            "points": {
                "left_shoulder": {"x": 0.4, "y": 0.3, "v": "visible"},
                "right_shoulder": {"x": 0.6, "y": 0.3, "v": "visible"},
            },
        }],
    }
    gt_labels.validate(doc)
    pose = {
        "keypoint_names": ["left_shoulder", "right_shoulder"],
        "frames": [{"f": 10, "kp": [[0.4, 0.305, 0.95], [0.6, 0.3, 0.95]]}],
    }
    rep = evaluate_body.evaluate_clip(doc, pose, VIDEO)
    assert rep["per_joint"]["left_shoulder"]["median_px"] == pytest.approx(5.0)
    assert rep["per_joint"]["right_shoulder"]["median_px"] == pytest.approx(0.0)
    assert rep["event_frames"]["impact"]["n"] == 2
    # GT line horizontal; predicted line tilted by atan(0.005/0.2) scaled to px.
    assert rep["line_angle_mae_deg"]["shoulder_line"] == pytest.approx(1.43, abs=0.02)
    assert rep["wrong_high_confidence_rate"] == 0.0


# ------------------------------------------------------------------ imports

def test_head_marker_import_builds_valid_doc():
    rows = [
        {"clip": "swing1", "frame": 200, "x": 0.5, "y": 0.6, "fps": 60.0,
         "artifact_revision": 3},
        {"clip": "swing1", "frame": 210, "x": 0.55, "y": 0.62, "fps": 60.0,
         "artifact_revision": 3},
    ]
    docs = build_docs(rows)
    assert set(docs) == {"swing1"}
    doc = docs["swing1"]
    assert doc["provenance"] == "player_correction"
    assert [f["frame"] for f in doc["frames"]] == [200, 210]
    assert doc["frames"][0]["points"]["head_center"]["x"] == 0.5


def test_head_marker_import_refuses_null_fps():
    with pytest.raises(ValueError):
        build_docs([{"clip": "swing1", "frame": 200, "x": 0.5, "y": 0.6, "fps": None}])


# ---------------------------------------------------------------- goldenset

def _mini_setup(tmp_path, impact_conf):
    """A one-clip golden world: manifest fps 60, impact 40 frames late."""
    out_root = tmp_path / "out" / "clip1"
    out_root.mkdir(parents=True)
    analysis = {
        "schema_version": 10,
        "video": {"fps": 60.0, "frame_count": 300, "width": 1000, "height": 1000},
        "events": {"address": {"frame": 100, "conf": 0.9},
                   "top": {"frame": 160, "conf": 0.9},
                   "impact": {"frame": 240, "conf": impact_conf},
                   "finish": {"frame": 260, "conf": 0.9}},
        "club": {"frames": [
            {"f": 0, "head": [0.5, 0.5], "conf": 0.2, "interp": True, "from_ball": False},
            {"f": 1, "head": [0.5, 0.5], "conf": 0.9, "interp": False, "from_ball": False},
        ]},
    }
    (out_root / "analysis.json").write_text(json.dumps(analysis))
    labels_root = tmp_path / "labels"
    labels_root.mkdir()
    doc = event_doc(clip="clip1")
    (labels_root / "clip1.events.json").write_text(json.dumps(doc))
    return tmp_path / "out", labels_root


def test_goldenset_report_gates_and_stability(tmp_path, monkeypatch):
    out_root, labels_root = _mini_setup(tmp_path, impact_conf=0.9)
    manifest = {"schema": "goldenset-manifest", "schema_version": 1,
                "clips": [{"stem": "clip1", "tier": "golden", "view": "dtl",
                           "handedness": "right", "golfer": "g1",
                           "recording": "r1", "club_type": "iron",
                           "fps_class": "60"}]}
    manifest_path = tmp_path / "goldenset.json"
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setattr(goldenset, "MANIFEST_PATH", manifest_path)

    rep1 = goldenset.build_report(out_root=out_root, labels_root=labels_root)
    rep2 = goldenset.build_report(out_root=out_root, labels_root=labels_root)
    # Byte-stable for identical inputs.
    assert json.dumps(rep1, sort_keys=True) == json.dumps(rep2, sort_keys=True)
    # The 40-frame high-confidence impact miss trips the hard gate.
    assert rep1["hard_gates"]["high_conf_catastrophic_impact"] == 1
    assert rep1["hard_gates"]["propagated_as_direct"] == 0
    assert rep1["hard_gates"]["frame_identity_mismatch"] == 0


def test_goldenset_diff_ratchet(tmp_path, monkeypatch):
    out_root, labels_root = _mini_setup(tmp_path, impact_conf=0.3)
    manifest = {"schema": "goldenset-manifest", "schema_version": 1,
                "clips": [{"stem": "clip1", "tier": "golden", "view": "dtl",
                           "handedness": "right", "golfer": "g1",
                           "recording": "r1", "club_type": "iron",
                           "fps_class": "60"}]}
    manifest_path = tmp_path / "goldenset.json"
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setattr(goldenset, "MANIFEST_PATH", manifest_path)

    accepted = goldenset.build_report(out_root=out_root, labels_root=labels_root)
    assert accepted["hard_gates"]["high_conf_catastrophic_impact"] == 0

    worse = copy.deepcopy(accepted)
    worse["hard_gates"]["high_conf_catastrophic_impact"] = 1
    d = goldenset.diff_reports(accepted, worse)
    assert d["hard_gate_failures"] and d["hard_gate_failures"][0]["gate"] == "high_conf_catastrophic_impact"

    better = copy.deepcopy(accepted)
    d2 = goldenset.diff_reports(accepted, better)
    assert d2["hard_gate_failures"] == []


# --------------------------------------------------- the real golden clips

REPO_FIXLABELS = Path(__file__).resolve().parents[3] / "fixtures" / "labels"
OUT = Path(__file__).resolve().parents[1] / "out"


@pytest.mark.goldenset
def test_goldenset_real_report():
    """Evaluate the real golden set. Local-footage bound; run with -m goldenset."""
    if not REPO_FIXLABELS.exists():
        pytest.skip("no fixtures/labels/ on this machine")
    report = goldenset.build_report()
    scored = [s for s, c in report["clips"].items()
              if isinstance(c.get("events"), dict) and not c["events"].get("stale_labels")]
    assert scored, "no golden clip had scoreable event labels"
    # The ratchet gates hold at their accepted baseline (see reports/accepted.json).
    assert report["hard_gates"]["propagated_as_direct"] == 0
    assert report["hard_gates"]["frame_identity_mismatch"] == 0


@pytest.mark.goldenset
def test_goldenset_reproduces_7wood1_impact_miss():
    """The evaluator must catch the known 40-frame 7wood-1 impact miss - the
    defect the audio witness found. If this stops failing-to-zero it means the
    labels or the artifact changed; if the evaluator misses it, the evaluator
    is broken (step 04's own acceptance criterion)."""
    label_path = REPO_FIXLABELS / "7wood-1.events.json"
    if not label_path.exists():
        pytest.skip("7wood-1 event labels absent on this machine")
    rep = evaluate_events.evaluate_out_dir(OUT / "7wood-1", REPO_FIXLABELS)
    impact = rep["events"]["impact"]
    assert impact["status"] == "scored"
    assert impact["catastrophic"] is True
    assert impact["error_frames"] >= 30, (
        f"expected the stored ~40-frame-late impact, got {impact['error_frames']:+d}"
    )
