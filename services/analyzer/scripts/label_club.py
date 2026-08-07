"""Hand-label the club head on genuine source observations (test plan §7).

Steps through the ORIGINAL upload's real camera observations (from the D54
source_timing.json sidecar) inside the address->impact window and records truth into
fixtures/labels/<stem>.club.json. Labels attach to SOURCE frames, so they survive any
future re-normalize.

Controls (labeling window):
    left click        visible club head (point)
    left click + drag blur streak (start -> end of the intra-frame trajectory)
    u                 unobservable (camera did not record the head)
    n / p             next / previous observation (n on an unlabeled frame skips it)
    x                 clear this frame's label
    s                 save    q  save + quit    Esc  quit without saving the tail

Modes:
    label_club.py out/<stem>              label club-head positions
    label_club.py out/<stem> --events     record address/top/impact interval labels
    label_club.py --validate <file>       validate a labels file, print coverage (no GUI)
    label_club.py --selftest              hermetic round-trip check (no GUI, CI-safe)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage.club_tracking.ground_truth import (AudioLabel, ClubLabel,  # noqa: E402
                                                  EventLabel, GroundTruth,
                                                  labels_path)

WINDOW = "SwingSage club labeler"
PAD_OBS = 10  # observations shown before address / after impact


# --------------------------------------------------------------------------- selftest


def selftest() -> int:
    import tempfile
    gt = GroundTruth(stem="selftest", view="dtl", handedness="right",
                     labeler="selftest")
    gt.upsert(ClubLabel(source_frame=10, source_pts_s=0.333, visibility="visible",
                        point=(0.712, 0.431)))
    gt.upsert(ClubLabel(source_frame=11, source_pts_s=0.366,
                        visibility="blur_streak",
                        trajectory=(0.701, 0.444, 0.742, 0.407), confidence=0.8))
    gt.upsert(ClubLabel(source_frame=12, source_pts_s=0.400,
                        visibility="unobservable"))
    gt.events.append(EventLabel(event="impact", kind="frame_interval",
                                frame_lo=11, frame_hi=12))
    gt.events.append(EventLabel(event="top", kind="fractional", time_s=1.95))
    gt.audio = AudioLabel(transient_time_s=0.401, ambiguity="clean")
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "selftest.club.json"
        gt.save(p)
        back = GroundTruth.load(p)
    assert back.to_dict() == gt.to_dict(), "round-trip mismatch"
    # upsert replaces, never duplicates
    gt.upsert(ClubLabel(source_frame=10, source_pts_s=0.333,
                        visibility="unobservable"))
    assert len([x for x in gt.club if x.source_frame == 10]) == 1
    assert gt.get(10).visibility == "unobservable"
    print("selftest: round-trip + upsert OK")
    return 0


def validate_file(path: Path) -> int:
    try:
        gt = GroundTruth.load(path)
    except Exception as e:  # noqa: BLE001 — any parse/validation failure is the answer
        print(f"INVALID: {e}")
        return 1
    by_vis = {v: sum(1 for lb in gt.club if lb.visibility == v)
              for v in ("visible", "blur_streak", "unobservable")}
    print(f"{path.name}: {len(gt.club)} club labels "
          f"({by_vis['visible']} visible, {by_vis['blur_streak']} streaks, "
          f"{by_vis['unobservable']} unobservable), "
          f"{len(gt.events)} event labels, audio="
          + ("yes" if gt.audio else "no"))
    return 0


# --------------------------------------------------------------------------- GUI


def run_gui(out_dir: Path, events_mode: bool) -> int:
    import cv2

    doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    timing_p = out_dir / "source_timing.json"
    if not timing_p.exists():
        print("no source_timing.json — run scripts/retiming.py first (D54)")
        return 1
    timing = json.loads(timing_p.read_text(encoding="utf-8"))
    src = Path(doc["video"]["source"]["path"])
    if not src.is_file():
        print(f"source missing: {src}")
        return 1

    stem = out_dir.name
    fps = doc["video"]["fps"]
    obs = timing["observations"]

    # address->impact window in normalized frames -> the source observations showing it.
    ev = doc.get("events", {})
    if "address" not in ev or "impact" not in ev:
        print("analysis.json lacks address/impact events")
        return 1
    n_lo, n_hi = ev["address"]["frame"], ev["impact"]["frame"]

    def shows(o, lo, hi):
        return any(lo <= n <= hi for n in o["normalized_frames"])

    idxs = [i for i, o in enumerate(obs) if shows(o, n_lo, n_hi)]
    if not idxs:
        print("no source observations inside the address->impact window")
        return 1
    lo = max(0, idxs[0] - PAD_OBS)
    hi = min(len(obs) - 1, idxs[-1] + PAD_OBS)
    todo = obs[lo:hi + 1]
    frames_wanted = {o["source_frame"] for o in todo}

    # Sequential decode (VFR sources make index seeks unreliable); cache only the window.
    cache: dict[int, "cv2.Mat"] = {}
    cap = cv2.VideoCapture(str(src))
    rot = doc["video"]["source"].get("rotation", 0) or 0
    f = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if f in frames_wanted:
            if rot:
                k = {90: cv2.ROTATE_90_COUNTERCLOCKWISE, -90: cv2.ROTATE_90_CLOCKWISE,
                     270: cv2.ROTATE_90_CLOCKWISE, -270: cv2.ROTATE_90_COUNTERCLOCKWISE,
                     180: cv2.ROTATE_180, -180: cv2.ROTATE_180}.get(rot % 360 if rot > 0 else rot)
                if k is not None:
                    img = cv2.rotate(img, k)
            cache[f] = img
        f += 1
        if f > max(frames_wanted):
            break
    cap.release()
    print(f"decoded {len(cache)}/{len(todo)} window frames from {src.name}")

    lp = labels_path(stem)
    gt = (GroundTruth.load(lp) if lp.exists()
          else GroundTruth(stem=stem, view=doc["video"]["view"],
                           handedness=doc["video"]["handedness"]))

    if events_mode:
        return run_event_labeling(gt, lp, todo, cache, ev, fps)

    # ---- club labeling loop ----
    i = 0
    drag: list | None = None

    def redraw():
        o = todo[i]
        img = cache.get(o["source_frame"])
        if img is None:
            return None
        disp = img.copy()
        h, w = disp.shape[:2]
        scale = min(1.0, 1400 / w, 900 / h)
        disp = cv2.resize(disp, (int(w * scale), int(h * scale)))
        lb = gt.get(o["source_frame"])
        color = (0, 255, 0)
        if lb and lb.visibility == "visible":
            x, y = lb.point
            cv2.drawMarker(disp, (int(x * disp.shape[1]), int(y * disp.shape[0])),
                           color, cv2.MARKER_CROSS, 24, 2)
        elif lb and lb.visibility == "blur_streak":
            x0, y0, x1, y1 = lb.trajectory
            cv2.arrowedLine(disp, (int(x0 * disp.shape[1]), int(y0 * disp.shape[0])),
                            (int(x1 * disp.shape[1]), int(y1 * disp.shape[0])),
                            color, 2)
        status = lb.visibility if lb else "UNLABELED"
        n_labeled = len(gt.club)
        cv2.putText(disp, f"src {o['source_frame']} pts {o['source_pts_s']:.3f}s "
                          f"[{i + 1}/{len(todo)}] {status} · {n_labeled} labeled",
                    (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        return disp

    def on_mouse(event, x, y, flags, param):
        nonlocal drag
        o = todo[i]
        img = cache.get(o["source_frame"])
        if img is None:
            return
        disp_shown = param["disp"]
        nx, ny = x / disp_shown.shape[1], y / disp_shown.shape[0]
        nx, ny = min(max(nx, 0.0), 1.0), min(max(ny, 0.0), 1.0)
        if event == cv2.EVENT_LBUTTONDOWN:
            drag = [nx, ny]
        elif event == cv2.EVENT_LBUTTONUP and drag is not None:
            dx, dy = nx - drag[0], ny - drag[1]
            if (dx * dx + dy * dy) ** 0.5 < 0.01:
                gt.upsert(ClubLabel(source_frame=o["source_frame"],
                                    source_pts_s=o["source_pts_s"],
                                    visibility="visible", point=(nx, ny)))
            else:
                gt.upsert(ClubLabel(source_frame=o["source_frame"],
                                    source_pts_s=o["source_pts_s"],
                                    visibility="blur_streak",
                                    trajectory=(drag[0], drag[1], nx, ny),
                                    confidence=0.8))
            drag = None
            param["dirty"] = True

    cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)
    param = {"disp": None, "dirty": True}
    cv2.setMouseCallback(WINDOW, on_mouse, param)

    def save():
        gt.labeled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        gt.save(lp)
        print(f"saved {len(gt.club)} labels -> {lp}")

    while True:
        if param["dirty"]:
            disp = redraw()
            if disp is not None:
                param["disp"] = disp
                cv2.imshow(WINDOW, disp)
            param["dirty"] = False
        k = cv2.waitKey(30) & 0xFF
        if k == ord("n"):
            i = min(i + 1, len(todo) - 1); param["dirty"] = True
        elif k == ord("p"):
            i = max(i - 1, 0); param["dirty"] = True
        elif k == ord("u"):
            o = todo[i]
            gt.upsert(ClubLabel(source_frame=o["source_frame"],
                                source_pts_s=o["source_pts_s"],
                                visibility="unobservable"))
            i = min(i + 1, len(todo) - 1); param["dirty"] = True
        elif k == ord("x"):
            o = todo[i]
            gt.club = [x for x in gt.club if x.source_frame != o["source_frame"]]
            param["dirty"] = True
        elif k == ord("s"):
            save()
        elif k == ord("q"):
            save()
            break
        elif k == 27:  # Esc
            break
    cv2.destroyAllWindows()
    return 0


def run_event_labeling(gt, lp, todo, cache, ev, fps) -> int:
    """Interval labels for address/top/impact: mark lo with [ and hi with ] per event."""
    import cv2
    order = ["address", "top", "impact"]
    which = 0
    # start near the detector's opinion of the current event
    def nearest_idx(nframe):
        for j, o in enumerate(todo):
            if any(n >= nframe for n in o["normalized_frames"]):
                return j
        return 0
    i = nearest_idx(ev[order[which]]["frame"])
    marks: dict[str, list[int | None]] = {e: [None, None] for e in order}
    for e in gt.events:
        if e.kind == "frame_interval" and e.event in marks:
            marks[e.event] = [e.frame_lo, e.frame_hi]

    print("keys: [ = interval start, ] = interval end, TAB = next event, "
          "n/p = step, s = save, q = save+quit")
    cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)
    while True:
        o = todo[i]
        img = cache.get(o["source_frame"])
        if img is not None:
            disp = img.copy()
            h, w = disp.shape[:2]
            scale = min(1.0, 1400 / w, 900 / h)
            disp = cv2.resize(disp, (int(w * scale), int(h * scale)))
            m = marks[order[which]]
            cv2.putText(disp, f"{order[which].upper()} src {o['source_frame']} "
                              f"pts {o['source_pts_s']:.3f}s interval={m}",
                        (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            cv2.imshow(WINDOW, disp)
        k = cv2.waitKey(30) & 0xFF
        if k == ord("n"):
            i = min(i + 1, len(todo) - 1)
        elif k == ord("p"):
            i = max(i - 1, 0)
        elif k == ord("["):
            marks[order[which]][0] = o["source_frame"]
        elif k == ord("]"):
            marks[order[which]][1] = o["source_frame"]
        elif k == 9:  # TAB
            which = (which + 1) % len(order)
            i = nearest_idx(ev[order[which]]["frame"])
        elif k in (ord("s"), ord("q")):
            gt.events = [e for e in gt.events
                         if not (e.kind == "frame_interval" and e.event in marks)]
            for name, (a, b) in marks.items():
                if a is not None and b is not None:
                    gt.events.append(EventLabel(event=name, kind="frame_interval",
                                                frame_lo=min(a, b), frame_hi=max(a, b)))
            gt.labeled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            gt.save(lp)
            print(f"saved {len(gt.events)} event labels -> {lp}")
            if k == ord("q"):
                break
        elif k == 27:
            break
    cv2.destroyAllWindows()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dir", nargs="?", type=Path,
                    help="out/<stem> directory (needs analysis.json + source_timing.json)")
    ap.add_argument("--events", action="store_true",
                    help="label address/top/impact intervals instead of club positions")
    ap.add_argument("--validate", type=Path, metavar="FILE",
                    help="validate a labels file and print coverage (no GUI)")
    ap.add_argument("--selftest", action="store_true",
                    help="hermetic round-trip check (no GUI)")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if args.validate:
        return validate_file(args.validate)
    if not args.out_dir:
        ap.error("out_dir required (or --validate/--selftest)")
    return run_gui(args.out_dir.resolve(), args.events)


if __name__ == "__main__":
    raise SystemExit(main())
