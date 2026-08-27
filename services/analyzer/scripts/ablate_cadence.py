"""E2.1 — what does a coarser inference cadence actually cost?

The frame planner (swingsage/planner.py) can measure a swing at any rate. Which rate it
SHOULD measure at is a question about accuracy against cost, and the one thing this project
has learned repeatedly is that a number chosen by opinion and defended by a coverage
percentage is a number nobody has checked. So the default policy is whatever this harness
says survives the gates, and the sheet it prints is the evidence.

    python scripts/ablate_cadence.py --clips 6iron2,swing1 --policies v0-dense,adaptive-v1@60hz
        [--out <dir>] [--burnin-args "--no-club --no-scoring"] [--report <name>]
        [--stage run|report|all]

For each clip, one run per policy into `<out>/<policy>/<clip>/`, then every non-dense policy is
scored against that clip's DENSE run:

  * **body agreement** — per-keypoint displacement in PIXELS of the analysis frame, at the
    eight event frames and across the swing window. This is the quantity everything downstream
    is built from, and unlike a score it needs no club, no labels and no interpretation.
  * **event agreement** — how far each detected event moved, in frames and in milliseconds.
  * **score agreement** — the overall coach score and every category, when scoring ran.
  * **cost** — direct-inference frames, pose-stage seconds, wall seconds.

And, where hand labels exist, each policy is ALSO scored against them
(`groundtruth.evaluate_events`), because "agrees with dense" and "is right" are different
claims and the dense run is not ground truth — on more than one clip in this set it is
measurably wrong.

Reruns are free: a policy/clip whose `analysis.json` already exists is not re-run, so
`--stage report` re-scores a finished sweep without touching the GPU.
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANALYZER = HERE.parent
REPO = ANALYZER.parent.parent
PY = str(ANALYZER / ".venv" / "Scripts" / "python.exe")
WEIGHTS = "runs/clubhead/weights/best.pt"

GOLDEN = ["6iron-1", "6iron2", "6iron3", "7wood-1", "7wood-2",
          "perfect", "pro_2", "pro_3", "swing1", "swing2"]
HIGH_SPEED = ["20260820_095337-2", "20260821_104719", "20260821_105528", "20260821_111217"]

DENSE = "v0-dense"


def clip_path(stem: str) -> Path:
    for cand in (REPO / "fixtures" / f"{stem}.mp4",
                 REPO / "fixtures" / "session-today" / f"{stem}.mp4"):
        if cand.exists():
            return cand
    raise SystemExit(f"no such clip: {stem}")


def run_one(stem: str, policy: str, out_dir: Path, extra: list[str]) -> dict:
    """One burn-in at one policy. Always passes --club-detector: omitting it silently
    regenerates the trace on the weaker classical path, which would make the comparison a
    comparison of two different pipelines."""
    if (out_dir / "analysis.json").exists():
        return {"ok": True, "cached": True, "seconds": None}
    cmd = [PY, "scripts/burnin.py", str(clip_path(stem)),
           "--club-detector", WEIGHTS, "--frame-policy", policy,
           "--out", str(out_dir), *extra]
    t = time.time()
    p = subprocess.run(cmd, cwd=str(ANALYZER), capture_output=True, text=True)
    dt = time.time() - t
    ok = p.returncode == 0 and (out_dir / "analysis.json").exists()
    return {"ok": ok, "cached": False, "seconds": round(dt, 1), "rc": p.returncode,
            "stderr": (p.stderr or "")[-800:] if not ok else "",
            "stage_seconds": _stage_seconds(p.stdout or "")}


def _stage_seconds(stdout: str) -> dict:
    """Pose-stage wall time, scraped from the lines the pipeline already prints.

    Scraped rather than instrumented because the alternative is threading a telemetry sink
    through a subprocess boundary for a number the stdout protocol already carries.
    """
    out: dict = {}
    for line in stdout.replace("\r", "\n").splitlines():
        s = line.strip()
        for key, marker in (("mediapipe_s", "mediapipe"), ("rtmpose_s", "rtmpose")):
            if s.startswith(marker) and " in " in s and s.endswith(("s", ")")):
                try:
                    out[key] = float(s.split(" in ")[1].split("s")[0])
                except (IndexError, ValueError):
                    pass
        if s.startswith("total ") and s.endswith(tuple("0123456789")) is False:
            try:
                out["total_s"] = float(s.split()[1].rstrip("s"))
            except (IndexError, ValueError):
                pass
    return out


# ------------------------------------------------------------------------------- comparison

def _kp_px(doc: dict, f: int) -> list[tuple[float, float, float]] | None:
    frames = doc["pose"]["frames"]
    if f < 0 or f >= len(frames):
        return None
    w = float(doc["video"]["analysis_res"]["width"])
    h = float(doc["video"]["analysis_res"]["height"])
    return [(x * w, y * h, c) for x, y, c in frames[f]["kp"]]


def body_error(ref: dict, got: dict, frames: list[int], min_conf: float = 0.35) -> dict:
    """Per-keypoint displacement in analysis pixels, over the given frames.

    Only points BOTH artifacts consider usable are compared. A point the coarser run dropped is
    a coverage difference, not a position error, and mixing the two would let a run that
    measured nothing score a small median.
    """
    errs: list[float] = []
    dropped = 0
    for f in frames:
        a, b = _kp_px(ref, f), _kp_px(got, f)
        if a is None or b is None:
            continue
        for (ax, ay, ac), (bx, by, bc) in zip(a, b):
            if ac < min_conf:
                continue
            if bc < min_conf:
                dropped += 1
                continue
            errs.append(((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5)
    if not errs:
        return {"n": 0}
    errs.sort()
    return {
        "n": len(errs),
        "median_px": round(statistics.median(errs), 2),
        "mean_px": round(statistics.fmean(errs), 2),
        "p95_px": round(errs[min(len(errs) - 1, int(0.95 * len(errs)))], 2),
        "max_px": round(errs[-1], 2),
        "dropped_pts": dropped,
    }


def event_deltas(ref: dict, got: dict, fps: float) -> dict:
    a = {k: v["frame"] for k, v in ref["events"].items()}
    b = {k: v["frame"] for k, v in got["events"].items()}
    d = {k: b[k] - a[k] for k in a if k in b}
    worst = max(abs(v) for v in d.values()) if d else 0
    return {"frames": d,
            "max_abs_frames": worst,
            "max_abs_ms": round(1000.0 * worst / fps, 1) if fps else None,
            "impact_frames": d.get("impact")}


def score_deltas(ref_dir: Path, got_dir: Path) -> dict | None:
    ra, ga = ref_dir / "coach_report.json", got_dir / "coach_report.json"
    if not ra.exists() or not ga.exists():
        return None
    r = json.loads(ra.read_text(encoding="utf-8"))
    g = json.loads(ga.read_text(encoding="utf-8"))
    cats = {}
    for k, v in (r.get("categories") or {}).items():
        gv = (g.get("categories") or {}).get(k)
        if gv is not None and v.get("score") is not None and gv.get("score") is not None:
            cats[k] = round(gv["score"] - v["score"], 2)
    return {"overall": round((g.get("overall") or 0) - (r.get("overall") or 0), 2),
            "max_abs_category": max((abs(x) for x in cats.values()), default=0.0),
            "categories": cats}


def label_report(out_dir: Path) -> dict | None:
    """Events vs hand labels — the only measurement here that is about being RIGHT."""
    try:
        from groundtruth import evaluate_events as ee
    except Exception:
        return None
    try:
        rep = ee.evaluate_out_dir(out_dir, ee.default_labels_root())
    except Exception:
        return None
    if not rep or rep.get("stale_labels"):
        return {"stale_labels": True} if rep else None
    per = rep.get("events") or {}
    errs = [abs(v["error_frames"]) for v in per.values() if v.get("error_frames") is not None]
    return {"mean_abs_frames": round(statistics.fmean(errs), 2) if errs else None,
            "max_abs_frames": max(errs) if errs else None,
            "within_2": sum(1 for e in errs if e <= 2),
            "n": len(errs)}


def compare(ref_dir: Path, got_dir: Path) -> dict:
    ref = json.loads((ref_dir / "analysis.json").read_text(encoding="utf-8"))
    got = json.loads((got_dir / "analysis.json").read_text(encoding="utf-8"))
    fps = float(ref["video"]["fps"])
    ev_frames = sorted({v["frame"] for v in ref["events"].values()})
    a, b = ref["swing_window"]
    swing = list(range(int(a), int(b) + 1))
    fp = got.get("frame_policy") or {}
    return {
        "policy": fp.get("version"),
        "direct_pct": fp.get("direct_pct"),
        "direct_count": fp.get("direct_count"),
        "n_frames": fp.get("n_frames") or len(got["pose"]["frames"]),
        "stride_in": fp.get("stride_in"),
        "at_events": body_error(ref, got, ev_frames),
        "over_swing": body_error(ref, got, swing),
        "events": event_deltas(ref, got, fps),
        "scores": score_deltas(ref_dir, got_dir),
        "labels": label_report(got_dir),
        "labels_ref": label_report(ref_dir),
    }


# ----------------------------------------------------------------------------------- report

def markdown(sweep: dict) -> str:
    lines = [
        "# E2.1 — cadence ablation",
        "",
        f"Clips: {', '.join(sweep['clips'])}",
        f"Policies: {', '.join(sweep['policies'])}",
        f"burnin flags: `{' '.join(sweep['burnin_args']) or '(defaults)'}`",
        "",
        "Body error is displacement from the SAME clip's dense run, in analysis-frame pixels,",
        "over keypoints both runs scored above 0.35. Event delta is how far the detected event",
        "moved. Neither says the dense run is right — the label columns are the ones that do.",
        "",
        "| clip | policy | direct | body p95 @events | body p95 @swing | max event Δ | overall Δ | pose s |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for clip, per in sweep["compare"].items():
        for pol, c in per.items():
            cost = sweep["runs"].get(f"{pol}:{clip}", {}).get("stage_seconds") or {}
            pose_s = cost.get("rtmpose_s")
            lines.append(
                f"| {clip} | {pol} | {c.get('direct_pct')}% "
                f"({c.get('direct_count')}/{c.get('n_frames')}) "
                f"| {c['at_events'].get('p95_px', '—')} "
                f"| {c['over_swing'].get('p95_px', '—')} "
                f"| {c['events']['max_abs_frames']} "
                f"({c['events']['max_abs_ms']} ms) "
                f"| {(c['scores'] or {}).get('overall', '—')} "
                f"| {pose_s if pose_s is not None else '—'} |")
    lines += ["", "## Events vs hand labels (the correctness column)", "",
              "| clip | policy | mean abs frames | max | within ±2 |", "|---|---|---:|---:|---:|"]
    for clip, per in sweep["compare"].items():
        for pol, c in per.items():
            for name, lab in (("dense (ref)", c.get("labels_ref")), (pol, c.get("labels"))):
                if lab and not lab.get("stale_labels"):
                    lines.append(f"| {clip} | {name} | {lab['mean_abs_frames']} "
                                 f"| {lab['max_abs_frames']} | {lab['within_2']}/{lab['n']} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", default=",".join(HIGH_SPEED),
                    help=f"comma-separated stems. Shorthands: golden={','.join(GOLDEN[:2])}..., "
                         f"high-speed={','.join(HIGH_SPEED[:2])}...")
    ap.add_argument("--policies",
                    default="v0-dense,adaptive-v1@120hz,adaptive-v1@80hz,"
                            "adaptive-v1@60hz,adaptive-v1@30hz")
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/e21"))
    ap.add_argument("--burnin-args", default="--no-club-variants")
    ap.add_argument("--report", default="e2.1-cadence")
    ap.add_argument("--stage", choices=["run", "report", "all"], default="all")
    args = ap.parse_args(argv)

    clips = {"golden": GOLDEN, "high-speed": HIGH_SPEED}.get(
        args.clips, [c for c in args.clips.split(",") if c])
    policies = [p for p in args.policies.split(",") if p]
    if DENSE not in policies:
        policies.insert(0, DENSE)
    extra = args.burnin_args.split()
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    sweep = {"schema": "cadence-ablation", "schemaVersion": 1,
             "clips": clips, "policies": policies, "burnin_args": extra,
             "runs": {}, "compare": {}}
    state = out_root / "sweep.json"
    if state.exists():
        sweep.update(json.loads(state.read_text(encoding="utf-8")))
        sweep["clips"], sweep["policies"], sweep["burnin_args"] = clips, policies, extra

    def save():
        state.write_text(json.dumps(sweep, indent=2), encoding="utf-8")

    if args.stage in ("run", "all"):
        for clip in clips:
            for pol in policies:
                d = out_root / pol.replace("@", "_").replace(":", "_") / clip
                print(f"[run] {clip} {pol} ...", flush=True)
                r = run_one(clip, pol, d, extra)
                sweep["runs"][f"{pol}:{clip}"] = r
                save()
                print(f"[run] {clip} {pol} "
                      f"{'cached' if r.get('cached') else ('ok' if r['ok'] else 'FAILED')} "
                      f"{r.get('seconds') or ''}", flush=True)
                if not r["ok"]:
                    print(r.get("stderr", ""), flush=True)

    if args.stage in ("report", "all"):
        for clip in clips:
            ref = out_root / DENSE / clip
            if not (ref / "analysis.json").exists():
                print(f"[skip] {clip}: no dense reference", flush=True)
                continue
            sweep["compare"].setdefault(clip, {})
            for pol in policies:
                if pol == DENSE:
                    continue
                d = out_root / pol.replace("@", "_").replace(":", "_") / clip
                if not (d / "analysis.json").exists():
                    continue
                sweep["compare"][clip][pol] = compare(ref, d)
            save()
        md = markdown(sweep)
        report_dir = ANALYZER / "groundtruth" / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / f"{args.report}.md").write_text(md, encoding="utf-8")
        (report_dir / f"{args.report}.json").write_text(
            json.dumps(sweep, indent=2), encoding="utf-8")
        print(md)
        print(f"report: {report_dir / (args.report + '.md')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
