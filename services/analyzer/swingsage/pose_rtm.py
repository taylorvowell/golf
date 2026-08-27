"""RTMPose estimator — the pose spec's documented escalation path from MediaPipe.

The pose spec names RTMPose (the RTMDet->RTMPose top-down stack, as used by Swing Catalyst for
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
  foot detail at all, and the pose spec needs feet for stance width, flare and balance.
"""
from __future__ import annotations

import os

import numpy as np

from .frames import provider_for
from .pose import RawPoseSeries
from .skeleton import N_NATIVE, N_TRACKED, TRACKED_NAMES

# rtmlib caches these under ~/.cache/rtmlib. 384x288 is the large-input variant — we are
# offline, and input size is where top-down models buy their accuracy back (contrast
# MediaPipe, whose fixed ROI made resolution a dead end;).
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
# RTMW / COCO-Wholebody: 133 keypoints — body 0-16, feet 17-22, face 23-90,
# left hand 91-111, right hand 112-132. The hands are the reason to pay for this model:
# grip_center derived from wrists is the wrist *bone*, but the club is held across the base
# of the fingers, so the knuckles give the real grip.
WHOLEBODY_MODELS = {
    "performance": (
        "https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/"
        "rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip",
        (288, 384),
    ),
    "balanced": (
        "https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/"
        "rtmw-dw-x-l_simcc-cocktail14_270e-256x192_20231122.zip",
        (192, 256),
    ),
}

WHOLEBODY_TO_NATIVE = {
    0: "nose", 1: "left_eye", 2: "right_eye", 3: "left_ear", 4: "right_ear",
    5: "left_shoulder", 6: "right_shoulder", 7: "left_elbow", 8: "right_elbow",
    9: "left_wrist", 10: "right_wrist", 11: "left_hip", 12: "right_hip",
    13: "left_knee", 14: "right_knee", 15: "left_ankle", 16: "right_ankle",
    17: "left_foot_index", 19: "left_heel", 20: "right_foot_index", 22: "right_heel",
    # BlazePose calls slots 17-22 the pinky/index/thumb *knuckles*, which is exactly what
    # these are — so the wholebody hand fills them in place rather than needing new names.
    # They sat empty on this path because MediaPipe could not see a closed fist.
    96: "left_index", 108: "left_pinky", 93: "left_thumb",
    117: "right_index", 129: "right_pinky", 114: "right_thumb",
}

# Sub-block offsets, verified against real pixels by scripts/kpdebug.py — the 133-point
# array documents its block boundaries but not its internal order, and that ordering is an
# assumption until something draws it on a frame.
FACE0 = 23                      # 68-point iBUG face: contour 0-16, bridge 27-30
WHOLEBODY_TO_MEASURED = {
    FACE0 + 8: "chin", FACE0 + 27: "nose_bridge",
    FACE0 + 0: "jaw_left", FACE0 + 16: "jaw_right",
    18: "left_small_toe", 21: "right_small_toe",
    100: "left_middle_mcp", 121: "right_middle_mcp",
}

# --- confidence scale -----------------------------------------------------------
# RTMW returns SimCC peak magnitudes, not probabilities: across both fixtures the points
# this pipeline consumes run p01 2.87, median 5.04, p99 7.84, with ~100% of them above 1.0
# on a typical frame. Clamping that to [0,1] — which is what this code used to do, on the
# assumption the scores were Halpe26-like — mapped essentially every keypoint to exactly
# 1.00. That is where "100% coverage @ 1.00" came from: the clamp, not the model. It also
# left the UI with nothing to dim and Stage 3 unable to reject anything on confidence.
#
# This is a monotone rescale of a sharpness score, NOT a calibrated probability, and it is
# only meaningful relative to other points from the same model. Endpoints are solved from
# the measured distribution (scripts/kpdebug.py prints it) so the occluded tail lands under
# the gates the rest of the pipeline already uses:
#
#     p01 -> 0.30   under the club pipeline's usable gate      (1% of points)
#     p10 -> 0.50   under Stage 3's OK gate, enters PROVISIONAL (10%)
#     p50 -> 0.76   comfortably trusted
#
# Halpe26 is natively ~0-1 and is left alone.
WHOLEBODY_CONF_LO, WHOLEBODY_CONF_HI = 1.45, 6.17

# MCP joints (the knuckles) of index/middle/ring/pinky on each hand. Their centroid is
# where the shaft actually sits in the palm. Hand layout is the standard 21-point one:
# 0 wrist, then thumb/index/middle/ring/pinky in fours.
HAND_BASE = {"left": 91, "right": 112}
MCP_OFFSETS = (5, 9, 13, 17)

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


def _hand_grip(pts, sc, w, h, conf_of, min_conf=0.25):
    """Grip point from the knuckles of both hands, in normalized coords.

    Averages the index/middle/ring/pinky MCP joints — the club rests across those, so their
    centroid is the true grip. Falls back to a single hand when only one resolves, which is
    still far better than the wrist midpoint.

    `min_conf` gates on the *rescaled* confidence, so it means the same thing here as
    everywhere else downstream — against raw SimCC scores it admitted everything.
    """
    hand_pts, confs, per_side = [], [], {}
    for side, base in HAND_BASE.items():
        got = [(pts[base + o], conf_of(sc[base + o])) for o in MCP_OFFSETS
               if base + o < len(pts) and conf_of(sc[base + o]) >= min_conf]
        if len(got) >= 2:
            m = np.mean([g[0] for g in got], axis=0)
            c = float(np.mean([g[1] for g in got]))
            hand_pts.append(m)
            confs.append(c)
            per_side[side] = [float(m[0]) / w, float(m[1]) / h, c]
    if not hand_pts:
        return None, {}
    c = np.mean(hand_pts, axis=0)
    return ([float(c[0]) / w, float(c[1]) / h, float(np.mean(confs))], per_side)


def _enable_cuda_dlls() -> None:
    """
    Make onnxruntime's CUDA provider loadable. Without this it silently runs on the CPU.

    There is **no CUDA toolkit installed on this machine**. The CUDA 12 + cuDNN 9 DLLs that
    `onnxruntime-gpu` links against are the ones **torch ships**, in `site-packages/torch/lib`,
    and importing torch is what puts that directory on the DLL search path. So this import is
    load-bearing, not incidental — skip it and `InferenceSession(..., providers=["CUDA..."])`
    returns a session whose providers are `["CPUExecutionProvider"]`, with no exception raised.

    That silence is the whole hazard: every symptom of "CUDA is not set up" looks identical to
    "the GPU does not help", and the second one is a conclusion about hardware you would then
    buy, or not buy, a host for.
    """
    try:
        import torch  # noqa: F401
    except Exception:
        pass


def pose_device() -> str:
    """
    Which device RTMPose runs on: `"cuda"` when the runtime can actually do it, else `"cpu"`.

    Pose is the slowest stage in the pipeline and ran on the CPU for the whole life of this project
    while a CUDA GPU sat idle — not because anything chose that, but because the installed
    `onnxruntime` was the CPU-only build, whose provider list contains no CUDA at all. Changing the
    string alone would have done nothing; `onnxruntime-gpu` is what makes this reachable.

    **Probed, never assumed.** The provider list is the runtime's own answer to "can I", which is
    the only trustworthy one — a CUDA build on a machine with no driver, a Pascal card too old for
    a given build, or a missing cuDNN all present as an available-provider list without CUDA in it,
    or as a session that fails to create. Falling back to CPU is always correct and merely slower;
    guessing wrong the other way fails the whole analysis.

    `SWINGSAGE_POSE_DEVICE=cpu|cuda` forces it, which is what the CPU-vs-CUDA measurement uses and
    what a host with a GPU it does not want spent on pose would set.
    """
    forced = os.environ.get("SWINGSAGE_POSE_DEVICE", "").strip().lower()
    if forced == "cpu":
        return "cpu"
    if forced == "cuda":
        # Still register the DLLs. An earlier version returned here directly, which meant the one
        # caller that forces "cuda" — the CPU-vs-CUDA benchmark — was the one caller that skipped
        # the setup CUDA needs, so it silently measured CPU against CPU and reported 1.00x.
        _enable_cuda_dlls()
        return "cuda"
    try:
        import onnxruntime as ort

        if "CUDAExecutionProvider" not in ort.get_available_providers():
            return "cpu"

        _enable_cuda_dlls()
        return "cuda"
    except Exception:
        # Anything failing here means CUDA is not usable. CPU is always correct and merely
        # slower; guessing the other way fails the whole analysis.
        return "cpu"


#: ONNX sessions, built once per process and keyed by (weights, input size, device). Session
#: creation is the expensive part — graph load, provider init, CUDA context — and it was paid
#: again on every job even on a warm container. The session is used read-only and rtmlib holds
#: no per-clip state on it, so one instance serves every job the container sees.
_RTM_CACHE: dict[tuple, object] = {}


def _rtmpose(url, input_size, device):
    from rtmlib import RTMPose
    key = (url, tuple(input_size), device)
    got = _RTM_CACHE.get(key)
    if got is None:
        got = _RTM_CACHE[key] = RTMPose(url, model_input_size=input_size,
                                        backend="onnxruntime", device=device)
    return got


def estimate(video_path, boxes, mode: str = "performance", progress=None,
             wholebody: bool = False, provider=None) -> RawPoseSeries:
    url, input_size = (WHOLEBODY_MODELS if wholebody else POSE_MODELS)[mode]
    mapping = WHOLEBODY_TO_NATIVE if wholebody else HALPE26_TO_NATIVE
    model = _rtmpose(url, input_size, pose_device())

    fp, owned = provider_for(video_path, provider)
    fps, w, h = fp.fps, fp.width, fp.height
    total = len(boxes)

    kind = "rtmw-wholebody133" if wholebody else "rtmpose-halpe26"
    series = RawPoseSeries(model=f"{kind}-{mode}-{input_size[0]}x{input_size[1]}",
                           width=w, height=h, fps=fps)
    slot = {name: i for i, name in enumerate(TRACKED_NAMES)}

    def conf_of(raw):
        """Model score -> [0,1]. See WHOLEBODY_CONF_LO/HI."""
        if not wholebody:
            return float(min(max(raw, 0.0), 1.0))
        span = WHOLEBODY_CONF_HI - WHOLEBODY_CONF_LO
        return float(min(max((raw - WHOLEBODY_CONF_LO) / span, 0.0), 1.0))

    f = 0
    try:
        for _f, img in fp.stream_bgr(limit=total):
            kp = [[0.0, 0.0, 0.0] for _ in range(N_TRACKED)]
            try:
                kps, scores = model(img, bboxes=[boxes[f]])
            except Exception:
                kps, scores = [], []

            grip, hands = None, {}
            if len(kps):
                pts, sc = np.asarray(kps[0], float), np.asarray(scores[0], float)
                for hi, name in mapping.items():
                    if hi < len(pts):
                        kp[slot[name]] = [float(pts[hi][0]) / w, float(pts[hi][1]) / h,
                                          conf_of(sc[hi])]
                if wholebody:
                    for hi, name in WHOLEBODY_TO_MEASURED.items():
                        if hi < len(pts):
                            kp[slot[name]] = [float(pts[hi][0]) / w, float(pts[hi][1]) / h,
                                              conf_of(sc[hi])]
                    grip, hands = _hand_grip(pts, sc, w, h, conf_of)
                series.detected.append(True)
            else:
                series.detected.append(False)

            # Per-hand knuckle centroids are kept separately, not just their average: the two
            # hands sit adjacent along the grip, so the vector between them points along the
            # shaft. That is a high-confidence, per-frame direction prior for club tracking —
            # measured from the body rather than inferred from a motion mask.
            series.frames.append({"f": f, "kp": kp, "grip": grip, "hands": hands})
            series.world.append(None)
            f += 1
            if progress and (f % 30 == 0 or f == total):
                progress(f, total)
    finally:
        if owned:
            fp.close()

    return series
