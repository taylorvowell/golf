"""Test 11 — Synthetic Temporal Densification (plan §20).

2x densify the downswing between genuine source observations (flow-warped mid-frames),
run the SAME club-head detector on the synthetic frames, add the resulting candidates as
capped `vfi` evidence, and re-solve the same candidate graph. The ablation is live in the
menu: t11 vs t1 IS "with VFI vs without" on the identical downstream solver — plan §20's
required comparison, judged visually per the user's directive.
"""
from __future__ import annotations

import numpy as np

from ..candidates import harvest
from ..graph import solve
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubCandidate, ClubObservation
from ..registry import TEST_IDS, register
from ..vfi import cap_synthetic_conf, synth_midframe
from .t3_point_tracking import _load_window

DET_CONF_FLOOR = 0.15


def _default_detector():
    """The existing Stage 4b club-head detector, applied to single frames."""
    from pathlib import Path
    from ultralytics import YOLO
    weights = Path(__file__).resolve().parents[3] / "runs" / "clubhead" / "weights" / "best.pt"
    model = YOLO(str(weights))

    def detect(frame_rgb: np.ndarray) -> list[tuple[float, float, float]]:
        import cv2
        from ..red_gate import gated_heads
        bgr = cv2.cvtColor(frame_rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
        res = model.predict(bgr, conf=DET_CONF_FLOOR, verbose=False)[0]
        h, w = frame_rgb.shape[:2]
        names = res.names
        dets = []
        for b in res.boxes:
            x0, y0, x1, y1 = b.xyxy[0].tolist()
            dets.append({"c": 0 if names.get(int(b.cls[0])) == "clubhead" else 1,
                         "xy": [(x0 + x1) / 2 / w, (y0 + y1) / 2 / h],
                         "wh": [(x1 - x0) / w, (y1 - y0) / h],
                         "p": float(b.conf[0])})
        # HARD RULE (red_gate): a head with no shaft in the same result does not exist
        return [(d["xy"][0], d["xy"][1], d["p"])
                for d in gated_heads(dets, is_head=lambda d: d["c"] == 0,
                                     is_green=lambda d: d["c"] == 1)]

    return detect


@register
class TemporalDensificationTracker:
    id = "t11_temporal_densification"
    label = TEST_IDS["t11_temporal_densification"]
    version = "1.0.0"

    def __init__(self, flow_fn=None, detector=None, loader=None):
        self._flow_fn = flow_fn
        self._detector = detector
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        cands = harvest(ctx)
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        # densify the DOWNSWING between genuine source observations
        if ctx.source_timing is not None and ctx.source_timing.observations:
            reps = [o.normalized_frames[0] for o in ctx.source_timing.observations
                    if o.normalized_frames and top <= o.normalized_frames[0] <= n1]
        else:
            reps = list(range(top, n1 + 1))
        if len(reps) < 3:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_downswing_observations"})

        video = self._loader(ctx, n0, n1)
        if video is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})

        flow_fn = self._flow_fn
        detector = self._detector
        if flow_fn is None:
            from ..point_trackers.raft_adapter import make_raft
            flow_fn = make_raft()
        if detector is None:
            detector = _default_detector()

        def conf_near(f: int) -> float:
            near = [c.confidence for c in cands.get(f, [])]
            return max(near) if near else 0.3

        synth_hits = 0
        for a, b in zip(reps, reps[1:]):
            ia, ib = a - n0, b - n0
            if not (0 <= ia < video.shape[0] and 0 <= ib < video.shape[0]):
                continue
            flow = flow_fn(video[ia], video[ib])
            mid = synth_midframe(video[ia], video[ib], flow)
            mid_t = (a + b) / 2.0
            for x, y, p in detector(mid):
                capped = cap_synthetic_conf(p, conf_near(a), conf_near(b))
                if capped <= 0.02:
                    continue
                synth_hits += 1
                # attach to the EARLIER real frame's slot so the graph keeps one slot
                # per genuine observation, with the synthetic time carried in features
                cands.setdefault(a, []).append(ClubCandidate(
                    frame=a, source_time_s=mid_t / ctx.fps, x=x, y=y,
                    confidence=capped, source="vfi",
                    features={"synthetic": 1.0, "mid_frame": mid_t}))

        # identical downstream solve to t1
        groups = ([o.normalized_frames for o in ctx.source_timing.observations
                   if o.normalized_frames]
                  if ctx.source_timing is not None and ctx.source_timing.observations
                  else [[f] for f in sorted(cands)])
        obs_frames, cands_by_obs = [], []
        for gf in groups:
            pooled = []
            for f in gf:
                pooled.extend(cands.get(f, []))
            if pooled or cands_by_obs:
                obs_frames.append(gf[0])
                cands_by_obs.append(pooled)
        times = [f / ctx.fps for f in obs_frames]
        chain = solve(cands_by_obs, times)

        observations = [
            ClubObservation(
                frame=obs_frames[i], source_time_s=times[i], x=c.x, y=c.y,
                confidence=round(c.confidence, 5),
                mode="inferred" if c.source == "vfi" else "observed",
                source=c.source,
                visibility="unobservable" if c.source == "vfi" else "visible")
            for i, c in chain
        ]
        n_vfi = sum(1 for o in observations if o.source == "vfi")
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "synthetic_candidates": synth_hits,
                "vfi_points_chosen": n_vfi,
                "chosen": len(observations),
            })
