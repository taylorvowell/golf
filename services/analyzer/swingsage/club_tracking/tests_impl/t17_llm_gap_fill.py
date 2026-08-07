"""Test 17 — Confidence-Triaged LLM Gap Fill (user request; doc 00's sanctioned AI use).

Confident detections stay as anchors and never touch the model. The unconfident gaps are
triaged deterministically, up to 10 representative frames get a labeled grid burned into
a generous crop, and ONE Claude call answers grid cells. LLM points are `mixed`, source
`llm`, confidence capped — the model assists, it never outranks a real detection. Total
failure = anchors alone, path-fit bridges (AI is never a hard dependency).
"""
from __future__ import annotations

import numpy as np

from ..forensic import roi_for, roi_to_frame
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..llm_locate import (CONF_ANCHOR, grid_cell_to_norm, draw_grid, locate,
                          pick_llm_frames)
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window

LLM_CONF_CAP = 0.55      # a grid cell is ~1/12 of a crop — never observed-grade


def _neighbor_prediction(anchors: dict[int, tuple[float, float]], f: int):
    ks = sorted(anchors)
    before = next((k for k in reversed(ks) if k < f), None)
    after = next((k for k in ks if k > f), None)
    if before is None and after is None:
        return (0.5, 0.5), 0.0
    if before is None:
        return anchors[after], 0.3
    if after is None:
        return anchors[before], 0.3
    t = (f - before) / max(after - before, 1)
    ax, ay = anchors[before]
    bx, by = anchors[after]
    return (ax + t * (bx - ax), ay + t * (by - ay)), 0.5


@register
class LlmGapFillTracker:
    id = "t17_llm_gap_fill"
    label = TEST_IDS["t17_llm_gap_fill"]
    version = "1.0.0"

    def __init__(self, provider=None, loader=None):
        self._provider = provider
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        anchors: dict[int, tuple[float, float]] = {}
        observations: list[ClubObservation] = []
        for cf in (ctx.doc.get("club") or {}).get("frames") or []:
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if (head is None or f is None or not n0 <= f <= n1
                    or conf < CONF_ANCHOR or cf.get("interp")):
                continue
            anchors[f] = (head[0], head[1])
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=head[0], y=head[1],
                confidence=round(conf, 5), mode="observed", source="detector",
                visibility="visible"))

        picks = pick_llm_frames(set(anchors), n0, n1)
        diag: dict = {"anchors": len(anchors), "llm_frames_requested": len(picks)}
        if not picks:
            diag["llm"] = "not_needed"
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version,
                                      observations=observations, diagnostics=diag)

        video = self._loader(ctx, n0, n1)
        if video is None:
            diag["llm"] = "no_video"
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version,
                                      observations=observations, diagnostics=diag)
        h, w = video.shape[1:3]

        # generous grid crops around the neighbor-predicted position
        entries, rois = [], {}
        if ctx.out_dir is not None:
            import cv2
            dbg = ctx.out_dir / "debug" / "club" / "t17"
            dbg.mkdir(parents=True, exist_ok=True)
            for f in picks:
                i = f - n0
                if not 0 <= i < video.shape[0]:
                    continue
                pred, pconf = _neighbor_prediction(anchors, f)
                roi = roi_for(pred, pconf, w, h)
                crop = video[i][roi[1]:roi[3], roi[0]:roi[2]].astype(np.uint8)
                if not crop.size:
                    continue
                gridded = draw_grid(np.ascontiguousarray(crop[..., ::-1]))
                path = dbg / f"grid_{f:04d}.jpg"
                cv2.imwrite(str(path), gridded, [cv2.IMWRITE_JPEG_QUALITY, 88])
                entries.append({"frame": f, "path": str(path)})
                rois[f] = roi
        if not entries:
            diag["llm"] = "no_crops"
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version,
                                      observations=observations, diagnostics=diag)

        cache = (ctx.out_dir / "debug" / "club" / "t17" / "cache.json"
                 if ctx.out_dir else None)
        resp, status = locate(entries, cache_path=cache, provider=self._provider)
        diag["llm"] = status
        filled = 0
        if resp is not None:
            for e in resp:
                if not e.get("visible"):
                    continue
                cell = grid_cell_to_norm(e["cell"])
                if cell is None:
                    continue
                f = e["frame"]
                roi = rois.get(f)
                if roi is None:
                    continue
                x, y = roi_to_frame(cell[0], cell[1], roi, w, h)
                conf = min(float(e.get("confidence", 0.5)), 1.0) * LLM_CONF_CAP
                filled += 1
                observations.append(ClubObservation(
                    frame=f, source_time_s=f / ctx.fps,
                    x=float(np.clip(x, 0, 1)), y=float(np.clip(y, 0, 1)),
                    confidence=round(max(conf, 0.05), 5), mode="mixed",
                    source="llm", visibility="visible"))
        diag["llm_frames_filled"] = filled
        observations.sort(key=lambda o: o.frame)
        return ClubTrackingResult(test_id=self.id, label=self.label,
                                  version=self.version,
                                  observations=observations, diagnostics=diag)
