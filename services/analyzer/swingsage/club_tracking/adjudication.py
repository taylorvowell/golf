"""Claude bounded adjudication (test plan §16) — choose among hypotheses, never localize.

The AI budget discipline is structural: `should_adjudicate` is a pure function that fires
only when deterministic hypotheses genuinely disagree (0 calls on easy swings, plan
target); the model answers a MULTIPLE-CHOICE question (enums only, JSON schema); one
validation retry; any failure — CLI missing, timeout, invalid JSON twice — falls back to
the deterministic winner and says so in diagnostics. AI is an enhancement, never a hard
dependency (CLAUDE.md non-negotiable).

Provider: the local Claude Code CLI (`claude -p --output-format json`) per doc 07's
ClaudeCodeProvider direction. The full AIProvider abstraction is doc 07's own future
track; this module deliberately carries only what T7 needs, cached on disk per swing so
re-runs are free.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

# npm installs the CLI as claude.cmd on Windows — bare "claude" fails under shell=False.
CLAUDE = shutil.which("claude") or "claude"

# hypothesis divergence thresholds (normalized units / seconds)
IMPACT_DIVERGENCE = 0.05
TOP_DIVERGENCE_S = 0.10
PATH_DIVERGENCE = 0.04

DECISIONS = ("candidate_a", "candidate_b", "candidate_c", "none")
REASON_CODES = ("motion_consistent", "closer_to_club_visually", "smoother_plausible_path",
                "impact_position_correct", "insufficient_evidence")

PROMPT_VERSION = "club_adjudication_v1"
TIMEOUT_S = 300   # 5-image verify calls need real reading time — 120s
                  # produced timeout->retry->timeout fallbacks (t28/t29)


def hypothesis_divergence(hypos: dict[str, list[dict]],
                          events: dict[str, dict]) -> dict:
    """Pure ambiguity measure over 2-3 hypothesis traces (default variants).

    Returns {max_path, impact_gap, top_gap_s, ambiguous}."""
    ids = sorted(hypos)
    max_path = 0.0
    impact_gap = 0.0
    if len(ids) >= 2:
        by_frame = []
        for tid in ids:
            by_frame.append({p["frame"]: (p["x"], p["y"]) for p in hypos[tid]})
        common = set.intersection(*(set(b) for b in by_frame))
        for f in common:
            pts = [b[f] for b in by_frame]
            for i in range(len(pts)):
                for j in range(i + 1, len(pts)):
                    d = ((pts[i][0] - pts[j][0]) ** 2
                         + (pts[i][1] - pts[j][1]) ** 2) ** 0.5
                    max_path = max(max_path, d)
        ends = [hypos[tid][-1] for tid in ids if hypos[tid]]
        for i in range(len(ends)):
            for j in range(i + 1, len(ends)):
                d = ((ends[i]["x"] - ends[j]["x"]) ** 2
                     + (ends[i]["y"] - ends[j]["y"]) ** 2) ** 0.5
                impact_gap = max(impact_gap, d)

    top_times = [ev.get("top", {}).get("time_s") for ev in events.values()
                 if ev.get("top")]
    top_gap = (max(top_times) - min(top_times)) if len(top_times) >= 2 else 0.0

    ambiguous = (impact_gap > IMPACT_DIVERGENCE or top_gap > TOP_DIVERGENCE_S
                 or max_path > PATH_DIVERGENCE)
    return {"max_path": round(max_path, 5), "impact_gap": round(impact_gap, 5),
            "top_gap_s": round(top_gap, 4), "ambiguous": ambiguous}


def deterministic_winner(hypos: dict[str, list[dict]]) -> str:
    """Fallback pick with no AI: the hypothesis with the highest confidence-mass."""
    def mass(pts):
        return sum(p["confidence"] for p in pts) / max(len(pts), 1)
    return max(sorted(hypos), key=lambda tid: mass(hypos[tid]))


def build_prompt(labels: dict[str, str], metrics: dict, image_paths: list[str]) -> str:
    letter = dict(zip(sorted(labels), ["a", "b", "c"]))
    lines = [
        "You are adjudicating between club-head trajectory hypotheses for a golf swing.",
        "Look at the attached frames: each shows the SAME frame with each hypothesis's",
        "club-head position drawn as a labeled colored dot (A=red, B=green, C=blue).",
        "",
        "Hypotheses:",
    ]
    for tid, name in sorted(labels.items()):
        lines.append(f"  candidate_{letter[tid]}: {name}")
    lines += [
        "",
        f"Structured metrics: {json.dumps(metrics)}",
        "",
        "Images to inspect:",
        *[f"  {p}" for p in image_paths],
        "",
        "Choose which candidate best matches the actual club head across the frames,",
        "or 'none' if no candidate is credible. Respond with ONLY a JSON object:",
        '{"decision": "candidate_a|candidate_b|candidate_c|none",',
        ' "confidence": 0.0-1.0,',
        f' "reason_code": one of {list(REASON_CODES)},',
        ' "top_adjustment_frames": integer -6..6,',
        ' "impact_adjustment_frames": integer -6..6}',
        "No prose, no markdown fences — the JSON object only.",
    ]
    return "\n".join(lines)


def validate_response(obj: dict, n_candidates: int) -> str | None:
    """None if valid, else the validation error to append on retry."""
    if not isinstance(obj, dict):
        return "response is not a JSON object"
    d = obj.get("decision")
    allowed = list(DECISIONS[:n_candidates]) + ["none"]
    if d not in allowed:
        return f"decision must be one of {allowed}"
    c = obj.get("confidence")
    if not isinstance(c, (int, float)) or not 0 <= c <= 1:
        return "confidence must be a number in [0,1]"
    if obj.get("reason_code") not in REASON_CODES:
        return f"reason_code must be one of {list(REASON_CODES)}"
    for k in ("top_adjustment_frames", "impact_adjustment_frames"):
        v = obj.get(k, 0)
        if not isinstance(v, int) or not -6 <= v <= 6:
            return f"{k} must be an integer in [-6,6]"
    return None


def _extract_json(raw: str) -> dict | None:
    try:
        start = raw.index("{")
        end = raw.rindex("}")
        return json.loads(raw[start:end + 1])
    except (ValueError, json.JSONDecodeError):
        return None


def claude_cli_provider(prompt: str) -> dict | None:
    """One `claude -p` call. Returns the parsed inner JSON or None on any failure.

    The prompt goes over STDIN, never argv. `shutil.which("claude")` resolves to
    claude.CMD on Windows, and cmd.exe ends a quoted argument at its first newline —
    build_prompt() is multi-line, so passing it as argv silently delivered only line 1
    ("You are adjudicating between...") with no hypotheses, metrics or image paths. The
    model then had nothing to choose between, failed validation twice and fell back,
    burning two CLI calls per ambiguous swing. stdin also dodges cmd.exe's ~8 KB
    command-line limit and any quoting of prompt text.
    """
    try:
        res = subprocess.run(
            # --allowedTools Read: the prompt references crop image paths the model must
            # open; headless -p has no interactive permission prompt, so grant Read only.
            [CLAUDE, "-p", "--output-format", "json", "--allowedTools", "Read"],
            input=prompt,
            capture_output=True, text=True, timeout=TIMEOUT_S, shell=False,
            encoding="utf-8", errors="replace",
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if res.returncode != 0:
        return None
    outer = _extract_json(res.stdout)
    if outer is None:
        return None
    # --output-format json wraps the assistant text in {"result": "..."}
    text = outer.get("result") if isinstance(outer.get("result"), str) else res.stdout
    return _extract_json(text) if text else None


def adjudicate(prompt: str, n_candidates: int, cache_path: Path | None = None,
               provider=None) -> tuple[dict | None, str]:
    """Returns (validated response | None, status). Status:
    'cached' | 'ai' | 'ai_retry' | 'fallback'."""
    key = hashlib.sha256((PROMPT_VERSION + prompt).encode()).hexdigest()[:24]
    if cache_path is not None and cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cache = {}
        if key in cache:
            return cache[key], "cached"
    else:
        cache = {}

    provider = provider or claude_cli_provider
    status = "ai"
    obj = provider(prompt)
    err = validate_response(obj, n_candidates) if obj is not None else "no response"
    if err:
        status = "ai_retry"
        obj = provider(prompt + f"\n\nYour previous answer was invalid: {err}. "
                                "Reply with the corrected JSON object only.")
        err = validate_response(obj, n_candidates) if obj is not None else "no response"
    if err:
        return None, "fallback"

    if cache_path is not None:
        cache[key] = obj
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
    return obj, status
