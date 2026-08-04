"""RTMPose estimator — doc 03 §1's documented escalation path from MediaPipe.

Doc 03 names RTMPose (the RTMDet->RTMPose top-down stack, as used by Swing Catalyst for
golf) as the upgrade to take when MediaPipe underperforms on occlusion. Measured on our
fixtures it does exactly that: on swing2 frame 30, where MediaPipe scores the far-side
wrist/elbow/knee/ankle all below 0.5, RTMPose scores them 0.70/0.71/0.77/0.88.

Two design choices worth stating:

* **No person detector.** rtmlib ships YOLOX for this, but the smallest useful weights are
  a large download and it re-detects a golfer who barely moves. We already run MediaPipe,
  whose torso and head are the most reliable thing it produces (100% at ~1.00 on both
  fixtures), so its skeleton supplies the per-frame box. MediaPipe localises, RTMPose
  measures — each does what it is good at.
* **Halpe26, not COCO17.** Halpe26 adds neck, head, mid-hip, heels and toes; COCO17 has no
  foot detail at all, and doc 03 §2 needs feet for stance width, flare and balance.
"""
from __future__ import annotations

import cv2
import numpy as np

from .pose import RawPoseSeries
from .skeleton import NATIVE_NAMES

N_NATIVE = len(NATIVE_NAMES)

# rtmlib caches these under ~/.cache/rtmlib. 384x288 is the large-input variant — we are
# offline, and input size is where top-down models buy their accuracy back (contrast
# MediaPipe, whose fixed ROI made resolution a dead end; see DECISIONS.md D5).
POSE_MODELS = {
    "performance": (
        "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
        "rtmpose-x_simcc-body7_pt-body7-halpe26_700e-384x288-7fb6e239_20230606.zip",
        (288, 384),
    ),
    "balanced": (
        "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
        "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip",
        (192, 256),
    ),
}

# Halpe26 index -> our native slot name. Unlisted slots (eye_inner/outer, mouth, the hand
# landmarks) have no Halpe equivalent and stay missing — all of them are already excluded
# from rendering and scoring, so nothing downstream regresses.
HALPE26_TO_NATIVE = {
    0: "nose", 1: "left_eye", 2: "right_eye", 3: "left_ear", 4: "right_ear",
    5: "left_shoulder", 6: "right_shoulder", 7: "left_elbow", 8: "right_elbow",
    9: "left_wrist", 10: "right_wrist", 11: "left_hip", 12: "right_hip",
    13: "left_knee", 14: "right_knee", 15: "left_ankle", 16: "right_ankle",
    20: "left_foot_index", 21: "right_foot_index", 24: "left_heel", 25: "right_heel",
}


def bboxes_from_series(series: RawPoseSeries, pad=0.22, min_conf=0.3):
    """Per-frame person box (pixels) from an existing skeleton, for RTMPose to work inside.

    Padded generously because the box must contain limbs the source model placed poorly or
    missed — a box drawn tightly around MediaPipe's output would inherit its blind spots.
    """
    w, h = series.width, series.height
    boxes, last = [], None
    for fr in series.frames:
        pts = [(x, y) for x, y, c in fr["kp"][:N_NATIVE] if c > min_conf]
        if len(pts) < 4:
            boxes.append(last)
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        span = max(x1 - x0, y1 - y0)
        px = py = span * pad
        box = [max(0.0, (x0 - px)) * w, max(0.0, (y0 - py)) * h,
               min(1.0, (x1 + px)) * w, min(1.0, (y1 + py)) * h]
        boxes.append(box)
        last = box
    # Backfill any leading frames that had no usable skeleton.
    first = next((b for b in boxes if b is not None), [0, 0, w, h])
    return [b if b is not None else first for b in boxes]


def estimate(video_path, boxes, mode: str = "performance", progress=None) -> RawPoseSeries:
    from rtmlib import RTMPose

    url, input_size = POSE_MODELS[mode]
    model = RTMPose(url, model_input_size=input_size,
                    backend="onnxruntime", device="cpu")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = len(boxes)

    series = RawPoseSeries(model=f"rtmpose-halpe26-{mode}-{input_size[0]}x{input_size[1]}",
                           width=w, height=h, fps=fps)
    slot = {name: i for i, name in enumerate(NATIVE_NAMES)}

    f = 0
    try:
        while f < total:
            ok, img = cap.read()
            if not ok:
                break
            kp = [[0.0, 0.0, 0.0] for _ in range(N_NATIVE)]
            try:
                kps, scores = model(img, bboxes=[boxes[f]])
            except Exception:
                kps, scores = [], []

            if len(kps):
                pts, sc = np.asarray(kps[0], float), np.asarray(scores[0], float)
                for hi, name in HALPE26_TO_NATIVE.items():
                    if hi < len(pts):
                        # RTMPose scores can exceed 1.0; clamp so confidence stays comparable
                        # to MediaPipe's and to the thresholds Stage 3 is tuned against.
                        c = float(min(max(sc[hi], 0.0), 1.0))
                        kp[slot[name]] = [float(pts[hi][0]) / w, float(pts[hi][1]) / h, c]
                series.detected.append(True)
            else:
                series.detected.append(False)

            series.frames.append({"f": f, "kp": kp})
            series.world.append(None)
            f += 1
            if progress and (f % 30 == 0 or f == total):
                progress(f, total)
    finally:
        cap.release()

    return series
