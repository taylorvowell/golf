"""Momentum corridor (user idea, 2026-08-08 — test 24).

The TIMING between verified (green-gated) red boxes carries physics: the club's velocity
between consecutive reds IS its momentum, and a real club cannot shift direction more
jaggedly than that momentum allows. The reds are authoritative and define the corridor;
every fill point (legacy, ball) between two reds must sit near the momentum-blended
prediction and within the allowed turn — or it is dropped.

Tweakables live here at the top, deliberately — "have it be 1 option, then we can tweak".
"""
from __future__ import annotations

import numpy as np

# ---- the knobs -------------------------------------------------------------------
MAX_TURN_DEG_PER_FRAME = 22.0   # how fast the travel direction may rotate, per frame
CORRIDOR_BASE = 0.035           # base distance gate from the momentum prediction
CORRIDOR_PER_FRAME = 0.012      # gate growth per frame away from the nearest red
MIN_SPEED_FOR_DIRECTION = 0.15  # units/s below which direction is meaningless (address)
# ----------------------------------------------------------------------------------


def red_velocities(reds: dict[int, tuple[float, float]], fps: float
                   ) -> dict[int, tuple[float, float]]:
    """Velocity (units/s) at each red frame, from its neighboring reds — central
    difference where possible, one-sided at the ends."""
    fs = sorted(reds)
    out: dict[int, tuple[float, float]] = {}
    for i, f in enumerate(fs):
        a = fs[max(0, i - 1)]
        b = fs[min(len(fs) - 1, i + 1)]
        if a == b:
            out[f] = (0.0, 0.0)
            continue
        dt = (b - a) / fps
        out[f] = ((reds[b][0] - reds[a][0]) / dt,
                  (reds[b][1] - reds[a][1]) / dt)
    return out


def momentum_ok(frame: int, x: float, y: float,
                reds: dict[int, tuple[float, float]],
                vels: dict[int, tuple[float, float]], fps: float) -> bool:
    """May a fill point exist here, given the momentum of the bracketing reds?

    Two gates: distance from the momentum-blended prediction (corridor widens with
    temporal distance from the reds), and direction — the travel from the previous red
    to this point may not rotate away from that red's momentum faster than
    MAX_TURN_DEG_PER_FRAME."""
    fs = sorted(reds)
    before = next((f for f in reversed(fs) if f < frame), None)
    after = next((f for f in fs if f > frame), None)
    if before is None and after is None:
        return True                      # no physics to test against
    # ---- corridor gate ----
    preds = []
    if before is not None:
        vx, vy = vels[before]
        dt = (frame - before) / fps
        preds.append((reds[before][0] + vx * dt, reds[before][1] + vy * dt,
                      frame - before))
    if after is not None:
        vx, vy = vels[after]
        dt = (after - frame) / fps
        preds.append((reds[after][0] - vx * dt, reds[after][1] - vy * dt,
                      after - frame))
    if len(preds) == 2:
        w = preds[1][2] / (preds[0][2] + preds[1][2])   # nearer red weighs more
        px = w * preds[0][0] + (1 - w) * preds[1][0]
        py = w * preds[0][1] + (1 - w) * preds[1][1]
        gap = min(preds[0][2], preds[1][2])
    else:
        px, py, gap = preds[0]
    corridor = CORRIDOR_BASE + CORRIDOR_PER_FRAME * gap
    if float(np.hypot(x - px, y - py)) > corridor:
        return False
    # ---- turn-rate gate ----
    if before is not None:
        vx, vy = vels[before]
        speed = float(np.hypot(vx, vy))
        if speed >= MIN_SPEED_FOR_DIRECTION:
            dx, dy = x - reds[before][0], y - reds[before][1]
            if np.hypot(dx, dy) > 1e-6:
                ang = np.degrees(abs(
                    (np.arctan2(dy, dx) - np.arctan2(vy, vx) + np.pi)
                    % (2 * np.pi) - np.pi))
                if ang > MAX_TURN_DEG_PER_FRAME * max(frame - before, 1):
                    return False
    return True
