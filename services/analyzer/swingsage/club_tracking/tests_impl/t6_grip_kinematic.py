"""Test 6 — Grip-Centered Kinematic Reconstruction (plan §15).

The club head relative to grip_center in polar form: anchor on confident visual head
detections, reconstruct between anchors from the grip path + smoothed unwrapped angle +
a slowly-varying projected-radius prior. The plan's critical correction is honored: the
2D projected radius is NEVER constant — perspective and out-of-plane orientation change
it, so radius gets a heavily-smoothed spline, not an equality constraint.

This is the cheapest baseline (~1 s) and the designated gap-filler expert for the fusion
tests. Its known ceiling (plan §15): 2D pose cannot uniquely determine an out-of-plane
club.
"""
from __future__ import annotations

import numpy as np
from scipy.interpolate import make_splrep

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register

ANCHOR_MIN_CONF = 0.35
INTERP_WEIGHT = 0.5     # artifact frames marked interp are already synthetic — half weight


def _grip_series(ctx: ClubTrackingContext, frames: np.ndarray) -> np.ndarray:
    """Grip (x, y) per requested frame, linearly interpolated across gaps."""
    known_f, known_x, known_y = [], [], []
    for f, g in enumerate(ctx.grip):
        if g is not None and g[2] > 0:
            known_f.append(f)
            known_x.append(g[0])
            known_y.append(g[1])
    kf = np.array(known_f, dtype=float)
    return np.stack([np.interp(frames, kf, np.array(known_x)),
                     np.interp(frames, kf, np.array(known_y))], axis=1)


def _grip_conf(ctx: ClubTrackingContext, f: int) -> float:
    g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
    return g[2] if g else 0.0


@register
class GripKinematicTracker:
    id = "t6_grip_kinematic"
    label = TEST_IDS["t6_grip_kinematic"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        frames = np.arange(n0, n1 + 1)
        grip = _grip_series(ctx, frames)

        # ---- anchors from the existing Stage 4 solve ----
        club_frames = (ctx.doc.get("club") or {}).get("frames") or []
        anchors = []  # (frame, x, y, weight)
        for cf in club_frames:
            f = cf.get("f")
            head = cf.get("head")
            conf = cf.get("conf", 0.0)
            if head is None or f is None or not n0 <= f <= n1:
                continue
            if conf < ANCHOR_MIN_CONF:
                continue
            w = conf * (INTERP_WEIGHT if cf.get("interp") else 1.0)
            anchors.append((f, head[0], head[1], w))

        if len(anchors) < 5:
            # Nothing to hang kinematics on — report honestly rather than inventing.
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"anchor_count": len(anchors),
                                              "reason": "insufficient_anchors"})

        af = np.array([a[0] for a in anchors], dtype=float)
        ax = np.array([a[1] for a in anchors])
        ay = np.array([a[2] for a in anchors])
        aw = np.clip(np.array([a[3] for a in anchors]), 1e-3, None)

        agrip = np.stack([np.interp(af, frames, grip[:, 0]),
                          np.interp(af, frames, grip[:, 1])], axis=1)
        rel = np.stack([ax, ay], axis=1) - agrip
        radius = np.linalg.norm(rel, axis=1)
        angle = np.unwrap(np.arctan2(rel[:, 1], rel[:, 0]))

        t = af / ctx.fps
        for i in range(1, len(t)):
            if t[i] <= t[i - 1]:
                t[i] = t[i - 1] + 1e-6
        k = min(3, len(t) - 1)
        # angle follows the data; radius is the slowly-varying prior (heavy smoothing)
        s_angle = make_splrep(t, angle, w=aw, k=k, s=0.05 * len(t))
        s_radius = make_splrep(t, radius, w=aw, k=k, s=1.0 * len(t))

        anchor_at = {int(a[0]): (a[1], a[2], a[3]) for a in anchors}
        anchor_fs = np.array(sorted(anchor_at))
        typical = float(np.median(np.diff(anchor_fs))) if len(anchor_fs) > 1 else 1.0

        obs: list[ClubObservation] = []
        for i, f in enumerate(frames):
            ts = f / ctx.fps
            if int(f) in anchor_at:
                x, y, w = anchor_at[int(f)]
                obs.append(ClubObservation(
                    frame=int(f), source_time_s=ts, x=float(x), y=float(y),
                    confidence=round(float(min(w, 1.0)), 5), mode="observed",
                    source="detector", visibility="visible"))
                continue
            th = float(s_angle(ts))
            r = float(max(s_radius(ts), 1e-4))
            x = float(np.clip(grip[i, 0] + r * np.cos(th), 0.0, 1.0))
            y = float(np.clip(grip[i, 1] + r * np.sin(th), 0.0, 1.0))
            d = float(np.min(np.abs(anchor_fs - f)))
            near_w = anchor_at[int(anchor_fs[np.argmin(np.abs(anchor_fs - f))])][2]
            conf = min(near_w, 1.0) * float(np.exp(-d / (6 * typical)))
            conf = min(conf, max(_grip_conf(ctx, int(f)), 0.05))
            obs.append(ClubObservation(
                frame=int(f), source_time_s=ts, x=x, y=y,
                confidence=round(max(conf, 0.01), 5), mode="inferred",
                source="kinematic", visibility="unobservable"))

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=obs,
            diagnostics={
                "anchor_count": len(anchors),
                "anchor_fraction": round(len(anchors) / max(len(frames), 1), 4),
                "radius_mean": round(float(np.mean(radius)), 5),
                "radius_spread": round(float(np.std(radius)), 5),
            })
