"""Audio impact detection (test plan §21) — deterministic transient finding, no ML.

Audio gives impact TIMING LIKELIHOOD, never an unconditional timestamp (§3.11): the
acoustic peak sits after true contact by mic distance, mux offset and device processing,
so the result carries a conservative uncertainty and the fusion treats agreement with the
visual estimate as confidence, disagreement as something to expose.

`audio_event` never supplies coordinates — enforced by the EventEvidence shape itself.
The §21 required fallback is structural: no audio / no transient -> empty list, and the
visual estimator stands alone.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from swingsage.video import FFMPEG

SR = 16000
AV_OFFSET_UNCERTAINTY_S = 0.030   # conservative mux/mic allowance (§21)
MIN_SALIENCE = 4.0                # peak must stand this far above the local floor
AMBIGUITY_RATIO = 0.6             # second peak this close in strength -> ambiguous


def extract_audio(src: str | Path, sr: int = SR) -> np.ndarray | None:
    """Mono float32 waveform from the ORIGINAL upload (the derivatives are -an). None on
    any failure — silence is a normal condition, not an error."""
    try:
        out = subprocess.run(
            [FFMPEG, "-v", "error", "-i", str(src), "-vn", "-ac", "1",
             "-ar", str(sr), "-f", "s16le", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, OSError):
        return None
    if len(out) < sr // 10 * 2:   # under 100 ms of audio is no audio
        return None
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def onset_strength(wav: np.ndarray, sr: int = SR,
                   win_s: float = 0.008) -> np.ndarray:
    """High-frequency-emphasised short-time energy envelope (§21's non-ML detector:
    band emphasis -> rectify -> short window energy). Sampled per window hop."""
    hf = np.diff(wav, prepend=wav[:1])          # first difference = HF emphasis
    win = max(8, int(sr * win_s))
    n = len(hf) // win
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    env = np.sqrt((hf[:n * win].reshape(n, win) ** 2).mean(axis=1))
    return env.astype(np.float32)


def find_impact(wav: np.ndarray | None, window_s: tuple[float, float],
                sr: int = SR) -> dict | None:
    """The most salient short transient inside the visual search window.

    Returns {time_s, salience, ambiguous, uncertainty_s} or None (no audio / nothing
    salient). `time_s` is in SOURCE seconds. Long-duration noise (mowers, voices) fails
    the salience test because the local floor rises with it.
    """
    if wav is None or len(wav) == 0:
        return None
    env = onset_strength(wav, sr)
    if env.size == 0:
        return None
    hop = max(8, int(sr * 0.008))
    t_env = (np.arange(env.size) * hop + hop / 2) / sr

    lo, hi = window_s
    sel = (t_env >= lo) & (t_env <= hi)
    if not sel.any():
        return None
    idx = np.nonzero(sel)[0]
    seg = env[idx]

    floor = float(np.median(env)) + 1e-6
    salience = seg / floor
    best = int(np.argmax(salience))
    if salience[best] < MIN_SALIENCE:
        return None

    # ambiguity: another peak of comparable strength >40 ms away (competing range mats)
    t_best = float(t_env[idx[best]])
    far = np.abs(t_env[idx] - t_best) > 0.040
    ambiguous = bool(far.any() and salience[far].max() >= salience[best] * AMBIGUITY_RATIO)

    return {"time_s": t_best, "salience": float(salience[best]),
            "ambiguous": ambiguous, "uncertainty_s": AV_OFFSET_UNCERTAINTY_S}
