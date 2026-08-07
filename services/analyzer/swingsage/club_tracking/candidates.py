"""Club-head candidate harvesting (test plan §10, §3.4).

Detection generates hypotheses; it never dictates the path. Two generators today:

  * the raw low-threshold detector stream the artifact already stores
    (`club.detector.boxes`, conf floor 0.15) — the primary evidence;
  * the classical solve's per-frame heads at reduced weight — they are a solved OPINION,
    not raw evidence, so they must never outvote a real detection.

The class id is looked up from `detector.names` (never hardcoded — the Roboflow dataset
maps 0/1 to clubhead/stick today, and nothing guarantees that tomorrow).
"""
from __future__ import annotations

import math

from .interface import ClubTrackingContext
from .model import ClubCandidate

CLASSICAL_WEIGHT = 0.6
HEAD_CLASS_NAME = "clubhead"


def _grip_at(ctx: ClubTrackingContext, f: int) -> tuple[float, float] | None:
    g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
    return (g[0], g[1]) if g and g[2] > 0 else None


def harvest(ctx: ClubTrackingContext) -> dict[int, list[ClubCandidate]]:
    """Candidates per normalized frame, inside address->impact."""
    n0 = ctx.events.get("address", 0)
    n1 = ctx.events.get("impact", ctx.frame_count - 1)
    out: dict[int, list[ClubCandidate]] = {}

    def add(f: int, x: float, y: float, conf: float, source: str,
            feats: dict[str, float]) -> None:
        if not n0 <= f <= n1:
            return
        g = _grip_at(ctx, f)
        if g is not None:
            feats["grip_distance"] = math.hypot(x - g[0], y - g[1])
        out.setdefault(f, []).append(ClubCandidate(
            frame=f, source_time_s=f / ctx.fps, x=x, y=y,
            confidence=min(max(conf, 0.0), 1.0), source=source, features=feats))

    det = (ctx.doc.get("club") or {}).get("detector") or {}
    names = det.get("names") or {}
    head_classes = {int(k) for k, v in names.items() if v == HEAD_CLASS_NAME}
    for row in det.get("boxes") or []:
        f = row.get("f")
        for d in row.get("d") or []:
            if d.get("c") not in head_classes:
                continue
            x, y = d["xy"]
            w, h = d.get("wh", (0.0, 0.0))
            add(f, x, y, d.get("p", 0.0), "detector",
                {"det_score": d.get("p", 0.0), "w": w, "h": h})

    for cf in (ctx.doc.get("club") or {}).get("frames") or []:
        head = cf.get("head")
        if head is None:
            continue
        conf = cf.get("conf", 0.0) * CLASSICAL_WEIGHT
        if conf <= 0:
            continue
        add(cf.get("f", -1), head[0], head[1], conf, "classical",
            {"solve_conf": cf.get("conf", 0.0),
             "interp": 1.0 if cf.get("interp") else 0.0})

    return out
