"""Test 28 — Red Box Only + LLM (user design, 2026-08-08).

Green-gated reds are the whole base — no legacy, no ball. Then the DOWNSWING (where we
fail most) splits into 5 segments; each contributes its HIGHEST-MOMENTUM frame (fastest
red-to-red travel), and ONE Claude call verifies our marked position per segment on
gridded crops — confirming the cell or answering the corrected one. Adjustments land as
`mixed`/`llm` at capped confidence; a confirmed red keeps its full detector strength.
AI failure = plain reds, untouched.
"""
from __future__ import annotations

import numpy as np

from ..forensic import roi_for, roi_to_frame
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..llm_locate import (GRID_COLS, GRID_ROWS, build_verify_prompt, draw_grid,
                          grid_cell_to_norm, locate)
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

N_SEGMENTS = 5
LLM_CONF_CAP = 0.55
ADJUST_MIN_CELLS = 1.0    # a correction under one cell of movement is a confirmation


def pick_momentum_frames(reds: dict[int, tuple[float, float]], top: int, impact: int,
                         fps: float, n_segments: int = N_SEGMENTS) -> list[int]:
    """Per downswing segment, the red frame with the fastest travel to its next red.
    Segments with no reds contribute their middle frame instead. Pure."""
    fs = sorted(f for f in reds if top <= f <= impact)
    speeds: dict[int, float] = {}
    for a, b in zip(fs, fs[1:]):
        dt = (b - a) / fps
        speeds[a] = float(np.hypot(reds[b][0] - reds[a][0],
                                   reds[b][1] - reds[a][1]) / dt)
    picks: list[int] = []
    span = (impact - top) / n_segments
    for k in range(n_segments):
        lo = top + k * span
        hi = top + (k + 1) * span
        seg = [f for f in fs if lo <= f < hi]
        if seg:
            picks.append(max(seg, key=lambda f: speeds.get(f, 0.0)))
        else:
            picks.append(int(lo + span / 2))
    return sorted(set(picks))


@register
class RedLlmTracker:
    id = "t28_red_llm"
    label = TEST_IDS["t28_red_llm"]
    version = "1.0.0"

    def __init__(self, provider=None, loader=None):
        self._provider = provider
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        red_full = {f: h for f, h in (_artifact_heads(ctx)
                                      or _sidecar_heads(ctx)).items()
                    if n0 <= f <= n1}
        if not red_full:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "no_raw_head_boxes"})
        reds_xy = {f: (x, y) for f, (x, y, _p) in red_full.items()}

        obs: dict[int, ClubObservation] = {
            f: ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                               confidence=round(p, 5), mode="observed",
                               source="detector", visibility="visible")
            for f, (x, y, p) in red_full.items()
        }

        picks = pick_momentum_frames(reds_xy, top, n1, ctx.fps)
        diag: dict = {"red_heads": len(red_full), "llm_frames": picks}

        video = self._loader(ctx, n0, n1)
        if video is None or ctx.out_dir is None:
            diag["llm"] = "no_video"
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version,
                                      observations=[obs[f] for f in sorted(obs)],
                                      diagnostics=diag)
        h, w = video.shape[1:3]

        import cv2
        dbg = ctx.out_dir / "debug" / "club" / "t28"
        dbg.mkdir(parents=True, exist_ok=True)

        def nearest_red(f: int) -> tuple[float, float]:
            k = min(reds_xy, key=lambda q: abs(q - f))
            return reds_xy[k]

        entries, rois = [], {}
        for f in picks:
            i = f - n0
            if not 0 <= i < video.shape[0]:
                continue
            cur = reds_xy.get(f, nearest_red(f))
            roi = roi_for(cur, 0.75, w, h)
            crop = video[i][roi[1]:roi[3], roi[0]:roi[2]].astype(np.uint8)
            if not crop.size:
                continue
            gridded = draw_grid(np.ascontiguousarray(crop[..., ::-1]))
            ch, cw = gridded.shape[:2]
            px = (cur[0] * w - roi[0]) / max(roi[2] - roi[0], 1)
            py = (cur[1] * h - roi[1]) / max(roi[3] - roi[1], 1)
            cv2.circle(gridded, (int(px * cw), int(py * ch)), 10, (255, 0, 255), 2)
            col = chr(ord("A") + int(np.clip(px * GRID_COLS, 0, GRID_COLS - 1)))
            row = int(np.clip(py * GRID_ROWS, 0, GRID_ROWS - 1)) + 1
            path = dbg / f"verify_{f:04d}.jpg"
            cv2.imwrite(str(path), gridded, [cv2.IMWRITE_JPEG_QUALITY, 88])
            entries.append({"frame": f, "path": str(path),
                            "current_cell": f"{col}{row}"})
            rois[f] = roi
        if not entries:
            diag["llm"] = "no_crops"
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version,
                                      observations=[obs[f] for f in sorted(obs)],
                                      diagnostics=diag)

        cache = ctx.out_dir / "debug" / "club" / "t28" / "cache.json"
        resp, status = locate(entries, cache_path=cache, provider=self._provider,
                              prompt_builder=build_verify_prompt)
        diag["llm"] = status
        adjusted = confirmed = 0
        if resp is not None:
            cell_w = 1.0 / GRID_COLS
            for e, ent in zip(resp, entries):
                if not e.get("visible"):
                    continue
                cell = grid_cell_to_norm(e["cell"])
                if cell is None:
                    continue
                f = e["frame"]
                roi = rois[f]
                x, y = roi_to_frame(cell[0], cell[1], roi, w, h)
                cur_cell = grid_cell_to_norm(ent["current_cell"])
                moved = np.hypot(cell[0] - cur_cell[0], cell[1] - cur_cell[1]) / cell_w
                if moved < ADJUST_MIN_CELLS:
                    confirmed += 1
                    continue
                adjusted += 1
                conf = min(float(e.get("confidence", 0.5)), 1.0) * LLM_CONF_CAP
                obs[f] = ClubObservation(
                    frame=f, source_time_s=f / ctx.fps,
                    x=float(np.clip(x, 0, 1)), y=float(np.clip(y, 0, 1)),
                    confidence=round(max(conf, 0.05), 5), mode="mixed",
                    source="llm", visibility="visible")
        diag["llm_adjusted"] = adjusted
        diag["llm_confirmed"] = confirmed
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)], diagnostics=diag)
