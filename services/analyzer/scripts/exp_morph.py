"""EXPERIMENT 3 — shaft via directional morphological line filtering.

Standalone. Writes:
    exp3_morph_sprite.jpg   frames across BACK and FORWARD swing, head circled
    exp3_morph_trace.jpg    the full smoothed path

    python scripts/exp_morph.py out/<stem> [--frames 24]

Everything tried so far keys off motion (differencing, background models, optical flow) or
gradients. Both are indirect: they ask "did this change" or "is there an edge", when what we
actually want is "is there a thin bright bar here".

The shaft is chrome. Against grass and foliage it is a *bright, thin, elongated* structure —
and morphological opening with a line structuring element is the classical operator for
exactly that. Opening with a line at angle theta preserves bright structures elongated along
theta and erases everything narrower. So

    lineness = max_theta open(img, line_theta) - min_theta open(img, line_theta)

is large only for elongated bright bars, and small for blobs, texture and flat regions. It
does not care whether the club is moving, which is the failure that killed optical flow at
the top, and it does not care about background clutter orientation the way gradients do.

The head is then the far end of the strongest lineness ray leaving the hands.
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


def line_kernel(length, angle_deg):
    """Binary line structuring element of given length at given angle."""
    L = max(3, int(length) | 1)
    k = np.zeros((L, L), np.uint8)
    cv2.line(k, (0, L // 2), (L - 1, L // 2), 1, 1)
    M = cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), angle_deg, 1.0)
    k = cv2.warpAffine(k, M, (L, L), flags=cv2.INTER_NEAREST)
    if k.sum() == 0:
        k[L // 2, :] = 1
    return k


def lineness_map(gray, club_px, n_dir=12):
    """Bright-thin-bar response, orientation-agnostic."""
    L = max(5, int(club_px * 0.22))
    ops = []
    for i in range(n_dir):
        k = line_kernel(L, 180.0 * i / n_dir)
        ops.append(cv2.morphologyEx(gray, cv2.MORPH_OPEN, k))
    stack = np.stack(ops).astype(np.int16)
    resp = (stack.max(axis=0) - stack.min(axis=0))
    return np.clip(resp, 0, 255).astype(np.uint8)


def body_mask(pf, f, W, H, club_px):
    m = np.zeros((H, W), np.uint8)
    def px(n):
        p = kp(pf, f, n, 0.25)
        return None if p is None else (int(p[0] * W), int(p[1] * H))
    torso = [px(n) for n in ("left_shoulder", "right_shoulder", "right_hip", "left_hip")]
    torso = [q for q in torso if q]
    if len(torso) >= 3:
        cv2.fillConvexPoly(m, cv2.convexHull(np.array(torso, np.int32)), 255)
    for chain in (("left_shoulder", "left_elbow", "left_wrist"),
                  ("right_shoulder", "right_elbow", "right_wrist")):
        q = [px(n) for n in chain]
        for i in range(len(q) - 1):
            if q[i] and q[i + 1]:
                cv2.line(m, q[i], q[i + 1], 255, int(club_px * 0.13))
    hd = px("head_center")
    if hd:
        cv2.circle(m, hd, int(club_px * 0.15), 255, -1)
    return m


def find_head(resp, gp, club_px, W, H, n_bins=120):
    """Strongest ray of lineness leaving the hands; head = far end of its support."""
    best = (None, -1.0, 0.0)
    rr = np.arange(club_px * 0.22, club_px * 1.08, 2.0)
    for i in range(n_bins):
        th = 2 * np.pi * i / n_bins
        c, s = np.cos(th), np.sin(th)
        xs = np.clip(np.rint(gp[0] + c * rr).astype(int), 0, W - 1)
        ys = np.clip(np.rint(gp[1] + s * rr).astype(int), 0, H - 1)
        vals = resp[ys, xs].astype(np.float32)
        hit = vals > 12
        if hit.sum() < 4:
            continue
        # Longest run of support, tolerating small holes; its end is the club head.
        run = end = bestrun = 0
        gap = 0
        bestend = 0.0
        for kx, hv in enumerate(hit):
            if hv:
                run += 1
                gap = 0
                if run > bestrun:
                    bestrun, bestend = run, rr[kx]
            else:
                gap += 1
                if gap > 3:
                    run = 0
        if bestrun < 4:
            continue
        score = float(vals[hit].mean()) * (0.4 + 0.6 * bestend / club_px)
        if score > best[1]:
            best = ((int(gp[0] + c * bestend), int(gp[1] + s * bestend)), score, bestend)
    return best


def smooth_path(found, club_px, max_jump=0.5, win=5):
    fs = sorted(found)
    if len(fs) < 5:
        return {f: found[f][0] for f in fs}
    P = np.array([found[f][0] for f in fs], float)
    keep = np.ones(len(fs), bool)
    for i in range(1, len(fs) - 1):
        if (np.linalg.norm(P[i] - P[i - 1]) > club_px * max_jump and
                np.linalg.norm(P[i + 1] - P[i]) > club_px * max_jump):
            keep[i] = False
    t = np.array(fs, float)
    out = {f: [0.0, 0.0] for f in fs}
    for ax in (0, 1):
        col = np.interp(t, t[keep], P[keep, ax])
        k = max(3, win | 1)
        col = np.convolve(np.pad(col, (k // 2, k // 2), mode="edge"),
                          np.ones(k) / k, mode="valid")[:len(t)]
        for i, f in enumerate(fs):
            out[f][ax] = float(col[i])
    return {f: (int(v[0]), int(v[1])) for f, v in out.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--frames", type=int, default=24)
    ap.add_argument("--tile", type=int, default=300)
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

    a = evd["address"]["frame"]
    top = evd["top"]["frame"]
    imp = evd["impact"]["frame"]
    fin = min(evd["finish"]["frame"], len(grays) - 1)   # include the forward swing

    found = {}
    for f in range(a, fin + 1):
        g = kp(pf, f, "grip_center")
        if g is None:
            continue
        gp = np.array([g[0] * W, g[1] * H])
        resp = lineness_map(grays[f], club_px)
        resp[body_mask(pf, f, W, H, club_px) > 0] = 0
        head, score, _ = find_head(resp, gp, club_px, W, H)
        if head is not None:
            found[f] = (head, score, gp)
    if not found:
        print("nothing found")
        return 1
    sm = smooth_path({f: (v[0],) for f, v in found.items()}, club_px)

    # ---- sprite: address -> finish, so both back and forward swing are visible ----
    picks = np.linspace(a, fin, args.frames).astype(int)
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
            if f in sm:
                cv2.line(img, gp, sm[f], (255, 255, 255), 1, cv2.LINE_AA)
        if f in found:
            cv2.circle(img, found[f][0], 7, (150, 150, 150), 1, cv2.LINE_AA)
        if f in sm:
            cv2.circle(img, sm[f], 15, (60, 90, 255), 3, cv2.LINE_AA)
        s = args.tile / W
        t = cv2.resize(img, (args.tile, int(H * s)))
        cv2.rectangle(t, (0, 0), (args.tile, 16), (0, 0, 0), -1)
        tag = "BACK" if f <= top else ("DOWN" if f <= imp else "FWD")
        cv2.putText(t, f"f{f} {tag}", (3, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.34,
                    (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(t)
    per = 8
    rows = []
    for i in range(0, len(tiles), per):
        row = tiles[i:i + per]
        while len(row) < per:
            row.append(np.zeros_like(row[0]))
        rows.append(np.hstack(row))
    p1 = out / "exp3_morph_sprite.jpg"
    cv2.imwrite(str(p1), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 92])

    # ---- trace ----
    base = (colors[min(imp, len(colors) - 1)] * 0.55).astype(np.uint8)
    for seg, col, rr in (("back", (77, 72, 229), range(a, top + 1)),
                         ("down", (246, 130, 59), range(top, imp + 1)),
                         ("fwd", (200, 160, 120), range(imp, fin + 1))):
        pts = [sm[f] for f in rr if f in sm]
        if len(pts) > 1:
            cv2.polylines(base, [np.array(pts, np.int32)], False, col, 3, cv2.LINE_AA)
    cv2.rectangle(base, (0, 0), (W, 26), (0, 0, 0), -1)
    cv2.putText(base, f"EXP3 morphological lineness - {len(found)} frames, smoothed",
                (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    p2 = out / "exp3_morph_trace.jpg"
    cv2.imwrite(str(p2), base, [cv2.IMWRITE_JPEG_QUALITY, 94])
    print(f"wrote {p1}\nwrote {p2}   ({len(found)} frames detected)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
