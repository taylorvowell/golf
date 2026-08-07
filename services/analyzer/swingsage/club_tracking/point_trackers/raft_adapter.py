"""Optical-flow adapter (plan §14) — torchvision RAFT-small.

SEA-RAFT has no packaged distribution; the plan sanctions "the strongest compatible flow
model", and torchvision's maintained RAFT wins over vendoring a research repo. The source
tag downstream is `raft` — the artifact never claims a model it didn't run (step-12 note).
Pairs are downscaled to <=384 px width for the GTX 1080; returned flow is scaled back to
input-pixel units.
"""
from __future__ import annotations

import numpy as np

MAX_W = 384


def make_raft(device: str | None = None):
    import torch
    from torchvision.models.optical_flow import Raft_Small_Weights, raft_small

    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    weights = Raft_Small_Weights.DEFAULT
    model = raft_small(weights=weights).to(dev).eval()
    transforms = weights.transforms()

    def flow_fn(a_rgb: np.ndarray, b_rgb: np.ndarray) -> np.ndarray:
        import cv2
        h, w = a_rgb.shape[:2]
        scale = min(1.0, MAX_W / w)
        if scale < 1.0:
            # RAFT wants dims divisible by 8
            nw = int(w * scale) // 8 * 8
            nh = int(h * scale) // 8 * 8
            a = cv2.resize(a_rgb, (nw, nh))
            b = cv2.resize(b_rgb, (nw, nh))
        else:
            a, b = a_rgb, b_rgb
            nw, nh = w // 8 * 8, h // 8 * 8
            a, b = cv2.resize(a, (nw, nh)), cv2.resize(b, (nw, nh))
        ta = torch.from_numpy(a.astype(np.uint8)).permute(2, 0, 1)[None]
        tb = torch.from_numpy(b.astype(np.uint8)).permute(2, 0, 1)[None]
        ta, tb = transforms(ta, tb)
        with torch.no_grad():
            flow = model(ta.to(dev), tb.to(dev))[-1][0].cpu().numpy()
        flow = np.transpose(flow, (1, 2, 0))          # (H', W', 2), pixels at H'xW'
        sx, sy = w / flow.shape[1], h / flow.shape[0]
        out = cv2.resize(flow, (w, h))
        out[..., 0] *= sx
        out[..., 1] *= sy
        return out

    return flow_fn
