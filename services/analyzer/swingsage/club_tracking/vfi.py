"""Synthetic temporal densification (test plan §20) — flow-warped mid-frames.

RIFE has no maintained packaged distribution; a bidirectional flow warp is the minimal
legitimate VFI (the §20 experiment needs SOME interpolator, and the acceptance rule judges
results, not pedigree — logged as a deviation like t5's RAFT). The §3.10 law is enforced
here structurally: every coordinate derived from a synthetic frame is `inferred`, source
`vfi`, and its confidence is CAPPED by the bounding real observations minus an
interpolation penalty — synthetic frames never increase certainty.
"""
from __future__ import annotations

import numpy as np

VFI_CONF_PENALTY = 0.35   # synthetic_conf <= min(left, right) * (1 - penalty)


def synth_midframe(a: np.ndarray, b: np.ndarray, flow_ab: np.ndarray) -> np.ndarray:
    """Halfway frame by symmetric warp: pull pixels from both endpoints along +-flow/2."""
    import cv2
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    map_a_x = xx + 0.5 * flow_ab[..., 0]
    map_a_y = yy + 0.5 * flow_ab[..., 1]
    map_b_x = xx - 0.5 * flow_ab[..., 0]
    map_b_y = yy - 0.5 * flow_ab[..., 1]
    wa = cv2.remap(a, map_a_x, map_a_y, cv2.INTER_LINEAR,
                   borderMode=cv2.BORDER_REPLICATE)
    wb = cv2.remap(b, map_b_x, map_b_y, cv2.INTER_LINEAR,
                   borderMode=cv2.BORDER_REPLICATE)
    return (0.5 * wa.astype(np.float32) + 0.5 * wb.astype(np.float32))


def cap_synthetic_conf(raw_conf: float, left_conf: float, right_conf: float) -> float:
    """§3.10/§20: a synthetic observation is never more certain than its real bounds."""
    return float(min(raw_conf, min(left_conf, right_conf) * (1.0 - VFI_CONF_PENALTY)))
