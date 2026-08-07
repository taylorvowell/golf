"""Point-tracker adapter seam (test plan §12).

One interface, several models behind it — CoTracker3 today, TAPIR/LocoTrack later if the
user's eye wants alternatives. A tracker is a callable:

    tracker(video, queries) -> (tracks, visibility)

    video      float32 ndarray (T, H, W, 3), RGB 0-255
    queries    float32 ndarray (N, 3) of (t_index, x_px, y_px)
    tracks     float32 ndarray (T, N, 2) pixel coordinates
    visibility float32 ndarray (T, N) in [0, 1]

Everything downstream (seeding, merging, mode assignment) is pure and hermetic-testable;
only the adapter itself touches torch.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

TrackerFn = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]


def merge_seed_tracks(tracks: np.ndarray, vis: np.ndarray,
                      offsets: np.ndarray, vis_gate: float = 0.5,
                      agree_tight: float = 0.02, frame_size: tuple[int, int] = (1, 1)
                      ) -> list[tuple[int, float, float, float, str]]:
    """Fuse per-seed tracks into one center estimate per frame. Pure.

    Each query k carries `offsets[k]` (its pixel offset from the club-head center when it
    was seeded); subtracting it re-centers every track. Per frame: visibility-gated
    weighted median; agreement across seeds decides observed vs mixed; frames where too
    few seeds are visible are DROPPED (the path-fit registry bridges them honestly).

    Returns [(t, x_norm, y_norm, confidence, mode)] with x/y normalized by `frame_size`
    (w, h).
    """
    T, N, _ = tracks.shape
    w, h = frame_size
    centered = tracks - offsets[None, :, :]
    out = []
    for t in range(T):
        v = vis[t]
        keep = v >= vis_gate
        if keep.sum() < max(2, N // 3):
            continue
        pts = centered[t, keep]
        wts = v[keep]
        order = np.argsort(pts[:, 0])
        cum = np.cumsum(wts[order])
        mx = pts[order[np.searchsorted(cum, cum[-1] / 2)], 0]
        order = np.argsort(pts[:, 1])
        cum = np.cumsum(wts[order])
        my = pts[order[np.searchsorted(cum, cum[-1] / 2)], 1]
        spread = float(np.hypot(*(pts - (mx, my)).T.std(axis=1)))
        spread_norm = spread / max(w, h)
        mode = "observed" if spread_norm <= agree_tight else "mixed"
        conf = float(np.clip(v[keep].mean() * (1.0 - min(spread_norm / (3 * agree_tight),
                                                          0.6)), 0.05, 1.0))
        out.append((t, float(mx / w), float(my / h), conf, mode))
    return out


def build_seed_queries(anchors: list[tuple[int, float, float]],
                       frame_size: tuple[int, int],
                       support_px: float = 5.0) -> tuple[np.ndarray, np.ndarray]:
    """Queries + their center offsets from anchor frames (plan §12: center + supports).

    anchors: (t_index, x_norm, y_norm) reliable club-head sightings spread across the
    window. Each contributes a center query and 4 support queries offset by support_px.
    """
    w, h = frame_size
    qs, offs = [], []
    for t, xn, yn in anchors:
        cx, cy = xn * w, yn * h
        for dx, dy in ((0, 0), (support_px, 0), (-support_px, 0),
                       (0, support_px), (0, -support_px)):
            qs.append((float(t), cx + dx, cy + dy))
            offs.append((dx, dy))
    return np.array(qs, dtype=np.float32), np.array(offs, dtype=np.float32)
