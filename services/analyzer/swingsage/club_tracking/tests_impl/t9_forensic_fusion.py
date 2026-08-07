"""Test 9 — Coarse-to-Fine Source-Time Forensic Fusion (plan §18).

Pass 1: coarse corridor from the strongest cached experiment. Pass 2: source-RESOLUTION
ROIs from the ORIGINAL upload (a 4K source has ~5x the club-head pixels the 720p analysis
derivative kept), sized by coarse uncertainty. Pass 3: the Stage-4b detector on each ROI.
Pass 4: solve in SOURCE time over genuine observations (duplicated CFR frames were never
decoded — the source demux IS the timeline). Pass 5: emit at representative normalized
frames; the path-fit registry samples the 60 fps player timeline.
"""
from __future__ import annotations

import numpy as np

from ..forensic import coarse_track, roi_for, roi_to_frame
from ..graph import solve
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubCandidate, ClubObservation
from ..registry import TEST_IDS, register

DET_CONF_FLOOR = 0.12


def _load_source_frames(ctx: ClubTrackingContext,
                        wanted: set[int]) -> dict[int, np.ndarray]:
    """Decode the ORIGINAL upload's frames by SOURCE index, upright."""
    if not ctx.source_path:
        return {}
    import cv2
    from pathlib import Path
    src = Path(ctx.source_path)
    if not src.is_file():
        return {}
    rot = ((ctx.doc.get("video") or {}).get("source") or {}).get("rotation", 0) or 0
    rot_map = {90: cv2.ROTATE_90_COUNTERCLOCKWISE, -90: cv2.ROTATE_90_CLOCKWISE,
               270: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, -180: cv2.ROTATE_180,
               -270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    out: dict[int, np.ndarray] = {}
    cap = cv2.VideoCapture(str(src))
    f = 0
    hi = max(wanted)
    while f <= hi:
        ok, img = cap.read()
        if not ok:
            break
        if f in wanted:
            k = rot_map.get(rot)
            if k is not None:
                img = cv2.rotate(img, k)
            out[f] = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        f += 1
    cap.release()
    return out


def _default_detector():
    from .t11_temporal_densification import _default_detector as d
    return d()


@register
class ForensicFusionTracker:
    id = "t9_forensic_fusion"
    label = TEST_IDS["t9_forensic_fusion"]
    version = "1.0.0"

    def __init__(self, detector=None, source_loader=None):
        self._detector = detector
        self._source_loader = source_loader or _load_source_frames

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        experiments = ((ctx.doc.get("club_tracking") or {}).get("experiments") or {})
        coarse = coarse_track(experiments)
        if not coarse:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "needs_cached_coarse_pass"})
        if ctx.source_timing is None or not ctx.source_timing.observations:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "needs_source_timing"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        # genuine source observations covering the swing, with their coarse prediction
        obs_list = []
        for o in ctx.source_timing.observations:
            if not o.normalized_frames:
                continue
            rep = o.normalized_frames[0]
            if not n0 <= rep <= n1 or rep not in coarse:
                continue
            obs_list.append((o.source_frame, o.source_pts_s, rep, coarse[rep]))
        if len(obs_list) < 6:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "too_few_source_observations"})

        frames = self._source_loader(ctx, {sf for sf, *_ in obs_list})
        if not frames:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "source_unreadable"})

        detector = self._detector or _default_detector()

        cands_by_obs: list[list[ClubCandidate]] = []
        times: list[float] = []
        reps: list[int] = []
        hits = 0
        base = obs_list[0][1]
        for sf, pts_s, rep, (cx, cy, conf) in obs_list:
            img = frames.get(sf)
            slot: list[ClubCandidate] = []
            if img is not None:
                h, w = img.shape[:2]
                roi = roi_for((cx, cy), conf, w, h)
                crop = img[roi[1]:roi[3], roi[0]:roi[2]]
                if crop.size:
                    for xr, yr, p in detector(crop):
                        fx, fy = roi_to_frame(xr, yr, roi, w, h)
                        slot.append(ClubCandidate(
                            frame=rep, source_time_s=pts_s, x=fx, y=fy,
                            confidence=p, source="detector",
                            features={"hires": 1.0}))
                        hits += 1
            # the coarse prediction rides along as a weak prior candidate
            slot.append(ClubCandidate(frame=rep, source_time_s=pts_s, x=cx, y=cy,
                                      confidence=min(conf, 0.45) * 0.6,
                                      source="fused", features={"coarse": 1.0}))
            cands_by_obs.append(slot)
            times.append(pts_s - base)     # SOURCE time, rebased — pass 4
            reps.append(rep)

        chain = solve(cands_by_obs, times)
        observations = []
        for i, c in chain:
            hires = c.features.get("hires")
            observations.append(ClubObservation(
                frame=reps[i], source_time_s=times[i] + base,
                x=float(np.clip(c.x, 0, 1)), y=float(np.clip(c.y, 0, 1)),
                confidence=round(c.confidence, 5),
                mode="observed" if hires else "mixed",
                source="detector" if hires else "fused",
                visibility="visible"))

        n_hires = sum(1 for o in observations if o.source == "detector")
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "source_observations": len(obs_list),
                "hires_detections": hits,
                "hires_points_chosen": n_hires,
                "coarse_points_chosen": len(observations) - n_hires,
            })
