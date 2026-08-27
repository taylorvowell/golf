"""Stage 2 — raw pose estimation (the pose spec).

Uses the MediaPipe Tasks PoseLandmarker; the legacy `mp.solutions.pose` API the pose spec was
written against no longer exists in mediapipe 1.0 ().

Two constraints from that API shape this module:
  * `detect_for_video` demands monotonically increasing timestamps and exposes no reset(),
    so a VIDEO-mode instance is single-use per clip and can never rewind.
  * Consequently the pose spec's "retry a failed span in static image mode" needs a *separate*
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

from . import silhouette as sil
from .frames import provider_for
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
    # Stage 2b: {frame: [ring, ...]} of the golfer's outline, normalized, only when
    # `estimate(silhouette=True)` asked for it. Empty otherwise — see swingsage/silhouette.py.
    silhouette: dict = field(default_factory=dict)

    @property
    def coverage(self) -> float:
        return (sum(self.detected) / len(self.detected)) if self.detected else 0.0


#: The .task bundle, read once per process and keyed by path. A VIDEO-mode landmarker cannot
#: be reused across clips (`detect_for_video` demands monotonic timestamps and exposes no
#: reset), so the LANDMARKER is deliberately not cached — the model BYTES are, which is the
#: part a warm container was re-reading off disk for every job and every retry pass.
_MODEL_BYTES: dict[str, bytes] = {}


def _base_options(model_path):
    key = str(model_path)
    buf = _MODEL_BYTES.get(key)
    if buf is None:
        try:
            buf = _MODEL_BYTES[key] = Path(key).read_bytes()
        except OSError:
            # Unreadable here means unreadable for MediaPipe too, but let IT produce the
            # error — its message names the task bundle and the expected format.
            return BaseOptions(model_asset_path=key)
    return BaseOptions(model_asset_buffer=buf)


def _make_options(running_mode, model_path=None, segmentation=False):
    return vision.PoseLandmarkerOptions(
        base_options=_base_options(model_path or MODEL_PATH),
        running_mode=running_mode,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        # An extra output head, not an extra pass: measured at +2.0s over 396 frames, against
        # +20s to segment the same clip with a second model. Landmark output is unaffected —
        # this changes nothing numerically in the pose, only what else comes back.
        output_segmentation_masks=segmentation,
    )


def _empty_kp():
    return [[0.0, 0.0, 0.0] for _ in range(N_TRACKED)]


def _landmarks_to_kp(landmarks):
    """NormalizedLandmark list -> [[x, y, conf], ...].

    `visibility` is the pose spec's confidence signal. The Tasks API can return None for it, and
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


def estimate(video_path: str | Path, progress=None, silhouette: bool = False,
             provider=None) -> RawPoseSeries:
    """Run pose frame-sequentially over a normalized CFR video.

    `silhouette` additionally asks the landmarker for its person segmentation mask and reduces
    each one to normalized contours (Stage 2b). It rides along on this pass rather than being
    a stage of its own precisely because this pass always happens — MediaPipe is the fallback
    estimator and RTMPose's localiser either way.
    """
    fp, owned = provider_for(video_path, provider)
    fps, total, w, h = fp.fps, fp.frame_count, fp.width, fp.height

    series = RawPoseSeries(model="mediapipe-tasks-pose-heavy-1.0.0",
                           width=w, height=h, fps=fps)

    landmarker = vision.PoseLandmarker.create_from_options(
        _make_options(vision.RunningMode.VIDEO, segmentation=silhouette))
    try:
        f = 0
        for _f, frame_bgr in fp.stream_bgr():
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

            # Reduced to contours here and not stored raw: `numpy_view()` is a view into the
            # result's own buffer, and holding it past this iteration segfaults the
            # interpreter rather than raising. A mask with no pose behind it is skipped —
            # it is the tracker's last guess, not a measurement.
            if silhouette and result.segmentation_masks and result.pose_landmarks:
                polys = sil.contours(result.segmentation_masks[0].numpy_view(), w, h)
                if polys:
                    series.silhouette[f] = polys

            f += 1
            if progress and (f % 30 == 0 or f == total):
                progress(f, total)
    finally:
        landmarker.close()
        if owned:
            fp.close()

    return series


def retry_gaps(video_path: str | Path, series: RawPoseSeries, min_run: int = 3) -> int:
    """The pose spec — re-run undetected spans with a per-frame detector (IMAGE mode).

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


def finalize(series: RawPoseSeries) -> RawPoseSeries:
    """Append derived joints — the pose spec requires this *after* smoothing."""
    for fr in series.frames:
        if len(fr["kp"]) == N_TRACKED:
            add_derived(fr["kp"], fr.get("st"), fr.get("grip"), fr.get("hands"))
    return series


def quality(series: RawPoseSeries) -> dict:
    """Per-joint coverage and mean confidence — the Gate 1 measurement (the pose spec)."""
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
