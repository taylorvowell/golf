"""
Where the ball was struck, heard rather than seen.

**This is a second, independent witness to Impact, and that is the whole reason it exists.**
Everything else in this package infers the strike from the picture — the club head's low point,
the hands' height, the speed profile — and those all fail together on the same clip, because they
are all reading the same pixels. A microphone is not reading the pixels. When the video-side
answer is ambiguous (`events.py` already has a documented case where speed-based detection and
the hand-height landmark disagree), a third opinion that shares none of their failure modes is
worth more than a fourth refinement of the same signal.

**It is a witness, never the verdict.** Video wins on precision and always will: at 60 fps a frame
is 17 ms, the club-head low point is a geometric fact, and the audio is subject to whatever
latency the recording pipeline had that day — measured at 121-148 ms of lag on five clips shot
with a stock camera app, and never measured at all on SwingSage's own recorder. So this answers
"which of these candidate frames is the strike", and it must never be allowed to answer "the
strike is at frame N".

## Why THIS detector

Nine were tried (`SwingClip.Method` on Android, `scripts/checkaudio.py` here). Eight of them
describe the transient — how loud, how sharp, how fast the attack, how quickly it decays — and
all eight lose to a louder transient. On real long takes the louder transient routinely is not
the swing: a ball dropped on the mat, a club tapped on the floor, the knock of a thumb on the
phone at Record, a shot from the next bay.

The one that works adds the question none of the others ask: **was anything swinging?** A club
head accelerating towards 100 mph is a broadband hiss that climbs for about 200 ms and stops dead
at contact. Every impostor above is a click with silence in front of it.

Measured against `scripts/audio_truth.json` — hand-labelled strike frames for the five long takes
in `fixtures/raw/`, read off frame-accurate strips — this scores 5/5 inside 250 ms, median error
0 ms, worst 10 ms, unchanged with the edge prior switched off. Every other method scored 3/5 or
worse on the same clips.

**That ground truth is five clips, one golfer, one indoor simulator bay, right-handed,
down-the-line.** It is the first falsifiable accuracy claim this project has and it is not a
general one. No outdoor take, no left-hander, no second device, no wind. Treat it as enough to
have rejected the other eight and nowhere near enough to trust a number from.
"""

from __future__ import annotations

import math
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

#: Short-time analysis window. 5 ms is fine enough to resolve a strike's attack and coarse enough
#: that a 30 s clip is only 6,000 windows.
WINDOW_S = 0.005

#: Where a strike lives and a voice, a gust and a footstep do not. A club-ball contact is a
#: broadband click with real energy well past 4 kHz; speech has rolled off, wind is near-DC and a
#: footstep is a low thud. From the physics of the sources, not tuned against a clip.
HIGH_BAND_HZ = 4000.0

#: How far above its local floor, and above the window before it, a candidate must rise.
PEAK_RATIO = 4.0
ATTACK_RATIO = 2.0

#: The background floor is a median of half-second blocks over a two-second neighbourhood. Half a
#: second is a hundred windows, far more than any transient occupies, so a strike cannot drag its
#: own block's median up — which is exactly what an EMA seeded from the clip's opening does.
BACKGROUND_BLOCK_S = 0.5
BACKGROUND_SPAN_S = 2.0

#: The swing-up: how long before contact the club is audibly moving, and the gap left in front of
#: contact itself so the click does not measure its own leading edge.
SWISH_LOOKBACK_S = 0.20
SWISH_GUARD_S = 0.03

#: Uncapped, the swish term does the opposite of its job — a WEAK click inside continuous noise
#: (a golfer walking back with the club swinging at their side) measures an enormous ramp against
#: its own local median and beats a strike thirty times louder. Cubed because the raw separation
#: is only ~1.7x while the impostors it must beat are up to 2.2x LOUDER, and a linear weight does
#: not turn the ranking over.
SWISH_CAP = 2.5
SWISH_POWER = 3.0

#: Candidates closer together than this are one event — a strike and its own echo off a bay wall.
MIN_SEPARATION_S = 0.35


@dataclass(frozen=True)
class AudioImpact:
    """One heard strike. `score` orders candidates within a clip and means nothing across clips."""

    time_sec: float
    score: float
    #: 0-1, from how far this candidate stands clear of the next-best one. Deliberately a measure
    #: of SEPARATION, not of strength: a loud clip is not a confident one, and two similar
    #: candidates are exactly the case a consumer must be told about.
    confidence: float


def _decode_mono(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 in [-1, 1] at the track's own rate. Empty when the clip carries no audio."""
    probe = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=False,
    )
    lines = probe.stdout.strip().splitlines()
    if not lines or not lines[0].strip().isdigit():
        return np.zeros(0, dtype=np.float32), 0
    rate = int(lines[0])
    proc = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(path), "-vn", "-ac", "1",
         "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True, check=False,
    )
    return np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0, rate


def highpass(x: np.ndarray, rate: int, cutoff: float) -> np.ndarray:
    """
    2nd-order Butterworth high-pass (RBJ cookbook), with its coefficients derived in the open.

    The derivation is written out rather than pulled from `scipy.signal.butter` because these five
    numbers ARE the specification the Android port implements sample by sample, and a detector
    whose analyzer filter differed from its phone filter would be two detectors wearing one name.
    """
    w0 = 2.0 * math.pi * cutoff / rate
    cos0 = math.cos(w0)
    alpha = math.sin(w0) / (2.0 * math.sqrt(0.5))
    a0 = 1.0 + alpha
    b0 = b2 = (1.0 + cos0) / 2.0 / a0
    b1 = -(1.0 + cos0) / a0
    a1 = (-2.0 * cos0) / a0
    a2 = (1.0 - alpha) / a0

    # The COEFFICIENTS above are the specification; the recursion below is just how it is
    # evaluated, and scipy runs the identical difference equation in C. A 30 s clip is 1.4M
    # samples, which is a second and a half of interpreted loop for no difference in output.
    from scipy.signal import lfilter

    return lfilter([b0, b1, b2], [1.0, a1, a2], x).astype(x.dtype, copy=False)


def band_envelope(pcm: np.ndarray, rate: int) -> np.ndarray:
    """RMS per 5 ms window of the signal above `HIGH_BAND_HZ`."""
    spw = max(1, int(rate * WINDOW_S))
    n = len(pcm) // spw
    if n < 8:
        return np.zeros(0)
    high = highpass(pcm[: n * spw], rate, HIGH_BAND_HZ).reshape(n, spw)
    return np.sqrt((high ** 2).mean(axis=1))


def background_floor(env: np.ndarray) -> np.ndarray:
    """Median of half-second blocks, then the median of the blocks around each — two cheap passes."""
    if not len(env):
        return env
    block = max(1, int(BACKGROUND_BLOCK_S / WINDOW_S))
    blocks = (len(env) + block - 1) // block
    per_block = np.array([np.median(env[b * block:(b + 1) * block]) for b in range(blocks)])
    reach = max(1, int((BACKGROUND_SPAN_S / BACKGROUND_BLOCK_S) // 2))
    smoothed = np.array([
        np.median(per_block[max(0, b - reach):b + reach + 1]) for b in range(blocks)
    ])
    return np.maximum(np.repeat(smoothed, block)[: len(env)], 1e-6)


def _swish_gain(env: np.ndarray, floor: np.ndarray, i: int) -> float:
    """How much air the club was moving just before instant `i`. See the module docstring."""
    lo = max(0, i - int(SWISH_LOOKBACK_S / WINDOW_S))
    hi = max(lo + 1, i - int(SWISH_GUARD_S / WINDOW_S))
    return min(float(env[lo:hi].mean() / floor[i]), SWISH_CAP)


def score_band(env: np.ndarray) -> list[tuple[float, float]]:
    """
    `(time_sec, score)` for every window that looks like a strike, unsorted and unseparated.

    Split out from `candidates` so the bench (`scripts/checkaudio.py`) can score the SAME function
    the pipeline runs instead of keeping a second copy of it. Two implementations under one name
    is how a detector ends up measured in one place and shipped in another.
    """
    if len(env) < 8:
        return []
    floor = background_floor(env)
    ratio = env / floor
    prev = np.concatenate([[1e-6], np.maximum(env[:-1], 1e-6)])
    attack = env / prev
    hits = np.flatnonzero((ratio > PEAK_RATIO) & (attack > ATTACK_RATIO))

    out: list[tuple[float, float]] = []
    for i in hits:
        i = int(i)
        gain = _swish_gain(env, floor, i) ** SWISH_POWER
        out.append((i * WINDOW_S, float(ratio[i] * attack[i] * gain)))
    return out


def separate(scored: list[tuple[float, float]], limit: int) -> list[tuple[float, float]]:
    """Strongest first, dropping anything within one separation window of a stronger pick — a
    strike and its echo off the bay wall are one event, not two candidates."""
    merged: list[tuple[float, float]] = []
    for t, sc in sorted(scored, key=lambda c: -c[1]):
        if sc <= 0:
            break
        if all(abs(m[0] - t) >= MIN_SEPARATION_S for m in merged):
            merged.append((t, sc))
        if len(merged) >= limit:
            break
    return merged


def candidates(path: Path | str, limit: int = 3) -> list[AudioImpact]:
    """
    Heard strikes in the clip, strongest first.

    **An empty list is a normal answer**, not an error: a clip with no audio track, a muted take,
    a windy range, an indoor mat. Every consumer falls back to what it would have done anyway.
    """
    pcm, rate = _decode_mono(Path(path))
    if not len(pcm):
        return []

    merged = separate(score_band(band_envelope(pcm, rate)), limit)
    if not merged:
        return []

    best = merged[0][1]
    runner_up = merged[1][1] if len(merged) > 1 else 0.0
    # Separation, not strength: 1.0 when nothing else came close, falling towards 0 as a second
    # candidate approaches the winner. A consumer that only acts on a clear answer reads this.
    clearance = 1.0 - (runner_up / best if best > 0 else 1.0)
    return [
        AudioImpact(t, sc, round(clearance if k == 0 else 0.0, 3))
        for k, (t, sc) in enumerate(merged)
    ]


def heard_impact(path: Path | str) -> AudioImpact | None:
    """The single best heard strike, or None when the clip says nothing."""
    found = candidates(path, limit=3)
    return found[0] if found else None
