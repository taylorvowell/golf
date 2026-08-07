"""Confidence-triaged LLM localization (test 17, user request 2026-08-08).

Doc 00's AI policy sanctions exactly this: "correction of low-confidence spans, capped
~10 frames/swing." The triage is deterministic and structural:

  * confident detections (classical solve / detector above CONF_ANCHOR) are anchors and
    are NEVER sent to the model;
  * frames with no confident point cluster into gaps; up to MAX_LLM_FRAMES representative
    frames are chosen (largest gaps first, impact-side preferred);
  * ONE call carries all crops. The model answers in GRID CELLS (a labeled grid is burned
    into each crop) — models answer "F7" far more reliably than pixel numbers, and a cell
    is honest about the precision actually on offer;
  * every answer is validated (cell exists, frame matches); the whole thing failing means
    the anchors stand alone and the path-fit bridges — AI is never a hard dependency.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

CONF_ANCHOR = 0.6
MAX_LLM_FRAMES = 10
GRID_COLS = 12           # A..L
GRID_ROWS = 12           # 1..12
CELL_RE = re.compile(r"^([A-L])(1[0-2]|[1-9])$")

PROMPT_VERSION = "club_gridloc_v1"


def pick_llm_frames(confident: set[int], n0: int, n1: int,
                    cap: int = MAX_LLM_FRAMES) -> list[int]:
    """Representative frames of the unconfident gaps: largest gaps first, each gap
    sampled at its middle (then quarters for very large ones), impact-side preferred on
    ties. Pure."""
    gaps: list[tuple[int, int]] = []
    run_start = None
    for f in range(n0, n1 + 1):
        if f not in confident:
            if run_start is None:
                run_start = f
        elif run_start is not None:
            gaps.append((run_start, f - 1))
            run_start = None
    if run_start is not None:
        gaps.append((run_start, n1))
    # order: longer gaps first, later (impact-side) gaps break ties
    gaps.sort(key=lambda g: (-(g[1] - g[0]), -g[1]))
    picks: list[int] = []
    for lo, hi in gaps:
        span = hi - lo
        centers = [lo + span // 2]
        if span >= 8:
            centers += [lo + span // 4, lo + 3 * span // 4]
        for c in centers:
            if len(picks) >= cap:
                return picks
            if c not in picks:
                picks.append(c)
    return picks


def grid_cell_to_norm(cell: str) -> tuple[float, float] | None:
    """'F7' -> normalized (x, y) of the cell CENTER within the crop."""
    m = CELL_RE.match(cell.strip().upper())
    if not m:
        return None
    col = ord(m.group(1)) - ord("A")
    row = int(m.group(2)) - 1
    return (col + 0.5) / GRID_COLS, (row + 0.5) / GRID_ROWS


def draw_grid(img: np.ndarray) -> np.ndarray:
    """Burn the labeled grid into a crop (BGR uint8). Lines thin, labels small — the
    club must stay visible under them."""
    import cv2
    out = img.copy()
    h, w = out.shape[:2]
    for c in range(1, GRID_COLS):
        x = int(c * w / GRID_COLS)
        cv2.line(out, (x, 0), (x, h), (255, 255, 255), 1)
    for r in range(1, GRID_ROWS):
        y = int(r * h / GRID_ROWS)
        cv2.line(out, (0, y), (w, y), (255, 255, 255), 1)
    for c in range(GRID_COLS):
        cv2.putText(out, chr(ord("A") + c), (int((c + 0.28) * w / GRID_COLS), 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
    for r in range(GRID_ROWS):
        cv2.putText(out, str(r + 1), (2, int((r + 0.65) * h / GRID_ROWS)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
    return out


def build_prompt(entries: list[dict]) -> str:
    """entries: [{frame, path}] in order."""
    lines = [
        "Locate the GOLF CLUB HEAD in each image. Every image is one video frame from",
        "the same golf swing, cropped around where the club should be, with a labeled",
        "grid burned in (columns A-L left to right, rows 1-12 top to bottom).",
        "The club head is at the far end of the shaft from the hands. It may be motion-",
        "blurred into a streak — answer the cell containing the streak's leading tip.",
        "",
        "Images (in temporal order):",
    ]
    for e in entries:
        lines.append(f"  frame {e['frame']}: {e['path']}")
    lines += [
        "",
        "Respond with ONLY a JSON array, one object per image, same order:",
        '[{"frame": <int>, "visible": true|false, "cell": "F7", "confidence": 0.0-1.0}]',
        'Use "visible": false (cell may be null) when you genuinely cannot find the',
        "club head. No prose, no markdown fences.",
    ]
    return "\n".join(lines)


def validate_response(obj, expected_frames: list[int]) -> str | None:
    if not isinstance(obj, list):
        return "response is not a JSON array"
    if len(obj) != len(expected_frames):
        return f"expected {len(expected_frames)} entries, got {len(obj)}"
    for e, f in zip(obj, expected_frames):
        if not isinstance(e, dict) or e.get("frame") != f:
            return f"entry for frame {f} missing or out of order"
        if not isinstance(e.get("visible"), bool):
            return "visible must be boolean"
        if e["visible"]:
            if not isinstance(e.get("cell"), str) or grid_cell_to_norm(e["cell"]) is None:
                return f"frame {f}: cell must match A-L + 1-12"
            c = e.get("confidence")
            if not isinstance(c, (int, float)) or not 0 <= c <= 1:
                return f"frame {f}: confidence must be in [0,1]"
    return None


def _extract_array(raw: str) -> list | None:
    try:
        return json.loads(raw[raw.index("["):raw.rindex("]") + 1])
    except (ValueError, json.JSONDecodeError):
        return None


def cli_array_provider(prompt: str) -> list | None:
    """`claude -p` returning a JSON ARRAY (the adjudication provider extracts objects)."""
    import subprocess
    from .adjudication import CLAUDE, TIMEOUT_S, _extract_json
    try:
        res = subprocess.run(
            [CLAUDE, "-p", "--output-format", "json", "--allowedTools", "Read"],
            input=prompt, capture_output=True, text=True, timeout=TIMEOUT_S,
            shell=False, encoding="utf-8", errors="replace",
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if res.returncode != 0:
        return None
    outer = _extract_json(res.stdout)
    text = (outer.get("result") if isinstance(outer, dict)
            and isinstance(outer.get("result"), str) else res.stdout)
    return _extract_array(text) if text else None


def locate(entries: list[dict], cache_path: Path | None = None,
           provider=None) -> tuple[list[dict] | None, str]:
    """One call, one retry, cached — same discipline as adjudication.adjudicate."""
    import hashlib

    prompt = build_prompt(entries)
    frames = [e["frame"] for e in entries]
    key = hashlib.sha256((PROMPT_VERSION + prompt).encode()).hexdigest()[:24]
    cache = {}
    if cache_path is not None and cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cache = {}
        if key in cache:
            return cache[key], "cached"

    ask = provider or cli_array_provider

    status = "ai"
    obj = ask(prompt)
    err = validate_response(obj, frames) if obj is not None else "no response"
    if err:
        status = "ai_retry"
        obj = ask(prompt + f"\n\nYour previous answer was invalid: {err}. "
                           "Reply with the corrected JSON array only.")
        err = validate_response(obj, frames) if obj is not None else "no response"
    if err:
        return None, "fallback"
    if cache_path is not None:
        cache[key] = obj
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
    return obj, status
