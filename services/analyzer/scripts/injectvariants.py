"""Inject post-hoc club-solution variants into already-analysed swings.

Two new solution families, computed entirely FROM the stored analysis.json — no video
decode, no pipeline re-run — following addvariant.py's non-destructive contract: rebuild
what the swingsage functions need from the stored artifact, compute, patch only this
script's own keys back in.

  model_shaft_first     Track the shaft, not the head. The detector's `stick` class is its
                        strong class (mAP50 0.976 vs the head's 0.686), so every raw stick
                        box defines a ray from the golfer's grip through the box centre and
                        the head is placed one calibrated club length along it. Frames with
                        no stick fall back to that frame's raw HEAD detection; remaining
                        gaps are filled in polar space around the grip, the same fill
                        swingsage/clubpath.py uses (an estimate must never pass for a
                        detection, so fills are marked interp).
  model_viterbi_loose   swingsage.clubpath.viterbi_refine with keep-friendlier knobs
                        (skip_cost=2.0, min_conf=0.05): pricier skips and a lower floor
                        keep more candidates on the path than the shipped build.

Each family also gets a `_moving` trace twin (trace_smooth="moving", trace_min_conf=0.0),
rebuilt exactly the way scripts/addvariant.py rebuilds one.

Usage:
    .venv/Scripts/python.exe scripts/injectvariants.py                # every out/<stem>/
    .venv/Scripts/python.exe scripts/injectvariants.py out/pro_2
    .venv/Scripts/python.exe scripts/injectvariants.py --dry-run

Idempotent: re-running overwrites only this script's four keys and touches nothing else.
A swing whose computation fails is skipped with a printed reason — a failed solve must
never overwrite a stored artifact.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import club, club_detect, clubpath  # noqa: E402

# >= on every gate, matching the analyzer: artifact confidences are TRUNCATED, so a >
# comparison would drop a detection the pipeline itself kept at exactly the threshold.
HEAD_MIN_CONF = 0.15    # fallback head detections below this are noise, not a club head
WRIST_MIN_CONF = 0.2    # same floor club.py's _kp uses for pose joints
FILL_CONF = 0.25        # clubpath's ceiling for polar-filled frames

BASE_KEY = "model_traj_raw"
KEY_SHAFT = "model_shaft_first"
KEY_VITERBI = "model_viterbi_loose"
OWN_KEYS = (KEY_SHAFT, KEY_SHAFT + "_moving", KEY_VITERBI, KEY_VITERBI + "_moving")


def _grips_px(doc) -> list:
    """Per-frame grip in PIXELS — wrist midpoint — or None where either wrist is unsure.

    Wrists are looked up by NAME through pose.keypoint_names: a literal index reads the
    wrong joint the day the keypoint order grows, and does it silently.
    """
    names = doc["pose"]["keypoint_names"]
    li, ri = names.index("left_wrist"), names.index("right_wrist")
    w, h = doc["video"]["width"], doc["video"]["height"]
    n = doc["video"]["frame_count"]
    grips: list = [None] * n
    for fr in doc["pose"]["frames"]:
        f = fr.get("f")
        if not isinstance(f, int) or not (0 <= f < n):
            continue
        lw, rw = fr["kp"][li], fr["kp"][ri]
        if lw[2] >= WRIST_MIN_CONF and rw[2] >= WRIST_MIN_CONF:
            grips[f] = np.array([(lw[0] + rw[0]) / 2 * w, (lw[1] + rw[1]) / 2 * h])
    return grips


def _detector_from_doc(doc) -> club_detect.DetectorResult | None:
    """A DetectorResult over the stored raw boxes, xy denormalized to PIXELS.

    clubpath scores candidates in pixel space against grip_px, so handing it the
    artifact's normalized coordinates would shrink every radius below the plausibility
    gate and reject the entire swing.

    Newer artifacts store the box list under `detector.boxes` (`detector.frames` is a
    frame COUNT there); older ones store it under `frames`. Checked by type rather than
    schema version so a count is never iterated as a list.
    """
    det_doc = (doc.get("club") or {}).get("detector") or {}
    raw = det_doc.get("boxes")
    if not isinstance(raw, list):
        raw = det_doc.get("frames")
    if not isinstance(raw, list):
        return None
    w, h = doc["video"]["width"], doc["video"]["height"]
    n = doc["video"]["frame_count"]
    per_frame: list = [[] for _ in range(n)]
    for e in raw:
        f = e.get("f")
        if not isinstance(f, int) or not (0 <= f < n):
            continue
        for d in e.get("d") or []:
            per_frame[f].append(club_detect.Detection(
                f=f, xy=(d["xy"][0] * w, d["xy"][1] * h), conf=float(d["p"]),
                cls=int(d["c"]), wh=(d["wh"][0] * w, d["wh"][1] * h)))
    return club_detect.DetectorResult(per_frame=per_frame)


def _result_from_variant(var: dict, doc: dict, grips: list) -> club.ClubResult:
    """addvariant's rebuild, plus what clubpath needs and the stored frames lack:
    width/height, per-frame grip_px and per-frame pixel length.

    Frames are indexed by their own `f`, never by list position — a sparse stored list
    would otherwise shift every lookup by one and nothing downstream would notice.
    """
    n = doc["video"]["frame_count"]
    w, h = doc["video"]["width"], doc["video"]["height"]
    frames = [club.ClubFrame(f=i) for i in range(n)]
    for c in var.get("frames") or []:
        f = c["f"]
        if not (0 <= f < n):
            continue
        fr = frames[f]
        fr.shaft, fr.head, fr.butt = c.get("shaft"), c.get("head"), c.get("butt")
        fr.conf = c.get("conf", 0.0)
        fr.interp = c.get("interp", False)
        fr.from_model = c.get("from_model", False)
        fr.from_ball = c.get("from_ball", False)
        fr.grip_px = grips[f]
        if fr.head is not None and not any(np.isnan(fr.head)) and grips[f] is not None:
            v = np.array([fr.head[0] * w, fr.head[1] * h]) - grips[f]
            fr.length = float(np.hypot(v[0], v[1]))
    res = club.ClubResult(
        frames=frames,
        club_len=var.get("club_len") or 0.0,
        butt_len=var.get("butt_len") or 0.0,
    )
    res.width, res.height = w, h
    res.notes = list(var.get("notes") or [])
    return res


def _club_px(base_var: dict, doc: dict, grips: list) -> tuple[float | None, str]:
    """(calibrated club length in px, provenance note).

    The artifact stores no per-frame length, so it is re-measured: median |head - grip|
    over the base solve's from_model frames — measured heads only, because an interpolated
    head's radius is itself an estimate and would calibrate the ray against a guess.
    Falls back to club.club_len * video.height when no measured frame has a grip.
    """
    w, h = doc["video"]["width"], doc["video"]["height"]
    lens = []
    for c in base_var.get("frames") or []:
        if not c.get("from_model") or not c.get("head"):
            continue
        f = c["f"]
        gp = grips[f] if 0 <= f < len(grips) else None
        if gp is None:
            continue
        v = np.array([c["head"][0] * w, c["head"][1] * h]) - gp
        lens.append(float(np.hypot(v[0], v[1])))
    if lens:
        px = float(np.median(lens))
        return px, (f"club_px {px:.0f}px = median |head-grip| over {len(lens)} "
                    f"from_model frames of {BASE_KEY}")
    cl = (doc.get("club") or {}).get("club_len")
    if cl:
        px = float(cl) * h
        return px, (f"club_px {px:.0f}px = club.club_len * video.height "
                    "(no from_model frame had a grip to measure against)")
    return None, "no measurable from_model frames and no club.club_len"


def _shaft_first(base_var: dict, doc: dict, det, grips: list, club_px: float,
                 src_note: str):
    """(ClubResult, None) or (None, reason) — the shaft-first solve over the swing window."""
    res = _result_from_variant(base_var, doc, grips)
    w, h = res.width, res.height
    e = doc["events"]
    n = doc["video"]["frame_count"]
    a_f, fin_f = e["address"]["frame"], min(n - 1, e["finish"]["frame"])

    placed: dict[int, tuple[np.ndarray, float]] = {}
    n_stick = n_head = 0
    for f in range(a_f, fin_f + 1):
        gp = grips[f]
        if gp is None:
            continue
        sticks = det.sticks(f)
        if sticks:
            s = max(sticks, key=lambda d: d.conf)
            v = np.asarray(s.xy, dtype=float) - gp
            r = float(np.hypot(v[0], v[1]))
            # A stick centred on the grip gives no direction — the ray would be a
            # divide-by-zero dressed as a measurement.
            if r > 1e-6:
                placed[f] = (gp + v / r * club_px, float(s.conf))
                n_stick += 1
                continue
        heads = [d for d in det.heads(f) if d.conf >= HEAD_MIN_CONF]
        if heads:
            d = max(heads, key=lambda x: x.conf)
            placed[f] = (np.asarray(d.xy, dtype=float), float(d.conf))
            n_head += 1

    # Below this the polar fill is drawing the swing, not bridging it.
    if len(placed) < 4:
        return None, f"only {len(placed)} placeable frames in the window"

    # Polar series around each placed frame's OWN grip (clubpath's fill): angles are
    # unwrapped so a fill across the top does not take the short way around the circle.
    order = sorted(placed)
    ths, rs = [], []
    for f in order:
        v = placed[f][0] - grips[f]
        ths.append(np.arctan2(v[1], v[0]))
        rs.append(np.hypot(v[0], v[1]))
    ths = np.unwrap(np.array(ths, dtype=float))
    rs = np.array(rs, dtype=float)
    fs = np.array(order, dtype=float)

    n_fill = 0
    for f in range(a_f, fin_f + 1):
        fr = res.frames[f]
        if f in placed:
            p, conf = placed[f]
            fr.head = [float(p[0] / w), float(p[1] / h)]
            fr.conf = conf
            fr.from_model = True
            fr.interp = False
            fr.from_ball = False
            v = p - grips[f]
            fr.length = float(np.hypot(v[0], v[1]))
            fr.angle = float(np.degrees(np.arctan2(v[1], v[0])))
            if fr.butt:
                fr.shaft = [fr.butt, fr.head]
            continue
        # No grip, or outside the measured span: the base solve's frame stands — placing
        # a head with nothing to anchor it to would fabricate geometry.
        if grips[f] is None or f < order[0] or f > order[-1]:
            continue
        th_i = float(np.interp(f, fs, ths))
        r_i = float(np.interp(f, fs, rs))
        p = grips[f] + np.array([np.cos(th_i), np.sin(th_i)]) * r_i
        fr.head = [float(p[0] / w), float(p[1] / h)]
        fr.conf = FILL_CONF
        fr.from_model = False
        fr.interp = True
        fr.from_ball = False
        fr.length = r_i
        fr.angle = float(np.degrees(th_i))
        if fr.butt:
            fr.shaft = [fr.butt, fr.head]
        n_fill += 1

    res.notes = [
        f"shaft-first: {n_stick} heads placed one club length along the grip->stick ray, "
        f"{n_head} from raw head boxes (conf >= {HEAD_MIN_CONF}), {n_fill} gap frames "
        f"filled in polar space; frames outside address..finish are {BASE_KEY}'s",
        src_note,
    ]
    cfg = club.ClubConfig()
    club._build_trace(res, {"events": e}, n, cfg)
    # Default trace_smooth is "none" so this is a no-op today; kept to match the pipeline
    # tail so a changed default cannot leave injected variants on a different polyline rule.
    club.smooth_trace(res, {"events": e}, n, cfg)
    return res, None


def _viterbi_loose(base_var: dict, doc: dict, det, grips: list):
    """(ClubResult, None) or (None, reason) — viterbi_refine with keep-friendlier knobs."""
    base = _result_from_variant(base_var, doc, grips)
    n = doc["video"]["frame_count"]
    n_base_notes = len(base.notes)
    res = clubpath.viterbi_refine(base, det, {"events": doc["events"]}, n,
                                  club.ClubConfig(), skip_cost=2.0, min_conf=0.05)
    added = res.notes[n_base_notes:]
    # "left unchanged" means the refine declined — writing it would store the base solve
    # under a name claiming a different computation.
    if any("left unchanged" in nt for nt in added):
        return None, "; ".join(added) or "viterbi declined"
    res.notes.append("loose knobs: skip_cost=2.0, min_conf=0.05")
    return res, None


def _frames_json(res: club.ClubResult) -> list:
    # Rounding matches pipeline.py's variant writer exactly (coords 5, conf 3) so injected
    # entries are byte-compatible with built ones.
    return [{"f": c.f,
             "shaft": ([[round(float(x), 5) for x in p] for p in c.shaft]
                       if c.shaft else None),
             "head": [round(float(x), 5) for x in c.head] if c.head else None,
             "butt": [round(float(x), 5) for x in c.butt] if c.butt else None,
             "conf": round(float(c.conf), 3),
             "interp": bool(c.interp),
             "from_model": bool(c.from_model),
             "from_ball": bool(c.from_ball)}
            for c in res.frames]


def _variant_json(res: club.ClubResult, label: str) -> dict:
    return {
        "label": label,
        "coverage": res.coverage,
        "club_len": round(float(res.club_len), 5),
        "butt_len": round(float(res.butt_len), 5),
        "notes": res.notes,
        "frames": _frames_json(res),
        "trace": res.trace,
        "trace_frames": res.trace_frames,
    }


def _moving_twin(res: club.ClubResult, parent_json: dict, doc: dict, label: str) -> dict:
    """The trace twin, rebuilt the way addvariant.py rebuilds one: same frames, same
    coverage — only the polyline differs. Runs on a deepcopy so the parent's stored trace
    is not the smoothed one."""
    r2 = copy.deepcopy(res)
    cfg = replace(club.ClubConfig(), trace_smooth="moving", trace_min_conf=0.0)
    club.smooth_trace(r2, {"events": doc["events"]}, doc["video"]["frame_count"], cfg)
    return {
        "label": label,
        "coverage": parent_json["coverage"],
        "club_len": parent_json["club_len"],
        "butt_len": parent_json["butt_len"],
        "notes": parent_json["notes"],
        "frames": parent_json["frames"],
        "trace": r2.trace,
        "trace_frames": r2.trace_frames,
    }


def _cov_str(cov: dict) -> str:
    return (f"back {cov.get('backswing', 0) * 100:3.0f}% / "
            f"down {cov.get('downswing', 0) * 100:3.0f}% / "
            f"through {cov.get('followthrough', 0) * 100:3.0f}%")


def inject_one(out_dir: Path, dry_run: bool = False) -> bool:
    p = out_dir / "analysis.json"
    if not p.exists():
        print(f"  {out_dir.name}: no analysis.json — skipped")
        return False
    doc = json.loads(p.read_text(encoding="utf-8"))

    ev = doc.get("events") or {}
    missing = [k for k in ("address", "top", "impact", "finish")
               if not isinstance((ev.get(k) or {}).get("frame"), int)]
    if missing:
        print(f"  {out_dir.name}: no {'/'.join(missing)} event — skipped")
        return False
    variants = ((doc.get("club") or {}).get("variants") or {})
    if BASE_KEY not in variants:
        print(f"  {out_dir.name}: no '{BASE_KEY}' variant — skipped "
              "(needs a --club-detector run)")
        return False

    # Nothing below may write on failure: a half-computed solve stored under a real key is
    # worse than the key being absent, so any exception skips the whole swing.
    try:
        det = _detector_from_doc(doc)
        if det is None:
            print(f"  {out_dir.name}: no raw detector boxes stored — skipped")
            return False
        grips = _grips_px(doc)
        base_var = variants[BASE_KEY]
        club_px, src_note = _club_px(base_var, doc, grips)
        if club_px is None or club_px <= 0:
            print(f"  {out_dir.name}: cannot calibrate club length ({src_note}) — skipped")
            return False

        new_entries: dict[str, dict] = {}

        res, err = _shaft_first(base_var, doc, det, grips, club_px, src_note)
        if err:
            print(f"  {out_dir.name}: {KEY_SHAFT} failed ({err}) — not written")
        else:
            vj = _variant_json(
                res, "Shaft-first: head one club length along the grip->stick ray")
            new_entries[KEY_SHAFT] = vj
            new_entries[KEY_SHAFT + "_moving"] = _moving_twin(
                res, vj, doc, "Shaft-first + trace: moving average")
            print(f"  {out_dir.name}: {KEY_SHAFT:<24} {_cov_str(res.coverage)}")

        res, err = _viterbi_loose(base_var, doc, det, grips)
        if err:
            print(f"  {out_dir.name}: {KEY_VITERBI} failed ({err}) — not written")
        else:
            vj = _variant_json(
                res, "Viterbi (loose): global path, skip_cost=2.0 min_conf=0.05")
            new_entries[KEY_VITERBI] = vj
            new_entries[KEY_VITERBI + "_moving"] = _moving_twin(
                res, vj, doc, "Viterbi (loose) + trace: moving average")
            print(f"  {out_dir.name}: {KEY_VITERBI:<24} {_cov_str(res.coverage)}")

        if not new_entries:
            print(f"  {out_dir.name}: nothing computed — artifact untouched")
            return False
        if dry_run:
            return True

        # Only this script's own keys are (over)written; every other variant and every
        # other byte of the artifact stays as stored.
        doc["club"]["variants"].update(new_entries)
        tmp = out_dir / "analysis.json.tmp"
        tmp.write_text(json.dumps(doc), encoding="utf-8")
        os.replace(tmp, p)
        return True
    except Exception as exc:  # noqa: BLE001 — the skip contract above
        print(f"  {out_dir.name}: {type(exc).__name__}: {exc} — skipped, artifact untouched")
        return False


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings under out/")
    print(f"injecting {', '.join(OWN_KEYS)} into {len(dirs)} swing(s)"
          f"{'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        inject_one(d, args.dry_run)


if __name__ == "__main__":
    main()
