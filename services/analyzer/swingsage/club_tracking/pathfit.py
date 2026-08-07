"""Analyzer-side path-fit registry (test plan §22): Default + A–I trajectory variants.

Every tracking test's observations are fitted ten ways and ALL of them persisted, so the
player switches path fits instantly (radio change -> select variant -> redraw) and the user
judges each by eye. The browser never runs any of this (plan §37).

Design rules carried from the plan:
  * §22.1 — the Default is a confidence-weighted robust APPROXIMATING fit; an interpolating
    spline faithfully reproduces tracking error, so interpolants (G, I) are options, not
    the default.
  * Fits run in the time domain: x(t) and y(t) separately against frame time, which handles
    uneven source cadence (§22 H's parameterization warning).
  * Honesty: a sample bridging a gap is `inferred` with decayed confidence, never dressed
    as measured (§8.5). Endpoints stay pinned so the head of the drawn line lands on the
    playhead (D43).

Pure numerics — observations in, JSON-ready samples out. No I/O anywhere.
"""
from __future__ import annotations

import numpy as np
from scipy.interpolate import CubicHermiteSpline, LSQUnivariateSpline, make_splrep
from scipy.signal import savgol_filter

from .model import ClubObservation

VARIANT_IDS = ("default", "a", "b", "c", "d", "e", "f", "g", "h", "i")

VARIANT_LABELS = {
    "default": "Robust global fit",
    "a": "Light robust B-spline",
    "b": "Strong robust B-spline",
    "c": "RTS constant-acceleration",
    "d": "Phase Hermite",
    "e": "Minimum jerk",
    "f": "Bezier-style few-knot fit",
    "g": "Centripetal Catmull-Rom",
    "h": "Penalized P-spline",
    "i": "SG + Catmull-Rom",
}

_ENDPOINT_WEIGHT = 1e3   # endpoint pinning (D43) via anchor weight, not post-hoc snapping
_MIN_OBS = 4             # below this every variant falls back to piecewise linear


def _odd_window(cap: int, n: int) -> int:
    """Largest odd window <= min(cap, n). `n // 2 * 2 + 1` overshoots for even n — that
    exact off-by-one crashed savgol on a 6-observation phase segment (6iron-1, t3)."""
    w = min(cap, n)
    return w if w % 2 else w - 1


# ------------------------------------------------------------------ shared plumbing


def _prepare(observations: list[ClubObservation], fps: float):
    obs = sorted(observations, key=lambda o: o.frame)
    t = np.array([o.source_time_s if o.source_time_s is not None else o.frame / fps
                  for o in obs])
    # strictly increasing time is required by every fitter; nudge duplicates
    for i in range(1, len(t)):
        if t[i] <= t[i - 1]:
            t[i] = t[i - 1] + 1e-6
    x = np.array([o.x for o in obs])
    y = np.array([o.y for o in obs])
    w = np.clip(np.array([o.confidence for o in obs]), 1e-3, 1.0)
    w[0] *= _ENDPOINT_WEIGHT
    w[-1] *= _ENDPOINT_WEIGHT
    return obs, t, x, y, w


def _sample_grid(fps: float, frame_range: tuple[int, int]):
    n0, n1 = frame_range
    frames = np.arange(n0, n1 + 1)
    return frames, frames / fps


def _modes_and_conf(ts: np.ndarray, t: np.ndarray, conf: np.ndarray, fps: float):
    """Per-sample mode + confidence from distance to the nearest real observation.

    Within half an output frame of an observation -> observed; within the typical source
    interval -> mixed; beyond -> inferred, confidence decaying with gap distance and capped
    by the bounding observations (a bridge is never more certain than its ends)."""
    typical = float(np.median(np.diff(t))) if len(t) > 1 else 1.0 / fps
    idx = np.searchsorted(t, ts)
    modes, confs = [], []
    for i, s in zip(idx, ts):
        lo = max(0, i - 1)
        hi = min(len(t) - 1, i)
        d_lo, d_hi = abs(s - t[lo]), abs(t[hi] - s)
        d = min(d_lo, d_hi)
        c_bound = min(conf[lo], conf[hi])
        if d <= 0.5 / fps:
            modes.append("observed")
            confs.append(float(conf[lo] if d_lo <= d_hi else conf[hi]))
        elif d <= 1.5 * typical:
            modes.append("mixed")
            confs.append(float(c_bound))
        else:
            modes.append("inferred")
            confs.append(float(c_bound * np.exp(-(d - 1.5 * typical) / (4 * typical))))
    return modes, confs


def _emit(frames, xs, ys, modes, confs):
    return [{"frame": int(f), "x": float(np.clip(px, 0.0, 1.0)),
             "y": float(np.clip(py, 0.0, 1.0)), "confidence": round(float(c), 5),
             "mode": m}
            for f, px, py, m, c in zip(frames, xs, ys, modes, confs)]


def _linear_fallback(t, x, y, w, ts):
    return np.interp(ts, t, x), np.interp(ts, t, y)


# ------------------------------------------------------------------ fitters


def _smooth_spline(t, v, w, smooth_scale: float, robust: bool = True):
    """Weighted smoothing cubic B-spline with optional IRLS Tukey reweighting."""
    n = len(t)
    s = smooth_scale * n
    ww = w.copy()
    for _ in range(3 if robust else 1):
        try:
            spl = make_splrep(t, v, w=ww, k=min(3, n - 1), s=s)
        except Exception:
            return None
        r = v - spl(t)
        scale = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-9
        u = np.clip(r / (4.685 * scale), -1, 1)
        tukey = (1 - u**2) ** 2
        ww = np.clip(w * tukey, 1e-4, None)
        ww[0], ww[-1] = w[0], w[-1]  # never down-weight the pinned endpoints
    return spl


def _rts(t, x, y, w, ts):
    """Forward constant-acceleration Kalman + Rauch-Tung-Striebel backward smoother."""
    z = np.stack([x, y], axis=1)
    n = len(t)
    q = 5.0    # process noise (jerk) — visual-stability tuned, not truth-tuned
    X = np.zeros((n, 6))          # x,y,vx,vy,ax,ay
    P = np.zeros((n, 6, 6))
    Xp = np.zeros_like(X)
    Pp = np.zeros_like(P)
    H = np.zeros((2, 6)); H[0, 0] = H[1, 1] = 1.0
    X[0, :2] = z[0]
    P[0] = np.eye(6)
    Fs = []
    for i in range(1, n):
        dt = t[i] - t[i - 1]
        F = np.eye(6)
        F[0, 2] = F[1, 3] = dt
        F[0, 4] = F[1, 5] = 0.5 * dt * dt
        F[2, 4] = F[3, 5] = dt
        Fs.append(F)
        G = np.array([dt**3 / 6, dt**3 / 6, dt**2 / 2, dt**2 / 2, dt, dt])
        Q = q * np.outer(G, G) * np.eye(6)
        R = np.eye(2) * (0.0005 / w[i] ** 2)
        Xp[i] = F @ X[i - 1]
        Pp[i] = F @ P[i - 1] @ F.T + Q
        S = H @ Pp[i] @ H.T + R
        K = Pp[i] @ H.T @ np.linalg.inv(S)
        X[i] = Xp[i] + K @ (z[i] - H @ Xp[i])
        P[i] = (np.eye(6) - K @ H) @ Pp[i]
    Xs = X.copy()
    for i in range(n - 2, -1, -1):
        F = Fs[i]
        C = P[i] @ F.T @ np.linalg.inv(Pp[i + 1])
        Xs[i] = X[i] + C @ (Xs[i + 1] - Xp[i + 1])
    # sample: cubic Hermite through smoothed states using their velocities
    hx = CubicHermiteSpline(t, Xs[:, 0], Xs[:, 2])
    hy = CubicHermiteSpline(t, Xs[:, 1], Xs[:, 3])
    return hx(ts), hy(ts)


def _whittaker(t, v, w, lam_grid=(1e-7, 1e-6, 1e-5, 1e-4)):
    """Second-difference penalized weighted least squares; λ by small-grid GCV.

    Solved on the observation grid, then cubic-interpolated to the sample grid."""
    n = len(v)
    D = np.diff(np.eye(n), n=2, axis=0)
    W = np.diag(w)
    best, best_gcv = None, np.inf
    for lam in lam_grid:
        A = W + lam * D.T @ D
        z = np.linalg.solve(A, W @ v)
        Hd = np.linalg.solve(A, W)          # hat matrix
        tr = np.trace(Hd)
        gcv = n * np.sum(w * (v - z) ** 2) / max((n - tr) ** 2, 1e-9)
        if gcv < best_gcv:
            best, best_gcv = z, gcv
    return best


def _min_jerk(t, v, w, lam=1e-9):
    """Third-difference (jerk) penalized weighted least squares on the observation grid."""
    n = len(v)
    D = np.diff(np.eye(n), n=3, axis=0)
    A = np.diag(w) + lam * D.T @ D * (n ** 3)
    return np.linalg.solve(A, w * v)


def _catmull_rom(t, x, y, ts, alpha=0.5):
    """Centripetal Catmull-Rom through the anchors, evaluated at sample times.

    Tangents come from the centripetal parameterization; evaluation maps sample time
    linearly inside each anchor interval."""
    pts = np.stack([x, y], axis=1)
    n = len(pts)
    # centripetal knot spacing
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1) ** alpha
    d = np.clip(d, 1e-9, None)
    # tangents (finite differences in the centripetal parameter)
    m = np.zeros_like(pts)
    for i in range(1, n - 1):
        m[i] = (pts[i + 1] - pts[i - 1]) / (d[i - 1] + d[i])
    m[0] = (pts[1] - pts[0]) / d[0]
    m[-1] = (pts[-1] - pts[-2]) / d[-1]

    out = np.zeros((len(ts), 2))
    idx = np.clip(np.searchsorted(t, ts, side="right") - 1, 0, n - 2)
    for k, (s, i) in enumerate(zip(ts, idx)):
        dt = t[i + 1] - t[i]
        u = np.clip((s - t[i]) / dt, 0.0, 1.0)
        h00 = 2 * u**3 - 3 * u**2 + 1
        h10 = u**3 - 2 * u**2 + u
        h01 = -2 * u**3 + 3 * u**2
        h11 = u**3 - u**2
        out[k] = (h00 * pts[i] + h10 * m[i] * d[i]
                  + h01 * pts[i + 1] + h11 * m[i + 1] * d[i])
    return out[:, 0], out[:, 1]


# ------------------------------------------------------------------ the registry


def fit_variants(observations: list[ClubObservation], fps: float,
                 frame_range: tuple[int, int],
                 top_frame: int | None = None) -> dict[str, list[dict]]:
    """Fit all ten §22.2 variants over the same sample grid. Returns JSON-ready dicts."""
    if not observations:
        return {}
    obs, t, x, y, w = _prepare(observations, fps)
    frames, ts = _sample_grid(fps, frame_range)
    ts = np.clip(ts, t[0], t[-1])  # endpoints pinned: never extrapolate past the anchors
    conf_raw = np.array([o.confidence for o in obs])
    modes, confs = _modes_and_conf(ts, t, conf_raw, fps)

    def emit(xs, ys):
        return _emit(frames, xs, ys, modes, confs)

    out: dict[str, list[dict]] = {}

    if len(obs) < _MIN_OBS:
        xs, ys = _linear_fallback(t, x, y, w, ts)
        return {vid: emit(xs, ys) for vid in VARIANT_IDS}

    def spline_variant(scale, robust=True):
        sx = _smooth_spline(t, x, w, scale, robust)
        sy = _smooth_spline(t, y, w, scale, robust)
        if sx is None or sy is None:
            return _linear_fallback(t, x, y, w, ts)
        return sx(ts), sy(ts)

    out["default"] = emit(*spline_variant(2e-5))
    out["a"] = emit(*spline_variant(4e-6))
    out["b"] = emit(*spline_variant(1e-4))
    out["c"] = emit(*_rts(t, x, y, w, ts))

    # d — phase-split Hermite joined at top: derivative continuity comes from fitting each
    # phase's smoothed velocity, then evaluating each sample in its own phase's spline.
    if top_frame is not None and t[0] < top_frame / fps < t[-1]:
        t_top = top_frame / fps
        cut = int(np.searchsorted(t, t_top))
        cut = int(np.clip(cut, 2, len(t) - 2))
        def hermite(ti, vi):
            win = _odd_window(7, len(vi))
            sm = savgol_filter(vi, win, 2) if win >= 5 else vi
            dv = np.gradient(sm, ti)
            return CubicHermiteSpline(ti, vi, dv)
        segs = []
        for sl in (slice(0, cut + 1), slice(cut, None)):
            segs.append((t[sl][0], t[sl][-1],
                         hermite(t[sl], x[sl]), hermite(t[sl], y[sl])))
        xs = np.empty_like(ts); ys = np.empty_like(ts)
        for k, s in enumerate(ts):
            seg = segs[0] if s <= t_top else segs[1]
            s_cl = np.clip(s, seg[0], seg[1])
            xs[k], ys[k] = seg[2](s_cl), seg[3](s_cl)
        out["d"] = emit(xs, ys)
    else:
        out["d"] = emit(*spline_variant(2e-5))

    # e — minimum jerk on the observation grid, resampled via Catmull-Rom (smooth read-out)
    zx, zy = _min_jerk(t, x, w), _min_jerk(t, y, w)
    out["e"] = emit(*_catmull_rom(t, zx, zy, ts))

    # f — few-knot LSQ cubic B-spline (Schneider-style economy of segments)
    try:
        n_knots = max(1, len(t) // 8)
        interior = np.linspace(t[0], t[-1], n_knots + 2)[1:-1]
        fx = LSQUnivariateSpline(t, x, interior, w=w, k=3)
        fy = LSQUnivariateSpline(t, y, interior, w=w, k=3)
        out["f"] = emit(fx(ts), fy(ts))
    except Exception:
        out["f"] = emit(*spline_variant(1e-4))

    # g — centripetal Catmull-Rom through confidence-filtered anchors (interpolant)
    keep = conf_raw >= max(0.2, float(np.percentile(conf_raw, 10)))
    keep[0] = keep[-1] = True
    out["g"] = emit(*_catmull_rom(t[keep], x[keep], y[keep], ts))

    # h — Whittaker-Henderson penalized spline, λ by GCV, read out via Catmull-Rom
    hx, hy = _whittaker(t, x, w), _whittaker(t, y, w)
    out["h"] = emit(*_catmull_rom(t, hx, hy, ts))

    # i — Savitzky-Golay pre-filter, then centripetal Catmull-Rom through the filtered anchors
    win = _odd_window(9, len(t))
    if win >= 5:
        ix = savgol_filter(x, win, 2)
        iy = savgol_filter(y, win, 2)
        ix[0], iy[0], ix[-1], iy[-1] = x[0], y[0], x[-1], y[-1]
    else:
        ix, iy = x, y
    out["i"] = emit(*_catmull_rom(t, ix, iy, ts))

    return out
