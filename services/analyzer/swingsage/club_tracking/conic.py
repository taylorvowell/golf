"""Local conic (ellipse) prior for the lower downswing (test plan §3.9, §19).

Motion-capture research supports near-impact planarity and ellipse fitting — for the LAST
part of the downswing only. Nothing here may be applied to the whole swing: perspective
makes the full 2D path decidedly non-elliptical, and §19 lists "overly strong conic prior
bends a real projection toward the model" as a main failure mode. The factor consuming this
module keeps the weight soft and the window local.

Fitzgibbon-style direct algebraic fit: solve the generalized eigenproblem for the conic
coefficients with the ellipse constraint 4AC - B^2 = 1. Degenerate inputs (near-collinear
points, tiny windows) return None rather than a garbage conic.
"""
from __future__ import annotations

import numpy as np


def fit_ellipse(pts: np.ndarray) -> np.ndarray | None:
    """Algebraic ellipse coefficients [A,B,C,D,E,F] for Ax²+Bxy+Cy²+Dx+Ey+F=0, or None."""
    if pts.shape[0] < 6:
        return None
    x, y = pts[:, 0], pts[:, 1]
    if np.ptp(x) < 1e-4 or np.ptp(y) < 1e-4:
        return None
    D1 = np.stack([x * x, x * y, y * y], axis=1)
    D2 = np.stack([x, y, np.ones_like(x)], axis=1)
    S1 = D1.T @ D1
    S2 = D1.T @ D2
    S3 = D2.T @ D2
    try:
        T = -np.linalg.solve(S3, S2.T)
        M = S1 + S2 @ T
        C1 = np.array([[0, 0, 2], [0, -1, 0], [2, 0, 0]], dtype=float)
        M2 = np.linalg.solve(C1, M)
        w, v = np.linalg.eig(M2)
    except np.linalg.LinAlgError:
        return None
    # pick the eigenvector satisfying the ellipse constraint 4ac - b^2 > 0
    best = None
    for i in range(3):
        a = np.real(v[:, i])
        cond = 4 * a[0] * a[2] - a[1] ** 2
        if cond > 1e-12:
            best = a
            break
    if best is None:
        return None
    coef = np.concatenate([best, T @ best])
    n = np.linalg.norm(coef)
    return coef / n if n > 0 else None


def algebraic_distance(coef: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Normalized algebraic residual per point — cheap, monotone-ish with true distance
    near the curve, which is all a soft prior needs."""
    x, y = pts[:, 0], pts[:, 1]
    val = (coef[0] * x * x + coef[1] * x * y + coef[2] * y * y
           + coef[3] * x + coef[4] * y + coef[5])
    # scale by gradient magnitude (Sampson-style) so the residual approximates distance
    gx = 2 * coef[0] * x + coef[1] * y + coef[3]
    gy = coef[1] * x + 2 * coef[2] * y + coef[4]
    g = np.hypot(gx, gy)
    return val / np.clip(g, 1e-6, None)
