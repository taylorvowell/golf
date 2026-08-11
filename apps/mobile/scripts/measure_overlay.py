#!/usr/bin/env python
"""
Measure overlay-vs-video sync from the device screen, not from the app's own report.

    python measure_overlay.py --samples 40 --label js-state

Why this exists
---------------
The in-app probe measures a *closed loop*: native says which frame is on screen, JS says which
frame it drew for, native compares them. That is a real measurement, but it is blind to where the
overlay was actually drawn — so it can read PASS while a human looking at the phone sees the
marker sitting off the bar. That happened: a coordinate-space bug put the marker in the wrong
place all the way through a passing run, and only the picture showed it.

This script measures what the eye measures, and it does it the only way that cannot be argued
with: **both things are read out of the same screenshot**, at the same instant, after compositing.
The screen capture is slow and the video keeps moving, and neither matters — the bar and the
marker are compared to each other within one frame of pixels, never across time.

That property is what makes it a fair judge of *different* overlay strategies. A JS-state overlay,
a UI-thread worklet and a natively-drawn overlay all end up as pixels; this compares the pixels.

What it reports
---------------
Gap in device px, and the same gap converted to frames using the clip's own geometry. Frames are
the unit the acceptance bar is stated in (D13: p95 = 0), so the conversion is the point:
a "2px" gap means nothing on its own, and "1.9 frames late" means everything.
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
from dataclasses import dataclass

import cv2
import numpy as np

# Must match apps/mobile/scripts/make-frame-clip.mjs and SpikeScreen.tsx.
CLIP_WIDTH_PX = 720
BAR_WIDTH_PX = 12
DEFAULT_CLIP_FRAMES = 600  # synthetic; the real swing clip is 396 (pass --frames)

# Colours as authored. Tolerances are wide because the panel, video encoding and any colour
# management between them all shift these a little; they only need to separate two known marks
# from a dark background, not identify a shade.
BAR_RGB = (0xA3, 0xE6, 0x35)
MARKER_RGB = (0xF7, 0xF8, 0xF5)
# Calibration ticks the app draws at the video's exact left and right edges. The rendered video
# width cannot be inferred from the screenshot: the clip is 9:16 and taller than the phone, so the
# bar's visible height is clipped and height x 9/16 understates the width badly. An early run
# derived it that way and produced "gaps" of 18,000 frames.
CAL_RGB = (0xFF, 0x00, 0xFF)


@dataclass
class Sample:
    bar_x: float
    marker_x: float
    video_left: float
    video_width: float
    clip_frames: int

    @property
    def gap_px(self) -> float:
        return self.marker_x - self.bar_x

    @property
    def gap_frames(self) -> float:
        """
        Convert a pixel gap to frames using how far the bar travels per frame.

        The bar sweeps (CLIP_WIDTH - BAR_WIDTH) of clip pixels over (CLIP_FRAMES - 1) frames, and
        the clip is rendered at `video_width`, so one frame of travel is that distance scaled.
        """
        span_px = (CLIP_WIDTH_PX - BAR_WIDTH_PX) / CLIP_WIDTH_PX * self.video_width
        per_frame = span_px / (self.clip_frames - 1)
        return self.gap_px / per_frame if per_frame else 0.0


def grab() -> np.ndarray:
    """One screenshot, as BGR. `exec-out` keeps the PNG binary-clean on Windows."""
    raw = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"], capture_output=True, check=True
    ).stdout
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("screencap returned something that is not an image")
    return img


def tall_column(mask: np.ndarray, min_fraction: float) -> tuple[float, int, int] | None:
    """
    Find the centre of the tallest run of columns that are 'lit' down most of their height.

    The height test is what rejects text. The screen has acid-green lettering in the header and
    white lettering everywhere, but only the bar and the marker run vertically for most of the
    video's height, so requiring a tall column separates the marks from the UI without needing to
    know where the video is first.
    """
    col_counts = mask.sum(axis=0)
    if col_counts.max() == 0:
        return None
    tallest = col_counts.max()
    lit = np.where(col_counts >= max(min_fraction * tallest, 1))[0]
    if lit.size == 0:
        return None

    # Take the widest contiguous run — a stray antialiased pixel elsewhere must not shift the centre.
    splits = np.where(np.diff(lit) > 1)[0]
    runs = np.split(lit, splits + 1)
    run = max(runs, key=len)

    rows = np.where(mask[:, run].any(axis=1))[0]
    return float(run.mean()), int(rows.min()), int(rows.max())


def near(img: np.ndarray, rgb: tuple[int, int, int], tol: int) -> np.ndarray:
    b, g, r = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
    return (
        (np.abs(r - rgb[0]) < tol) & (np.abs(g - rgb[1]) < tol) & (np.abs(b - rgb[2]) < tol)
    )


def measure(img: np.ndarray, clip_frames: int) -> Sample | None:
    bar = tall_column(near(img, BAR_RGB, 60), 0.6)
    if bar is None:
        return None
    bar_x, top, bottom = bar

    # Restrict the marker search to the bar's own vertical extent — that IS the video region, and
    # confining to it removes every piece of white text on the rest of the screen.
    band = img[top : bottom + 1, :]
    marker = tall_column(near(band, MARKER_RGB, 40), 0.6)
    if marker is None:
        return None
    marker_x, _, _ = marker

    # Video geometry from the app's own calibration ticks, not inferred.
    cal = near(band, CAL_RGB, 60)
    cal_cols = np.where(cal.sum(axis=0) >= 0.6 * cal.sum(axis=0).max())[0] if cal.any() else []
    if len(cal_cols) < 2:
        return None
    left, right = float(cal_cols.min()), float(cal_cols.max())
    video_width = right - left + 1
    if video_width < 50:
        return None
    return Sample(
        bar_x=bar_x,
        marker_x=marker_x,
        video_left=left,
        video_width=video_width,
        clip_frames=clip_frames,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=30)
    ap.add_argument("--label", default="unlabelled", help="which overlay strategy this run is")
    ap.add_argument("--json", help="write raw samples here")
    ap.add_argument("--frames", type=int, default=DEFAULT_CLIP_FRAMES,
                    help="frame count of the clip on screen: synthetic 600, swing1 396")
    args = ap.parse_args()

    samples: list[Sample] = []
    misses = 0
    for _ in range(args.samples):
        try:
            s = measure(grab(), args.frames)
        except subprocess.CalledProcessError as exc:
            print(f"adb failed: {exc}", file=sys.stderr)
            return 2
        if s is None:
            misses += 1
            continue
        samples.append(s)

    # At the loop wrap the video jumps to frame 0 while the marker is still at the right-hand end;
    # that is a genuine transient, not overlay drift, and it must be discarded rather than
    # averaged in. Reported, never silent.
    wrapped = [s for s in samples if abs(s.gap_frames) > 60]
    samples = [s for s in samples if abs(s.gap_frames) <= 60]

    if not samples:
        print(
            "No sample found either mark. Is the spike in the foreground and playing?",
            file=sys.stderr,
        )
        return 1

    gaps_px = [s.gap_px for s in samples]
    gaps_fr = [s.gap_frames for s in samples]
    abs_fr = sorted(abs(g) for g in gaps_fr)
    p95 = abs_fr[min(int(np.ceil(0.95 * len(abs_fr))) - 1, len(abs_fr) - 1)]

    print(f"strategy      {args.label}")
    print(f"samples       {len(samples)} ({misses} unreadable, {len(wrapped)} discarded at loop wrap)")
    print(f"video width   {statistics.mean(s.video_width for s in samples):.0f}px")
    print(f"gap px        mean {statistics.mean(gaps_px):+.2f}  median {statistics.median(gaps_px):+.2f}")
    print(f"gap frames    mean {statistics.mean(gaps_fr):+.2f}  median {statistics.median(gaps_fr):+.2f}")
    print(f"|gap| frames  p95 {p95:.2f}  max {max(abs_fr):.2f}")
    print()
    # Sign is the finding, not a detail: a marker consistently BEHIND the bar is the overlay
    # lagging the video, which is the thing D13 sets to zero. A random sign is noise instead.
    lagging = sum(1 for g in gaps_fr if g < -0.5)
    leading = sum(1 for g in gaps_fr if g > 0.5)
    print(f"marker behind bar: {lagging}/{len(samples)}   ahead: {leading}/{len(samples)}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "label": args.label,
                    "samples": [
                        {"gap_px": s.gap_px, "gap_frames": s.gap_frames} for s in samples
                    ],
                },
                fh,
                indent=2,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
