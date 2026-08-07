"""Stage 2b — the golfer's outline, and the setup reference lines drawn from it.

MediaPipe's PoseLandmarker can emit a person segmentation mask alongside the landmarks
(`output_segmentation_masks`). Stage 2 already runs that landmarker over every frame — it is
the fallback estimator and RTMPose's localiser — so the mask costs one extra output head on a
pass we were making anyway: measured at **+2.0s on a 396-frame clip** against +20s for a
second model's pass. That is the whole reason this is a MediaPipe mask and not a YOLO11-seg
one; on quality the two were indistinguishable on the fixtures, except at the top of the
backswing where MediaPipe correctly kept the gap between the arms open and YOLO filled it.

What gets stored is **contours, not pixels**. A per-frame mask is megabytes; the same outline
simplified to ~100 polygon points is a few hundred KB for a whole clip, and it satisfies doc
02's "renderable with no client-side computation beyond coordinate scaling" — the player fills
the rings and is done. Simplification epsilon was chosen by rendering the stored polygon back
over the frame: 0.0008 and 0.002 of the perimeter are indistinguishable from the raw mask,
0.004 visibly cuts the corners off a shoe.

Rings come out `RETR_CCOMP`, outer boundaries and holes together, with no flag saying which is
which — deliberately, because the consumer does not need to know. Filling every ring under an
even-odd rule puts the holes back automatically (the gap between the arms at the top is a
hole), and that is exactly what both `render.py` and the canvas do.

Coordinates are normalized against the **analysis** video, which shares its aspect ratio with
the player's video, so the usual `x * W` / `y * H` applies — same convention as
`club.detector.boxes`.
"""
from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

# Fraction of a ring's own perimeter used as the Douglas-Peucker tolerance, and the smallest
# ring worth keeping as a fraction of frame area. The area floor drops the speckle a mask
# leaves around a moving club without touching a hand or a shoe.
EPS_FRAC = 0.002
MIN_AREA_FRAC = 0.0008

# 4 decimals is 0.07px on a 720-wide analysis frame — far finer than the mask's own edge,
# which is a 256x256 network output upsampled. It is kept anyway because it costs ~8% of the
# payload and makes the stored outline exactly reproducible from the mask.
ND = 4

MIN_CONF = 0.3

# What produced the mask, recorded in the artifact. Always MediaPipe, even on a clip whose
# landmarks came from RTMW — the segmentation head belongs to the PoseLandmarker, and writing
# the *chosen* pose model here would credit the mask to a model that never saw it.
MODEL_ID = "mediapipe-tasks-pose-heavy-1.0.0"


# ---------------------------------------------------------------------------- masks
def contours(mask, width: int, height: int, eps_frac: float = EPS_FRAC,
             min_area_frac: float = MIN_AREA_FRAC) -> list[list[list[float]]]:
    """Binary/float mask -> simplified normalized rings (outer boundaries and holes).

    The caller must still own `mask`'s memory: MediaPipe's `numpy_view()` is a view into the
    result's buffer, and reading it after the result is released segfaults the interpreter
    rather than raising. Everything here happens before this function returns, so passing the
    view straight in is safe — storing it is not.
    """
    m = np.ascontiguousarray(np.squeeze(mask) > 0.5).astype(np.uint8)
    rings, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    area_min = min_area_frac * width * height
    out = []
    for c in rings:
        if cv2.contourArea(c) < area_min:
            continue
        pts = cv2.approxPolyDP(c, eps_frac * cv2.arcLength(c, True), True).reshape(-1, 2)
        if len(pts) < 3:
            continue
        out.append([[round(float(x) / width, ND), round(float(y) / height, ND)]
                    for x, y in pts])
    return out


def contains(polys, x: float, y: float) -> bool:
    """Is the point inside the filled silhouette, under the same even-odd rule the UI fills
    with? Used to reject a mask that latched onto a spectator instead of the golfer."""
    crossings = 0
    for poly in polys:
        n = len(poly)
        for i in range(n):
            x0, y0 = poly[i]
            x1, y1 = poly[(i + 1) % n]
            if (y0 <= y < y1) or (y1 <= y < y0):
                if x < x0 + (x1 - x0) * (y - y0) / (y1 - y0):
                    crossings += 1
    return crossings % 2 == 1


def _row_crossings(polys, y: float) -> list[float]:
    """Every x where the outline crosses the horizontal line at y."""
    xs = []
    for poly in polys:
        n = len(poly)
        for i in range(n):
            x0, y0 = poly[i]
            x1, y1 = poly[(i + 1) % n]
            if (y0 <= y < y1) or (y1 <= y < y0):
                xs.append(x0 + (x1 - x0) * (y - y0) / (y1 - y0))
    return xs


# ------------------------------------------------------------------ a standalone pass
def run(video_path: str | Path, model_path: str | Path, progress=None) -> dict[int, list]:
    """Segment every frame in its own MediaPipe pass, for tools that have no Stage 2.

    `burnin.py` does NOT use this — it takes the masks off the pose pass it already makes
    (`pose.estimate(..., silhouette=True)`), which is ten times cheaper. This exists for
    `scripts/resegment.py`, which adds a silhouette to an `out/` folder that was analysed
    before this stage existed, without re-running the whole pipeline over it.
    """
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    lm = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO, num_poses=1,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5, output_segmentation_masks=True))
    sil: dict[int, list] = {}
    try:
        f = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            image = mp.Image(image_format=mp.ImageFormat.SRGB,
                             data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            r = lm.detect_for_video(image, int(round(f * 1000.0 / fps)))
            if r.segmentation_masks and r.pose_landmarks:
                polys = contours(r.segmentation_masks[0].numpy_view(), w, h)
                if polys:
                    sil[f] = polys
            f += 1
            if progress and (f % 30 == 0 or f == total):
                progress(f, total)
    finally:
        lm.close()
        cap.release()
    return sil


# ------------------------------------------------------------------------- artifact
def payload(sil: dict[int, list], frames, keypoint_names, model: str,
            width: int, height: int, frame_count: int) -> dict:
    """The `silhouette.json` artifact, with masks that missed the golfer dropped.

    A separate file rather than another block in `analysis.json` because it is both large and
    optional: the player already parses a multi-megabyte analysis on every page load, and this
    is only fetched when the overlay is switched on.

    The drop rule is the cheapest honest one available. `num_poses=1` means the mask always
    belongs to whichever person the landmarker locked onto, so a broadcast clip with a gallery
    behind the golfer can hand back a perfectly clean mask of the wrong human. Requiring the
    outline to contain the hips of the pose we actually published catches that, and costs a
    point-in-polygon test per frame.
    """
    try:
        hip = keypoint_names.index("mid_hip")
    except ValueError:
        hip = None

    kept, dropped = {}, []
    for f, polys in sil.items():
        fr = frames[f] if 0 <= f < len(frames) else None
        if hip is not None and fr is not None:
            p = fr["kp"][hip]
            if p[2] >= MIN_CONF and not contains(polys, p[0], p[1]):
                dropped.append(f)
                continue
        kept[f] = polys

    notes = []
    if dropped:
        notes.append(f"{len(dropped)} frame(s) segmented someone other than the golfer and "
                     f"were dropped (the outline did not contain the published hips)")
    cov = len(kept) / frame_count if frame_count else 0.0
    if cov < 0.9:
        notes.append(f"silhouette covers {cov * 100:.0f}% of frames; it will disappear on "
                     f"the rest rather than being interpolated")
    return {
        "schema": 1,
        "source": "mediapipe_segmentation",
        "model": model,
        "eps": EPS_FRAC,
        "width": width, "height": height,
        "frame_count": frame_count,
        "coverage": round(cov, 4),
        "notes": notes,
        # Sorted so a diff between two runs is readable, and so the client can binary-search
        # rather than building a map if it ever wants to.
        "frames": [{"f": f, "p": kept[f]} for f in sorted(kept)],
    }


# ------------------------------------------------------------------------ butt line
def butt_line(sil: dict[int, list], frames, keypoint_names, address_span, body_height: float,
              view: str) -> tuple[dict | None, list[str]]:
    """A vertical tangent to the rear of the seat, locked at address (the DTL posture line).

    Coaches draw this one by hand on every down-the-line lesson: a line touching the back of
    the golfer's seat at setup, which the seat should stay in contact with through the
    backswing. Losing it forward is early extension; losing it back is a slide.

    Three things make it measurable rather than a guess:

    * **The edge comes from the silhouette, not from a keypoint.** Pose gives hip joint
      *centres*; the coaching line is tangent to the body's outline, which no keypoint knows
      about. Offsetting a hip keypoint outward by some fraction of body height would put a
      confident-looking red line at a number nobody measured.
    * **Which side is "rear" is observed, not configured.** At address the arms hang out over
      the ball, so the hands sit ball-ward of the hip line; down the line that offset is
      horizontal in frame and its sign is the ball direction. The seat is the other way. This
      is the same signal `metrics.py`'s `ball_direction` reads, so the two cannot disagree.
    * **It is a median over the whole address hold, not one frame** (D28), and the spread
      across that hold is published as the confidence — a golfer still waggling gives a wide
      spread and says so.

    Down-the-line only. Face-on, the rear of the pelvis is pointing at neither edge of the
    frame and the tangent would be the golfer's side, which means nothing.

    Returns `(line | None, notes)`.
    """
    notes: list[str] = []
    if view != "dtl":
        return None, ["butt line is a down-the-line reference; not measured face-on"]
    if not sil:
        return None, ["no silhouette, so no butt line"]
    if body_height <= 1e-6:
        return None, ["body height unknown, so the seat band could not be placed"]

    idx = {n: i for i, n in enumerate(keypoint_names)}

    def kp(f: int, name: str):
        i = idx.get(name)
        if i is None or not (0 <= f < len(frames)):
            return None
        p = frames[f]["kp"][i]
        return (p[0], p[1]) if p[2] >= MIN_CONF else None

    a, b = (address_span if address_span else (0, 0))
    # The last ~20 frames of the hold. Early in a long "address span" the golfer is often still
    # walking in and setting the club — pro_2's span starts at frame 0 — and those frames are
    # not the posture the line is meant to record.
    picks = [f for f in range(max(0, b - 20), b + 1) if f in sil][-12:]
    if len(picks) < 3:
        picks = [f for f in range(max(0, a), b + 1) if f in sil][-12:]
    if len(picks) < 3:
        return None, ["fewer than 3 segmented frames in the address hold"]

    offs = [g[0] - h[0] for g, h in
            ((kp(f, "grip_center"), kp(f, "mid_hip")) for f in picks) if g and h]
    if not offs:
        return None, ["hands or hips missing through the address hold, so which side the "
                      "seat faces could not be resolved"]
    ball_off = float(np.median(offs)) / body_height
    if abs(ball_off) < 0.02:
        return None, ["the hands sit too close to the hip line to tell which way the golfer "
                      "faces; refusing to guess the seat side"]
    side = -1 if ball_off > 0 else 1

    xs, los, his = [], [], []
    for f in picks:
        hip = kp(f, "mid_hip")
        if not hip:
            continue
        # The seat, as a band of rows: from just above the hip joint down over the glute. Both
        # ends are in body heights so it scales with how big the golfer is in frame.
        y_lo, y_hi = hip[1] - 0.05 * body_height, hip[1] + 0.14 * body_height
        best = None
        for y in np.linspace(y_lo, y_hi, 24):
            row = _row_crossings(sil[f], float(y))
            if not row:
                continue
            v = max(row) if side > 0 else min(row)
            best = v if best is None else (max(best, v) if side > 0 else min(best, v))
        if best is not None:
            xs.append(best); los.append(y_lo); his.append(y_hi)

    if len(xs) < 3:
        return None, ["the seat band fell outside the silhouette on too many frames"]

    x = float(np.median(xs))
    y_lo, y_hi = float(np.median(los)), float(np.median(his))
    spread = float(np.percentile(xs, 90) - np.percentile(xs, 10)) / body_height
    # Confidence is how still the setup was, in body heights of horizontal wander. Under 1% is
    # a settled address; past 6% the golfer was still moving and the "locked" line is a median
    # of several different postures.
    conf = round(float(np.clip(1.0 - (spread - 0.01) / 0.05, 0.3, 1.0)), 2)
    if spread > 0.04:
        notes.append(f"the seat moved {spread * 100:.1f}% of body height across the address "
                     f"hold — the golfer was still settling, so this line is a median of "
                     f"several postures")

    pad = 0.06 * body_height
    return {
        "x": round(x, 5),
        # What to draw: the measured band with a little air at each end, so the line reads as
        # a tangent to the seat rather than as a segment that stops at two arbitrary rows.
        "y0": round(max(0.0, y_lo - pad), 5),
        "y1": round(min(1.0, y_hi + pad), 5),
        # What it was measured over, kept separate from what is drawn so the debug renderer
        # can show the band and the drawn line as two different things.
        "band": [round(y_lo, 5), round(y_hi, 5)],
        "frame": int(b),
        "frames": [int(picks[0]), int(picks[-1])],
        "n": len(xs),
        "side": side,
        "spread_bh": round(spread, 4),
        "conf": conf,
        "source": "mediapipe_segmentation",
    }, notes
