"""Test 5 — Blur + Flow + Deblatting (plan §14).

Downswing-focused: streaks from frame differences where the head moved too fast to be a
crisp detection, flow advection where nothing at all was measured. Base positions come
from the classical solve; this test only fills the hard interval — its value shows on the
frames every detector declined.
"""
from __future__ import annotations

import numpy as np

from ..blur import advect, extract_streaks
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window

BASE_MIN_CONF = 0.5


@register
class BlurFlowTracker:
    id = "t5_blur_flow"
    label = TEST_IDS["t5_blur_flow"]
    version = "1.0.0"

    def __init__(self, flow_fn=None, loader=None):
        self._flow_fn = flow_fn
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        base: dict[int, tuple[float, float, float]] = {}
        for cf in (ctx.doc.get("club") or {}).get("frames") or []:
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if (head is not None and f is not None and n0 <= f <= n1
                    and conf >= BASE_MIN_CONF and not cf.get("interp")):
                base[f] = (head[0], head[1], conf)
        if len(base) < 5:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "insufficient_base"})

        video = self._loader(ctx, n0, n1)
        if video is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})
        h, w = video.shape[1:3]
        gray = video.mean(axis=3)

        obs: dict[int, ClubObservation] = {
            f: ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                               confidence=round(c, 5), mode="observed",
                               source="detector", visibility="visible")
            for f, (x, y, c) in base.items()
        }

        def nearest_base(f: int):
            ks = sorted(base)
            k = min(ks, key=lambda q: abs(q - f))
            return base[k], k

        # ---- streaks on the frames the classical solve declined ----
        streak_count = 0
        missing = [f for f in range(n0 + 1, n1 + 1) if f not in obs]
        for f in missing:
            i = f - n0
            diff = np.abs(gray[i] - gray[i - 1])
            (bx, by, _), bf = nearest_base(f)
            # expected direction: from the base positions bracketing f
            ks = sorted(base)
            after = next((k for k in ks if k > f), None)
            before = next((k for k in reversed(ks) if k < f), None)
            exp_dir = None
            if after is not None and before is not None:
                exp_dir = ((base[after][0] - base[before][0]) * w,
                           (base[after][1] - base[before][1]) * h)
            g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
            grip_px = (g[0] * w, g[1] * h) if g and g[2] > 0 else None
            streaks = extract_streaks(diff, exp_dir, grip_px, f, f / ctx.fps)
            if not streaks:
                continue
            s = streaks[0]
            # sanity: the tip must be near the base track, not a bird
            if np.hypot(s.end_x - bx, s.end_y - by) > 0.25:
                continue
            streak_count += 1
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=s.end_x, y=s.end_y,
                confidence=round(s.confidence * 0.8, 5), mode="mixed",
                source="deblatting", visibility="blur_streak")

        # ---- flow advection for what is STILL missing ----
        advected = 0
        still = [f for f in range(n0 + 1, n1 + 1) if f not in obs]
        if still:
            flow_fn = self._flow_fn
            if flow_fn is None:
                from ..point_trackers.raft_adapter import make_raft
                flow_fn = make_raft()
            for f in still:
                prev = obs.get(f - 1)
                if prev is None or prev.confidence < 0.1:
                    continue
                i = f - n0
                flow = flow_fn(video[i - 1], video[i])
                nx, ny = advect((prev.x, prev.y), flow)
                advected += 1
                obs[f] = ClubObservation(
                    frame=f, source_time_s=f / ctx.fps, x=nx, y=ny,
                    confidence=round(max(prev.confidence * 0.75, 0.05), 5),
                    mode="inferred", source="raft", visibility="unobservable")

        ordered = [obs[f] for f in sorted(obs)]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=ordered,
            diagnostics={
                "base_points": len(base),
                "streaks_used": streak_count,
                "flow_advected": advected,
                "coverage": round(len(ordered) / max(n1 - n0 + 1, 1), 4),
            })
