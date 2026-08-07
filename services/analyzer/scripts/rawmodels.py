"""Run several club-head detectors over a swing and store every model's raw output.

The player's "Model output only (raw)" overlay can then flip between models (Debug menu)
— no solver, no gating, exactly what each model saw. Results merge into
out/<stem>/raw_models.json one model at a time, so adding a model never re-runs the rest.

Model specs (repeat --model):
    builtin                       the Stage 4b detector (runs/clubhead/weights/best.pt)
    world:<prompt>[,prompt...]    YOLO-World open-vocabulary, e.g. world:golf club head
    rf:<workspace/project/ver>    Roboflow hosted inference (needs ROBOFLOW_API_KEY)
    yolo:<path/to/weights.pt>     any local ultralytics weights

Usage:
    .venv/Scripts/python.exe scripts/rawmodels.py out/swing1 \
        --model builtin --model "world:golf club head,golf club" --model rf:some/3
    .venv/Scripts/python.exe scripts/rawmodels.py --all --model "world:golf club head"
    --stride 2      run every 2nd frame (hosted models: be kind to the API)
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import json

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage.club_tracking import raw_models as rm  # noqa: E402

BUILTIN_WEIGHTS = ROOT / "runs" / "clubhead" / "weights" / "best.pt"


def build_runner(spec: str):
    """(key, label, runner) from a --model spec."""
    if spec == "builtin":
        return ("builtin", "Stage 4b yolo11s (ours)",
                rm.make_local_yolo(BUILTIN_WEIGHTS))
    if spec.startswith("world:"):
        prompts = [p.strip() for p in spec[6:].split(",") if p.strip()]
        key = "world_" + "_".join(p.replace(" ", "-") for p in prompts)[:40]
        return (key, f"YOLO-World: {', '.join(prompts)}",
                rm.make_yolo_world(prompts))
    if spec.startswith("rf:"):
        model_id = spec[3:]
        api_key = rm.load_env_key()
        if not api_key:
            raise SystemExit("rf: models need ROBOFLOW_API_KEY in services/analyzer/.env")
        key = "rf_" + model_id.replace("/", "_")
        return (key, f"Roboflow {model_id}",
                rm.make_roboflow_hosted(model_id, api_key))
    if spec.startswith("yolo:"):
        path = Path(spec[5:])
        return ("yolo_" + path.stem, f"YOLO {path.name}", rm.make_local_yolo(path))
    raise SystemExit(f"unknown model spec: {spec}")


def run_swing(out_dir: Path, specs: list[str], stride: int) -> None:
    doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    ev = doc.get("events") or {}
    n0 = ev.get("address", {}).get("frame", 0)
    n1 = ev.get("impact", {}).get("frame", doc["video"]["frame_count"] - 1)
    video = out_dir / "analysis.mp4"
    if not video.exists():
        print(f"  {out_dir.name}: no analysis.mp4 — skipped")
        return

    runners = [build_runner(s) for s in specs]
    frames_rgb: dict[int, "cv2.Mat"] = {}
    cap = cv2.VideoCapture(str(video))
    f = 0
    while f <= n1:
        ok, img = cap.read()
        if not ok:
            break
        if f >= n0 and (f - n0) % stride == 0:
            frames_rgb[f] = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        f += 1
    cap.release()

    payload = {}
    for key, label, runner in runners:
        t0 = time.time()
        rows = []
        n_det = 0
        for fi in sorted(frames_rgb):
            d = runner(frames_rgb[fi])
            n_det += len(d)
            rows.append({"f": fi, "d": d})
        payload[key] = {"label": label, "stride": stride, "frames": rows}
        print(f"  {out_dir.name} · {label}: {n_det} detections over "
              f"{len(rows)} frames ({time.time() - t0:.1f}s)")
    rm.write_sidecar(out_dir, payload)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dir", nargs="?", type=Path)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", action="append", required=True, dest="models")
    ap.add_argument("--stride", type=int, default=1)
    args = ap.parse_args()
    dirs = (sorted(p for p in (ROOT / "out").glob("*")
                   if (p / "analysis.json").exists())
            if args.all else [args.out_dir] if args.out_dir else [])
    if not dirs:
        raise SystemExit("give an out/<stem> dir or --all")
    for d in dirs:
        run_swing(d.resolve(), args.models, args.stride)


if __name__ == "__main__":
    main()
