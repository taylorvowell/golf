"""Test 2's temporal heatmap network (plan §11) — small enough for a GTX 1080.

Input: a stack of N_STACK consecutive DISTINCT-observation grayscale frames (never
duplicated CFR frames — §11 is explicit), downscaled. Outputs: a club-head heatmap and a
visibility logit. Trajectory context enters through the temporal stack, which is the whole
TrackNet-family idea.

Training data reality (logged decision): the plan demands thousands of manually checked
labels across golfers and forbids training only on the committed fixtures. This project's
user has ruled out hand-labeling, so v1 trains on PSEUDO-LABELS from the fused
deterministic solve over the seven fixtures. That makes t2 a real architecture test and a
selectable menu row; it makes NO generalization claim, and its diagnostics say
`trained_on: pseudo_labels_7_fixtures` so nobody mistakes it later.
"""
from __future__ import annotations

import numpy as np

N_STACK = 5
IN_W, IN_H = 160, 288       # portrait 9:16-ish at 1/4.5 of 720p
HEAT_W, HEAT_H = 40, 72     # heatmap at 1/4 of input
SIGMA_PX = 2.0              # gaussian target radius on the heatmap grid


def build_model():
    import torch.nn as nn

    class TemporalHeatmapNet(nn.Module):
        def __init__(self):
            super().__init__()
            c = 32

            def block(cin, cout, stride=1):
                return nn.Sequential(
                    nn.Conv2d(cin, cout, 3, stride=stride, padding=1),
                    nn.BatchNorm2d(cout), nn.ReLU(inplace=True))

            self.enc = nn.Sequential(
                block(N_STACK, c), block(c, c),
                block(c, 2 * c, stride=2), block(2 * c, 2 * c),
                block(2 * c, 4 * c, stride=2), block(4 * c, 4 * c),
            )
            self.heat = nn.Sequential(
                block(4 * c, 2 * c), nn.Conv2d(2 * c, 1, 1))
            self.vis = nn.Sequential(
                nn.AdaptiveAvgPool2d(1), nn.Flatten(),
                nn.Linear(4 * c, 32), nn.ReLU(inplace=True), nn.Linear(32, 1))

        def forward(self, x):
            f = self.enc(x)
            return self.heat(f), self.vis(f)

    return TemporalHeatmapNet()


def gaussian_target(x_norm: float, y_norm: float) -> np.ndarray:
    """Heatmap-grid gaussian centred on the (normalized) head position."""
    cx, cy = x_norm * HEAT_W, y_norm * HEAT_H
    xs = np.arange(HEAT_W)[None, :]
    ys = np.arange(HEAT_H)[:, None]
    return np.exp(-((xs - cx) ** 2 + (ys - cy) ** 2) / (2 * SIGMA_PX ** 2)).astype(np.float32)


def decode_heatmap(heat: np.ndarray) -> tuple[float, float, float, float]:
    """(x_norm, y_norm, peak, entropy_norm) from one heatmap. Keeps the probability
    structure §11 asks for — peak location plus how concentrated the mass is."""
    h = heat.astype(np.float64)
    h = h - h.min()
    total = h.sum()
    if total <= 1e-12:
        return 0.5, 0.5, 0.0, 1.0
    p = h / total
    iy, ix = np.unravel_index(np.argmax(h), h.shape)
    peak = float(h[iy, ix] / (total / p.size))     # peak vs uniform
    ent = float(-(p[p > 0] * np.log(p[p > 0])).sum() / np.log(p.size))
    return (float(ix) + 0.5) / h.shape[1], (float(iy) + 0.5) / h.shape[0], peak, ent
