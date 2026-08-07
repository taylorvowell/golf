"""Test 10's solver (plan §19): robust least squares over ordinary noisy candidates.

The experiment's question is whether better mathematics alone — robust association, motion
smoothness, a soft grip-radius factor, a LOCAL conic prior — turns a low-threshold detector
stream into a production-quality path. The sensor input is deliberately frozen to
`candidates.harvest`'s output; no other expert may be added here (§19 "do not quietly add
the temporal net or point tracker").

Formulation: positions p_i at each genuine source observation; scipy `least_squares` with
Huber loss over stacked residuals:

    measurement   conf-weighted distance to the ASSOCIATED candidate (nearest within a
                  gate, re-associated each IRLS round)
    acceleration  second time-difference of p
    jerk          third time-difference of p
    grip radius   second difference of |p - grip| — slowly varying, never constant (§3.9)
    local conic   Sampson distance to an ellipse refit each round, lower downswing only
    endpoints     strong anchoring on the first/last associated candidates (D43)
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import least_squares

from .conic import algebraic_distance, fit_ellipse
from .model import ClubCandidate

ASSOC_GATE = 0.06        # normalized units — candidate beyond this is not this frame's head
W_MEAS = 30.0
W_ACCEL = 4e-3
W_JERK = 2e-3
W_GRIP = 8.0
W_CONIC = 6.0
W_ENDPOINT = 90.0
IRLS_ROUNDS = 3
CONIC_MIN_PTS = 8


def _init_track(cands_by_obs: list[list[ClubCandidate]], n: int) -> np.ndarray:
    """Best-candidate-per-observation with linear infill across empty slots."""
    pts = np.full((n, 2), np.nan)
    for i, cs in enumerate(cands_by_obs):
        if cs:
            best = max(cs, key=lambda c: c.confidence)
            pts[i] = (best.x, best.y)
    # linear infill
    idx = np.arange(n)
    known = ~np.isnan(pts[:, 0])
    if known.sum() < 4:
        return pts  # caller bails
    for d in range(2):
        pts[:, d] = np.interp(idx, idx[known], pts[known, d])
    return pts


def _associate(pts: np.ndarray, cands_by_obs: list[list[ClubCandidate]]):
    """Nearest candidate within the gate, per observation. Returns (index or None, conf)."""
    assoc: list[ClubCandidate | None] = []
    for i, cs in enumerate(cands_by_obs):
        if not cs:
            assoc.append(None)
            continue
        d = [float(np.hypot(c.x - pts[i, 0], c.y - pts[i, 1])) for c in cs]
        j = int(np.argmin(d))
        assoc.append(cs[j] if d[j] <= ASSOC_GATE else None)
    return assoc


def solve(cands_by_obs: list[list[ClubCandidate]], times: list[float],
          grip: np.ndarray, downswing_from: int | None = None
          ) -> tuple[np.ndarray, list[ClubCandidate | None]] | None:
    """Solve p(t). `grip` is (n,2) per observation; `downswing_from` is the observation
    index where the conic window may begin (top). Returns (points, association) or None
    when there is nothing to solve."""
    n = len(cands_by_obs)
    if n < 6:
        return None
    t = np.asarray(times)
    pts = _init_track(cands_by_obs, n)
    if np.isnan(pts).any():
        return None

    dt = np.clip(np.diff(t), 1e-4, None)

    for _ in range(IRLS_ROUNDS):
        assoc = _associate(pts, cands_by_obs)
        meas_idx = [i for i, a in enumerate(assoc) if a is not None]
        if len(meas_idx) < 4:
            return None
        meas_xy = np.array([[assoc[i].x, assoc[i].y] for i in meas_idx])
        meas_w = np.sqrt(np.array([assoc[i].confidence for i in meas_idx]))
        first, last = meas_idx[0], meas_idx[-1]

        # conic window: lower downswing — from midway through the downswing to impact
        conic_coef = None
        conic_lo = None
        if downswing_from is not None and n - downswing_from >= CONIC_MIN_PTS:
            conic_lo = downswing_from + (n - downswing_from) // 2
            window = pts[conic_lo:]
            if window.shape[0] >= CONIC_MIN_PTS:
                conic_coef = fit_ellipse(window)

        def residuals(flat: np.ndarray) -> np.ndarray:
            p = flat.reshape(n, 2)
            out = []
            out.append((W_MEAS * meas_w[:, None]
                        * (p[meas_idx] - meas_xy)).ravel())
            v = np.diff(p, axis=0) / dt[:, None]
            a = np.diff(v, axis=0) / ((dt[:-1] + dt[1:]) / 2)[:, None]
            out.append((W_ACCEL * a).ravel())
            j = np.diff(a, axis=0)
            out.append((W_JERK * j).ravel())
            r = np.hypot(p[:, 0] - grip[:, 0], p[:, 1] - grip[:, 1])
            out.append(W_GRIP * np.diff(r, n=2))
            if conic_coef is not None:
                out.append(W_CONIC * algebraic_distance(conic_coef, p[conic_lo:]))
            out.append(W_ENDPOINT * (p[first] - meas_xy[0]))
            out.append(W_ENDPOINT * (p[last] - meas_xy[-1]))
            return np.concatenate(out)

        res = least_squares(residuals, pts.ravel(), loss="huber", f_scale=0.02,
                            max_nfev=60, method="trf")
        pts = res.x.reshape(n, 2)

    return pts, _associate(pts, cands_by_obs)
