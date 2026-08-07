"""Test 4 — Video Object Segmentation (plan §13).

Per-frame SAM 2.1 point prompts at a velocity-predicted position, with the sanity gate
terminating a branch the moment the mask stops looking like a club head. Branches reseed
at the next reliable classical anchor. Segmenter and loader are injected; pytest fakes
them, the fixture runs use the real adapter.
"""
from __future__ import annotations

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from ..segmentation import VelocityPredictor, branch_verdict, mask_stats
from .t3_point_tracking import _load_window, _pick_anchors


@register
class VideoSegmentationTracker:
    id = "t4_video_segmentation"
    label = TEST_IDS["t4_video_segmentation"]
    version = "1.0.0"

    def __init__(self, segmenter=None, loader=None):
        self._segmenter = segmenter
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        anchors = _pick_anchors(ctx, n0, n1)
        if not anchors:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "insufficient_anchors"})

        video = self._loader(ctx, n0, n1)
        if video is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})
        h, w = video.shape[1:3]

        segmenter = self._segmenter
        if segmenter is None:
            from ..point_trackers.sam2_adapter import make_sam2
            segmenter = make_sam2()

        anchor_by_frame = {t: (x, y) for t, x, y in anchors}
        pred = VelocityPredictor()
        seeded = False
        deaths = 0
        observations: list[ClubObservation] = []

        for i in range(video.shape[0]):
            f = n0 + i
            g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
            grip = (g[0], g[1]) if g and g[2] > 0 else None

            prompt = None
            if f in anchor_by_frame:                    # (re)seed on reliable anchors
                prompt = anchor_by_frame[f]
                pred.reset()
            elif seeded:
                prompt = pred.predict()
            if prompt is None:
                continue

            mask = segmenter(video[i], (prompt[0] * w, prompt[1] * h))
            stats = mask_stats(mask) if mask is not None else None
            verdict = branch_verdict(stats, pred.predict(), grip)
            if verdict == "dead":
                seeded = False
                deaths += 1
                continue
            seeded = True
            pred.update(stats.cx, stats.cy)
            conf = 0.7 if verdict == "ok" else 0.4
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps,
                x=float(np.clip(stats.cx, 0, 1)), y=float(np.clip(stats.cy, 0, 1)),
                confidence=conf, mode="observed" if verdict == "ok" else "mixed",
                source="segmentation", visibility="visible"))

        modes = [o.mode for o in observations]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "anchors": len(anchors),
                "branch_deaths": deaths,
                "kept": len(observations),
                "observed_fraction": round(
                    modes.count("observed") / len(modes), 4) if modes else 0.0,
            })
