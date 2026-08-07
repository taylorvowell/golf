"""Test 31 — "Potential" (user recipe 2026-08-08).

Legacy solve + TRAJECTORY-GATED head + moving-average trace.

The artifact ships the two halves separately — `model_traj` is the trajectory-gated head
(the Hampel gate on shaft angle that rejects isolated head jumps, D23-era) and
`model_trace_moving` is the moving-average trace of the plain model head — but never
both. So this takes the trajectory-gated heads and applies the moving average here,
which is the combination the user asked for and one no stored variant provides.

Interpolated frames are excluded before averaging: a moving average over invented points
smears them into the real ones, which is how a gate's rejection quietly comes back.
"""
from __future__ import annotations

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register

# preference order — all trajectory-gated, most-processed first
VARIANT_ORDER = ("model_traj", "model_traj_measured", "model_traj_raw")
MA_WINDOW = 5            # centered, in measured points (not frames)
MIN_CONF = 0.25


def moving_average(points: list[tuple[int, float, float, float]], window: int = MA_WINDOW
                   ) -> list[tuple[int, float, float, float]]:
    """Centered moving average over frame-ordered points. Pure.

    Averages over the point SEQUENCE, not a frame window: where the gate rejected frames
    the neighbours are the surviving measurements, which is what should be smoothed
    together. Endpoints keep their own value (the window shrinks to fit), so the trace
    still starts and ends exactly where it was measured.
    """
    n = len(points)
    if n < 3 or window < 3:
        return list(points)
    half = window // 2
    out = []
    for i, (f, _x, _y, c) in enumerate(points):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        k = min(i - lo, hi - 1 - i)          # symmetric window, shrunk at the ends
        lo, hi = i - k, i + k + 1
        xs = [p[1] for p in points[lo:hi]]
        ys = [p[2] for p in points[lo:hi]]
        out.append((f, sum(xs) / len(xs), sum(ys) / len(ys), c))
    return out


@register
class PotentialTracker:
    id = "t31_potential"
    label = TEST_IDS["t31_potential"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        variants = ((ctx.doc.get("club") or {}).get("variants") or {})
        key = next((k for k in VARIANT_ORDER if k in variants), None)
        if key is None:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_trajectory_gated_variant",
                             "hint": "re-run burnin.py with --club-detector"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        raw: list[tuple[int, float, float, float]] = []
        skipped_interp = 0
        for cf in (variants[key].get("frames") or []):
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if head is None or f is None or not n0 <= f <= n1 or conf < MIN_CONF:
                continue
            if cf.get("interp"):
                skipped_interp += 1
                continue
            raw.append((f, head[0], head[1], conf))
        raw.sort(key=lambda p: p[0])

        if len(raw) < 4:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "too_few_gated_heads", "variant": key,
                             "points": len(raw)})

        smoothed = moving_average(raw)
        observations = [
            ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                            confidence=round(c, 5), mode="observed",
                            source="classical", visibility="visible")
            for f, x, y, c in smoothed
        ]
        gaps = [b.frame - a.frame for a, b in zip(observations, observations[1:])]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"variant": key, "label": variants[key].get("label"),
                         "points": len(observations),
                         "ma_window": MA_WINDOW,
                         "skipped_interpolated": skipped_interp,
                         "longest_gap_frames": max(gaps) if gaps else 0})
