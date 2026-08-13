"""
Pose on CPU versus CUDA: how much faster, and does it produce the same swing?

Pose is the slowest stage in the pipeline, and it ran on the CPU for the whole life of this project
while a CUDA GPU sat idle — the installed `onnxruntime` was the CPU-only build, so the GPU was not
merely unused, it was unreachable. This measures what that cost.

**Two questions, and the second one is the one that gets forgotten.**

1. *How much faster?* — decides whether the analyzer worker needs a GPU host at all (D18 reopened
   Railway, which has none).
2. *Is it the same answer?* — a keypoint that moves between hosts is a swing that scores differently
   depending on which machine analysed it. Speed with a different answer is not a speedup, and this
   project's own history is that a number which looks healthy is not evidence it is right. So the
   two runs are compared keypoint-by-keypoint and the worst disagreement is printed, in pixels and
   in confidence.

Usage:
    .venv\\Scripts\\python.exe scripts/posebench.py <video> [--frames N]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_BOXES = None


def run(video: Path, device: str, limit: int | None):
    """One full pose pass on one device. Returns (seconds, series, frames)."""
    os.environ["SWINGSAGE_POSE_DEVICE"] = device

    # Imported inside, after the env var is set, so the device choice is read fresh each pass.
    from swingsage import pose, pose_rtm

    # MediaPipe is the person LOCALISER that supplies RTMPose's per-frame box (burnin.py 325-341).
    # It runs once, outside the timer, and both passes reuse it — timing it twice would measure
    # MediaPipe, which is not the stage being moved to the GPU.
    global _BOXES
    if _BOXES is None:
        mp_series = pose.estimate(video, silhouette=False)
        _BOXES = pose_rtm.bboxes_from_series(mp_series)
    boxes = _BOXES[:limit] if limit else _BOXES

    # The session the pipeline actually builds, asked what it actually got. `available` is a
    # claim; this is the capability. Reported per pass so a fallback can never masquerade as a
    # result — the failure mode this whole script exists to not repeat.
    from rtmlib import RTMPose

    url, sz = pose_rtm.WHOLEBODY_MODELS["performance"]
    probe = RTMPose(url, model_input_size=sz, backend="onnxruntime", device=pose_rtm.pose_device())
    got = probe.session.get_providers()
    print(f"  session providers: {got}")
    if device == "cuda" and "CUDAExecutionProvider" not in got:
        raise RuntimeError(
            "asked for CUDA and the session fell back to CPU — refusing to time it, because "
            "CPU-against-CPU reads exactly like 'the GPU does not help'"
        )

    t0 = time.perf_counter()
    series = pose_rtm.estimate(video, boxes, wholebody=True)
    elapsed = time.perf_counter() - t0
    return elapsed, series, len(boxes)


def providers_actually_used(device: str) -> list[str]:
    """
    What a real session GETS, which is not what `get_available_providers()` promises.

    This check exists because the first run of this script produced a beautiful, wrong answer:
    `onnxruntime-gpu` 1.28 listed CUDAExecutionProvider as available, then failed to create it
    (it wants CUDA 13; this machine has 12.6), fell back to CPU **silently**, and the benchmark
    reported a 0.98x speedup. That reads exactly like "the GPU does not help" — a conclusion that
    would have picked the production worker host off a measurement of CPU against CPU.

    A provider that is listed but cannot load is the trap. Only a real session knows, so this
    builds one on the actual pose model.
    """
    import onnxruntime as ort

    from swingsage.pose_rtm import WHOLEBODY_MODELS, pose_device

    pose_device()  # registers torch/lib on the DLL path, which is what makes CUDA loadable here

    url = WHOLEBODY_MODELS["performance"][0]
    cached = Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints" / Path(url).name
    if not cached.exists():
        return ["<model not cached; run the pipeline once first>"]

    want = ["CUDAExecutionProvider"] if device == "cuda" else ["CPUExecutionProvider"]
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(str(cached), opts, providers=want).get_providers()


def compare(a, b) -> dict:
    """Worst per-keypoint disagreement between two passes, in normalized units and confidence."""
    worst_xy, worst_conf, n = 0.0, 0.0, 0
    for fa, fb in zip(a.frames, b.frames):
        # RawPoseSeries.frames are dicts: {"f": int, "kp": [[x, y, conf], ...]}
        ka_list = fa.get("kp") or []
        kb_list = fb.get("kp") or []
        for ka, kb in zip(ka_list, kb_list):
            if not ka or not kb:
                continue
            worst_xy = max(worst_xy, abs(ka[0] - kb[0]), abs(ka[1] - kb[1]))
            worst_conf = max(worst_conf, abs(ka[2] - kb[2]))
            n += 1
    return {"worst_xy": worst_xy, "worst_conf": worst_conf, "compared": n}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--frames", type=int, default=None, help="cap the frame count for a quick pass")
    args = ap.parse_args()

    if not args.video.exists():
        print(f"no such video: {args.video}")
        return 2

    import onnxruntime as ort

    providers = ort.get_available_providers()
    print(f"onnxruntime {ort.__version__}")
    print(f"providers: {providers}")
    if "CUDAExecutionProvider" not in providers:
        print("\nCUDAExecutionProvider is NOT available — this build cannot use the GPU.")
        print("Install onnxruntime-gpu. Nothing below would be a real comparison.")
        return 1

    results = {}
    for device in ("cpu", "cuda"):
        print(f"\n--- {device} ---", flush=True)
        try:
            elapsed, series, frames = run(args.video, device, args.frames)
        except Exception as exc:
            print(f"{device} FAILED: {type(exc).__name__}: {exc}")
            results[device] = None
            continue
        fps = frames / elapsed if elapsed else 0.0
        print(f"{frames} frames in {elapsed:.1f}s  =  {fps:.2f} fps  ({elapsed / frames * 1000:.1f} ms/frame)")
        results[device] = (elapsed, series, frames)

    cpu, cuda = results.get("cpu"), results.get("cuda")
    if not cpu or not cuda:
        print("\nOne pass failed — no comparison.")
        return 1

    print("\n=== RESULT ===")
    speedup = cpu[0] / cuda[0]
    print(f"CPU  {cpu[0]:7.1f}s   ({cpu[0] / cpu[2] * 1000:6.1f} ms/frame)")
    print(f"CUDA {cuda[0]:7.1f}s   ({cuda[0] / cuda[2] * 1000:6.1f} ms/frame)")
    print(f"speedup: {speedup:.2f}x")

    d = compare(cpu[1], cuda[1])
    print(f"\nsame answer? compared {d['compared']} keypoints")
    print(f"  worst x/y disagreement:  {d['worst_xy']:.6f}  (normalized 0-1)")
    print(f"  worst confidence delta:  {d['worst_conf']:.6f}")
    # A pixel on the 720-short-side frame the CV stage consumes is ~1/720 = 0.00139 normalized.
    print(f"  ... worst x/y is ~{d['worst_xy'] * 720:.3f} px on the 720 analysis frame")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
