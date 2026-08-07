"""Ground-truth label schema (track step 03, plan §7) — validation and round-trips.
Hermetic: temp files only."""
from __future__ import annotations

import pytest

from swingsage.club_tracking.ground_truth import (AudioLabel, ClubLabel, EventLabel,
                                                  GroundTruth)


def _visible(f=10, x=0.5, y=0.5):
    return ClubLabel(source_frame=f, source_pts_s=f / 30.0, visibility="visible",
                     point=(x, y))


class TestClubLabel:
    def test_visible_needs_point_not_trajectory(self):
        _visible().validate()
        with pytest.raises(ValueError, match="visible"):
            ClubLabel(source_frame=1, source_pts_s=0.0,
                      visibility="visible").validate()
        with pytest.raises(ValueError, match="visible"):
            ClubLabel(source_frame=1, source_pts_s=0.0, visibility="visible",
                      point=(0.5, 0.5),
                      trajectory=(0.1, 0.1, 0.2, 0.2)).validate()

    def test_blur_streak_needs_trajectory_not_point(self):
        ClubLabel(source_frame=1, source_pts_s=0.0, visibility="blur_streak",
                  trajectory=(0.70, 0.44, 0.74, 0.41), confidence=0.8).validate()
        with pytest.raises(ValueError, match="blur_streak"):
            ClubLabel(source_frame=1, source_pts_s=0.0, visibility="blur_streak",
                      point=(0.5, 0.5),
                      trajectory=(0.1, 0.1, 0.2, 0.2)).validate()
        with pytest.raises(ValueError, match="blur_streak"):
            ClubLabel(source_frame=1, source_pts_s=0.0,
                      visibility="blur_streak").validate()

    def test_unobservable_carries_no_coordinates(self):
        ClubLabel(source_frame=1, source_pts_s=0.0,
                  visibility="unobservable").validate()
        with pytest.raises(ValueError, match="unobservable"):
            ClubLabel(source_frame=1, source_pts_s=0.0, visibility="unobservable",
                      point=(0.5, 0.5)).validate()

    def test_out_of_range_coordinate_rejected(self):
        with pytest.raises(ValueError, match="outside"):
            _visible(x=1.2).validate()

    def test_unknown_visibility_rejected(self):
        with pytest.raises(ValueError, match="visibility"):
            ClubLabel(source_frame=1, source_pts_s=0.0,
                      visibility="maybe").validate()


class TestEventLabel:
    def test_interval_and_fractional(self):
        EventLabel(event="impact", kind="frame_interval",
                   frame_lo=160, frame_hi=162).validate()
        EventLabel(event="top", kind="fractional", time_s=1.95).validate()
        with pytest.raises(ValueError, match="frame_hi"):
            EventLabel(event="impact", kind="frame_interval",
                       frame_lo=5, frame_hi=3).validate()
        with pytest.raises(ValueError, match="fractional"):
            EventLabel(event="top", kind="fractional", time_s=1.0,
                       frame_lo=1).validate()
        with pytest.raises(ValueError, match="event"):
            EventLabel(event="toe_up", kind="fractional", time_s=1.0).validate()


class TestGroundTruth:
    def test_save_load_round_trip(self, tmp_path):
        gt = GroundTruth(stem="x", view="dtl", handedness="right", labeler="t")
        gt.upsert(_visible(10))
        gt.upsert(ClubLabel(source_frame=11, source_pts_s=0.37,
                            visibility="unobservable"))
        gt.events.append(EventLabel(event="impact", kind="frame_interval",
                                    frame_lo=11, frame_hi=12))
        gt.audio = AudioLabel(transient_time_s=0.4, ambiguity="clean")
        p = gt.save(tmp_path / "x.club.json")
        assert GroundTruth.load(p).to_dict() == gt.to_dict()

    def test_labels_sorted_on_save(self, tmp_path):
        gt = GroundTruth(stem="x", view="dtl", handedness="right")
        gt.upsert(_visible(20))
        gt.upsert(_visible(5))
        d = gt.to_dict()
        assert [c["source_frame"] for c in d["club"]] == [5, 20]

    def test_upsert_replaces(self):
        gt = GroundTruth(stem="x", view="dtl", handedness="right")
        gt.upsert(_visible(10))
        gt.upsert(ClubLabel(source_frame=10, source_pts_s=0.33,
                            visibility="unobservable"))
        assert len(gt.club) == 1
        assert gt.get(10).visibility == "unobservable"

    def test_duplicate_frames_rejected(self):
        gt = GroundTruth(stem="x", view="dtl", handedness="right",
                         club=[_visible(10), _visible(10)])
        with pytest.raises(ValueError, match="duplicate"):
            gt.validate()

    def test_duplicate_event_rejected(self):
        gt = GroundTruth(stem="x", view="dtl", handedness="right",
                         events=[EventLabel(event="top", kind="fractional", time_s=1.0),
                                 EventLabel(event="top", kind="fractional", time_s=2.0)])
        with pytest.raises(ValueError, match="duplicate"):
            gt.validate()

    def test_save_refuses_invalid(self, tmp_path):
        gt = GroundTruth(stem="x", view="dtl", handedness="right",
                         club=[ClubLabel(source_frame=1, source_pts_s=0.0,
                                         visibility="visible")])
        with pytest.raises(ValueError):
            gt.save(tmp_path / "bad.json")
        assert not (tmp_path / "bad.json").exists()
