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


def _mask_to_rings(mask: np.ndarray, kernel: np.ndarray, w: int, h: int) -> list:
    import cv2
    if not mask.any():
        return []
    closed = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    eps = APPROX_EPS * float(max(h, w))
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


FOOT_RADIUS = 0.055      # exclusion disk around each foot keypoint, of the long side —
                         # shoe shuffle and turf spray are never the club (user directive);
                         # the ball/club at address sits laterally OUTSIDE these disks


def frame_rings(gray_prev: np.ndarray, gray_cur: np.ndarray,
                body_rings: list | None,
                grip: tuple[float, float] | None,
                feet: list[tuple[float, float]] | None = None) -> tuple[list, list]:
    """One frame's (golfer+club union rings, CLUB-ONLY rings), both normalized.

    Club-only is the SUBTRACTIVE view (user request 2026-08-08): the kept moving
    components minus the body mask — the shaft/head poking out of the golfer survives
    because the subtraction uses the raw body, while attachment testing uses the dilated
    one. `feet` are normalized foot-keypoint positions; motion inside their exclusion
    disks is dropped from the CLUB view only (it stays golfer in the union). One pass
    computes both; the generator is too slow to run twice."""
    import cv2
    from scipy import ndimage

    h, w = gray_cur.shape
    scale = float(max(h, w))

    body = (_rasterize(body_rings, w, h) if body_rings else
            np.zeros((h, w), dtype=np.uint8))
    kernel = np.ones((BODY_DILATE_PX, BODY_DILATE_PX), np.uint8)
    body_dil = cv2.dilate(body, kernel)

    foot_mask = np.zeros((h, w), dtype=np.uint8)
    for fx, fy in feet or []:
        cv2.circle(foot_mask, (int(fx * w), int(fy * h)),
                   int(FOOT_RADIUS * scale), 1, -1)

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

    union = ((body > 0) | (keep > 0))
    club = (keep > 0) & ~(body > 0) & ~(foot_mask > 0)
    return (_mask_to_rings(union, kernel, w, h),
            _mask_to_rings(club, kernel, w, h))


def union_rings(gray_prev, gray_cur, body_rings, grip) -> list:
    """Back-compat: the union view alone."""
    return frame_rings(gray_prev, gray_cur, body_rings, grip)[0]


FOOT_KEYPOINTS = ("left_ankle", "right_ankle", "left_heel", "right_heel",
                  "left_foot_index", "right_foot_index",
                  "left_small_toe", "right_small_toe")


def foot_positions(kp: list, names: list[str], min_conf: float = 0.3
                   ) -> list[tuple[float, float]]:
    """Confidence-gated foot keypoints for one pose frame."""
    out = []
    for n in FOOT_KEYPOINTS:
        try:
            x, y, c = kp[names.index(n)]
        except (ValueError, IndexError):
            continue
        if c >= min_conf:
            out.append((x, y))
    return out


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
