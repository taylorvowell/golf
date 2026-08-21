"""Predict-then-look ROI cascade — recover club heads the full-frame detector missed.

The full-frame pass runs YOLO at analysis resolution, where a club head is a handful of
pixels; the frames it misses are exactly the fast, blurred ones. This script revisits each
swing-window frame that has NO stored head detection, predicts where the head should be by
interpolating its neighbours in polar coordinates about the grip, crops that region from the
video at full resolution, and re-runs the SAME weights on the crop — the head is ~3x bigger
in the detector's input, so detections recovered this way are real detections, just found by
asking a better question. Post-hoc variant injector in the addvariant.py mould: reads
analysis.json, writes back only its own two `club.variants` keys.

Usage:
    .venv/Scripts/python.exe scripts/roicascade.py                # every out/<stem>/
    .venv/Scripts/python.exe scripts/roicascade.py out/pro_2
    .venv/Scripts/python.exe scripts/roicascade.py --dry-run
"""
from __future__ import annotations

import argparse
import json
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

# ALWAYS the fine-tuned weights. The classical path has silently regenerated worse artifacts
# before when the weights were omitted (CLAUDE.md standing trap) — so the path is pinned here,
# not a CLI default someone can forget.
WEIGHTS = ROOT / "runs" / "clubhead" / "weights" / "best.pt"

KEY = "model_roi_cascade"
KEY_MOVING = "model_roi_cascade_moving"
BASE_KEY = "model_traj_raw"

CLUBHEAD = 0                 # class id, matches club_detect.EXPECTED_NAMES
GAP_HEAD_CONF = 0.15         # a frame counts as a gap when no head reaches this (>=, truncated)
ROI_CONF = 0.05              # deliberately low on the crop — the geometric gate does the rejecting
ROI_IOU = 0.5
INTERP_CONF = 0.25           # confidence stamped on frames we could only predict, never detect
MIN_R, MAX_R = 0.35, 1.9     # accepted head distance from grip, multiples of calibrated club length
WRIST_MIN_CONF = 0.2         # same gate club.py's _kp uses — a guessed wrist makes a guessed grip
# A recovered box must be at least this fraction of the median full-frame head box's long side.
# Measured failure this prevents: on pro_2 every crop is littered with distant range balls, the
# head class fires on them at conf up to 0.84, and all three "recoveries" the distance gate
# accepted were 5-11px balls against a ~45px real head. Size is what separates them — a head
# big enough to have been worth the crop cannot be smaller than half the heads already measured.
MIN_BOX_FRAC = 0.5


def _grip_px(pose_frames_by_f: dict, f: int, li: int, ri: int, w: int, h: int):
    """Grip = wrist midpoint in pixels, or None when either wrist is below confidence.

    Indices come from pose.keypoint_names, never literals — the 49-point layout is append-only
    but a literal index silently reads the wrong joint if it is ever wrong once.
    """
    pf = pose_frames_by_f.get(f)
    if not pf:
        return None
    kp = pf["kp"]
    lw, rw = kp[li], kp[ri]
    if lw[2] < WRIST_MIN_CONF or rw[2] < WRIST_MIN_CONF:
        return None
    return np.array([(lw[0] + rw[0]) / 2 * w, (lw[1] + rw[1]) / 2 * h], dtype=float)


def _polar(head_px, grip_px):
    v = np.asarray(head_px, dtype=float) - grip_px
    return float(np.arctan2(v[1], v[0])), float(np.hypot(v[0], v[1]))


def _predict_polar(f: int, anchor_fs: list, polar: dict):
    """(theta, r) at frame f, interpolated between the nearest measured neighbours.

    Interpolation is polar about the grip, not Cartesian, because the head rides an arc about
    the hands — a straight chord between two heads half a swing apart passes through the
    golfer's body. Theta takes the shortest angular path; interpolating raw angles across the
    ±pi wrap would send the prediction the long way round the circle.
    """
    lo = [a for a in anchor_fs if a < f]
    hi = [a for a in anchor_fs if a > f]
    if not lo and not hi:
        return None
    if not lo:
        return polar[hi[0]]
    if not hi:
        return polar[lo[-1]]
    f0, f1 = lo[-1], hi[0]
    (th0, r0), (th1, r1) = polar[f0], polar[f1]
    t = (f - f0) / (f1 - f0)
    dth = (th1 - th0 + np.pi) % (2 * np.pi) - np.pi
    return th0 + t * dth, r0 + t * (r1 - r0)


def _load_model(device):
    from ultralytics import YOLO
    if device is None:
        # Same convention as ClubDetector._load: CUDA when available, else CPU.
        try:
            import torch
            device = 0 if torch.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"
    if not WEIGHTS.exists():
        raise SystemExit(f"weights not found: {WEIGHTS} — the cascade must use the same "
                         "fine-tuned detector as the full-frame pass, never a fallback")
    return YOLO(str(WEIGHTS)), device


def _detector_heads_by_frame(doc: dict):
    """(frame -> best head conf, accepted head box whs) from the stored detector boxes.

    The box sizes calibrate the recovery's size gate — what "a club head at this framing"
    measures, taken from the frames the full-frame pass itself trusted.

    The artifact key is `club.detector.boxes` ([{f, d:[{c, xy, wh, p}]}]); `detector.frames`
    is an int frame count, so guarding the type here prevents reading a count as a list on
    artifacts from either schema vintage.
    """
    det = (doc.get("club") or {}).get("detector") or {}
    rows = det.get("boxes")
    if not isinstance(rows, list):
        rows = det.get("frames") if isinstance(det.get("frames"), list) else []
    best, sides = {}, []
    for row in rows:
        for d in row.get("d") or []:
            if d.get("c") != CLUBHEAD:
                continue
            best[row["f"]] = max(best.get(row["f"], 0.0), d["p"])
            # >= not >: truncated confs must land on the same side of the gate everywhere.
            if d["p"] >= GAP_HEAD_CONF and d.get("wh"):
                sides.append(tuple(d["wh"]))   # normalized; scaled to px by the caller
    return best, sides


def _frame_dict(f, head_n, butt_n, conf, interp, from_model):
    r5 = lambda p: [round(float(p[0]), 5), round(float(p[1]), 5)]  # noqa: E731
    head, butt = r5(head_n), r5(butt_n)
    return {"f": int(f), "shaft": [butt, head], "head": head, "butt": butt,
            "conf": round(float(conf), 3), "interp": bool(interp),
            "from_model": bool(from_model), "from_ball": False}


def _result_from_frames(frame_dicts, club_len, butt_len) -> club.ClubResult:
    """Rebuild the ClubResult the trace builders need — addvariant.py's pattern."""
    frames = [
        club.ClubFrame(
            f=c["f"], shaft=c.get("shaft"), head=c.get("head"), butt=c.get("butt"),
            conf=c.get("conf", 0.0), interp=c.get("interp", False),
        )
        for c in frame_dicts
    ]
    # `from_model` gates the trace modes and is stored per frame — set explicitly rather than
    # trusting the dataclass default, or every recovered head would be dropped from the line.
    for fr, c in zip(frames, frame_dicts):
        fr.from_model = c.get("from_model", False)
    return club.ClubResult(frames=frames, club_len=club_len, butt_len=butt_len)


def cascade_one(out_dir: Path, model_state: dict, device, imgsz: int,
                dry_run: bool = False) -> bool:
    p = out_dir / "analysis.json"
    vid = out_dir / "analysis.mp4"
    if not p.exists():
        print(f"  {out_dir.name}: no analysis.json — skipped")
        return False
    doc = json.loads(p.read_text(encoding="utf-8"))
    variants = ((doc.get("club") or {}).get("variants") or {})
    if BASE_KEY not in variants:
        print(f"  {out_dir.name}: no '{BASE_KEY}' variant — skipped (needs a --club-detector run)")
        return False
    ev = doc.get("events") or {}
    if not all(k in ev for k in ("address", "top", "impact", "finish")):
        print(f"  {out_dir.name}: missing events — skipped")
        return False
    if not vid.exists():
        print(f"  {out_dir.name}: no analysis.mp4 — skipped (the crops must come from the "
              "analysis-resolution copy the coordinates refer to)")
        return False

    n = doc["video"]["frame_count"]
    base = variants[BASE_KEY]
    base_frames = list(base.get("frames") or [])
    if len(base_frames) != n or any(c["f"] != i for i, c in enumerate(base_frames)):
        # Index-by-f everywhere below assumes one entry per frame in order; a sparse or
        # reordered list would silently pair frame f's grip with frame g's head.
        by_f = {c["f"]: c for c in base_frames}
        base_frames = [by_f.get(i, {"f": i}) for i in range(n)]

    # Pixel space is the analysis.mp4's own — normalized coords scale to whatever the file
    # really is, and video.width/height in the artifact is the SOURCE resolution, not this copy.
    cap = cv2.VideoCapture(str(vid))
    if not cap.isOpened():
        print(f"  {out_dir.name}: cannot open {vid} — skipped")
        return False
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    pose_frames_by_f = {pf["f"]: pf for pf in doc["pose"]["frames"]}
    names = doc["pose"]["keypoint_names"]
    li, ri = names.index("left_wrist"), names.index("right_wrist")

    # --- 1. gaps: swing-window frames the full-frame detector answered nothing for -------
    a_f, fin_f = ev["address"]["frame"], min(n - 1, ev["finish"]["frame"])
    head_conf, head_whs = _detector_heads_by_frame(doc)
    # Size floor in px for a believable recovered head, from the heads already measured.
    # 0 disables the gate only when there is nothing to calibrate against.
    min_box_px = (MIN_BOX_FRAC * float(np.median([max(bw * w, bh * h)
                                                  for bw, bh in head_whs]))
                  if head_whs else 0.0)
    # >= not >: confidences are truncated, and a frame sitting exactly on the gate must agree
    # with every other consumer about which side it is on.
    gap_fs = [f for f in range(a_f, fin_f + 1) if head_conf.get(f, 0.0) < GAP_HEAD_CONF]

    # --- 2. anchors: base frames with a REAL detected head and a usable grip -------------
    grips = {f: _grip_px(pose_frames_by_f, f, li, ri, w, h) for f in range(n)}
    anchor_fs, polar = [], {}
    for f, c in enumerate(base_frames):
        if not (c.get("from_model") and not c.get("interp") and c.get("head")):
            continue
        if grips[f] is None:
            continue
        anchor_fs.append(f)
        polar[f] = _polar((c["head"][0] * w, c["head"][1] * h), grips[f])

    # Calibrations in pixels from the base's measured frames — never from the artifact's
    # normalized club_len, whose reference dimension differs from this file's pixel space.
    radii = [polar[f][1] for f in anchor_fs]
    club_px = float(np.median(radii)) if radii else 0.0
    butt_ds = [float(np.hypot(c["butt"][0] * w - grips[f][0], c["butt"][1] * h - grips[f][1]))
               for f, c in enumerate(base_frames)
               if f in polar and c.get("butt")]
    butt_px = float(np.median(butt_ds)) if butt_ds else 0.0

    if not gap_fs:
        print(f"  {out_dir.name}: 0 gap frames in window {a_f}..{fin_f} — nothing to recover")
    if club_px <= 0:
        print(f"  {out_dir.name}: no measured base heads to calibrate against — skipped")
        cap.release()
        return False

    # --- 3. predict, crop, re-detect ------------------------------------------------------
    side = int(max(220, 0.35 * min(w, h)))
    crops, crop_meta = [], []   # meta: (f, x0, y0, grip)
    for f in sorted(gap_fs):
        gp = grips[f]
        pred = _predict_polar(f, anchor_fs, polar)
        if gp is None or pred is None:
            continue  # nowhere to look — the frame stays a prediction-only gap below
        th, r = pred
        cx, cy = gp[0] + r * np.cos(th), gp[1] + r * np.sin(th)
        # Clamp the WINDOW, not the point: sliding the box keeps it full-sized at the image
        # edge, where a truncated crop would shrink exactly the head it is trying to enlarge.
        x0 = int(np.clip(round(cx - side / 2), 0, max(0, w - side)))
        y0 = int(np.clip(round(cy - side / 2), 0, max(0, h - side)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        crops.append(img[y0:y0 + min(side, h), x0:x0 + min(side, w)])
        crop_meta.append((f, x0, y0, gp))
    cap.release()

    recovered = {}   # f -> (head_px, conf)
    t0 = time.perf_counter()
    if crops:
        if model_state.get("model") is None:
            model_state["model"], model_state["device"] = _load_model(device)
        model, dev = model_state["model"], model_state["device"]
        BATCH = 16  # same peak-memory bound club_detect.py uses on the shared 8 GB card
        for i in range(0, len(crops), BATCH):
            out = model.predict(crops[i:i + BATCH], conf=ROI_CONF, iou=ROI_IOU,
                                imgsz=imgsz, device=dev, verbose=False)
            for j, r in enumerate(out):
                f, x0, y0, gp = crop_meta[i + j]
                boxes = getattr(r, "boxes", None)
                if boxes is None or len(boxes) == 0:
                    continue
                xyxy = boxes.xyxy.cpu().numpy()
                cf = boxes.conf.cpu().numpy()
                cl = boxes.cls.cpu().numpy().astype(int)
                best = None
                for (bx0, by0, bx1, by1), c, k in zip(xyxy, cf, cl):
                    if k != CLUBHEAD:
                        continue
                    # Crop coords -> full frame. Forgetting the offset would place every
                    # recovered head in the image's top-left corner.
                    hx, hy = x0 + (bx0 + bx1) / 2, y0 + (by0 + by1) / 2
                    d = float(np.hypot(hx - gp[0], hy - gp[1]))
                    # The club is rigid and held at the hands: a head outside the calibrated
                    # length bounds is a ball, a shadow, or someone else's club — not a recovery.
                    if not (MIN_R * club_px <= d <= MAX_R * club_px):
                        continue
                    # Size gate — see MIN_BOX_FRAC. Range balls share the annulus AND fire the
                    # head class at high conf; being ~7px against a ~45px head is what betrays them.
                    if max(bx1 - bx0, by1 - by0) < min_box_px:
                        continue
                    if best is None or c > best[1]:
                        best = ((hx, hy), float(c))
                if best:
                    recovered[f] = best
    roi_secs = time.perf_counter() - t0

    # --- 4. assemble the variant's frames -------------------------------------------------
    out_frames, interped = [], 0
    for f, c in enumerate(base_frames):
        if f not in gap_fs:
            out_frames.append(dict(c))   # base kept verbatim wherever it had a real answer
            continue
        gp = grips[f]
        if f in recovered and gp is not None:
            (hx, hy), conf = recovered[f]
            d = np.array([hx, hy], dtype=float) - gp
            u = d / max(float(np.hypot(*d)), 1e-6)
            butt = gp - u * butt_px
            out_frames.append(_frame_dict(f, (hx / w, hy / h), (butt[0] / w, butt[1] / h),
                                          conf, interp=False, from_model=True))
            continue
        pred = _predict_polar(f, anchor_fs, polar)
        if gp is None or pred is None:
            out_frames.append(dict(c))   # nothing to predict from — keep whatever the base had
            continue
        th, r = pred
        head = gp + np.array([np.cos(th), np.sin(th)]) * r
        butt = gp - np.array([np.cos(th), np.sin(th)]) * butt_px
        # A prediction is not a detection: interp=True keeps it out of every measured-only
        # trace mode, and from_model=False keeps it from ever passing for the detector's word.
        out_frames.append(_frame_dict(f, (head[0] / w, head[1] / h), (butt[0] / w, butt[1] / h),
                                      INTERP_CONF, interp=True, from_model=False))
        interped += 1

    confs = [recovered[f][1] for f in recovered]
    mean_conf = float(np.mean(confs)) if confs else 0.0

    # --- 5. trace + coverage, raw and moving twin -----------------------------------------
    ev_wrap = {"events": ev}
    res = _result_from_frames(out_frames, base.get("club_len", 0.0), base.get("butt_len", 0.0))
    club._build_trace(res, ev_wrap, n, club.ClubConfig())

    res_mov = _result_from_frames(out_frames, base.get("club_len", 0.0), base.get("butt_len", 0.0))
    # trace_min_conf=0.0 on purpose: the recoveries are low-confidence by construction
    # (conf 0.05 gate on the crop) and the moving trace exists to show them, not re-drop them.
    cfg_mov = replace(club.ClubConfig(), trace_smooth="moving", trace_min_conf=0.0)
    club.smooth_trace(res_mov, ev_wrap, n, cfg_mov)

    notes = [
        f"ROI cascade over {BASE_KEY}: {len(gap_fs)} gap frames in swing window "
        f"{a_f}..{fin_f} (no head det >= {GAP_HEAD_CONF}); recovered {len(recovered)} by "
        f"re-detecting a {side}px predicted crop (conf {ROI_CONF}, imgsz {imgsz}, "
        f"min box side {min_box_px:.0f}px); "
        f"{interped} polar-interpolated; mean recovered conf {mean_conf:.3f}",
    ]

    print(f"  {out_dir.name}: gaps {len(gap_fs)}  recovered {len(recovered)}  "
          f"interp {interped}  mean conf {mean_conf:.3f}  "
          f"coverage {res.coverage}  roi pass {roi_secs:.1f}s")
    if dry_run:
        return True

    def _variant(label, r):
        return {
            "label": label,
            "coverage": res.coverage,   # coverage is a property of the frames, shared by both
            "club_len": base.get("club_len"),
            "butt_len": base.get("butt_len"),
            "notes": notes,
            "frames": out_frames,
            "trace": r.trace,
            "trace_frames": r.trace_frames,
        }

    doc["club"]["variants"][KEY] = _variant(
        "ROI cascade: predicted-crop re-detection over trajectory-gated head", res)
    doc["club"]["variants"][KEY_MOVING] = _variant(
        "ROI cascade + trace: moving average", res_mov)
    # tmp + replace so a crash mid-write can never leave a truncated analysis.json behind.
    tmp = out_dir / "analysis.json.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, p)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--device", default=None,
                    help="ultralytics device (default: cuda when available)")
    ap.add_argument("--imgsz", type=int, default=640)
    args = ap.parse_args()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings under out/")
    print(f"ROI cascade -> '{KEY}' + '{KEY_MOVING}' on {len(dirs)} swing(s)"
          f"{'  (dry run)' if args.dry_run else ''}")
    # One model shared across dirs, loaded only when some dir actually has crops to run.
    model_state = {"model": None, "device": None}
    for d in dirs:
        cascade_one(d, model_state, args.device, args.imgsz, args.dry_run)


if __name__ == "__main__":
    main()
