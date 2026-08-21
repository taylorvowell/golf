"""SPIKE: Meta CoTracker3 (offline) as a club-head tracker — post-hoc variant injector.

Evaluates whether a modern track-any-point model beats our detector+solver head. Reads an
already-analysed out/<stem>/ (analysis.json + analysis.mp4), seeds CoTracker3 with the club
head at the swing's event frames (taken from the stored `model_traj_raw` solve), tracks
bidirectionally, and injects two new club variants:

    model_cotracker         raw trace built by club._build_trace (same as *_raw variants)
    model_cotracker_moving  the same head positions with the moving-average trace

Same non-destructive contract as scripts/addvariant.py: nothing else in the artifact is
touched, and the write is atomic.

Install route (documented because it IS the spike):
    The model is loaded via `torch.hub.load("facebookresearch/co-tracker", "cotracker3_offline")`
    — no pip package; torch.hub clones the repo into the hub cache and pulls the
    `scaled_offline.pth` weights (~180MB) from HuggingFace on first use. Works on
    torch 2.13.0+cu126 / Python 3.13. No extra pip installs (frames are read with OpenCV).

Findings that shaped the method (measured on pro_2, GTX 1080 8GB):
  - Seeding ONLY at Address + Impact fails: both sit on the ground, and once the club
    leaves, the tracker latches onto the revealed background (grass/ball) — a static
    "track" for the whole clip. Seeding at airborne event frames tracks the real head to
    within a few px of the detector where the model keeps visibility.
  - fp16 autocast fits the whole clip in VRAM but corrupts the visibility output
    (stuck background points report visible=1). fp32 visibility is honest, so tracking
    runs in fp32 over overlapping temporal windows instead (322 frames of fp32 feature
    maps OOM an 8GB card in one shot).
  - Visibility comes back binary (the predictor thresholds internally), so conf on
    tracked frames is the visible fraction of the cluster, not a soft score.

Method:
  - Seeds: for every event with a `model_traj_raw` measured head within SEED_SEARCH
    frames, a 5-point cluster (the point + 4 offsets ~6px) so one occluded pixel doesn't
    kill the track. CoTracker3 accepts queries at arbitrary times; offline mode tracks
    both directions from each query.
  - Windows: the clip is split into WINDOW-frame chunks overlapping by OVERLAP; each
    chunk tracks the seed clusters whose seed frame falls inside it.
  - Fusion: per frame, each cluster run proposes its visible points' median. Proposals
    are gated (below), then the winner is the cluster with the highest
    (visible_fraction x exp(-|t - seed_t| / TAU)) — winner-take-all rather than an
    average, so the head never blends two estimators. conf = winner's visible fraction.
  - Sanity gate: a proposed head further than 2.2x the calibrated club length (median
    |head-grip| px over model_traj_raw's from_model frames; grip = wrist midpoint from
    pose, keypoints resolved BY NAME) is a lost track; so is a cluster with fewer than
    MIN_PTS visible points (a lone "visible" point is how a stuck background track looks).
  - Gaps: frames with no surviving proposal inside the tracked range are filled by polar
    interpolation (radius + unwrapped angle) around the per-frame grip — interp=True,
    conf 0.25. Frames outside the tracked range carry no head.

Usage:
    .venv/Scripts/python.exe scripts/cotracker_spike.py                # every out/<stem>/
    .venv/Scripts/python.exe scripts/cotracker_spike.py out/pro_2
    .venv/Scripts/python.exe scripts/cotracker_spike.py --dry-run --downscale 2
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import club  # noqa: E402

KEY = "model_cotracker"
KEY_MOVING = "model_cotracker_moving"
LABEL = "CoTracker3 offline point track"
LABEL_MOVING = "CoTracker3 offline point track + trace: moving average"
BASE_KEY = "model_traj_raw"

HUB_REPO = "facebookresearch/co-tracker"
HUB_MODEL = "cotracker3_offline"

MIN_VIS = 0.5            # a cluster point below this visibility does not vote
MIN_PTS = 2              # visible points a cluster needs before it may propose a head
CLUSTER_OFFSET_PX = 6.0  # seed offsets, in analysis.mp4 pixels
LOST_TRACK_MULT = 2.2    # x calibrated club length -> lost track
INTERP_CONF = 0.25
MIN_POSE_CONF = 0.2      # wrist keypoints below this don't define a grip
SEED_SEARCH = 6          # frames each side of an event to find a measured head to seed
WINDOW = 130             # fp32 temporal window (frames) — sized for 8GB VRAM
OVERLAP = 26             # window overlap, so edge seeds get covered from both sides
TAU = 25.0               # frames; trust in a cluster decays with distance from its seed


# ---------------------------------------------------------------- artifact helpers

def _grips_px(doc: dict, w: int, h: int) -> list:
    """Per-frame grip (wrist midpoint) in pixels; None where the pose can't provide one.

    Keypoints are resolved by name via pose.keypoint_names — never a literal index.
    """
    names = doc["pose"]["keypoint_names"]
    li, ri = names.index("left_wrist"), names.index("right_wrist")
    grips = [None] * doc["video"]["frame_count"]
    for fr in doc["pose"]["frames"]:
        kp = fr["kp"]
        pts = [kp[i] for i in (li, ri) if kp[i][2] >= MIN_POSE_CONF]
        if pts:
            grips[fr["f"]] = np.array([np.mean([p[0] for p in pts]) * w,
                                       np.mean([p[1] for p in pts]) * h])
    return grips


def _seed_points(doc: dict, base_frames: list, w: int, h: int) -> list:
    """[(seed_frame, [x,y] px), ...] — one per event with a measured base head nearby.

    Prefers a real detector measurement (from_model, not interp); accepts the ball anchor
    (from_ball) as a fallback; never seeds on a solver guess.
    """
    by_f = {c["f"]: c for c in base_frames}

    def measured(c, allow_ball):
        if not c or not c.get("head"):
            return False
        if c.get("from_model") and not c.get("interp"):
            return True
        return allow_ball and c.get("from_ball")

    seeds, seen = [], set()
    for ev in doc["events"].values():
        if not isinstance(ev, dict) or "frame" not in ev:
            continue
        for allow_ball in (False, True):
            found = None
            for d in range(SEED_SEARCH + 1):
                for f in (ev["frame"] - d, ev["frame"] + d):
                    c = by_f.get(f)
                    if measured(c, allow_ball):
                        found = (f, [c["head"][0] * w, c["head"][1] * h])
                        break
                if found:
                    break
            if found:
                if found[0] not in seen:
                    seen.add(found[0])
                    seeds.append(found)
                break
    return sorted(seeds)


def _calibrated_club_len_px(base_frames: list, grips: list, w: int, h: int) -> float:
    """Median |head - grip| px over the base solve's real detector measurements."""
    ds = []
    for c in base_frames:
        if c.get("from_model") and not c.get("interp") and c.get("head"):
            g = grips[c["f"]]
            if g is not None:
                head = np.array([c["head"][0] * w, c["head"][1] * h])
                ds.append(float(np.linalg.norm(head - g)))
    return float(np.median(ds)) if ds else 0.0


# ---------------------------------------------------------------- tracking

def _read_video(path: Path, downscale: int):
    """(frames uint8 RGB [T,H,W,3] at downscaled size, full_w, full_h)."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {path}")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    dw, dh = max(1, w // downscale), max(1, h // downscale)
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if (dw, dh) != (w, h):
            bgr = cv2.resize(bgr, (dw, dh), interpolation=cv2.INTER_AREA)
        frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    cap.release()
    return np.stack(frames), w, h


_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        import torch
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"  loading {HUB_REPO}:{HUB_MODEL} on {dev} (first run downloads weights)...")
        _MODEL = torch.hub.load(HUB_REPO, HUB_MODEL).to(dev).eval()
        _MODEL._spike_device = dev
    return _MODEL


def _windows(n: int):
    """Overlapping (lo, hi) chunks covering [0, n)."""
    if n <= WINDOW:
        return [(0, n)]
    out, lo = [], 0
    while True:
        hi = min(n, lo + WINDOW)
        out.append((lo, hi))
        if hi >= n:
            return out
        lo = hi - OVERLAP


def _track_window(frames_np: np.ndarray, lo: int, hi: int, seeds: list,
                  downscale_sx: float, downscale_sy: float):
    """Track every seed cluster whose seed frame is in [lo, hi) over that window.

    Returns [{seed_f, lo, hi, tracks [T,5,2] full-res px, vis [T,5] float}, ...].
    fp32 on purpose: fp16 fits the whole clip but corrupts the visibility output.
    """
    import torch
    inside = [s for s in seeds if lo <= s[0] < hi]
    if not inside:
        return []
    model = _model()
    dev = model._spike_device
    qs = []
    for f, (x, y) in inside:
        for dx, dy in ((0, 0), (CLUSTER_OFFSET_PX, 0), (-CLUSTER_OFFSET_PX, 0),
                       (0, CLUSTER_OFFSET_PX), (0, -CLUSTER_OFFSET_PX)):
            qs.append([f - lo, (x + dx) * downscale_sx, (y + dy) * downscale_sy])
    video = torch.from_numpy(frames_np[lo:hi]).permute(0, 3, 1, 2)[None].float().to(dev)
    q = torch.tensor(qs, dtype=torch.float32, device=dev)[None]
    with torch.inference_mode():
        tracks, vis = model(video, queries=q, backward_tracking=True)
    tracks = tracks[0].float().cpu().numpy()          # [T, 5*k, 2] downscaled px
    vis = vis[0].float().cpu().numpy()                # [T, 5*k]
    if vis.ndim == 3:                                 # some versions return [T,N,1]
        vis = vis[..., 0]
    tracks[..., 0] /= downscale_sx
    tracks[..., 1] /= downscale_sy
    del video, q
    if dev == "cuda":
        torch.cuda.empty_cache()
    runs = []
    for i, (f, _) in enumerate(inside):
        runs.append({"seed_f": f, "lo": lo, "hi": hi,
                     "tracks": tracks[:, 5 * i:5 * i + 5],
                     "vis": np.clip(vis[:, 5 * i:5 * i + 5], 0.0, 1.0)})
    return runs


STATIC_SPAN = 3        # frames each side for the local-motion consistency gate
STATIC_PX_PER_FRAME = 2.0


def _fuse(n: int, runs: list, grips: list, club_len_px: float):
    """Winner-take-all across cluster runs -> (heads px|None, confs) per frame.

    Two gates per proposal, both learned from real failures on pro_2:
      - grip-distance: further than LOST_TRACK_MULT x the calibrated club length from the
        grip is a lost track.
      - local-motion consistency: a track sitting still while the grip moves is revealed
        background (the tracker's classic failure at ground-level seeds), not the club —
        during a swing the head never holds still while the hands travel. The seed's own
        neighbourhood is exempt so the resting club at Address survives.
    """
    heads, confs = [None] * n, [0.0] * n
    best = [0.0] * n
    for r in runs:
        # Per-frame cluster proposal: visible points' median (None below MIN_PTS votes).
        pos = [None] * (r["hi"] - r["lo"])
        frac = [0.0] * (r["hi"] - r["lo"])
        for i in range(r["hi"] - r["lo"]):
            use = r["vis"][i] >= MIN_VIS
            if use.sum() >= MIN_PTS:
                pos[i] = np.median(r["tracks"][i][use], axis=0)
                frac[i] = float(use.sum()) / len(r["vis"][i])

        def local_speed(seq, i):
            a, b = max(0, i - STATIC_SPAN), min(len(seq) - 1, i + STATIC_SPAN)
            if b <= a or seq[a] is None or seq[b] is None:
                return None
            return float(np.linalg.norm(np.asarray(seq[b]) - np.asarray(seq[a]))) / (b - a)

        for t in range(r["lo"], r["hi"]):
            i = t - r["lo"]
            if pos[i] is None:
                continue
            if club_len_px > 0 and grips[t] is not None and \
                    np.linalg.norm(pos[i] - grips[t]) > LOST_TRACK_MULT * club_len_px:
                continue  # lost track — further from the grip than the club can reach
            if abs(t - r["seed_f"]) > STATIC_SPAN + 1:
                cs = local_speed(pos, i)
                gs = local_speed([grips[f] for f in range(r["lo"], r["hi"])], i)
                if cs is not None and gs is not None and \
                        cs < STATIC_PX_PER_FRAME and gs > STATIC_PX_PER_FRAME:
                    continue  # static "head" under moving hands = latched background
            wgt = frac[i] * math.exp(-abs(t - r["seed_f"]) / TAU)
            if wgt > best[t]:
                best[t] = wgt
                heads[t] = pos[i]
                confs[t] = float(np.clip(frac[i], 0.0, 1.0))
    return heads, confs


def _polar_fill(heads: list, confs: list, grips: list):
    """Fill gaps INSIDE the tracked range by polar interpolation around the grip:
    radius and shortest-arc angle interpolated between the bracketing tracked frames.
    Returns interp flags parallel to heads."""
    T = len(heads)
    tracked = [t for t in range(T) if heads[t] is not None]
    interp = [False] * T
    if len(tracked) < 2:
        return interp

    def polar(t):
        d = heads[t] - grips[t]
        return float(np.hypot(*d)), math.atan2(d[1], d[0])

    for a, b in zip(tracked, tracked[1:]):
        if b - a <= 1:
            continue
        if grips[a] is None or grips[b] is None:
            continue
        r0, th0 = polar(a)
        r1, th1 = polar(b)
        dth = (th1 - th0 + math.pi) % (2 * math.pi) - math.pi  # shortest arc
        for t in range(a + 1, b):
            if grips[t] is None:
                continue
            u = (t - a) / (b - a)
            r, th = r0 + u * (r1 - r0), th0 + u * dth
            heads[t] = grips[t] + r * np.array([math.cos(th), math.sin(th)])
            confs[t] = INTERP_CONF
            interp[t] = True
    return interp


# ---------------------------------------------------------------- per-swing driver

def add_one(out_dir: Path, downscale: int, dry_run: bool = False) -> bool:
    p = out_dir / "analysis.json"
    vid_p = out_dir / "analysis.mp4"
    if not p.exists() or not vid_p.exists():
        print(f"  {out_dir.name}: missing analysis.json or analysis.mp4 — skipped")
        return False
    doc = json.loads(p.read_text(encoding="utf-8"))
    variants = ((doc.get("club") or {}).get("variants") or {})
    if BASE_KEY not in variants:
        print(f"  {out_dir.name}: no '{BASE_KEY}' variant — skipped")
        return False
    if not doc.get("events") or not doc.get("pose"):
        print(f"  {out_dir.name}: no events/pose — skipped")
        return False

    t0 = time.time()
    base = variants[BASE_KEY]
    base_frames = base.get("frames") or []
    n = doc["video"]["frame_count"]

    frames_np, w, h = _read_video(vid_p, downscale)
    if frames_np.shape[0] != n:
        print(f"  {out_dir.name}: analysis.mp4 has {frames_np.shape[0]} frames, "
              f"artifact says {n} — skipped")
        return False
    sx, sy = frames_np.shape[2] / w, frames_np.shape[1] / h

    grips = _grips_px(doc, w, h)
    club_len_px = _calibrated_club_len_px(base_frames, grips, w, h)
    seeds = _seed_points(doc, base_frames, w, h)
    if not seeds:
        print(f"  {out_dir.name}: no measured head near any event — skipped")
        return False

    runs = []
    for lo, hi in _windows(n):
        runs.extend(_track_window(frames_np, lo, hi, seeds, sx, sy))
    del frames_np
    if not runs:
        print(f"  {out_dir.name}: no seed landed in any window — skipped")
        return False

    heads, confs = _fuse(n, runs, grips, club_len_px)
    interp_flags = _polar_fill(heads, confs, grips)
    tracked_n = sum(1 for t in range(n) if heads[t] is not None and not interp_flags[t])
    interp_n = sum(interp_flags)

    # Full-length ClubFrame list (smooth_trace/_build_trace index res.frames by frame no).
    cfs = []
    for f in range(n):
        cf = club.ClubFrame(f=f)
        if heads[f] is not None:
            cf.head = [round(float(heads[f][0] / w), 5), round(float(heads[f][1] / h), 5)]
            if grips[f] is not None:
                # Butt drawn at the grip: enough to render a club line for the spike; the
                # tracker measures the head only.
                cf.butt = [round(float(grips[f][0] / w), 5),
                           round(float(grips[f][1] / h), 5)]
                cf.shaft = [cf.butt, cf.head]
            cf.conf = round(float(confs[f]), 3)
            cf.interp = bool(interp_flags[f])
            cf.from_model = not interp_flags[f]
        cfs.append(cf)

    runtime = time.time() - t0
    notes = [
        f"CoTracker3 offline (torch.hub {HUB_REPO}:{HUB_MODEL}, scaled_offline weights); "
        f"5-point clusters (+/-{CLUSTER_OFFSET_PX:.0f}px) seeded at {len(seeds)} event "
        f"frames from '{BASE_KEY}' ({', '.join(str(f) for f, _ in seeds)})",
        f"fp32 in {len(_windows(n))} windows of <={WINDOW} frames (overlap {OVERLAP}), "
        f"input downscale 1/{downscale}; winner-take-all fusion "
        f"(min vis {MIN_VIS}, min pts {MIN_PTS}, seed-distance decay tau {TAU:.0f})",
        f"head tracked on {tracked_n}/{n} frames, {interp_n} polar-interpolated; "
        f"lost-track gate at {LOST_TRACK_MULT}x club length "
        f"({club_len_px:.0f}px from grip); runtime {runtime:.1f}s",
    ]

    res = club.ClubResult(frames=cfs, club_len=base.get("club_len", 0.0),
                          butt_len=base.get("butt_len", 0.0), notes=list(notes))
    ev = {"events": doc["events"]}
    club._build_trace(res, ev, n, club.ClubConfig())

    res_mov = club.ClubResult(frames=cfs, club_len=res.club_len, butt_len=res.butt_len)
    cfg_mov = replace(club.ClubConfig(), trace_smooth="moving", trace_min_conf=0.0)
    club.smooth_trace(res_mov, ev, n, cfg_mov)

    pts = {k: len(v) for k, v in res.trace.items()}
    print(f"  {out_dir.name}: tracked {tracked_n}/{n} frames, {interp_n} interp; "
          f"coverage {res.coverage}; trace pts back {pts.get('backswing', 0)} / "
          f"down {pts.get('downswing', 0)} / through {pts.get('followthrough', 0)}; "
          f"{runtime:.1f}s")
    if dry_run:
        return True

    fj = []
    for cf in cfs:
        fj.append({"f": cf.f, "shaft": cf.shaft, "head": cf.head, "butt": cf.butt,
                   "conf": cf.conf, "interp": cf.interp,
                   "from_model": cf.from_model, "from_ball": False})
    doc["club"]["variants"][KEY] = {
        "label": LABEL, "coverage": res.coverage, "club_len": res.club_len,
        "butt_len": res.butt_len, "notes": notes, "frames": fj,
        "trace": res.trace, "trace_frames": res.trace_frames,
    }
    doc["club"]["variants"][KEY_MOVING] = {
        "label": LABEL_MOVING, "coverage": res.coverage, "club_len": res.club_len,
        "butt_len": res.butt_len, "notes": notes + ["trace: moving average"], "frames": fj,
        "trace": res_mov.trace, "trace_frames": res_mov.trace_frames,
    }
    tmp = out_dir / "analysis.json.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, p)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--downscale", type=int, default=1,
                    help="integer frame downscale before tracking (default 1; the model "
                         "resizes internally, so this mainly trims VRAM/IO)")
    args = ap.parse_args()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings under out/")
    print(f"adding '{KEY}' + '{KEY_MOVING}' to {len(dirs)} swing(s)"
          f"{'  (dry run)' if args.dry_run else ''}")
    ok = 0
    for d in dirs:
        ok += bool(add_one(d, args.downscale, args.dry_run))
    print(f"done: {ok}/{len(dirs)}")


if __name__ == "__main__":
    main()
