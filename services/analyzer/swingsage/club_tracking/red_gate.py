"""THE green-box gate (user hard rule, 2026-08-08): a model's red (head) detection only
exists if it sits inside a same-frame green (shaft/stick) box.

Always on, everywhere model output is consumed — the candidate harvest, the red-family
tests, and the live detector adapters. The physics: the head is attached to the shaft; a
head detection with no shaft under it is spurious, however confident. Strict by order: a
frame with no green box validates nothing.

The raw OVERLAY intentionally still shows everything — it exists to show what the model
said, gate included the viewer couldn't see what was removed.
"""
from __future__ import annotations

GREEN_MARGIN = 1.2       # green boxes grown by this factor before the containment test


def in_green(hx: float, hy: float,
             greens: list[tuple[float, float, float, float]]) -> bool:
    """Is (hx, hy) inside any green box (cx, cy, w, h), grown by GREEN_MARGIN?"""
    for gx, gy, gw, gh in greens:
        if (abs(hx - gx) <= gw / 2 * GREEN_MARGIN
                and abs(hy - gy) <= gh / 2 * GREEN_MARGIN):
            return True
    return False


def greens_of(dets: list[dict], is_green) -> list[tuple[float, float, float, float]]:
    return [(d["xy"][0], d["xy"][1], d["wh"][0], d["wh"][1])
            for d in dets if is_green(d)]


def gated_heads(dets: list[dict], is_head, is_green) -> list[dict]:
    """The head detections of one frame that survive the gate."""
    greens = greens_of(dets, is_green)
    return [d for d in dets
            if is_head(d) and in_green(d["xy"][0], d["xy"][1], greens)]
