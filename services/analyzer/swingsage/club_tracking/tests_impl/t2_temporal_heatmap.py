"""Test 2 — Club-Specific Temporal Heatmap (plan §11).

Sliding N_STACK window over DISTINCT source observations, heatmap peak + entropy +
visibility per center frame. Probability structure is kept (§11): a diffuse heatmap
downgrades to `mixed`, low visibility drops the frame entirely — the path-fit registry
bridges honestly.

v1 weights are pseudo-label-trained on the seven fixtures (see temporal_net.py header) —
`diagnostics.trained_on` carries that caveat permanently.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from ..temporal_net import IN_H, IN_W, N_STACK, decode_heatmap
from .t3_point_tracking import _load_window

WEIGHTS = Path(__file__).resolve().parents[3] / "models" / "club_temporal" / "v1.pt"
VIS_GATE = 0.35
PEAK_TIGHT = 12.0        # peak-vs-uniform ratio above which the location is `observed`


def _default_model():
    import torch
    from ..temporal_net import build_model
    if not WEIGHTS.exists():
        return None, None
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(WEIGHTS, map_location=dev, weights_only=False)
    model = build_model().to(dev).eval()
    model.load_state_dict(ckpt["state_dict"])

    def infer(stacks: np.ndarray):
        with torch.no_grad():
            x = torch.from_numpy(stacks).to(dev)
            heat, vis = model(x)
            return (torch.sigmoid(heat)[:, 0].cpu().numpy(),
                    torch.sigmoid(vis)[:, 0].cpu().numpy())

    return infer, ckpt.get("meta", {})


@register
class TemporalHeatmapTracker:
    id = "t2_temporal_heatmap"
    label = TEST_IDS["t2_temporal_heatmap"]
    version = "1.0.0"

    def __init__(self, infer=None, meta=None, loader=None):
        self._infer = infer
        self._meta = meta
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        infer, meta = (self._infer, self._meta or {})
        if infer is None:
            infer, meta = _default_model()
        if infer is None:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_weights",
                             "hint": "run scripts/train_club_temporal.py"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        video = self._loader(ctx, n0, n1)
        if video is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})

        import cv2
        gray = {}
        for i in range(video.shape[0]):
            g = video[i].mean(axis=2).astype(np.float32)
            gray[n0 + i] = cv2.resize(g, (IN_W, IN_H)) / 255.0

        if ctx.source_timing is not None and ctx.source_timing.observations:
            reps = [o.normalized_frames[0] for o in ctx.source_timing.observations
                    if o.normalized_frames and n0 <= o.normalized_frames[0] <= n1]
        else:
            reps = list(range(n0, n1 + 1))
        reps = [r for r in reps if r in gray]
        half = N_STACK // 2
        if len(reps) < N_STACK:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "too_short"})

        stacks, centers = [], []
        for i in range(half, len(reps) - half):
            stacks.append(np.stack([gray[reps[j]]
                                    for j in range(i - half, i + half + 1)]))
            centers.append(reps[i])

        observations = []
        dropped = 0
        B = 32
        for b0 in range(0, len(stacks), B):
            heat, vis = infer(np.stack(stacks[b0:b0 + B]))
            for k in range(heat.shape[0]):
                f = centers[b0 + k]
                v = float(vis[k])
                if v < VIS_GATE:
                    dropped += 1
                    continue
                x, y, peak, ent = decode_heatmap(heat[k])
                mode = "observed" if peak >= PEAK_TIGHT else "mixed"
                conf = float(np.clip(v * (1.0 - ent), 0.02, 1.0))
                observations.append(ClubObservation(
                    frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                    confidence=round(conf, 5), mode=mode,
                    source="temporal_heatmap", visibility="visible"))

        modes = [o.mode for o in observations]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "trained_on": meta.get("trained_on", "unknown"),
                "windows": len(stacks), "dropped_low_vis": dropped,
                "observed_fraction": round(
                    modes.count("observed") / len(modes), 4) if modes else 0.0,
            })
