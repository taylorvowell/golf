"""Fine-tune YOLO to detect the club head and shaft.

    python scripts/train_club.py

Dataset: golf-swing-vnwlh/golf-swing-msiuj v9 (CC BY 4.0) — 4,399 train images with
`clubhead` and `stick` instance masks. Median clubhead extent is 1.3% x 2.4% of the image,
i.e. genuinely the head rather than the golfer.

Detection (not segmentation) is enough: we need the head's position, and boxes train faster
and are less sensitive to mask quality on a tiny object. `stick` is kept as a second class
because a shaft prediction adjacent to a head prediction is strong mutual corroboration —
the same "shaft ends at the head" constraint the hand-built detectors used, but learned.
"""
from pathlib import Path
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "Golf-Swing-9" / "data.yaml"

if __name__ == "__main__":
    model = YOLO("yolo11s.pt")
    model.train(
        data=str(DATA),
        epochs=40,
        imgsz=640,
        batch=8,
        device="cpu",
        workers=4,
        project=str(ROOT / "runs"),
        name="clubhead",
        exist_ok=True,
        patience=12,
        # A club head is small and high-contrast; mild augmentation only, and no vertical
        # flip since swing geometry is not up-down symmetric.
        degrees=8, translate=0.08, scale=0.4, fliplr=0.5, flipud=0.0, mosaic=0.6,
        plots=False, verbose=True,
    )
