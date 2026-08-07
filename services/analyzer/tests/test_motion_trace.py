"""Second-wave motion tests (t13/t14/t15) — the envelope insight, hermetically.

Synthetic scene: a small bright 'head' sweeping an arc around a hub, plus a static-ish
'body' blob near the hub. The head must be recovered from the motion composite's outer
envelope; the body must not be."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.motion_trace import (composite, envelope_distance,
                                                  frame_head_pick, motion_mask,
                                                  outer_envelope)
from swingsage.club_tracking.tests_impl.t13_motion_composite import (
    MotionCompositeTracker)
from swingsage.club_tracking.tests_impl.t14_silhouette_subtract import (
    SilhouetteSubtractTracker)

FPS = 60.0
W, H = 360, 640
HUB = (0.5, 0.5)
R_HEAD = 0.22            # head radius from hub, normalized by max dim — stays in frame


def _head_pos(f):
    ang = -2.4 + 0.09 * f
    scale = max(W, H)
    return (HUB[0] + R_HEAD * np.cos(ang) * scale / W,
            HUB[1] + R_HEAD * np.sin(ang) * scale / H)


def _frame(f):
    img = np.zeros((H, W), dtype=np.float32)
    x, y = _head_pos(f)
    cx, cy = int(x * W), int(y * H)
    img[max(0, cy - 3):cy + 4, max(0, cx - 3):cx + 4] = 255.0     # the head
    # a jittering body blob near the hub (arms/torso motion)
    bx, by = int(0.5 * W) + (f % 3), int(0.55 * H)
    img[by - 20:by + 20, bx - 10:bx + 10] = 128.0 + 20 * (f % 2)
    return img


class TestEnvelope:
    def test_head_on_envelope_body_inside(self):
        frames = [_frame(f) for f in range(40)]
        masks = [motion_mask(frames[i - 1], frames[i]) for i in range(1, 40)]
        comp = composite(masks)
        env = outer_envelope(comp, HUB)
        assert (env > 0).sum() > 30
        # envelope radius near the head's sweep, not the body's
        assert abs(env[env > 0].max() - R_HEAD) < 0.06

    def test_frame_pick_lands_on_head(self):
        frames = [_frame(f) for f in range(40)]
        masks = [motion_mask(frames[i - 1], frames[i]) for i in range(1, 40)]
        env = outer_envelope(composite(masks), HUB)
        hits = 0
        for i, m in enumerate(masks):
            pick = frame_head_pick(m, HUB, env)
            if pick is None:
                continue
            x, y, _ = pick
            tx, ty = _head_pos(i + 1)
            # a frame-diff mask holds BOTH head positions (old and new) — a pick may
            # land on either edge of the pair, so the gate is the pair spacing
            if np.hypot((x - tx) * W, (y - ty) * H) < 16:
                hits += 1
        assert hits >= len(masks) * 0.7, f"only {hits}/{len(masks)} picks on the head"

    def test_envelope_distance_prior(self):
        frames = [_frame(f) for f in range(40)]
        masks = [motion_mask(frames[i - 1], frames[i]) for i in range(1, 40)]
        env = outer_envelope(composite(masks), HUB)
        on_path = envelope_distance(env, HUB, *_head_pos(20), (W, H))
        # an off-path candidate INSIDE the swept ring (a shoe/hand at half the club's
        # radius, at an angle the club really swept) — the t15 corridor's actual prey
        off_path = envelope_distance(env, HUB, 0.5 + 0.11 * max(W, H) / W, 0.5, (W, H))
        assert on_path < 0.05 < off_path


def _make_doc(n=40):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [HUB[0], HUB[1], 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 20, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": []},
    }


def _fake_loader(ctx, lo, hi):
    return np.stack([np.repeat(_frame(f)[..., None], 3, axis=2)
                     for f in range(lo, hi + 1)])


class TestT13:
    def test_registered_and_tracks(self):
        assert "t13_motion_composite" in available()
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = MotionCompositeTracker(loader=_fake_loader).run(ctx)
        assert len(res.observations) >= 25, res.diagnostics
        good = sum(1 for o in res.observations
                   if np.hypot((o.x - _head_pos(o.frame)[0]) * W,
                               (o.y - _head_pos(o.frame)[1]) * H) < 16)
        assert good >= len(res.observations) * 0.7
        assert all(o.source == "motion_envelope" for o in res.observations)


class TestT14:
    def test_registered_and_subtracts_body(self):
        assert "t14_silhouette_subtract" in available()
        # body mask covering the body-blob zone; the head sweep stays outside it
        body = np.zeros((H, W), dtype=bool)
        body[int(0.55 * H) - 25:int(0.55 * H) + 25,
             int(0.5 * W) - 15:int(0.5 * W) + 15] = True
        sils = {f: body for f in range(40)}
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = SilhouetteSubtractTracker(loader=_fake_loader,
                                        silhouettes=sils).run(ctx)
        assert res.observations, res.diagnostics
        for o in res.observations:
            tx, ty = _head_pos(o.frame)
            # pair spacing (~13px) + blob corner offset — same physics as the t13 gate
            assert np.hypot((o.x - tx) * W, (o.y - ty) * H) < 18, \
                "picked the body, not the club head"

    def test_no_silhouette_honest(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = SilhouetteSubtractTracker(loader=_fake_loader,
                                        silhouettes={}).run(ctx)
        assert res.diagnostics.get("reason") == "no_silhouette"


class TestT15:
    def test_registered(self):
        assert "t15_envelope_graph" in available()
