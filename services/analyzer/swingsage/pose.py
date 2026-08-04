"""Stage 2 — raw pose estimation (doc 03 §3).

Uses the MediaPipe Tasks PoseLandmarker; the legacy `mp.solutions.pose` API doc 03 was
written against no longer exists in mediapipe 1.0 (see docs/DECISIONS.md D1).

Two constraints from that API shape this module:
  * `detect_for_video` demands monotonically increasing timestamps and exposes no reset(),
    so a VIDEO-mode instance is single-use per clip and can never rewind.
  * Consequently doc 03 §3.4's "retry a failed span in static image mode" needs a *separate*
    IMAGE-mode landmarker, which `retry_gaps` provides.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

from .skeleton import (NATIVE_NAMES, KEYPOINT_NAMES, TRACKED_NAMES, N_TRACKED,
                       add_derived)

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "pose_landmarker_heavy.task"
N_NATIVE = len(NATIVE_NAMES)


@dataclass
class RawPoseSeries:
    model: str
    frames: list = field(default_factory=list)   # [{"f": int, "kp": [[x,y,conf], ...]}]
    world: list = field(default_factory=list)    # per-frame world landmarks (kept for 3D later)
    detected: list = field(default_factory=list) # bool per frame
    width: int = 0
    height: int = 0
    fps: float = 60.0

    @property
    def coverage(self) -> float:
        return (sum(self.detected) / len(self.detected)) if self.detected else 0.0


def _make_options(running_mode, model_path=None):
    return vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path or MODEL_PATH)),
        running_mode=running_mode,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_segmentation_masks=False,   # doc 04 Layer A turns this on; costs time, unused here
    )


def _empty_kp():
    return [[0.0, 0.0, 0.0] for _ in range(N_TRACKED)]


def _landmarks_to_kp(landmarks):
    """NormalizedLandmark list -> [[x, y, conf], ...].

    `visibility` is doc 03's confidence signal. The Tasks API can return None for it, and
    also exposes `presence`; we take the min of whichever are present so an occluded-but-
    hallucinated joint can't score high on one signal alone.
    """
    kp = []
    for lm in landmarks:
        vis = getattr(lm, "visibility", None)
        pres = getattr(lm, "presence", None)
        scores = [s for s in (vis, pres) if s is not None]
        conf = float(min(scores)) if scores else 1.0
        kp.append([float(lm.x), float(lm.y), conf])
    # Pad the measured-extras block: BlazePose has no face-contour, small-toe or middle-MCP
    # landmark, so those stay missing on this path and every array keeps one width.
    kp += [[0.0, 0.0, 0.0]] * (N_TRACKED - len(kp))
    return kp


def estimate(video_path: str | Path, progress=None) -> RawPoseSeries:
    """Run pose frame-sequentially over a normalized CFR video."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    series = RawPoseSeries(model="mediapipe-tasks-pose-heavy-1.0.0",
                           width=w, height=h, fps=fps)

    landmarker = vision.PoseLandmarker.create_from_options(
        _make_options(vision.RunningMode.VIDEO))
    try:
        f = 0
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # Monotonic and strictly increasing: integer ms from the CFR frame index.
            ts_ms = int(round(f * 1000.0 / fps))
            result = landmarker.detect_for_video(image, ts_ms)

            if result.pose_landmarks:
                kp = _landmarks_to_kp(result.pose_landmarks[0])
                series.detected.append(True)
                world = [[lm.x, lm.y, lm.z] for lm in result.pose_world_landmarks[0]] \
                    if result.pose_world_landmarks else None
            else:
                kp = _empty_kp()
                series.detected.append(False)
                world = None

            series.frames.append({"f": f, "kp": kp})
            series.world.append(world)

            f += 1
            if progress and (f % 30 == 0 or f == total):
                progress(f, total)
    finally:
        landmarker.close()
        cap.release()

    return series


def retry_gaps(video_path: str | Path, series: RawPoseSeries, min_run: int = 3) -> int:
    """Doc 03 §3.4 — re-run undetected spans with a per-frame detector (IMAGE mode).

    VIDEO mode leans on its internal tracker; once it loses the golfer it can stay lost.
    IMAGE mode re-detects from scratch on every frame, which recovers those spans at the
    cost of speed. Only runs on gaps of >= min_run consecutive misses. Returns frames fixed.
    """
    gaps, start = [], None
    for i, det in enumerate(series.detected):
        if not det and start is None:
            start = i
        elif det and start is not None:
            if i - start >= min_run:
                gaps.append((start, i))
            start = None
    if start is not None and len(series.detected) - start >= min_run:
        gaps.append((start, len(series.detected)))

    if not gaps:
        return 0

    cap = cv2.VideoCapture(str(video_path))
    landmarker = vision.PoseLandmarker.create_from_options(
        _make_options(vision.RunningMode.IMAGE))
    fixed = 0
    try:
        for a, b in gaps:
            for f in range(a, b):
                cap.set(cv2.CAP_PROP_POS_FRAMES, f)
                ok, frame_bgr = cap.read()
                if not ok:
                    continue
                image = mp.Image(image_format=mp.ImageFormat.SRGB,
                                 data=cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
                result = landmarker.detect(image)
                if result.pose_landmarks:
                    series.frames[f]["kp"] = _landmarks_to_kp(result.pose_landmarks[0])
                    series.detected[f] = True
                    fixed += 1
    finally:
        landmarker.close()
        cap.release()
    return fixed


def swing_bbox(series: RawPoseSeries, pad: float = 0.12, lo: float = 0.5,
               hi: float = 99.5) -> tuple[float, float, float, float]:
    """Union bounding box of the golfer across the clip, in normalized coords.

    Uses percentiles rather than absolute min/max so a single wild misdetection can't
    inflate the box and undo the resolution gain. One fixed box for the whole clip (rather
    than per-frame tracking) is deliberate: the golfer stays roughly stationary, and a
    stable crop keeps MediaPipe's VIDEO-mode tracker from seeing the scene jump every frame.
    """
    xs, ys = [], []
    for fr in series.frames:
        for x, y, c in fr["kp"]:
            if c > 0.3:
                xs.append(x); ys.append(y)
    if not xs:
        return (0.0, 0.0, 1.0, 1.0)

    x0, x1 = np.percentile(xs, lo), np.percentile(xs, hi)
    y0, y1 = np.percentile(ys, lo), np.percentile(ys, hi)

    # Pad relative to the larger dimension so a narrow standing pose still gets lateral
    # room for the arms and club to swing into.
    span = max(x1 - x0, y1 - y0)
    px = py = span * pad
    return (max(0.0, x0 - px), max(0.0, y0 - py),
            min(1.0, x1 + px), min(1.0, y1 + py))


def remap_to_full(series: RawPoseSeries, applied_bbox) -> RawPoseSeries:
    """Convert crop-space normalized coords back to full-frame normalized coords."""
    bx0, by0, bx1, by1 = applied_bbox
    sx, sy = bx1 - bx0, by1 - by0
    for fr in series.frames:
        for p in fr["kp"]:
            if p[2] > 0.0:
                p[0] = bx0 + p[0] * sx
                p[1] = by0 + p[1] * sy
    return series


def finalize(series: RawPoseSeries) -> RawPoseSeries:
    """Append derived joints — doc 03 §3.6 requires this *after* smoothing."""
    for fr in series.frames:
        if len(fr["kp"]) == N_TRACKED:
            add_derived(fr["kp"], fr.get("st"), fr.get("grip"), fr.get("hands"))
    return series


def quality(series: RawPoseSeries) -> dict:
    """Per-joint coverage and mean confidence — the Gate 1 measurement (doc 03 §7)."""
    n = len(series.frames)
    per_joint = {}
    if n:
        arr = np.array([fr["kp"] for fr in series.frames], dtype=np.float32)  # (n, J, 3)
        conf = arr[:, :, 2]
        # Pre-finalize the array is in TRACKED order (native + measured); after finalize the
        # derived block sits between them. Label by width so a pre-finalize call can't
        # silently report measured points under derived joints' names.
        names = KEYPOINT_NAMES if arr.shape[1] == len(KEYPOINT_NAMES) else TRACKED_NAMES
        for j, name in enumerate(names[:arr.shape[1]]):
            visible = conf[:, j] >= 0.5
            per_joint[name] = {
                "coverage": round(float(visible.mean()), 4),
                "mean_conf": round(float(conf[:, j].mean()), 4),
            }
    return {
        "frames": n,
        "detection_coverage": round(series.coverage, 4),
        "overall_mean_conf": round(
            float(np.mean([v["mean_conf"] for v in per_joint.values()])), 4
        ) if per_joint else 0.0,
        "per_joint": per_joint,
    }
