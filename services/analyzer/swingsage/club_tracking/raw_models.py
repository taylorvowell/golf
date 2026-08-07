"""Multi-model raw detection harness (user request 2026-08-08).

Runs several club-head detectors over a swing's frames and stores EVERY model's raw
output in one sidecar (`raw_models.json`), so the player's "Model output only (raw)"
overlay can flip between models — no solver, no gate, exactly what each model saw.

A runner is a callable `(frame_rgb) -> list[dict]` with normalized detections:
    {"c": 0|1, "xy": [x, y], "wh": [w, h], "p": conf, "label": str}
Class 0 is "head-like" (drawn rose), everything else 1 (drawn green) — matching the
built-in detector's class convention so the overlay code needs no changes.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import numpy as np

SIDECAR_NAME = "raw_models.json"
HEAD_WORDS = ("head", "clubhead", "club-head", "club_head")


def _cls_of(label: str) -> int:
    low = label.lower()
    return 0 if any(wd in low for wd in HEAD_WORDS) else 1


def load_env_key(name: str = "ROBOFLOW_API_KEY") -> str | None:
    """The analyzer's .env, same convention as fetch_club_dataset.py."""
    if os.environ.get(name):
        return os.environ[name]
    env = Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def make_local_yolo(weights: str | Path):
    """Any ultralytics-loadable weights file (the built-in Stage 4b detector included)."""
    from ultralytics import YOLO
    model = YOLO(str(weights))

    def run(frame_rgb: np.ndarray) -> list[dict]:
        import cv2
        bgr = cv2.cvtColor(frame_rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
        res = model.predict(bgr, conf=0.12, verbose=False)[0]
        h, w = frame_rgb.shape[:2]
        out = []
        for b in res.boxes:
            label = res.names.get(int(b.cls[0]), str(int(b.cls[0])))
            x0, y0, x1, y1 = b.xyxy[0].tolist()
            out.append({"c": _cls_of(label),
                        "xy": [round((x0 + x1) / 2 / w, 5), round((y0 + y1) / 2 / h, 5)],
                        "wh": [round((x1 - x0) / w, 5), round((y1 - y0) / h, 5)],
                        "p": round(float(b.conf[0]), 4), "label": label})
        return out

    return run


def make_yolo_world(prompts: list[str], weights: str = "yolov8s-worldv2.pt"):
    """Open-vocabulary detection — no training, the prompt IS the class."""
    from ultralytics import YOLO
    model = YOLO(weights)
    model.set_classes(prompts)

    def run(frame_rgb: np.ndarray) -> list[dict]:
        import cv2
        bgr = cv2.cvtColor(frame_rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
        res = model.predict(bgr, conf=0.05, verbose=False)[0]
        h, w = frame_rgb.shape[:2]
        out = []
        for b in res.boxes:
            label = res.names.get(int(b.cls[0]), str(int(b.cls[0])))
            x0, y0, x1, y1 = b.xyxy[0].tolist()
            out.append({"c": _cls_of(label),
                        "xy": [round((x0 + x1) / 2 / w, 5), round((y0 + y1) / 2 / h, 5)],
                        "wh": [round((x1 - x0) / w, 5), round((y1 - y0) / h, 5)],
                        "p": round(float(b.conf[0]), 4), "label": label})
        return out

    return run


def make_roboflow_hosted(model_id: str, api_key: str, confidence: int = 10):
    """Roboflow Universe hosted inference, one REST call per frame (base64 POST)."""
    import urllib.request

    url = (f"https://detect.roboflow.com/{model_id}"
           f"?api_key={api_key}&confidence={confidence}&overlap=40")

    def run(frame_rgb: np.ndarray) -> list[dict]:
        import cv2
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(frame_rgb.astype(np.uint8),
                                                    cv2.COLOR_RGB2BGR),
                               [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            return []
        payload = base64.b64encode(buf.tobytes())
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except Exception:
            return []
        iw = float(resp.get("image", {}).get("width") or frame_rgb.shape[1])
        ih = float(resp.get("image", {}).get("height") or frame_rgb.shape[0])
        out = []
        for p in resp.get("predictions", []):
            label = str(p.get("class", "?"))
            out.append({"c": _cls_of(label),
                        "xy": [round(p["x"] / iw, 5), round(p["y"] / ih, 5)],
                        "wh": [round(p["width"] / iw, 5), round(p["height"] / ih, 5)],
                        "p": round(float(p.get("confidence", 0)), 4), "label": label})
        return out

    return run


def write_sidecar(out_dir: Path, models: dict) -> Path:
    """models: {model_key: {"label": str, "stride": int, "frames": [{f, d}]}}. Merges
    with an existing sidecar so models can be added one run at a time."""
    dst = out_dir / SIDECAR_NAME
    doc = {"schema": 1, "models": {}}
    if dst.exists():
        try:
            doc = json.loads(dst.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    doc.setdefault("models", {}).update(models)
    tmp = out_dir / (SIDECAR_NAME + ".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, dst)
    return dst
