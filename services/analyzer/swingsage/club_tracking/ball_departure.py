"""Ball-departure impact detection (plan §3.12/§21; user request 2026-08-08).

The ball sits still through the whole swing and then is GONE — the cleanest impact cue in
the scene. Two stages, both deterministic:

  * the ball's SPOT comes from ball-class detections in the raw-models sidecar during the
    address hold (the hosted Universe models detect golf_ball directly — the learned ball
    detector D44 said would make ball-anchoring safe);
  * DEPARTURE is the first frame where the spot's pixels change from their address
    reference and STAY changed — the club sweeping past occludes the ball for a frame or
    two at 60 fps, so only a sustained change is the ball actually leaving.

The frame straddling there->gone is the impact: the club head must be AT the ball then.
"""
from __future__ import annotations

import numpy as np

BALL_WORDS = ("ball",)
SPOT_WINDOW = 20         # frames after address to harvest ball detections from
ROI_RADIUS = 0.022       # of the long side
DIFF_THRESH = 22.0
SUSTAIN = 3              # frames the change must persist (club occlusion is 1-2)


def find_ball_spot(raw_models_doc: dict | None, address_frame: int
                   ) -> tuple[float, float] | None:
    """Median position of ball-class detections near address, across all models."""
    if not raw_models_doc:
        return None
    xs, ys = [], []
    for entry in (raw_models_doc.get("models") or {}).values():
        for row in entry.get("frames") or []:
            f = row.get("f")
            if f is None or not address_frame <= f <= address_frame + SPOT_WINDOW:
                continue
            for d in row.get("d") or []:
                label = str(d.get("label", "")).lower()
                if any(wd in label for wd in BALL_WORDS):
                    xs.append(d["xy"][0])
                    ys.append(d["xy"][1])
    if len(xs) < 3:
        return None
    return float(np.median(xs)), float(np.median(ys))


def departure_frame(gray: np.ndarray, first_frame: int, spot: tuple[float, float],
                    address_frame: int, search_from: int) -> int | None:
    """First frame (absolute) where the ball ROI departs from its address reference and
    stays departed. `gray` is (T, H, W) starting at `first_frame`."""
    h, w = gray.shape[1:]
    scale = max(h, w)
    r = max(3, int(ROI_RADIUS * scale))
    cx, cy = int(spot[0] * w), int(spot[1] * h)
    x0, x1 = max(0, cx - r), min(w, cx + r + 1)
    y0, y1 = max(0, cy - r), min(h, cy + r + 1)
    if x0 >= x1 or y0 >= y1:
        return None

    def roi(f_abs: int) -> np.ndarray | None:
        i = f_abs - first_frame
        if not 0 <= i < gray.shape[0]:
            return None
        return gray[i, y0:y1, x0:x1]

    refs = [roi(address_frame + k) for k in range(0, 6)]
    refs = [x for x in refs if x is not None]
    if not refs:
        return None
    ref = np.median(np.stack(refs), axis=0)

    last = first_frame + gray.shape[0] - 1
    run = 0
    for f in range(max(search_from, first_frame), last + 1):
        cur = roi(f)
        if cur is None:
            break
        if float(np.abs(cur.astype(np.float32) - ref).mean()) >= DIFF_THRESH:
            run += 1
            if run >= SUSTAIN:
                return f - SUSTAIN + 1        # the first changed frame of the run
        else:
            run = 0
    return None
