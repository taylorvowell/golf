"""Golfer + club isolation rings (user request 2026-08-08).

The Stage 2b silhouette is BODY-ONLY — MediaPipe's segmenter does not know the club, so
the "Isolate the golfer" overlay dims the club out with the background. This module builds
the union: the body silhouette plus the moving components attached to (or reaching from)
it — physically, the only movers in a swing clip are the golfer and the club.

Written as a sidecar `isolation.json` with exactly silhouette.json's frame shape
({f, p: [rings]}), so the player renders it through the same even-odd fill path with zero
new drawing code. The frontend never does CV (non-negotiable): this file is produced here,
by `scripts/isolate.py`, and only ever *read* by the player.
"""
from __future__ import annotations

import numpy as np

SCHEMA = 1
DIFF_THRESH = 22.0
BODY_DILATE_PX = 9       # union margin — motion touching this ring counts as attached
MAX_GRIP_DIST = 0.45     # a mover farther than this from the hands is not the club —
                         # measured club_len is ~0.31 normalized, so this keeps 45% margin
MIN_BLOB_PX = 12
APPROX_EPS = 0.004       # polygon simplification, fraction of the long side


def _rasterize(rings: list, w: int, h: int) -> np.ndarray:
    import cv2
    m = np.zeros((h, w), dtype=np.uint8)
    polys = [np.round(np.array(r) * [w, h]).astype(np.int32) for r in rings
             if len(r) >= 3]
    if polys:
        cv2.fillPoly(m, polys, 1)
    return m


def union_rings(gray_prev: np.ndarray, gray_cur: np.ndarray,
                body_rings: list | None,
                grip: tuple[float, float] | None) -> list:
    """One frame's golfer+club rings (normalized), or [] when nothing is known."""
    import cv2
    from scipy import ndimage

    h, w = gray_cur.shape
    scale = float(max(h, w))

    body = (_rasterize(body_rings, w, h) if body_rings else
            np.zeros((h, w), dtype=np.uint8))
    kernel = np.ones((BODY_DILATE_PX, BODY_DILATE_PX), np.uint8)
    body_dil = cv2.dilate(body, kernel)

    motion = (np.abs(gray_cur.astype(np.float32) - gray_prev.astype(np.float32))
              >= DIFF_THRESH).astype(np.uint8)
    labels, n = ndimage.label(motion)
    keep = np.zeros_like(motion)
    for c in range(1, n + 1):
        comp = labels == c
        if comp.sum() < MIN_BLOB_PX:
            continue
        touches = bool((comp & (body_dil > 0)).any())
        near_grip = False
        if not touches and grip is not None:
            ys, xs = np.nonzero(comp)
            d = np.hypot(xs / scale - grip[0] * w / scale,
                         ys / scale - grip[1] * h / scale)
            near_grip = bool(d.min() <= MAX_GRIP_DIST)
        if touches or near_grip:
            keep |= comp

    union = ((body > 0) | (keep > 0)).astype(np.uint8)
    if not union.any():
        return []
    # close small gaps so club+body merge into clean rings
    union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(union, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    eps = APPROX_EPS * scale
    rings = []
    for c in contours:
        if cv2.contourArea(c) < MIN_BLOB_PX:
            continue
        approx = cv2.approxPolyDP(c, eps, True)
        if len(approx) < 3:
            continue
        pts = approx.reshape(-1, 2).astype(np.float64)
        rings.append([[round(float(x) / w, 4), round(float(y) / h, 4)]
                      for x, y in pts])
    return rings


def payload(frames: list[dict], w: int, h: int, frame_count: int) -> dict:
    covered = sum(1 for fr in frames if fr["p"])
    return {
        "schema": SCHEMA,
        "source": "isolation (body silhouette + attached motion)",
        "width": w, "height": h, "frame_count": frame_count,
        "coverage": round(covered / max(frame_count, 1), 4),
        "notes": [],
        "frames": frames,
    }
