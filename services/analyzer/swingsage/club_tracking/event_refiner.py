"""Common event refiner (test plan §24): address onset, top reversal, impact corridor.

Shared by any test with a solved trajectory. Three principles from the plan:

  * address is the END of sustained stillness — waggle and one-frame noise must not
    trigger departure (§24.1, persistence over genuine observations);
  * top is a DIRECTION REVERSAL of the club's travel, not the highest y (§24.2, D49's
    lesson lives here);
  * impact is the crossing of a corridor around the address head position, weighted by
    speed — the fastest corridor pass wins (§24.3).

Emits EventEvidence (times in source seconds); build_experiment prefers these over the
artifact's frames when confidence is present.
"""
from __future__ import annotations

import numpy as np

from .model import EventEvidence

STILL_SPEED = 0.35        # units/s — below this the club counts as holding still
STILL_RUN_S = 0.20        # sustained departure horizon
CORRIDOR_R = 0.05         # normalized radius of the impact corridor around address head


def refine(points: np.ndarray, times: np.ndarray,
           artifact_top_time: float | None = None) -> list[EventEvidence]:
    """points: (n,2) solved head path over address->impact-ish window."""
    n = points.shape[0]
    if n < 8:
        return []
    v = np.diff(points, axis=0) / np.clip(np.diff(times), 1e-4, None)[:, None]
    speed = np.hypot(v[:, 0], v[:, 1])
    out: list[EventEvidence] = []

    # ---- address: end of the last sustained-still run before sustained departure ----
    dt_med = float(np.median(np.diff(times)))
    run = max(2, int(round(STILL_RUN_S / dt_med)))
    moving = speed > STILL_SPEED
    addr_i = None
    # Both sides must persist (§24.1): a still RUN ending at i, then a moving RUN — a
    # single slow frame (waggle, the top turnaround) is neither an address nor a departure.
    for i in range(run, n - 1 - run):
        if (~moving[i - run + 1:i + 1]).all() and moving[i + 1:i + 1 + run].all():
            addr_i = i
    if addr_i is not None:
        out.append(EventEvidence(event="address", time_s=float(times[addr_i]),
                                 confidence=0.6, source="club_trajectory"))

    # ---- top: direction reversal — most-negative dot product of adjacent velocities,
    # searched near the artifact's opinion when one exists ----
    dots = (v[:-1] * v[1:]).sum(axis=1) / np.clip(speed[:-1] * speed[1:], 1e-9, None)
    lo, hi = 1, len(dots) - 1
    if artifact_top_time is not None:
        c = int(np.searchsorted(times, artifact_top_time))
        lo, hi = max(1, c - 12), min(len(dots) - 1, c + 12)
    if hi > lo:
        rev = lo + int(np.argmin(dots[lo:hi]))
        conf = float(np.clip(0.4 + 0.5 * (-dots[rev]), 0.2, 0.9))
        out.append(EventEvidence(event="top", time_s=float(times[rev + 1]),
                                 confidence=conf, source="club_trajectory"))

    # ---- impact: fastest pass through the corridor around the ADDRESS head position ----
    anchor = points[addr_i] if addr_i is not None else points[0]
    top_t = next((e.time_s for e in out if e.event == "top"), None)
    half = int(np.searchsorted(times, top_t)) if top_t is not None else n // 2
    d_anchor = np.hypot(points[:, 0] - anchor[0], points[:, 1] - anchor[1])
    in_corridor = np.where(d_anchor[half:] < CORRIDOR_R)[0] + half
    if in_corridor.size:
        sp = speed[np.clip(in_corridor - 1, 0, len(speed) - 1)]
        imp = int(in_corridor[int(np.argmax(sp))])
        conf = float(np.clip(0.5 + 0.04 * sp.max(), 0.5, 0.95))
        out.append(EventEvidence(event="impact", time_s=float(times[imp]),
                                 confidence=conf, source="club_trajectory"))
    return out
