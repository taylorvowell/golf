"""Phase-adaptive multi-expert fusion (test plan §17) — pure math, no I/O.

Each expert's observations are weighted by swing phase (a point tracker owns the top, the
blur/streak specialist owns impact, kinematics backstops everywhere), by its own reported
confidence, and by mode honesty (an inferred point argues weakly). Per frame: robust
IRLS weighted mean with an outlier gate, and the surviving spread recorded as
disagreement — miscalibrated consensus is §17's failure mode, so disagreement is a
first-class output, not a discarded residual.

Expert calibration against observed error (§17's empirical reliability) requires truth
this project deliberately doesn't collect — the phase table below is the v1 prior, tuned
by eye like everything else, and carried as data so the debug menu ablations can vary it.
"""
from __future__ import annotations

import numpy as np

# phase -> expert-source -> weight. Sources are experiment test ids.
PHASE_WEIGHTS: dict[str, dict[str, float]] = {
    "address": {"t1_candidate_graph": 1.0, "t3_point_tracking": 0.9,
                "t4_video_segmentation": 0.7, "t5_blur_flow": 0.6,
                "t6_grip_kinematic": 0.5, "t10_physics_conic": 0.9},
    "backswing": {"t1_candidate_graph": 1.0, "t3_point_tracking": 0.9,
                  "t4_video_segmentation": 0.6, "t5_blur_flow": 0.7,
                  "t6_grip_kinematic": 0.6, "t10_physics_conic": 0.9},
    "top": {"t1_candidate_graph": 0.6, "t3_point_tracking": 1.0,
            "t4_video_segmentation": 0.5, "t5_blur_flow": 0.5,
            "t6_grip_kinematic": 1.0, "t10_physics_conic": 0.8},
    "downswing": {"t1_candidate_graph": 0.8, "t3_point_tracking": 0.6,
                  "t4_video_segmentation": 0.4, "t5_blur_flow": 1.0,
                  "t6_grip_kinematic": 0.8, "t10_physics_conic": 1.0},
    "impact": {"t1_candidate_graph": 0.7, "t3_point_tracking": 0.4,
               "t4_video_segmentation": 0.3, "t5_blur_flow": 1.0,
               "t6_grip_kinematic": 0.8, "t10_physics_conic": 1.0},
}

MODE_WEIGHT = {"observed": 1.0, "mixed": 0.6, "inferred": 0.25}
OUTLIER_GATE = 0.06        # normalized distance from the consensus that ejects an expert
IMPACT_ZONE_FRAMES = 8     # this close to impact counts as the impact phase


def phase_of(frame: int, events: dict[str, int]) -> str:
    top = events.get("top")
    impact = events.get("impact")
    address = events.get("address", 0)
    if impact is not None and frame >= impact - IMPACT_ZONE_FRAMES:
        return "impact"
    if top is not None and frame > top:
        return "downswing"
    if top is not None and abs(frame - top) <= 3:
        return "top"
    if frame <= address + 3:
        return "address"
    return "backswing"


def fuse_frame(points: list[tuple[str, float, float, float, str]],
               phase: str) -> tuple[float, float, float, str, float, list[str]] | None:
    """Fuse one frame's expert points.

    points: [(expert_id, x, y, confidence, mode)]. Returns
    (x, y, confidence, mode, disagreement, contributors) or None when nothing usable.
    """
    if not points:
        return None
    pw = PHASE_WEIGHTS.get(phase, {})
    xs, ys, ws, meta = [], [], [], []
    for expert, x, y, conf, mode in points:
        w = pw.get(expert, 0.5) * conf * MODE_WEIGHT.get(mode, 0.25)
        if w <= 0:
            continue
        xs.append(x); ys.append(y); ws.append(w); meta.append((expert, mode))
    if not ws:
        return None
    xs = np.array(xs); ys = np.array(ys); ws = np.array(ws)

    # IRLS: weighted mean, then eject outliers past the gate, twice.
    keep = np.ones(len(ws), dtype=bool)
    for _ in range(2):
        if not keep.any():
            return None
        mx = float(np.average(xs[keep], weights=ws[keep]))
        my = float(np.average(ys[keep], weights=ws[keep]))
        d = np.hypot(xs - mx, ys - my)
        new_keep = d <= OUTLIER_GATE
        if new_keep.sum() == 0:
            new_keep = d <= d.min() + 1e-9   # keep at least the closest
        keep = new_keep
    mx = float(np.average(xs[keep], weights=ws[keep]))
    my = float(np.average(ys[keep], weights=ws[keep]))
    d = np.hypot(xs[keep] - mx, ys[keep] - my)
    disagreement = float(np.average(d, weights=ws[keep]))

    contributors = [meta[i][0] for i in np.nonzero(keep)[0]]
    modes = {meta[i][1] for i in np.nonzero(keep)[0]}
    if "observed" in modes:
        mode = "observed" if disagreement <= OUTLIER_GATE / 3 else "mixed"
    elif "mixed" in modes:
        mode = "mixed"
    else:
        mode = "inferred"
    conf = float(np.clip(ws[keep].sum() / (ws.sum() + 1e-9), 0, 1)) \
        * float(np.clip(1.0 - disagreement / OUTLIER_GATE, 0.2, 1.0)) \
        * float(np.clip(ws[keep].max(), 0, 1)) ** 0.5
    return mx, my, float(np.clip(conf, 0.02, 1.0)), mode, disagreement, contributors
