"""Test 3 — Modern Point Tracking (plan §12).

Zero-shot CoTracker3 over the address->impact window of analysis.mp4, seeded from the
frames where the classical solve was most confident, merged across seeds by visibility-
gated weighted median. The tracker and the frame loader are constructor args so the
hermetic suite runs on fakes; the real adapter is only constructed inside `run` on demand.
"""
from __future__ import annotations

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..point_trackers.base import (TrackerFn, build_seed_queries, merge_seed_tracks)
from ..registry import TEST_IDS, register

N_ANCHORS = 4
ANCHOR_MIN_CONF = 0.5
PAD_FRAMES = 12


def _load_window(ctx: ClubTrackingContext, lo: int, hi: int) -> np.ndarray | None:
    """RGB frames [lo, hi] from analysis.mp4 (the 720p CFR derivative CV consumes)."""
    if ctx.out_dir is None:
        return None
    path = ctx.out_dir / "analysis.mp4"
    if not path.exists():
        return None
    import cv2
    cap = cv2.VideoCapture(str(path))
    frames = []
    f = 0
    while True:
        ok, img = cap.read()
        if not ok or f > hi:
            break
        if f >= lo:
            frames.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        f += 1
    cap.release()
    return np.stack(frames).astype(np.float32) if frames else None


def _pick_anchors(ctx: ClubTrackingContext, lo: int, hi: int
                  ) -> list[tuple[int, float, float]]:
    """Most-confident classical head per quarter of the window (plan §12's 'seed from
    multiple reliable frames': address, mid-backswing, near top, late downswing)."""
    rows = []
    for cf in (ctx.doc.get("club") or {}).get("frames") or []:
        f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
        if head is None or f is None or not lo <= f <= hi or cf.get("interp"):
            continue
        rows.append((f, head[0], head[1], conf))
    if not rows:
        return []
    anchors = []
    span = (hi - lo + 1) / N_ANCHORS
    for q in range(N_ANCHORS):
        a, b = lo + q * span, lo + (q + 1) * span
        best = max((r for r in rows if a <= r[0] < b), key=lambda r: r[3], default=None)
        if best is not None and best[3] >= ANCHOR_MIN_CONF:
            anchors.append((best[0], best[1], best[2]))
    return anchors


@register
class PointTrackingTracker:
    id = "t3_point_tracking"
    label = TEST_IDS["t3_point_tracking"]
    version = "1.0.0"

    def __init__(self, tracker: TrackerFn | None = None, loader=None):
        self._tracker = tracker
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        lo = max(0, n0 - PAD_FRAMES)
        hi = min(ctx.frame_count - 1, n1 + PAD_FRAMES)

        anchors = _pick_anchors(ctx, n0, n1)
        if len(anchors) < 2:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "insufficient_anchors"})

        video = self._loader(ctx, lo, hi)
        if video is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})
        h, w = video.shape[1:3]

        queries, offsets = build_seed_queries(
            [(t - lo, x * w, y * h) for t, x, y in anchors], (1.0, 1.0),
            support_px=max(3.0, w * 0.008))
        # build_seed_queries multiplies by frame size; we already passed pixels, so
        # frame_size=(1,1) above keeps them as-is.

        tracker = self._tracker
        if tracker is None:
            from ..point_trackers.cotracker import make_cotracker
            tracker = make_cotracker()

        tracks, vis = tracker(video, queries)
        merged = merge_seed_tracks(tracks, vis, offsets, frame_size=(w, h))

        # dedupe to source observations
        rep_of: dict[int, int] = {}
        if ctx.source_timing is not None and ctx.source_timing.observations:
            for o in ctx.source_timing.observations:
                for nf in o.normalized_frames:
                    rep_of[nf] = o.normalized_frames[0]

        best_by_frame: dict[int, tuple[float, float, float, str]] = {}
        for t, xn, yn, conf, mode in merged:
            f = lo + t
            if not n0 <= f <= n1:
                continue
            f = rep_of.get(f, f)
            cur = best_by_frame.get(f)
            if cur is None or conf > cur[2]:
                best_by_frame[f] = (xn, yn, conf, mode)

        observations = [
            ClubObservation(frame=f, source_time_s=f / ctx.fps,
                            x=float(np.clip(x, 0, 1)), y=float(np.clip(y, 0, 1)),
                            confidence=round(conf, 5), mode=mode,
                            source="point_tracker", visibility="visible")
            for f, (x, y, conf, mode) in sorted(best_by_frame.items())
        ]
        modes = [o.mode for o in observations]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "anchors": len(anchors),
                "tracked_frames": len(merged),
                "kept": len(observations),
                "observed_fraction": round(
                    modes.count("observed") / len(modes), 4) if modes else 0.0,
            })
