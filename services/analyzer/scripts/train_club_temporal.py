"""Train Test 2's temporal heatmap net on pseudo-labels (plan §11, v1 caveat).

Labels come from each fixture's cached t8 fused experiment (falling back to t10, then the
classical solve), conf-gated — NOT hand labels. See temporal_net.py's header for what that
does and does not claim. Frames are the DISTINCT source observations only (§11: never fill
the temporal stack with duplicated CFR frames).

Usage (from services/analyzer, venv python):
    python scripts/train_club_temporal.py            # ~10-20 min on a GTX 1080
    python scripts/train_club_temporal.py --epochs 5 --limit 200   # smoke run

Writes models/club_temporal/v1.pt (weights + normalization metadata). Not in git —
re-train with this script.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage.club_tracking.temporal_net import (IN_H, IN_W, N_STACK,  # noqa: E402
                                                  build_model, gaussian_target)

OUT = ROOT / "models" / "club_temporal"
LABEL_SOURCES = ("t8_phase_fusion", "t10_physics_conic")
MIN_CONF = 0.35


def fixture_samples(out_dir: Path, limit: int | None = None):
    """(stack, target_heatmap, visible) tuples for one analysed swing."""
    doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    video_path = out_dir / "analysis.mp4"
    if not video_path.exists():
        return

    labels: dict[int, tuple[float, float]] = {}
    exps = (doc.get("club_tracking") or {}).get("experiments") or {}
    for src in LABEL_SOURCES:
        pts = (exps.get(src) or {}).get("trace", {}).get("variants", {}).get("default")
        if pts:
            for p in pts:
                if p["confidence"] >= MIN_CONF and p["mode"] != "inferred":
                    labels[p["frame"]] = (p["x"], p["y"])
            break
    if not labels:
        for cf in (doc.get("club") or {}).get("frames") or []:
            if cf.get("head") and cf.get("conf", 0) >= MIN_CONF and not cf.get("interp"):
                labels[cf["f"]] = tuple(cf["head"])
    if len(labels) < N_STACK + 2:
        return

    # distinct source observations only
    st = None
    st_path = out_dir / "source_timing.json"
    if st_path.exists():
        st = json.loads(st_path.read_text(encoding="utf-8"))
    reps = ([o["normalized_frames"][0] for o in st["observations"]
             if o["normalized_frames"]] if st
            else sorted(labels))

    cap = cv2.VideoCapture(str(video_path))
    gray: dict[int, np.ndarray] = {}
    want = set(reps)
    f = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if f in want:
            g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            gray[f] = cv2.resize(g, (IN_W, IN_H)).astype(np.float32) / 255.0
        f += 1
    cap.release()

    reps = [r for r in reps if r in gray]
    half = N_STACK // 2
    n = 0
    for i in range(half, len(reps) - half):
        center = reps[i]
        stack = np.stack([gray[reps[j]] for j in range(i - half, i + half + 1)])
        lab = labels.get(center)
        if lab is not None:
            yield stack, gaussian_target(lab[0], lab[1]), 1.0
        else:
            yield stack, np.zeros_like(gaussian_target(0.5, 0.5)), 0.0
        n += 1
        if limit and n >= limit:
            return


def augment(stack: np.ndarray, heat: np.ndarray, rng: np.random.Generator):
    if rng.random() < 0.5:                     # left/right mirror (§11 aug list)
        stack = stack[:, :, ::-1].copy()
        heat = heat[:, ::-1].copy()
    if rng.random() < 0.3:                     # contrast jitter
        stack = np.clip(stack * rng.uniform(0.7, 1.3), 0, 1)
    if rng.random() < 0.2:                     # occlusion: blank one non-center frame
        k = rng.integers(0, N_STACK)
        if k != N_STACK // 2:
            stack = stack.copy()
            stack[k] = 0.0
    return stack, heat


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--limit", type=int, default=None, help="samples per fixture cap")
    ap.add_argument("--lr", type=float, default=3e-4)
    args = ap.parse_args()

    import torch
    import torch.nn.functional as F

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    samples = []
    for d in sorted((ROOT / "out").glob("*")):
        if (d / "analysis.json").exists():
            got = list(fixture_samples(d, args.limit))
            samples.extend(got)
            print(f"  {d.name}: {len(got)} samples")
    if len(samples) < 100:
        print("not enough samples — run the tracking tests over the fixtures first")
        return 1
    print(f"{len(samples)} samples total (pseudo-labels)")

    model = build_model().to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    rng = np.random.default_rng(0)

    t0 = time.time()
    for epoch in range(args.epochs):
        rng.shuffle(samples)
        losses = []
        for b0 in range(0, len(samples), 16):
            batch = samples[b0:b0 + 16]
            xs, hs, vs = [], [], []
            for stack, heat, vis in batch:
                stack, heat = augment(stack, heat, rng)
                xs.append(stack); hs.append(heat); vs.append(vis)
            x = torch.from_numpy(np.stack(xs)).to(dev)
            h = torch.from_numpy(np.stack(hs)).unsqueeze(1).to(dev)
            v = torch.tensor(vs, dtype=torch.float32, device=dev).unsqueeze(1)
            ph, pv = model(x)
            loss = (F.binary_cross_entropy_with_logits(ph, h) * 10
                    + F.binary_cross_entropy_with_logits(pv, v))
            opt.zero_grad(); loss.backward(); opt.step()
            losses.append(float(loss))
        print(f"epoch {epoch + 1}/{args.epochs}  loss {np.mean(losses):.4f}  "
              f"({time.time() - t0:.0f}s)")

    OUT.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(),
                "meta": {"n_stack": N_STACK, "in": [IN_W, IN_H],
                         "trained_on": "pseudo_labels_7_fixtures",
                         "epochs": args.epochs, "samples": len(samples)}},
               OUT / "v1.pt")
    print(f"saved {OUT / 'v1.pt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
