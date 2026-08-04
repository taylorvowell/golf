"""Club head orientation through the swing (doc 04 §6, tier 2).

What this measures, and what it deliberately does not:

  MEASURED   The club head's principal axis relative to the shaft, per frame. The head is an
             elongated body (heel to toe), so the angle between that axis and the shaft is a
             real, geometric signal for how the head is rolling through the swing — toe-up at
             the takeaway, squaring toward impact. This is the rotation a golfer sees.

  NOT        Face angle in degrees at impact (open/closed to the target line). That is a 3D
             quantity about the face *normal*, and at 60fps the head near impact is a blur
             streak crossing 15-30% of the frame between exposures. Doc 04 §6 forbids
             displaying a fabricated number for it; the simulator impact image (doc 06) is
             the authoritative source and the UI must prefer it.

So the output here is an orientation time series plus checkpoint classifications with
explicit confidence, never an impact face angle.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class FaceConfig:
    win: float = 0.16           # crop half-size, fraction of club length
    min_pixels: int = 18        # below this the blob is noise, not a club head
    min_elongation: float = 1.5 # a near-circular blob has no meaningful axis
    blur_reject: float = 1.20   # shaft longer than this x calibrated => motion streak
    min_to_shaft: float = 30.0  # below this the "head axis" is really leftover shaft


@dataclass
class FaceFrame:
    f: int
    head_axis_deg: float | None = None   # principal axis, deg from horizontal
    to_shaft_deg: float | None = None    # signed angle between head axis and shaft
    elongation: float = 0.0
    conf: float = 0.0


@dataclass
class FaceResult:
    frames: list = field(default_factory=list)
    checkpoints: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def _principal_axis(mask):
    """PCA on the blob's pixels -> (axis angle in deg, elongation ratio).

    Elongation is the ratio of the two eigenvalues' square roots. A club head viewed
    face-on is clearly elongated; a blob that is nearly round carries no orientation
    information and is rejected rather than reported at low confidence, because a
    meaningless axis that happens to look plausible is worse than no reading.
    """
    ys, xs = np.nonzero(mask)
    if len(xs) < 8:
        return None, 0.0
    pts = np.stack([xs, ys], 1).astype(np.float32)
    pts -= pts.mean(0)
    cov = np.cov(pts, rowvar=False)
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1]
    vals, vecs = vals[order], vecs[:, order]
    if vals[0] <= 1e-6:
        return None, 0.0
    major = vecs[:, 0]
    ang = float(np.degrees(np.arctan2(-major[1], major[0])))
    elong = float(np.sqrt(max(vals[0], 1e-9) / max(vals[1], 1e-9)))
    return ang, elong


def _wrap180(a):
    """Axis angles are undirected: 170 deg and -10 deg are the same line."""
    return (a + 90.0) % 180.0 - 90.0


def analyse(video_path, club_frames, club_len_norm, ev, cfg: FaceConfig | None = None):
    cfg = cfg or FaceConfig()
    res = FaceResult()

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")
    frames = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()
    if not frames:
        return res

    h, w = frames[0].shape
    club_px = max(8.0, club_len_norm * h)
    half = max(6, int(club_px * cfg.win))

    for cf in club_frames:
        f = cf["f"] if isinstance(cf, dict) else cf.f
        head = cf["head"] if isinstance(cf, dict) else cf.head
        shaft = cf["shaft"] if isinstance(cf, dict) else cf.shaft
        conf = cf["conf"] if isinstance(cf, dict) else cf.conf
        out = FaceFrame(f=f)
        if head is None or shaft is None or f >= len(frames) or conf < 0.25:
            res.frames.append(out)
            continue

        # A shaft measurably longer than the calibrated club is a blur streak, not a pose —
        # the head has no stable silhouette in those frames, so refuse rather than guess.
        sh = np.array(shaft, float) * [w, h]
        if np.linalg.norm(sh[1] - sh[0]) > club_px * cfg.blur_reject:
            res.frames.append(out)
            continue

        cx, cy = int(head[0] * w), int(head[1] * h)
        x0, x1 = max(0, cx - half), min(w, cx + half)
        y0, y1 = max(0, cy - half), min(h, cy + half)
        patch = frames[f][y0:y1, x0:x1]
        if patch.size < cfg.min_pixels:
            res.frames.append(out)
            continue

        # The head is a dark, compact object against grass or sky; Otsu separates it without
        # a hand-tuned threshold that would not survive a change of lighting.
        p = cv2.GaussianBlur(patch, (3, 3), 0)
        _, m = cv2.threshold(p, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        n, lab, stats, cent = cv2.connectedComponentsWithStats(m, 8)
        if n <= 1:
            res.frames.append(out)
            continue
        # Prefer the blob nearest the detected head point, not merely the largest — the
        # largest is often the golfer's shadow or a fence post clipped by the window.
        best, bd = None, 1e9
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < cfg.min_pixels:
                continue
            d = np.hypot(cent[i][0] - (cx - x0), cent[i][1] - (cy - y0))
            if d < bd:
                best, bd = i, d
        if best is None:
            res.frames.append(out)
            continue

        blob = (lab == best).astype(np.uint8)

        # Drop the shaft. The crop necessarily contains the last stretch of shaft, and a
        # shaft is a far stronger elongated feature than the head — PCA locks onto it and
        # reports a head axis ~28 deg from the shaft, i.e. the shaft's own direction. Keep
        # only blob pixels at or beyond the detected head along the shaft direction.
        d = sh[1] - sh[0]
        nrm = np.linalg.norm(d)
        if nrm > 1e-6:
            d = d / nrm
            ys_b, xs_b = np.nonzero(blob)
            rel = np.stack([xs_b - (cx - x0), ys_b - (cy - y0)], 1).astype(np.float32)
            along = rel @ d
            keep = along >= -club_px * 0.02
            blob[:] = 0
            blob[ys_b[keep], xs_b[keep]] = 1

        ang, elong = _principal_axis(blob)
        if ang is None or elong < cfg.min_elongation:
            res.frames.append(out)
            continue

        shaft_ang = float(np.degrees(np.arctan2(-(sh[1][1] - sh[0][1]), sh[1][0] - sh[0][0])))
        rel = _wrap180(ang - shaft_ang)

        # Physical prior: a club head's heel-toe axis is never parallel to its own shaft.
        # Measurements near 0 deg are shaft contamination that survived the crop filter, and
        # they are what made the raw series flip between two modes. Reject rather than
        # report — a bimodal readout would look like the face violently rolling.
        if abs(rel) < cfg.min_to_shaft:
            res.frames.append(out)
            continue

        out.head_axis_deg = round(_wrap180(ang), 1)
        out.to_shaft_deg = round(rel, 1)
        out.elongation = round(elong, 2)
        # Confidence blends how elongated the blob is (is there really an axis?) with how
        # well the shaft was tracked in this frame (is the reference trustworthy?).
        out.conf = round(float(np.clip((min(elong, 3.0) / 3.0) * 0.6 + conf * 0.4, 0, 0.95)), 2)
        res.frames.append(out)

    _checkpoints(res, ev)
    return res


def _checkpoints(res: FaceResult, ev):
    """Classify head orientation at the slow checkpoints doc 04 §6 permits.

    Only address, toe-up and top are attempted. Impact is deliberately absent: it is the
    frame the golfer most wants and the one video cannot honestly answer.
    """
    by_f = {fr.f: fr for fr in res.frames}
    for name in ("address", "toe_up", "top"):
        e = ev["events"].get(name)
        if not e:
            continue
        # Average a small neighbourhood — a single frame's blob is noisy.
        vals = [by_f[f] for f in range(e["frame"] - 2, e["frame"] + 3)
                if f in by_f and by_f[f].to_shaft_deg is not None]
        if not vals:
            res.checkpoints[name] = {"class": "not measurable", "conf": 0.0,
                                     "reason": "club head silhouette not resolvable"}
            continue
        rel = float(np.median([v.to_shaft_deg for v in vals]))
        conf = float(np.median([v.conf for v in vals]))
        # Near-perpendicular to the shaft is the neutral, toe-up presentation; deviation
        # either way means the head has rolled open or shut relative to the shaft.
        dev = _wrap180(rel - 90.0)
        if abs(dev) <= 12:
            cls = "square-ish"
        elif dev > 0:
            cls = "toe up / open-ish"
        else:
            cls = "toe down / shut-ish"
        res.checkpoints[name] = {
            "class": cls,
            "head_to_shaft_deg": round(rel, 1),
            "deviation_deg": round(dev, 1),
            "conf": round(conf, 2),
            "n_frames": len(vals),
        }
    res.checkpoints["impact"] = {
        "class": "requires launch monitor",
        "conf": 0.0,
        "reason": ("Face angle at impact is not measurable from 60fps video — the head is a "
                   "blur streak. Upload a simulator impact image for the authoritative value "
                   "(doc 04 §6, doc 06 §2)."),
    }
