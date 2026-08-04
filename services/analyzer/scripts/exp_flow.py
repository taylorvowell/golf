"""EXPERIMENT 1 — club head from dense optical flow.

Standalone. Does not touch the pipeline. Writes two images for visual judgement:
    exp1_flow_sprite.jpg   sampled frames, detected club head circled
    exp1_flow_trace.jpg    the full detected path, backswing red / downswing blue

    python scripts/exp_flow.py out/<stem> [--frames 16]

Why flow rather than frame differencing: differencing fires on any intensity change — leaves,
shadows, noise, every edge of the golfer. Flow gives a velocity per pixel, and the club head
moves at ~100mph against a body at ~5mph and foliage at ~2mph: a 20-50x separation in the
quantity we actually care about.

And the club is a rigid body rotating about the hands, so speed is proportional to radius —
**the club head is the fastest-moving point in the frame**. Detection becomes finding a peak
in the speed map: no line fitting, no shaft continuity, no 180-degree ambiguity.

Deliberately naive: one peak per frame, no temporal smoothing, no path model. The point is to
see what the raw signal gives before anything is built on it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swingsage.skeleton import IDX  # noqa: E402


def kp(pose_frames, f, name, min_conf=0.2):
    p = pose_frames[f]["kp"][IDX[name]]
    return (p[0], p[1]) if p[2] >= min_conf else None


def body_mask(pose_frames, f, W, H, club_px, arm_w=0.16, torso_pad=0.10):
    """Pixels belonging to the golfer — torso, head and BOTH ARMS — to exclude from search.

    The arms are the specific problem: a swinging forearm is fast, and near the top the club
    decelerates to zero while the body keeps rotating, so the elbow becomes the fastest thing
    in the annulus and gets picked as the club. Pose gives us the arm joints exactly, so the
    limbs can be drawn as thick lines and removed rather than guessed at.
    """
    m = np.zeros((H, W), np.uint8)
    def px(name):
        p = kp(pose_frames, f, name, 0.25)
        return None if p is None else (int(p[0] * W), int(p[1] * H))

    torso = [px(n) for n in ("left_shoulder", "right_shoulder", "right_hip", "left_hip")]
    torso = [q for q in torso if q]
    if len(torso) >= 3:
        cv2.fillConvexPoly(m, cv2.convexHull(np.array(torso, np.int32)), 255)
    for chain in (("left_shoulder", "left_elbow", "left_wrist"),
                  ("right_shoulder", "right_elbow", "right_wrist")):
        pts = [px(n) for n in chain]
        for i in range(len(pts) - 1):
            if pts[i] and pts[i + 1]:
                cv2.line(m, pts[i], pts[i + 1], 255, int(club_px * arm_w), cv2.LINE_AA)
    hd = px("head_center")
    if hd:
        cv2.circle(m, hd, int(club_px * 0.16), 255, -1)
    return cv2.dilate(m, cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (int(club_px * torso_pad) | 1, int(club_px * torso_pad) | 1)))


def smooth_path(found, lo, hi, club_px, max_jump=0.5, win=5):
    """Reject jumps that no rigid club could make, then smooth what remains.

    Two stages because they fix different things: the reject removes frames where the peak
    landed on something else entirely, and the smooth removes the pixel-level wobble of a
    peak-finder. Smoothing alone would just average a wrong point into its neighbours.
    """
    fs = sorted(f for f in found if lo <= f <= hi)
    if len(fs) < 5:
        return {f: found[f][0] for f in fs}
    P = np.array([found[f][0] for f in fs], float)

    # Outlier reject: a point unreachable from BOTH neighbours is not the club.
    keep = np.ones(len(fs), bool)
    for i in range(1, len(fs) - 1):
        d_prev = np.linalg.norm(P[i] - P[i - 1])
        d_next = np.linalg.norm(P[i + 1] - P[i])
        if d_prev > club_px * max_jump and d_next > club_px * max_jump:
            keep[i] = False

    t = np.array(fs, float)
    out = {}
    for ax in (0, 1):
        col = np.interp(t, t[keep], P[keep, ax])
        k = max(3, win | 1)
        pad = np.pad(col, (k // 2, k // 2), mode="edge")
        col = np.convolve(pad, np.ones(k) / k, mode="valid")[:len(t)]
        for i, f in enumerate(fs):
            out.setdefault(f, [0.0, 0.0])[ax] = float(col[i])
    return {f: (int(v[0]), int(v[1])) for f, v in out.items()}


def detect(grays, pf, club_px, lo, hi, W, H):
    """Peak of the compensated flow-speed map inside a club-length annulus. One per frame."""
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow.setUseSpatialPropagation(True)
    yy, xx = np.mgrid[0:H, 0:W]
    found = {}
    for f in range(max(1, lo), min(hi + 1, len(grays))):
        g = kp(pf, f, "grip_center")
        if g is None:
            continue
        fl = flow.calc(grays[f - 1], grays[f], None)
        # Camera-motion compensation: subtract the global median vector so a handheld pan
        # does not read as everything moving at once.
        fl = fl - np.median(fl.reshape(-1, 2), axis=0)
        mag = np.linalg.norm(fl, axis=2)

        gp = np.array([g[0] * W, g[1] * H])
        r = np.hypot(xx - gp[0], yy - gp[1])
        # Only where a club could physically be: an annulus around the hands out to the
        # club's own length, minus the golfer's own body and arms.
        band = (r > club_px * 0.30) & (r < club_px * 1.10)
        band &= body_mask(pf, f, W, H, club_px) == 0
        m = cv2.GaussianBlur(np.where(band, mag, 0.0), (0, 0), 3)
        _, peak, _, loc = cv2.minMaxLoc(m)
        found[f] = ((loc[0], loc[1]), float(peak), gp)
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--frames", type=int, default=16)
    ap.add_argument("--tile", type=int, default=330)
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    pf, ev = d["pose"]["frames"], d["events"]
    club_len = (d.get("club") or {}).get("club_len") or 0.3

    cap = cv2.VideoCapture(str(out / "analysis.mp4"))
    grays, colors = [], []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        colors.append(img)
        grays.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()
    if len(grays) < 3:
        print("not enough frames")
        return 1
    H, W = grays[0].shape
    club_px = club_len * H

    a = ev["address"]["frame"]
    top = ev["top"]["frame"]
    b = ev["impact"]["frame"]
    found = detect(grays, pf, club_px, a, b, W, H)
    sm = smooth_path(found, a, b, club_px)

    # ---- sprite: sampled frames, head circled (smoothed) ----
    picks = np.linspace(a, b, args.frames).astype(int)
    tiles = []
    for f in picks:
        f = int(f)
        img = colors[f].copy() if f < len(colors) else None
        if img is None:
            continue
        got = found.get(f)
        if got:
            raw, peak, gp = got
            head = sm.get(f, raw)
            cv2.circle(img, tuple(gp.astype(int)), 6, (0, 220, 255), 2, cv2.LINE_AA)
            cv2.circle(img, raw, 7, (150, 150, 150), 1, cv2.LINE_AA)   # raw peak, grey
            cv2.line(img, tuple(gp.astype(int)), head, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.circle(img, head, 16, (60, 90, 255), 3, cv2.LINE_AA)
            lbl = f"f{f}  {peak:.1f}px/fr"
        else:
            lbl = f"f{f}  no grip"
        s = args.tile / W
        t = cv2.resize(img, (args.tile, int(H * s)))
        cv2.rectangle(t, (0, 0), (args.tile, 18), (0, 0, 0), -1)
        cv2.putText(t, lbl, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1,
                    cv2.LINE_AA)
        tiles.append(t)

    per = 8
    rows = []
    for i in range(0, len(tiles), per):
        row = tiles[i:i + per]
        while len(row) < per:
            row.append(np.zeros_like(row[0]))
        rows.append(np.hstack(row))
    sprite = np.vstack(rows)
    p1 = out / "exp1_flow_sprite.jpg"
    cv2.imwrite(str(p1), sprite, [cv2.IMWRITE_JPEG_QUALITY, 92])

    # ---- trace: full detected path over a darkened impact frame ----
    base = (colors[min(b, len(colors) - 1)] * 0.55).astype(np.uint8)
    # Raw peaks faint underneath so the smoothing's effect is visible, not just asserted.
    for seg in ("back", "down"):
        rng = range(a, top + 1) if seg == "back" else range(top, b + 1)
        raw = [found[f][0] for f in rng if f in found]
        if len(raw) > 1:
            cv2.polylines(base, [np.array(raw, np.int32)], False, (110, 110, 110), 1,
                          cv2.LINE_AA)
    for seg, col in (("back", (77, 72, 229)), ("down", (246, 130, 59))):
        rng = range(a, top + 1) if seg == "back" else range(top, b + 1)
        pts = [sm[f] for f in rng if f in sm]
        if len(pts) > 1:
            cv2.polylines(base, [np.array(pts, np.int32)], False, col, 3, cv2.LINE_AA)
        for q in pts:
            cv2.circle(base, q, 3, col, -1, cv2.LINE_AA)
    cv2.rectangle(base, (0, 0), (W, 26), (0, 0, 0), -1)
    cv2.putText(base, f"EXP1 optical flow - smoothed (grey = raw)  "
                      f"({len(found)} frames, arms masked)", (6, 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    p2 = out / "exp1_flow_trace.jpg"
    cv2.imwrite(str(p2), base, [cv2.IMWRITE_JPEG_QUALITY, 94])

    print(f"wrote {p1}")
    print(f"wrote {p2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
