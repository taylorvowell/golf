"""Golfer+club isolation rings (scripts/isolate.py) — hermetic union logic."""
from __future__ import annotations

import numpy as np

from swingsage.isolation import payload, union_rings

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

    def test_payload_coverage(self):
        frames = [{"f": 0, "p": [[[0, 0], [0.1, 0], [0.1, 0.1]]]},
                  {"f": 1, "p": []}]
        d = payload(frames, W, H, 2)
        assert d["coverage"] == 0.5
        assert d["frames"] is frames
