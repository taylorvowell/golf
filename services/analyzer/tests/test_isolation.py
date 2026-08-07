"""Golfer+club isolation rings (scripts/isolate.py) — hermetic union + subtract logic."""
from __future__ import annotations

import numpy as np

from swingsage.isolation import frame_rings, payload, union_rings

W, H = 360, 640


def _gray(club_at=None):
    g = np.zeros((H, W), dtype=np.float32)
    g[300:420, 150:210] = 180.0                    # the body, static
    if club_at:
        cx, cy = club_at
        g[cy - 4:cy + 5, cx - 4:cx + 5] = 255.0    # the club head, moving
    return g


BODY_RINGS = [[[150 / W, 300 / H], [210 / W, 300 / H],
               [210 / W, 420 / H], [150 / W, 420 / H]]]


def _inside(rings, x_px, y_px):
    import cv2
    m = np.zeros((H, W), dtype=np.uint8)
    polys = [np.round(np.array(r) * [W, H]).astype(np.int32) for r in rings]
    cv2.fillPoly(m, polys, 1)
    return bool(m[y_px, x_px])


class TestUnionRings:
    def test_moving_club_near_grip_joins_the_union(self):
        rings = union_rings(_gray(club_at=(260, 250)), _gray(club_at=(280, 240)),
                            BODY_RINGS, grip=(200 / W, 320 / H))
        assert rings
        assert _inside(rings, 280, 240), "club not in the union"
        assert _inside(rings, 180, 360), "body not in the union"

    def test_far_mover_excluded(self):
        # something moving in the far corner (another golfer, a cart)
        a = _gray(); b = _gray()
        b[30:44, 20:34] = 255.0
        rings = union_rings(a, b, BODY_RINGS, grip=(200 / W, 320 / H))
        assert not _inside(rings, 27, 37), "far mover leaked into the union"
        assert _inside(rings, 180, 360)

    def test_no_body_no_grip_still_safe(self):
        rings = union_rings(_gray(), _gray(), None, None)
        assert rings == []


class TestClubOnly:
    def test_subtractive_view_keeps_club_drops_body(self):
        union, club = frame_rings(_gray(club_at=(260, 250)),
                                  _gray(club_at=(280, 240)),
                                  BODY_RINGS, grip=(200 / W, 320 / H))
        assert club, "club-only rings empty"
        assert _inside(club, 280, 240), "club missing from subtractive view"
        assert not _inside(club, 180, 360), "body leaked into the club-only view"
        # and the union still contains both
        assert _inside(union, 280, 240) and _inside(union, 180, 360)

    def test_static_scene_club_empty(self):
        union, club = frame_rings(_gray(), _gray(), BODY_RINGS,
                                  grip=(200 / W, 320 / H))
        assert club == []

    def test_payload_coverage(self):
        frames = [{"f": 0, "p": [[[0, 0], [0.1, 0], [0.1, 0.1]]]},
                  {"f": 1, "p": []}]
        d = payload(frames, W, H, 2)
        assert d["coverage"] == 0.5
        assert d["frames"] is frames
