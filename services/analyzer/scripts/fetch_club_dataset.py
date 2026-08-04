"""Download the club-head training dataset from Roboflow.

    python scripts/fetch_club_dataset.py

Lands at `datasets/Golf-Swing-9/`, which is where `train_club.py` expects `data.yaml`.
Gitignored (see .gitignore) — re-run on a new machine rather than committing ~6k images.

Dataset: golf-swing-vnwlh/golf-swing-msiuj v9, CC BY 4.0. Attribution is required for
anything shipped that is derived from it.

The project is annotated as instance segmentation, but we export the **yolov11 detection**
format: `train_club.py` only needs the head's position, and boxes derived from the masks
train faster and are less sensitive to mask quality on an object this small.

Needs ROBOFLOW_API_KEY, from the environment or from services/analyzer/.env (not committed).
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "datasets" / "Golf-Swing-9"

WORKSPACE, PROJECT, VERSION = "golf-swing-vnwlh", "golf-swing-msiuj", 9
FORMAT = "yolov11"


def api_key() -> str:
    key = os.environ.get("ROBOFLOW_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "ROBOFLOW_API_KEY" and value.strip():
                return value.strip()
    sys.exit("ROBOFLOW_API_KEY not set (environment or services/analyzer/.env)")


if __name__ == "__main__":
    if (DEST / "data.yaml").exists():
        print(f"already present: {DEST}")
        sys.exit(0)

    from roboflow import Roboflow

    version = (
        Roboflow(api_key=api_key())
        .workspace(WORKSPACE)
        .project(PROJECT)
        .version(VERSION)
    )
    version.download(FORMAT, location=str(DEST))

    # Report what actually landed. The Roboflow project pool and a pinned version differ
    # (the pool reads 6,077 images; v9 is its own snapshot), so trust the counts on disk.
    print(f"\n{DEST}")
    for split in ("train", "valid", "test"):
        images = DEST / split / "images"
        labels = DEST / split / "labels"
        if images.exists():
            n_img = sum(1 for _ in images.iterdir())
            n_lbl = sum(1 for _ in labels.iterdir()) if labels.exists() else 0
            print(f"  {split:<6} {n_img:>5} images  {n_lbl:>5} labels")
    data_yaml = DEST / "data.yaml"
    if data_yaml.exists():
        print(f"\n--- data.yaml ---\n{data_yaml.read_text().strip()}")
