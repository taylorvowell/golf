"""Endpoint anchoring — every experiment's trace starts ON the club head at address and
ends ON it at impact (user directive 2026-08-08: "100% needs to be at start + at impact.
Every algorithm needs to have this.").

Enforced in the SHARED runner layer, not per test: the artifact's measured club head at
(or nearest to) the address and impact frames is inserted as an authoritative endpoint
observation, overriding whatever the tracker emitted there. The path-fit registry pins
endpoints (D43), so anchoring the endpoint observations anchors all ten variants of every
test — current and future — with no per-tracker code.

If the classical solve has no confident head near an endpoint the anchor is skipped —
anchoring is a correction to real measurements, never a fabrication.
"""
from __future__ import annotations

from .interface import ClubTrackingContext
from .model import ClubObservation

ANCHOR_SEARCH = 6      # frames around the event to find a measured head
ANCHOR_MIN_CONF = 0.3


def _head_near(ctx: ClubTrackingContext, frame: int) -> tuple[float, float, float] | None:
    """The artifact's measured club head at `frame`, or the nearest within the search
    window. Prefers non-interpolated frames and closeness."""
    best = None
    for cf in (ctx.doc.get("club") or {}).get("frames") or []:
        f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
        if head is None or f is None or conf < ANCHOR_MIN_CONF:
            continue
        d = abs(f - frame)
        if d > ANCHOR_SEARCH:
            continue
        penalty = d + (3 if cf.get("interp") else 0)
        if best is None or penalty < best[0]:
            best = (penalty, head[0], head[1], conf)
    if best is None:
        return None
    return best[1], best[2], best[3]


def apply_endpoint_anchors(observations: list[ClubObservation],
                           ctx: ClubTrackingContext) -> tuple[list[ClubObservation], dict]:
    """Returns (anchored observations, diagnostics). Pure — no I/O."""
    n0 = ctx.events.get("address")
    n1 = ctx.events.get("impact")
    diag = {"address_anchored": False, "impact_anchored": False}
    if n0 is None or n1 is None:
        return observations, diag

    by_frame = {o.frame: o for o in observations}
    for frame, key in ((n0, "address_anchored"), (n1, "impact_anchored")):
        head = _head_near(ctx, frame)
        if head is None:
            continue
        x, y, conf = head
        by_frame[frame] = ClubObservation(
            frame=frame, source_time_s=frame / ctx.fps, x=x, y=y,
            confidence=round(max(conf, 0.9), 5), mode="observed",
            source="detector", visibility="visible")
        diag[key] = True

    return [by_frame[f] for f in sorted(by_frame)], diag
