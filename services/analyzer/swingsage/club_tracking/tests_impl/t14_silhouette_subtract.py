"""Test 14 — Silhouette-Subtracted Motion (user brainstorm).

"The only movement in the scene is the person and the club": subtract the golfer's stored
silhouette (Stage 2b) from each frame's motion mask — what remains near the grip is club
(+ball). The head is the remaining blob's extremal point from the grip. No models beyond
what the artifact already carries.
"""
from __future__ import annotations

import json

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..motion_trace import motion_mask
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window

MAX_GRIP_DIST = 0.55     # a blob farther than this from the hands is not the club
MIN_BLOB_PX = 15
DILATE_PX = 7            # body mask margin — pose silhouettes hug the torso tightly


def _silhouette_masks(ctx: ClubTrackingContext, shape: tuple[int, int]):
    """frame -> boolean body mask rasterized from silhouette.json, or None."""
    if ctx.out_dir is None:
        return None
    p = ctx.out_dir / "silhouette.json"
    if not p.exists():
        return None
    import cv2
    doc = json.loads(p.read_text(encoding="utf-8"))
    h, w = shape
    kernel = np.ones((DILATE_PX, DILATE_PX), np.uint8)
    out: dict[int, np.ndarray] = {}
    for fr in doc.get("frames", []):
        contours = fr.get("p") or []
        if not contours:
            continue
        m = np.zeros((h, w), dtype=np.uint8)
        polys = [np.round(np.array(c) * [w, h]).astype(np.int32) for c in contours
                 if len(c) >= 3]
        if not polys:
            continue
        cv2.fillPoly(m, polys, 1)
        out[fr["f"]] = cv2.dilate(m, kernel).astype(bool)
    return out or None


@register
class SilhouetteSubtractTracker:
    id = "t14_silhouette_subtract"
    label = TEST_IDS["t14_silhouette_subtract"]
    version = "1.0.0"

    def __init__(self, loader=None, silhouettes=None):
        self._loader = loader or _load_window
        self._silhouettes = silhouettes      # test injection

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        video = self._loader(ctx, n0, n1)
        if video is None or video.shape[0] < 3:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})
        h, w = video.shape[1:3]
        sil = (self._silhouettes if self._silhouettes is not None
               else _silhouette_masks(ctx, (h, w)))
        if not sil:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_silhouette",
                                                   "hint": "run scripts/resegment.py"})

        from scipy import ndimage
        gray = video.mean(axis=3)
        scale = float(max(h, w))
        observations = []
        subtracted_all = 0
        for i in range(1, gray.shape[0]):
            f = n0 + i
            g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
            if not g or g[2] <= 0:
                continue
            m = motion_mask(gray[i - 1], gray[i])
            body = sil.get(f)
            if body is not None:
                m = m & ~body
            labels, ncomp = ndimage.label(m)
            best = None
            for c in range(1, ncomp + 1):
                ys, xs = np.nonzero(labels == c)
                if xs.size < MIN_BLOB_PX:
                    continue
                d = np.hypot(xs / scale - g[0] * w / scale,
                             ys / scale - g[1] * h / scale)
                if d.min() > MAX_GRIP_DIST:
                    continue                     # not attached/near the golfer
                k = int(np.argmax(d))
                cand = (float(d[k]), float(xs[k]) / w, float(ys[k]) / h, xs.size)
                if best is None or cand[0] > best[0]:
                    best = cand                  # farthest reach wins — that's the head
            if best is None:
                continue
            subtracted_all += 1
            _, x, y, npx = best
            conf = float(np.clip(0.25 + npx / 2500.0, 0.1, 0.75))
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(conf, 5), mode="observed",
                source="silhouette_subtract", visibility="visible"))

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"frames_with_club_blob": subtracted_all,
                         "silhouette_frames": len(sil)})
