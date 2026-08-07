"""Test 19 — Legacy Solve Gated by Isolation (user request 2026-08-08).

The classical solve's heads, kept only where the subtractive isolation view agrees
something club-like is actually there: a head falling outside every club-only ring (plus
margin) is rejected — whatever the detector thought it saw, the motion evidence says the
club is not at that spot. Rejected frames become gaps the path-fit bridges honestly.
"""
from __future__ import annotations

import json

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register

GATE_MARGIN = 0.03       # normalized distance outside a ring that still counts as "near"


def near_rings(x: float, y: float, rings: list,
               margin: float = GATE_MARGIN) -> bool:
    """Is (x, y) inside or within `margin` of any ring? Pure geometry via cv2."""
    import cv2
    if not rings:
        return False
    pt = (float(x), float(y))
    for ring in rings:
        if len(ring) < 3:
            continue
        cnt = np.array(ring, dtype=np.float32).reshape(-1, 1, 2)
        d = cv2.pointPolygonTest(cnt, pt, True)   # signed; >=0 inside
        if d >= -margin:
            return True
    return False


def _load_club_only(ctx: ClubTrackingContext) -> dict[int, list] | None:
    if ctx.out_dir is None:
        return None
    p = ctx.out_dir / "club_only.json"
    if not p.exists():
        return None
    doc = json.loads(p.read_text(encoding="utf-8"))
    return {fr["f"]: fr["p"] for fr in doc.get("frames", [])}


@register
class LegacyIsolationGateTracker:
    id = "t19_legacy_isolation_gate"
    label = TEST_IDS["t19_legacy_isolation_gate"]
    version = "1.0.0"

    def __init__(self, rings_by_frame=None):
        self._rings = rings_by_frame          # test injection

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        rings = self._rings if self._rings is not None else _load_club_only(ctx)
        if rings is None:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_club_only_artifact",
                             "hint": "run scripts/isolate.py"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        kept, rejected, unverifiable = [], 0, 0
        for cf in (ctx.doc.get("club") or {}).get("frames") or []:
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if head is None or f is None or not n0 <= f <= n1 or conf <= 0:
                continue
            frame_rings = rings.get(f)
            if not frame_rings:
                # no motion evidence this frame (club still, or artifact hole): the gate
                # cannot testify either way — keep the head at reduced confidence
                unverifiable += 1
                kept.append(ClubTrackingObs(cf, conf * 0.6, "mixed"))
                continue
            if near_rings(head[0], head[1], frame_rings):
                kept.append(ClubTrackingObs(cf, conf, "observed"))
            else:
                rejected += 1

        observations = [o for o in kept]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"kept": len(observations), "rejected": rejected,
                         "unverifiable": unverifiable})


def ClubTrackingObs(cf: dict, conf: float, mode: str) -> ClubObservation:
    return ClubObservation(
        frame=cf["f"], source_time_s=None, x=cf["head"][0], y=cf["head"][1],
        confidence=round(min(conf, 1.0), 5), mode=mode,
        source="detector", visibility="visible")
