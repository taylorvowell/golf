"""Gate 1 harness: swing video -> analysis.json + overlay.mp4 + contact sheet.

No web app, no database, no AI. This exists to answer one question in isolation — is the
pose correct? — before any browser code can confuse pose error with frame-sync error.

    python scripts/burnin.py <video> [--out DIR] [--no-retry]

Outputs into DIR (default: out/<video stem>/):
    normalized.mp4   CFR 60, rotation baked, short side 1080  (player + burn-in source)
    analysis.mp4     CFR 60, short side 720                   (what the CV consumed)
    analysis.json    pose portion of the doc 02 contract
    overlay.mp4      skeleton burned into pixels              <- watch this at 0.25x
    contact.jpg      24-frame grid of the whole swing
"""
from __future__ import annotations

import argparse
import copy as copy0
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingsage import club, events, pose, pose_rtm, postprocess, render, video  # noqa: E402
from swingsage.skeleton import KEYPOINT_NAMES  # noqa: E402

SCHEMA_VERSION = 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default=None)
    ap.add_argument("--view", default="dtl", choices=["dtl", "face_on"])
    ap.add_argument("--handedness", default="right", choices=["right", "left"])
    ap.add_argument("--no-retry", action="store_true",
                    help="skip the IMAGE-mode re-detection pass over dropout spans")
    # ROI cropping was removed from this pipeline — it measurably hurt on both fixtures
    # (docs/DECISIONS.md D5). video.crop_scale / pose.swing_bbox remain if it needs redoing.
    ap.add_argument("--analysis-short-side", type=int, default=720,
                    help="resolution the CV pipeline consumes")
    ap.add_argument("--no-stage3", action="store_true",
                    help="skip post-processing (raw Stage 2 baseline for A/B)")
    ap.add_argument("--pose-model", choices=["mediapipe", "rtmpose"], default="rtmpose",
                    help="landmark model; rtmpose is markedly better on occluded limbs")
    ap.add_argument("--rtm-mode", choices=["performance", "balanced"], default="performance")
    ap.add_argument("--no-club", action="store_true", help="skip Stage 4 club tracking")
    args = ap.parse_args()

    src = Path(args.video).resolve()
    if not src.exists():
        print(f"no such video: {src}")
        return 1
    out = Path(args.out).resolve() if args.out else Path("out") / src.stem
    out.mkdir(parents=True, exist_ok=True)

    t_all = time.time()

    # --- Stage 0: probe + normalize -------------------------------------------------
    src_info = video.probe(src)
    print(f"source     {src_info.width}x{src_info.height} {src_info.codec} "
          f"rot={src_info.rotation} fps={src_info.fps:.3f} "
          f"(nominal {src_info.nominal_fps:.3f}) frames={src_info.frame_count} "
          f"{'VFR' if src_info.is_vfr else 'CFR'}")
    if src_info.is_vfr:
        print("           -> VFR detected; CFR normalization is mandatory for frame sync")

    t = time.time()
    norm = video.normalize(src, out / "normalized.mp4", short_side=1080, fps=60)
    anal = video.normalize(src, out / "analysis.mp4",
                           short_side=args.analysis_short_side, fps=60)
    print(f"normalized {norm.width}x{norm.height} @ {norm.fps:.3f} "
          f"frames={norm.frame_count} | analysis {anal.width}x{anal.height} "
          f"({time.time() - t:.1f}s)")

    # --- Stage 2: pose --------------------------------------------------------------
    def prog(done, total):
        print(f"\r  pose {done}/{total or '?'}", end="", flush=True)

    def snapshot(s):
        """Quality of a series without disturbing it (finalize mutates)."""
        return pose.quality(pose.finalize(pose.RawPoseSeries(
            model=s.model, frames=copy0.deepcopy(s.frames), detected=list(s.detected))))

    # MediaPipe always runs. It is the fallback estimator, and when RTMPose is selected it
    # is also the person localiser that supplies RTMPose's per-frame box (see pose_rtm.py).
    t = time.time()
    mp_series = pose.estimate(anal.path, progress=prog)
    print(f"\r  mediapipe          {len(mp_series.frames)} frames in {time.time() - t:.1f}s")
    if not args.no_retry:
        fixed = pose.retry_gaps(anal.path, mp_series)
        if fixed:
            print(f"  retry recovered {fixed} frames via IMAGE-mode re-detection")
    quality_mp = snapshot(mp_series)

    if args.pose_model == "rtmpose":
        boxes = pose_rtm.bboxes_from_series(mp_series)
        t = time.time()
        series = pose_rtm.estimate(anal.path, boxes, mode=args.rtm_mode, progress=prog)
        dt = max(time.time() - t, 1e-6)
        print(f"\r  rtmpose            {len(series.frames)} frames in {dt:.1f}s "
              f"({len(series.frames) / dt:.1f} fps)")
        n = min(len(mp_series.frames), len(series.frames))
        series.frames = series.frames[:n]
        series.detected = series.detected[:n]
    else:
        series = mp_series

    # --- Stage 3: post-processing (doc 03 §3) ---------------------------------------
    # Raw quality of the *chosen* model, so the table below isolates Stage 3's effect.
    before = snapshot(series)

    rep = None
    if not args.no_stage3:
        # A rough swing window from the raw pose gates the grip prior; the definitive
        # events are detected afterwards on the cleaned series.
        pose.finalize(pose.RawPoseSeries(model=series.model, frames=series.frames,
                                         detected=series.detected))
        try:
            _pre, pre_sg = events.detect(series.frames, args.handedness, norm.fps)
            window = tuple(_pre["swing_window"])
        except Exception:
            window = None
        for fr in series.frames:                      # undo provisional derived joints
            del fr["kp"][len(pose.NATIVE_NAMES):]
        t = time.time()
        series, rep = postprocess.postprocess(series, window=window)
        print(f"stage3     side-swaps {rep.swaps}, bone rejects {rep.bone_rejects}, "
              f"grip rejects {rep.grip_rejects}, outliers {rep.outlier_rejects}, "
              f"promoted {rep.promoted}, interpolated {rep.interpolated} "
              f"({time.time() - t:.1f}s)")
        for n in rep.notes:
            print(f"           ! {n}")

    pose.finalize(series)
    q = pose.quality(series)

    # --- Stage 5: swing events (doc 05 A) -------------------------------------------
    t = time.time()
    ev, sg = events.detect(series.frames, args.handedness, norm.fps)
    print(f"events     " + "  ".join(
        f"{k.split('_')[0][:3].upper()}{'' if k.count('_') < 1 else k.split('_')[-1][:1].upper()}"
        f"={v['frame']}" for k, v in ev["events"].items()))
    if ev["tempo"]:
        print(f"           tempo {ev['tempo']['ratio']}:1  "
              f"(backswing {ev['tempo']['backswing_ms']}ms / "
              f"downswing {ev['tempo']['downswing_ms']}ms)  "
              f"window {ev['swing_window'][0]}-{ev['swing_window'][1]}  ({time.time()-t:.1f}s)")
    for n_ in ev["notes"]:
        print(f"           ! {n_}")

    # --- Stage 4: club tracking (doc 04) --------------------------------------------
    cl = None
    if not args.no_club:
        t = time.time()
        cl = club.track(anal.path, series.frames, ev, args.handedness, progress=prog)
        cov = cl.coverage
        print(f"\r  club       coverage back {cov.get('backswing', 0) * 100:.0f}% / "
              f"down {cov.get('downswing', 0) * 100:.0f}% / "
              f"through {cov.get('followthrough', 0) * 100:.0f}%  "
              f"club_len {cl.club_len:.3f}  ({time.time() - t:.1f}s)")
        for n_ in cl.notes:
            print(f"           ! {n_}")
        # Doc 02 quality gate: below 50% across the swing the trace is disabled rather
        # than shown as a fabricated path.
        if cov.get("swing", 0) < 0.5:
            print(f"           ! trace disabled — swing coverage "
                  f"{cov.get('swing', 0) * 100:.0f}% < 50%")

    # --- analysis.json (pose portion of the doc 02 contract) ------------------------
    doc = {
        "schema_version": SCHEMA_VERSION,
        "video": {
            "fps": norm.fps, "frame_count": len(series.frames),
            "width": norm.width, "height": norm.height,
            "view": args.view, "handedness": args.handedness,
            "source": {
                "path": str(src), "width": src_info.width, "height": src_info.height,
                "codec": src_info.codec, "rotation": src_info.rotation,
                "fps": src_info.fps, "is_vfr": src_info.is_vfr,
            },
            "analysis_res": {"width": anal.width, "height": anal.height},
        },
        "pose": {
            "model": series.model,
            "keypoint_names": KEYPOINT_NAMES,
            "frames": [
                {"f": fr["f"],
                 "kp": [[round(x, 5), round(y, 5), round(c, 4)] for x, y, c in fr["kp"]],
                 # st: 0 missing, 1 provisional/unverified, 2 confirmed, 3 interpolated
                 "st": fr.get("st"),
                 "interp": bool(fr.get("interp", False))}
                for fr in series.frames
            ],
        },
        "events": ev["events"],
        "phases": ev["phases"],
        "swing_window": ev["swing_window"],
        "tempo": ev["tempo"],
        "club": ({
            "club_len": round(cl.club_len, 5),
            "coverage": cl.coverage,
            "trace_enabled": cl.coverage.get("swing", 0) >= 0.5,
            "notes": cl.notes,
            "frames": [{"f": c.f,
                        "shaft": ([[round(v, 5) for v in p] for p in c.shaft]
                                  if c.shaft else None),
                        "head": [round(v, 5) for v in c.head] if c.head else None,
                        "conf": round(c.conf, 3),
                        "shaft_angle_deg": round(c.angle, 1) if c.angle is not None else None,
                        "blurred": c.blurred, "interp": c.interp}
                       for c in cl.frames],
            "trace": cl.trace,
        } if cl else None),
        "quality": q,
        "quality_raw": before,
        "quality_mediapipe": quality_mp if args.pose_model == "rtmpose" else None,
        "stage3": ({"body_height_px": round(rep.body_height * anal.height, 1),
                    "side_swaps": rep.swaps, "bone_rejects": rep.bone_rejects,
                    "grip_rejects": rep.grip_rejects, "outlier_rejects": rep.outlier_rejects,
                    "promoted": rep.promoted, "interpolated": rep.interpolated,
                    "notes": rep.notes} if rep else None),
    }
    (out / "analysis.json").write_text(json.dumps(doc), encoding="utf-8")

    # --- Gate 1 renders -------------------------------------------------------------
    t = time.time()
    render.burn_in(norm.path, series.frames, out / "overlay.mp4",
                   detected=series.detected, fps=norm.fps)
    render.contact_sheet(norm.path, series.frames, out / "contact.jpg")
    print(f"rendered   overlay.mp4 + contact.jpg ({time.time() - t:.1f}s)")

    # --- Quality report -------------------------------------------------------------
    print(f"\ndetection coverage {q['detection_coverage'] * 100:.1f}%  "
          f"overall mean conf {q['overall_mean_conf']:.3f}"
          + (f"   (full-frame baseline {before['overall_mean_conf']:.3f})" if before else ""))
    key = ["head_center", "neck", "left_shoulder", "right_shoulder", "left_elbow",
           "right_elbow", "left_wrist", "right_wrist", "grip_center", "mid_hip",
           "left_knee", "right_knee", "left_ankle", "right_ankle",
           "left_foot_index", "right_foot_index"]
    if before:
        rtm = args.pose_model == "rtmpose"
        hdr = f"{'joint':<18}{'final':>9}{'raw':>9}"
        if rtm:
            hdr += f"{'mediapipe':>11}"
        print(hdr + f"{'mean conf':>12}")
        for name in key:
            s, b = q["per_joint"].get(name), before["per_joint"].get(name)
            if not (s and b):
                continue
            row = (f"{name:<18}{s['coverage'] * 100:>8.1f}%{b['coverage'] * 100:>8.1f}%")
            if rtm:
                m = quality_mp["per_joint"].get(name)
                row += f"{(m['coverage'] * 100 if m else 0):>10.1f}%"
            gain = (s["coverage"] - (quality_mp["per_joint"][name]["coverage"]
                                     if rtm and name in quality_mp["per_joint"]
                                     else b["coverage"]))
            mark = "  ++" if gain > 0.15 else ("  +" if gain > 0.03 else
                                               ("  --" if gain < -0.03 else ""))
            print(row + f"{s['mean_conf']:>12.3f}{mark}")
    else:
        print(f"{'joint':<18}{'coverage':>10}{'mean conf':>12}")
        for name in key:
            s = q["per_joint"].get(name)
            if s:
                flag = "  <-- low" if s["coverage"] < 0.9 else ""
                print(f"{name:<18}{s['coverage'] * 100:>9.1f}%{s['mean_conf']:>12.3f}{flag}")

    print(f"\ntotal {time.time() - t_all:.1f}s -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
