"""SAM 2.1 adapter (plan §13) — per-frame point-prompted segmentation.

Goes through ultralytics' SAM wrapper (already a pinned dependency; weights auto-download
to the ultralytics cache, never the repo). Per-frame prompting at a predicted point was
chosen over the stateful video-propagation API deliberately: the branch logic in
`segmentation.py` re-decides sanity every frame anyway, and a fresh prompt per frame can't
drag a poisoned memory bank forward — §13's mask-drift failure mode stays one frame big.
Pascal note: float32 throughout (D21b — no amp on a GTX 1080).
"""
from __future__ import annotations

import numpy as np


def make_sam2(device: str | None = None):
    import torch
    from ultralytics import SAM

    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = SAM("sam2.1_s.pt")

    def segmenter(frame_rgb: np.ndarray, point_px: tuple[float, float]):
        frame_bgr = np.ascontiguousarray(frame_rgb[..., ::-1]).astype(np.uint8)
        res = model.predict(frame_bgr,
                            points=[[float(point_px[0]), float(point_px[1])]],
                            labels=[1], imgsz=1024, device=dev, verbose=False)
        masks = res[0].masks
        if masks is None or masks.data.shape[0] == 0:
            return None
        m = masks.data[0].cpu().numpy()
        return m > 0.5

    return segmenter
