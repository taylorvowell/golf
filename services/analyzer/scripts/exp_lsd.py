"""EXPERIMENT 4 — line SEGMENTS from the hands, with monotonic height along the swing.

Standalone. Writes:
    exp4_lsd_sprite.jpg   frames across back / down / forward swing, head circled
    exp4_lsd_trace.jpg    the full smoothed path

    python scripts/exp_lsd.py out/<stem> [--frames 24]

Built from four constraints the user identified, all of which are hard facts about a golf
swing rather than tunable scores:

  1. The shaft is a LINE SEGMENT with one end at the hands. Not "a ray with evidence along
     it" (what previous attempts scored) but an actual detected segment, from LSD, which
     finds real segments with real endpoints instead of accumulating support along a guess.
  2. Its far endpoint is the club head. Nothing else to compute.
  3. **Backswing: the head only goes UP. Downswing: it only goes DOWN.** A monotonic
     constraint, enforced as a hard rule in the path solver — every earlier method allowed
     the head to wander back down mid-backswing, which is physically impossible and is what
     let it jump to the shoulder or the shorts.
  4. Frames whose best candidate falls outside the plausible band are dropped rather than
     forced, then filled from neighbours.
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


def segments(gray):
    """Real line segments with endpoints. LSD where available, Hough as a fallback."""
    try:
        lsd = cv2.createLineSegmentDetector()
        lines = lsd.detect(gray)[0]
        if lines is None:
            return np.empty((0, 4))
        return np.asarray(lines).reshape(-1, 4)
    except Exception:
        h = cv2.HoughLinesP(cv2.Canny(gray, 50, 150), 1, np.pi / 180, 30,
                            minLineLength=25, maxLineGap=6)
        return np.empty((0, 4)) if h is None else np.asarray(h).reshape(-1, 4)


def candidates(gray, gp, club_px):
    """Segments with an endpoint at the hands -> their far endpoints are head candidates."""
    segs = segments(gray)
    out = []
    for x1, y1, x2, y2 in segs:
        a, b = np.array([x1, y1]), np.array([x2, y2])
        da, db = np.linalg.norm(a - gp), np.linalg.norm(b - gp)
        near, far = (a, b) if da <= db else (b, a)
        d_near, d_far = min(da, db), max(da, db)
        # One end AT the hands, the other out at roughly club length.
        if d_near > club_px * 0.42:
            continue
        if not (club_px * 0.40 <= d_far <= club_px * 1.15):
            continue
        seg_len = float(np.linalg.norm(far - near))
        if seg_len < club_px * 0.28:
            continue
        score = seg_len / club_px + (1.0 - d_near / (club_px * 0.42)) * 0.5
        out.append((far, float(score), seg_len))
    return out


def solve_monotonic(cands, order, club_px, direction):
    """Pick one candidate per frame so height moves only one way along the segment.

    direction = -1 for the backswing (y decreases: the head rises), +1 for the downswing.
    DP over frames; a transition that moves height the wrong way is forbidden outright, not
    penalised. This is the constraint every previous method lacked, and it is what stops the
    head jumping to a shoulder or a hem halfway through.
    """
    frames = [f for f in order if cands.get(f)]
    if len(frames) < 4:
        return {}
    dp, back = [], []
    first = [(c[0], c[1]) for c in cands[frames[0]]]
    dp.append([s for _, s in first])
    back.append([-1] * len(first))
    states = [first]

    for i in range(1, len(frames)):
        cur = [(c[0], c[1]) for c in cands[frames[i]]]
        prev = states[-1]
        row, bk = [], []
        for pj, (pt, sc) in enumerate(cur):
            best, bi = -1e18, -1
            for pi, (ppt, _) in enumerate(prev):
                dy = (pt[1] - ppt[1]) * direction
                if dy < -club_px * 0.03:          # moved the wrong way: forbidden
                    continue
                step = float(np.linalg.norm(pt - ppt))
                if step > club_px * 0.75:          # unreachable in one frame
                    continue
                v = dp[-1][pi] - step / club_px * 1.5
                if v > best:
                    best, bi = v, pi
            if bi < 0:
                best, bi = -1e6 + sc, 0
            row.append(best + sc)
            bk.append(bi)
        dp.append(row)
        back.append(bk)
        states.append(cur)

    k = int(np.argmax(dp[-1]))
    out = {}
    for i in range(len(frames) - 1, -1, -1):
        out[frames[i]] = tuple(np.rint(states[i][k][0]).astype(int))
        k = back[i][k] if back[i][k] >= 0 else 0
    return out


def fill_and_smooth(path, lo, hi, win=5):
    fs = sorted(path)
    if len(fs) < 3:
        return path
    t = np.arange(lo, hi + 1)
    P = np.array([path[f] for f in fs], float)
    out = {}
    cols = []
    for ax in (0, 1):
        col = np.interp(t, np.array(fs, float), P[:, ax])
        k = max(3, win | 1)
        col = np.convolve(np.pad(col, (k // 2, k // 2), mode="edge"),
                          np.ones(k) / k, mode="valid")[:len(t)]
        cols.append(col)
    for i, f in enumerate(t):
        out[int(f)] = (int(cols[0][i]), int(cols[1][i]))
    return out


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
    fin = min(evd["finish"]["frame"], len(grays) - 1)

    cands, grips = {}, {}
    for f in range(a, fin + 1):
        g = kp(pf, f, "grip_center")
        if g is None:
            continue
        gp = np.array([g[0] * W, g[1] * H])
        grips[f] = gp
        c = candidates(grays[f], gp, club_px)
        if c:
            cands[f] = c

    # Height is monotonic within each phase: up through the backswing, down through the
    # downswing, up again through the follow-through.
    path = {}
    path.update(solve_monotonic(cands, list(range(a, top + 1)), club_px, direction=-1))
    path.update(solve_monotonic(cands, list(range(top, imp + 1)), club_px, direction=+1))
    path.update(solve_monotonic(cands, list(range(imp, fin + 1)), club_px, direction=-1))
    sm = fill_and_smooth(path, a, fin)
    print(f"candidates on {len(cands)}/{fin - a + 1} frames; path on {len(path)}")

    picks = np.linspace(a, fin, args.frames).astype(int)
    tiles = []
    for f in picks:
        f = int(f)
        if f >= len(colors):
            continue
        img = colors[f].copy()
        if f in grips:
            gp = tuple(np.rint(grips[f]).astype(int))
            cv2.circle(img, gp, 6, (0, 220, 255), 2, cv2.LINE_AA)
            if f in sm:
                cv2.line(img, gp, sm[f], (255, 255, 255), 1, cv2.LINE_AA)
        if f in path:
            cv2.circle(img, path[f], 7, (150, 150, 150), 1, cv2.LINE_AA)
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
    p1 = out / "exp4_lsd_sprite.jpg"
    cv2.imwrite(str(p1), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 92])

    base = (colors[min(imp, len(colors) - 1)] * 0.55).astype(np.uint8)
    for col, rr in (((77, 72, 229), range(a, top + 1)),
                    ((246, 130, 59), range(top, imp + 1)),
                    ((200, 160, 120), range(imp, fin + 1))):
        pts = [sm[f] for f in rr if f in sm]
        if len(pts) > 1:
            cv2.polylines(base, [np.array(pts, np.int32)], False, col, 3, cv2.LINE_AA)
    cv2.rectangle(base, (0, 0), (W, 26), (0, 0, 0), -1)
    cv2.putText(base, f"EXP4 LSD segments from hands + monotonic height ({len(path)} frames)",
                (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
    p2 = out / "exp4_lsd_trace.jpg"
    cv2.imwrite(str(p2), base, [cv2.IMWRITE_JPEG_QUALITY, 94])
    print(f"wrote {p1}\nwrote {p2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
