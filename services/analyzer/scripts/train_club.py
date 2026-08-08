"""Fine-tune YOLO on the club head and shaft.

    python scripts/train_club.py                  # detection  -> runs/clubhead
    python scripts/train_club.py --task segment    # segmentation -> runs/clubhead_seg

Dataset: golf-swing-vnwlh/golf-swing-msiuj v9 (CC BY 4.0) — 4,399 train images with
`clubhead` and `stick` instance masks. Median clubhead extent is 1.3% x 2.4% of the image,
i.e. genuinely the head rather than the golfer (verified independently).

Both tasks train from the SAME `data.yaml`: the Roboflow export is polygons even when the
detection format is requested, and Ultralytics derives boxes from them for a detect run. So
segmentation needs no re-download — the masks were always there, detection just discarded them.

### Why both are worth having

Detection was the original choice and the reasoning held at the time: we need the head's
position, and boxes are cheaper and less sensitive to mask quality on a tiny object. What the
first run then measured changes the calculus:

    class      mAP50   mAP50-95
    stick      0.976   0.840      <- the model's strong output
    clubhead   0.686   0.303      <- the class we actually consume

`stick` is by far the better signal, and the solver's state is shaft **angle**. But an
axis-aligned box around a diagonal shaft encodes almost no orientation — a shaft running corner
to corner fills its box — so `club_detect.inject_sticks` has to *infer* direction from the box
centroid. A mask does not need inferring: fit a line to it and the shaft direction falls out.
For `clubhead`, a mask centroid also beats a box centre on a ~9x15px object.

Neither replaces the other here. Keep both sets of weights so the variants can be compared on
real pixels, which is the only judgement available until a position-error metric exists.
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "Golf-Swing-9" / "data.yaml"

# (base weights, run name) per task. `-seg` heads predict a mask per instance alongside the box.
TASKS = {
    "detect": ("yolo11s.pt", "clubhead"),
    "segment": ("yolo11s-seg.pt", "clubhead_seg"),
}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=sorted(TASKS), default="detect")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--imgsz", type=int, default=640,
                    help="keep 640 — the club head is a small object and dropping resolution "
                         "hurts exactly what we are detecting")
    ap.add_argument("--name", default=None, help="override the run directory name")
    args = ap.parse_args()

    weights, name = TASKS[args.task]
    model = YOLO(weights)
    model.train(
        data=str(DATA),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=0,
        # Pascal (GTX 1080, sm_61) runs FP16 at a fraction of its FP32 rate, so mixed
        # precision buys nothing here and can cost. VRAM is not the constraint either
        # (batch 8 @ 640 with yolo11s against 7 GiB free), so train in FP32.
        amp=False,
        workers=4,
        project=str(ROOT / "runs"),
        name=args.name or name,
        exist_ok=True,
        patience=12,
        # A club head is small and high-contrast; mild augmentation only, and no vertical
        # flip since swing geometry is not up-down symmetric.
        degrees=8, translate=0.08, scale=0.4, fliplr=0.5, flipud=0.0, mosaic=0.6,
        plots=False, verbose=True,
    )
