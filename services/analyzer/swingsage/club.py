"""Stage 4 — club shaft and head tracking (doc 04). The hardest CV problem in the app.

Layered hybrid per doc 04 §2, anchored by the pose skeleton:

  A  motion mask   three-frame differencing, ANDed, morphologically closed to heal the
                   thin shaft, with the golfer's own body suppressed
  B  shaft         probabilistic Hough inside an annulus around grip_center, candidates
                   scored on grip proximity, length plausibility and angular continuity
  C  head          the distal endpoint, refined against the motion blob
  D  temporal      per-segment smoothing splines (the path is only piecewise smooth — it
                   reverses sharply at Top, so one spline across the whole swing would cut
                   the corner)

Designed for graceful degradation throughout: doc 02's quality gate disables the trace below
50% coverage rather than drawing a fabricated path, and every frame carries its own
confidence so the renderer can show what was actually measured.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .skeleton import IDX


@dataclass
class ClubConfig:
    diff_thresh: int = 8           # per-pixel motion threshold (0-255)
    body_dilate: float = 0.030     # body suppression radius, fraction of golfer height
    min_len: float = 0.22          # shaft length bounds, fraction of calibrated club length
    max_len: float = 1.45
    hough_thresh: int = 12
    max_angle_step: float = 55.0   # deg/frame; the club is fast but not discontinuous
    search_scale: float = 1.6      # annulus radius, multiples of club length
    grip_tol: float = 0.55         # how far the shaft's near end may sit from the hands


@dataclass
class ClubFrame:
    f: int
    shaft: list | None = None      # [[x0,y0],[x1,y1]] normalized, grip end first
    head: list | None = None       # [x,y] normalized
    conf: float = 0.0
    angle: float | None = None     # deg from horizontal
    blurred: bool = False
    interp: bool = False


@dataclass
class ClubResult:
    frames: list = field(default_factory=list)
    trace: dict = field(default_factory=dict)
    club_len: float = 0.0
    coverage: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def _segments(hough):
    """HoughLinesP returns (N,1,4) on OpenCV 4 and (N,4) on OpenCV 5 — normalise to (N,4)."""
    if hough is None:
        return []
    return np.asarray(hough).reshape(-1, 4)


def _kp(frames, f, name, min_conf=0.2):
    p = frames[f]["kp"][IDX[name]]
    return (p[0], p[1]) if p[2] >= min_conf else None


def _body_mask(shape, frames, f, body_h, cfg):
    """Suppress the golfer so their own moving pixels don't masquerade as the club."""
    h, w = shape
    mask = np.zeros((h, w), np.uint8)
    pts = [(x * w, y * h) for x, y, c in frames[f]["kp"] if c > 0.3]
    if len(pts) < 3:
        return mask
    r = max(3, int(cfg.body_dilate * body_h * h))
    hull = cv2.convexHull(np.array(pts, np.float32).reshape(-1, 1, 2).astype(np.int32))
    cv2.fillConvexPoly(mask, hull, 255)
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))


def _motion(prev, cur, nxt, cfg):
    """Doc 04 Layer A — pixels moving *at* time f, isolated by ANDing both differences."""
    d1 = cv2.absdiff(cur, prev)
    d2 = cv2.absdiff(nxt, cur)
    _, m1 = cv2.threshold(d1, cfg.diff_thresh, 255, cv2.THRESH_BINARY)
    _, m2 = cv2.threshold(d2, cfg.diff_thresh, 255, cv2.THRESH_BINARY)
    m = cv2.bitwise_and(m1, m2)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)


def _score_candidate(p0, p1, grip_px, club_px, prev_angle, cfg):
    """Rank a Hough segment as a shaft hypothesis (doc 04 Layer B)."""
    a, b = np.array(p0, float), np.array(p1, float)
    da, db = np.linalg.norm(a - grip_px), np.linalg.norm(b - grip_px)
    near, far = (a, b) if da <= db else (b, a)
    d_near = min(da, db)

    # The shaft must start at the hands.
    if d_near > club_px * cfg.grip_tol:
        return None
    length = np.linalg.norm(far - near)
    if not (club_px * cfg.min_len <= length <= club_px * cfg.max_len):
        return None

    ang = float(np.degrees(np.arctan2(-(far[1] - near[1]), far[0] - near[0])))
    s = 0.0
    s += 1.0 - min(1.0, d_near / (club_px * cfg.grip_tol))   # grip proximity
    s += min(1.0, length / club_px)                          # prefer full-length shafts
    if prev_angle is not None:
        # Soft continuity: a hard reject loses the club for the rest of the swing whenever
        # one frame's angle is off, and the tracker never recovers. Penalise instead.
        step = abs((ang - prev_angle + 180) % 360 - 180)
        s += 1.0 - min(1.5, step / cfg.max_angle_step)
    return s, near, far, ang


def _extend_to_head(motion, near, direction, club_px, tol=6.0):
    """Walk the shaft direction out to the farthest collinear motion pixel.

    Hough fragments a thin, partly-blurred shaft into several short segments, so the distal
    endpoint of the best *segment* often sits barely past the hands rather than at the club
    head — visible in the debug view as a head marker stuck near the grip. Taking the
    farthest motion pixel that is still collinear with the chosen direction recovers the
    real extent, and doubles as doc 04 Layer C's blur-streak handling: the streak a fast
    head paints between shutter open and close is exactly what we want the far tip of.
    """
    ys, xs = np.nonzero(motion)
    if not len(xs):
        return None, 0.0
    pts = np.stack([xs, ys], 1).astype(np.float32)
    rel = pts - near
    d = direction / (np.linalg.norm(direction) + 1e-9)
    along = rel @ d
    perp = np.abs(rel[:, 0] * d[1] - rel[:, 1] * d[0])
    keep = (perp <= tol) & (along > 0) & (along <= club_px * 1.35)
    if keep.sum() < 3:
        return None, 0.0
    i = int(np.argmax(along[keep]))
    head = pts[keep][i]
    reach = float(along[keep][i])
    return head, reach


def calibrate(gray_frames, pose_frames, addr_f, body_h, cfg):
    """Doc 04 §3 — measure club length at Address, where everything is static.

    Sets the search radius and length bounds for every later frame, so getting it right
    once removes most of the ambiguity from the rest of the swing.
    """
    h, w = gray_frames[addr_f].shape
    grip = _kp(pose_frames, addr_f, "grip_center")
    if grip is None:
        return None
    gp = np.array([grip[0] * w, grip[1] * h])

    best = None
    for f in range(max(0, addr_f - 6), min(len(gray_frames), addr_f + 7)):
        img = cv2.GaussianBlur(gray_frames[f], (3, 3), 0)
        edges = cv2.Canny(img, 40, 120)
        # Only look below the hands, out to a generous radius — the club points at the ball.
        mask = np.zeros_like(edges)
        r = int(body_h * h * 1.1)
        cv2.circle(mask, tuple(gp.astype(int)), r, 255, -1)
        mask[: int(gp[1]) - int(0.05 * body_h * h), :] = 0
        edges = cv2.bitwise_and(edges, mask)

        segs = _segments(cv2.HoughLinesP(edges, 1, np.pi / 180, cfg.hough_thresh,
                                         minLineLength=int(body_h * h * 0.22), maxLineGap=12))
        for x1, y1, x2, y2 in segs:
            a, b = np.array([x1, y1], float), np.array([x2, y2], float)
            da, db = np.linalg.norm(a - gp), np.linalg.norm(b - gp)
            near, far = (a, b) if da <= db else (b, a)
            if min(da, db) > body_h * h * 0.18:
                continue
            if far[1] <= near[1]:            # club head must be below the hands at address
                continue
            L = float(np.linalg.norm(far - near))
            if best is None or L > best[0]:
                best = (L, near / [w, h], far / [w, h])
    return best


def track(video_path, pose_frames, ev, handedness="right", cfg: ClubConfig | None = None,
          progress=None) -> ClubResult:
    cfg = cfg or ClubConfig()
    res = ClubResult()

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")
    grays = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        grays.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()
    n = min(len(grays), len(pose_frames))
    if n < 3:
        res.notes.append("too few frames for club tracking")
        return res
    h, w = grays[0].shape

    # Golfer height in normalized units — every threshold scales off it.
    hc = [p for p in (_kp(pose_frames, i, "head_center") for i in range(n)) if p]
    ak = [p for p in (_kp(pose_frames, i, "left_ankle") for i in range(n)) if p]
    body_h = float(np.median([a[1] for a in ak]) - np.median([c[1] for c in hc])) \
        if hc and ak else 0.4
    body_h = max(body_h, 0.05)

    addr_f = ev["events"]["address"]["frame"]
    cal = calibrate(grays, pose_frames, addr_f, body_h, cfg)
    if cal is None:
        club_px = body_h * h * 0.95
        res.notes.append("address calibration failed; using height-derived club length")
    else:
        club_px = cal[0]
        res.club_len = float(club_px / h)
    club_px = float(np.clip(club_px, body_h * h * 0.55, body_h * h * 1.35))

    prev_angle, miss = None, 0
    out = []
    for f in range(n):
        cf = ClubFrame(f=f)
        grip = _kp(pose_frames, f, "grip_center")
        if grip is None or f == 0 or f >= n - 1:
            out.append(cf)
            continue
        gp = np.array([grip[0] * w, grip[1] * h])

        motion = _motion(grays[f - 1], grays[f], grays[f + 1], cfg)
        motion = cv2.bitwise_and(motion, cv2.bitwise_not(
            _body_mask((h, w), pose_frames, f, body_h, cfg)))

        # Restrict to an annulus around the hands (doc 04 Layer B).
        ring = np.zeros_like(motion)
        cv2.circle(ring, tuple(gp.astype(int)), int(club_px * cfg.search_scale), 255, -1)
        motion = cv2.bitwise_and(motion, ring)

        segs = _segments(cv2.HoughLinesP(motion, 1, np.pi / 180, cfg.hough_thresh,
                                         minLineLength=int(club_px * cfg.min_len),
                                         maxLineGap=14))
        best = None
        for x1, y1, x2, y2 in segs:
            sc = _score_candidate((x1, y1), (x2, y2), gp, club_px, prev_angle, cfg)
            if sc and (best is None or sc[0] > best[0]):
                best = sc

        if best is not None:
            s, near, far, ang = best
            # The shaft starts at the hands, not wherever Hough happened to begin.
            near = gp + (near - gp) * 0.25
            tip, reach = _extend_to_head(motion, near, far - near, club_px)
            if tip is not None and reach > np.linalg.norm(far - near):
                far = tip
                ang = float(np.degrees(np.arctan2(-(far[1] - near[1]), far[0] - near[0])))
            length = float(np.linalg.norm(far - near))
            # Cast out of numpy scalars — they survive round() and break json.dump.
            cf.shaft = [[float(near[0]) / w, float(near[1]) / h],
                        [float(far[0]) / w, float(far[1]) / h]]
            cf.head = [float(far[0]) / w, float(far[1]) / h]
            cf.angle = float(ang)
            # Confidence rewards a shaft that reaches its calibrated length — a stub near
            # the hands is a weak hypothesis even when it scores well on proximity.
            cf.conf = float(np.clip((s / 3.0) * (0.4 + 0.6 * min(1.0, length / club_px)),
                                    0.05, 0.99))
            cf.blurred = bool(length > club_px * 1.15)
            prev_angle = ang
            miss = 0
        else:
            miss += 1
            if miss > 4:
                prev_angle = None      # tracking lost; stop biasing towards a stale angle
        out.append(cf)
        if progress and (f % 30 == 0 or f == n - 1):
            progress(f + 1, n)

    res.frames = out
    _smooth_segments(res, ev, n)
    _build_trace(res, ev, n)
    return res


def _smooth_segments(res: ClubResult, ev, n):
    """Doc 04 Layer D — smooth per swing segment; the path reverses sharply at Top."""
    e = ev["events"]
    bounds = [e["address"]["frame"], e["top"]["frame"], e["impact"]["frame"],
              min(n - 1, e["finish"]["frame"])]
    heads = np.array([fr.head if fr.head else [np.nan, np.nan] for fr in res.frames], float)

    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 4:
            continue
        idx = np.arange(a, b + 1)
        ok = ~np.isnan(heads[a:b + 1, 0])
        if ok.sum() < 4:
            continue
        for ax in (0, 1):
            vals = heads[a:b + 1, ax]
            # Fit only within the segment so the reversal at Top is never smoothed across.
            sm = np.interp(idx, idx[ok], vals[ok])
            k = 5 if (b - a) >= 5 else 3
            ker = np.ones(k) / k
            sm = np.convolve(np.pad(sm, (k // 2, k // 2), mode="edge"), ker, mode="valid")
            heads[a:b + 1, ax] = sm[:len(idx)]
        for i, f in enumerate(idx):
            if not ok[i] and 0 <= f < len(res.frames):
                res.frames[f].interp = True
            if 0 <= f < len(res.frames):
                res.frames[f].head = [float(heads[f, 0]), float(heads[f, 1])]


def _build_trace(res: ClubResult, ev, n):
    """Segment the head path into the three polylines the renderer draws (doc 04 §5)."""
    e = ev["events"]
    spans = {
        "backswing": (e["address"]["frame"], e["top"]["frame"]),
        "downswing": (e["top"]["frame"], e["impact"]["frame"]),
        "followthrough": (e["impact"]["frame"], min(n - 1, e["finish"]["frame"])),
    }
    measured = {}
    for key, (a, b) in spans.items():
        pts, got, tot = [], 0, 0
        for f in range(max(0, a), min(n, b + 1)):
            fr = res.frames[f]
            tot += 1
            if fr.head and not any(np.isnan(fr.head)):
                pts.append([round(fr.head[0], 5), round(fr.head[1], 5)])
                if fr.conf > 0:
                    got += 1
        res.trace[key] = pts
        measured[key] = round(got / tot, 3) if tot else 0.0
    res.coverage = measured
    swing = [k for k in ("backswing", "downswing") ]
    res.coverage["swing"] = round(
        float(np.mean([measured[k] for k in swing])), 3) if swing else 0.0
