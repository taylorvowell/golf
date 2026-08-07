"""CoTracker3 adapter (plan §12) — the only file here that touches torch.

Offline mode: the model sees the whole clip and tracks bidirectionally from each query's
frame, which is exactly the §12 forward+backward requirement. Weights come from torch.hub
(~/.cache/torch/hub), never the repo. VRAM: the window is downscaled to <=512 px width
before inference; coordinates are mapped back by the caller via the returned scale.
"""
from __future__ import annotations

import numpy as np

MAX_W = 512


def make_cotracker(device: str | None = None):
    """Returns (tracker_fn, scale_fn). Import cost and CUDA are paid here, not at module
    import — the registry must stay importable on CPU-only CI."""
    import torch

    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = torch.hub.load("facebookresearch/co-tracker", "cotracker3_offline")
    model = model.to(dev).eval()

    def tracker(video: np.ndarray, queries: np.ndarray):
        t, h, w, _ = video.shape
        scale = min(1.0, MAX_W / w)
        if scale < 1.0:
            import cv2
            video = np.stack([cv2.resize(f, (int(w * scale), int(h * scale)))
                              for f in video])
        q = queries.copy()
        q[:, 1:] *= scale
        vt = torch.from_numpy(video).permute(0, 3, 1, 2)[None].float().to(dev)
        qt = torch.from_numpy(q)[None].to(dev)
        with torch.no_grad():
            tracks, vis = model(vt, queries=qt, backward_tracking=True)
        tr = tracks[0].cpu().numpy() / scale
        vi = vis[0].cpu().numpy().astype(np.float32)
        return tr, vi

    return tracker
