"""EXPERIMENT 2 — track-before-detect over a parametric swing path.

Standalone. Writes:
    exp2_tbd_sprite.jpg   sampled frames, club head circled
    exp2_tbd_trace.jpg    the full path

    python scripts/exp_tbd.py out/<stem> [--frames 16]

Every previous attempt detected a head per frame and then linked the detections. That order
fails whenever a frame has no usable evidence — the detector is forced to pick something, and
a wrong pick either propagates or has to be repaired later.

Track-before-detect inverts it. The club is rigid and hinged at the hands, so its head is
fully described by one angle per frame:

    head(t) = grip(t) + L(t) * [cos theta(t), sin theta(t)]

theta(t) sweeps smoothly through the swing, so it is a low-order polynomial in t — a handful
of numbers describe the entire path. We therefore search *paths*, not points: propose a
coefficient vector, sample the image evidence at every implied head position across all
frames, and sum. A path that threads real club pixels scores high even if no individual frame
is convincing on its own; a path through noise cannot accumulate.

This is the standard approach for targets too dim to detect in a single frame (radar), and it
matches the failure we keep hitting: the top of the backswing, where the club is nearly
stationary and there is almost nothing to detect frame by frame.
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

rng = np.random.default_rng(7)


def kp(pose_frames, f, name, min_conf=0.2):
    p = pose_frames[f]["kp"][IDX[name]]
    return (p[0], p[1]) if p[2] >= min_conf else None


def build_evidence(grays, pf, club_px, W, H):
    """Per-frame evidence map: moving, non-golfer pixels, smoothed so sampling is stable."""
    sub = cv2.createBackgroundSubtractorMOG2(history=len(grays), varThreshold=24,
                                             detectShadows=False)
    for g in grays:
        sub.apply(g)
    ev = []
    for f in range(len(grays)):
        fg = sub.apply(grays[f], learningRate=0.0)
        if 0 < f < len(grays) - 1:
            d1 = cv2.absdiff(grays[f], grays[f - 1])
            d2 = cv2.absdiff(grays[f + 1], grays[f])
            m = cv2.min(d1, d2)
        else:
            m = np.zeros_like(grays[f])
        e = cv2.bitwise_and(m, m, mask=fg).astype(np.float32)

        # Remove the golfer: torso hull plus both arms as thick lines. The club must be
        # found outside the body, and a swinging forearm otherwise scores like a club.
        body = np.zeros((H, W), np.uint8)
        def px(n):
            p = kp(pf, f, n, 0.25)
            return None if p is None else (int(p[0] * W), int(p[1] * H))
        torso = [px(n) for n in ("left_shoulder", "right_shoulder", "right_hip", "left_hip")]
        torso = [q for q in torso if q]
        if len(torso) >= 3:
            cv2.fillConvexPoly(body, cv2.convexHull(np.array(torso, np.int32)), 255)
        for chain in (("left_shoulder", "left_elbow", "left_wrist"),
                      ("right_shoulder", "right_elbow", "right_wrist")):
            q = [px(n) for n in chain]
            for i in range(len(q) - 1):
                if q[i] and q[i + 1]:
                    cv2.line(body, q[i], q[i + 1], 255, int(club_px * 0.15))
        hd = px("head_center")
        if hd:
            cv2.circle(body, hd, int(club_px * 0.16), 255, -1)
        e[body > 0] = 0.0
        ev.append(cv2.GaussianBlur(e, (0, 0), club_px * 0.05))
    return ev


def sample(ev_maps, grips, coefs, ts, L, W, H):
    """Score one candidate path: total evidence under the implied head positions."""
    theta = np.polyval(coefs, ts)
    xs = grips[:, 0] + np.cos(theta) * L
    ys = grips[:, 1] + np.sin(theta) * L
    xi = np.clip(np.rint(xs).astype(int), 0, W - 1)
    yi = np.clip(np.rint(ys).astype(int), 0, H - 1)
    return float(sum(ev_maps[i][yi[i], xi[i]] for i in range(len(ts))))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--frames", type=int, default=16)
    ap.add_argument("--tile", type=int, default=330)
    ap.add_argument("--iters", type=int, default=6000)
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    pf, evd = d["pose"]["frames"], d["events"]
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
    H, W = grays[0].shape
    club_px = club_len * H

    a, top, b = evd["address"]["frame"], evd["top"]["frame"], evd["impact"]["frame"]
    idx = [f for f in range(a, min(b, len(grays) - 1) + 1) if kp(pf, f, "grip_center")]
    if len(idx) < 10:
        print("not enough grip frames")
        return 1
    grips = np.array([[kp(pf, f, "grip_center")[0] * W, kp(pf, f, "grip_center")[1] * H]
                      for f in idx])
    ts = (np.array(idx, float) - idx[0]) / max(1.0, idx[-1] - idx[0])   # normalised 0..1

    ev_maps = build_evidence(grays, pf, club_px, W, H)
    ev_maps = [ev_maps[f] for f in idx]

    # Seed theta(0) from the address club direction: the head at address is the ball, which
    # the pipeline already calibrated, so one end of the path is effectively known.
    cj = d.get("club") or {}
    th0 = None
    if cj.get("frames") and cj["frames"][a] and cj["frames"][a].get("head"):
        hd = cj["frames"][a]["head"]
        v = np.array([hd[0] * W - grips[0, 0], hd[1] * H - grips[0, 1]])
        th0 = float(np.arctan2(v[1], v[0]))

    # Search cubic theta(t). Coarse random search over plausible sweeps, then local refine.
    best, best_s = None, -1.0
    for _ in range(args.iters):
        t0 = th0 + rng.normal(0, 0.25) if th0 is not None else rng.uniform(-np.pi, np.pi)
        # A swing sweeps roughly 1.5-2.5 turns of theta from address to impact.
        total = rng.uniform(-3.0, 3.0) * np.pi
        c2 = rng.normal(0, 2.0)
        c3 = rng.normal(0, 2.0)
        # theta(t) = t0 + total*t + c2*t^2(1-t) + c3*t^3 ; expressed as polyval coefficients
        coefs = np.array([c3, c2, total - c2, t0])
        s = sample(ev_maps, grips, coefs, ts, club_px * 0.95, W, H)
        if s > best_s:
            best_s, best = s, coefs

    for scale in (0.5, 0.2, 0.08, 0.03):
        for _ in range(args.iters // 3):
            cand = best + rng.normal(0, scale, size=4) * np.array([2.0, 2.0, 2.0, 0.5])
            s = sample(ev_maps, grips, cand, ts, club_px * 0.95, W, H)
            if s > best_s:
                best_s, best = s, cand

    theta = np.polyval(best, ts)
    heads = np.stack([grips[:, 0] + np.cos(theta) * club_px * 0.95,
                      grips[:, 1] + np.sin(theta) * club_px * 0.95], 1)
    pos = {f: (int(heads[i, 0]), int(heads[i, 1])) for i, f in enumerate(idx)}
    print(f"best path score {best_s:.0f}  sweep {np.degrees(theta[-1]-theta[0]):.0f} deg")

    # ---- sprite ----
    picks = np.linspace(a, b, args.frames).astype(int)
    tiles = []
    for f in picks:
        f = int(f)
        if f >= len(colors):
            continue
        img = colors[f].copy()
        g = kp(pf, f, "grip_center")
        if g:
            gp = (int(g[0] * W), int(g[1] * H))
            cv2.circle(img, gp, 6, (0, 220, 255), 2, cv2.LINE_AA)
            if f in pos:
                cv2.line(img, gp, pos[f], (255, 255, 255), 1, cv2.LINE_AA)
        if f in pos:
            cv2.circle(img, pos[f], 16, (60, 90, 255), 3, cv2.LINE_AA)
        s = args.tile / W
        t = cv2.resize(img, (args.tile, int(H * s)))
        cv2.rectangle(t, (0, 0), (args.tile, 18), (0, 0, 0), -1)
        cv2.putText(t, f"f{f}", (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1,
                    cv2.LINE_AA)
        tiles.append(t)
    per = 8
    rows = []
    for i in range(0, len(tiles), per):
        row = tiles[i:i + per]
        while len(row) < per:
            row.append(np.zeros_like(row[0]))
        rows.append(np.hstack(row))
    p1 = out / "exp2_tbd_sprite.jpg"
    cv2.imwrite(str(p1), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 92])

    # ---- trace (the path is a smooth polynomial, so it is inherently smoothed) ----
    base = (colors[min(b, len(colors) - 1)] * 0.55).astype(np.uint8)
    for seg, col in (("back", (77, 72, 229)), ("down", (246, 130, 59))):
        rr = [f for f in idx if (f <= top if seg == "back" else f >= top)]
        pts = [pos[f] for f in rr if f in pos]
        if len(pts) > 1:
            cv2.polylines(base, [np.array(pts, np.int32)], False, col, 3, cv2.LINE_AA)
        for q in pts:
            cv2.circle(base, q, 3, col, -1, cv2.LINE_AA)
    cv2.rectangle(base, (0, 0), (W, 26), (0, 0, 0), -1)
    cv2.putText(base, f"EXP2 track-before-detect - cubic theta(t), {len(idx)} frames",
                (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    p2 = out / "exp2_tbd_trace.jpg"
    cv2.imwrite(str(p2), base, [cv2.IMWRITE_JPEG_QUALITY, 94])
    print(f"wrote {p1}\nwrote {p2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
