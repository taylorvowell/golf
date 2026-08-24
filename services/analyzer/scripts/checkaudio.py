"""
The strike, heard: every audio impact detector's answer drawn on the frame it picked.

The capture screen seeds its "where you hit the ball" mark from the recorded audio, and the
native detector that does it (`SwingClip.kt`) has eight methods and no ground truth — the
project's own note on it says so, twice. This script is the missing half: it re-implements each
method against the SAME 5 ms envelope maths, runs them over a real long take, and then draws the
video frame at the time each one chose.

That last part is the whole point. A candidate list is unfalsifiable; a picture of a club three
feet from the ball is not. This is `checkclub.py`'s trick applied to sound.

    python scripts/checkaudio.py fixtures/raw/6iron-1.mp4 [more.mp4 ...]
        --out out/audio          where the sheets go
        --methods hf,sharp,...   only these
        --no-edge                turn the first/last-five-seconds prior off

Nothing here runs in the product. It exists to decide what the product should do.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from swingsage import audio_impact  # noqa: E402  - after the path insert, by necessity

# ---------------------------------------------------------------- the shared constants
# Deliberately the SAME numbers as SwingClip.kt. A bench tuned to different constants measures
# a detector the phone does not run.

WINDOW_MS = 5.0
PEAK_RATIO = 4.0
BACKGROUND_ALPHA = 0.02
MIN_SEPARATION_S = 0.35
EDGE_SEC = 5.0
EDGE_FLOOR = 0.15
EDGE_MAX_FRACTION = 0.25
#: `captureConstants.ts` - a candidate this far below the strongest is noise, not a second swing.
CANDIDATE_FLOOR = 0.45


@dataclass
class Impact:
    time_sec: float
    score: float


# ---------------------------------------------------------------- decode


def decode_audio(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 in [-1, 1], at the file's own rate. Empty when the clip has no audio."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    lines = probe.stdout.strip().splitlines()
    if not lines:
        return np.zeros(0, dtype=np.float32), 0
    rate = int(lines[0])
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
         "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True,
    )
    pcm = np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0
    return pcm, rate


@dataclass
class Envelopes:
    """The three short-time views SwingClip builds in one decode pass, plus a spectral one."""
    peak: np.ndarray
    hf: np.ndarray
    rms: np.ndarray
    #: Energy above HIGH_BAND_HZ per window, from an STFT. NOT in the native detector yet -
    #: this is the candidate replacement for its one-tap difference.
    band: np.ndarray
    window_sec: float
    #: The samples themselves, so `by_swish` can hand them to the shipped detector rather than
    #: re-deriving an envelope that would then be a different detector wearing the same name.
    pcm: np.ndarray
    rate: int


#: Where a strike lives and a voice, a footstep and wind do not. A club-ball contact is a
#: broadband click whose energy runs well past 4 kHz; speech rolls off by 4, wind is
#: near-DC, and a footstep is a low thud. Chosen from the physics, not tuned.
HIGH_BAND_HZ = 4000.0


def envelopes(pcm: np.ndarray, rate: int) -> Envelopes:
    window_sec = WINDOW_MS / 1000.0
    spw = max(1, int(rate * window_sec))
    n = len(pcm) // spw
    if n < 4:
        z = np.zeros(0)
        return Envelopes(z, z, z, z, window_sec, pcm, rate)
    flat = pcm[: n * spw]
    trimmed = flat.reshape(n, spw)

    peak = np.abs(trimmed).max(axis=1)
    rms = np.sqrt((trimmed ** 2).mean(axis=1))
    # One-tap high-pass, exactly the native abs(sample - previousSample) - including the seam
    # between windows, which the Kotlin carries in `previousSample`.
    hf = np.abs(np.diff(flat, prepend=np.float32(0.0))).reshape(n, spw).max(axis=1)

    # The high-band view. A 2nd-order Butterworth high-pass run over the samples, then RMS per
    # window - NOT an FFT. Same quantity, and it costs five multiplies per sample with no
    # buffering, which is what lets the native decoder compute it inside the loop it already has.
    band = audio_impact.band_envelope(flat, rate)[:n]

    return Envelopes(peak, hf, rms, band, window_sec, pcm, rate)


# ---------------------------------------------------------------- the native methods, ported


def by_attack(env: np.ndarray, window_sec: float) -> list[Impact]:
    """SwingClip.byAttack - ratio to a running background AND rise over the previous window."""
    if len(env) < 4:
        return []
    background = max(float(env[: min(len(env), 40)].mean()), 1e-6)
    found: list[Impact] = []
    for i in range(1, len(env)):
        v = float(env[i])
        prev = max(float(env[i - 1]), 1e-6)
        ratio = v / background
        attack = v / prev
        if ratio > PEAK_RATIO and attack > 2.0:
            found.append(Impact(i * window_sec, ratio * attack))
        if ratio < PEAK_RATIO:
            background = background * (1 - BACKGROUND_ALPHA) + v * BACKGROUND_ALPHA
    return found


def by_level(env: np.ndarray, window_sec: float) -> list[Impact]:
    return [Impact(i * window_sec, float(v)) for i, v in enumerate(env)]


def by_flux(env: np.ndarray, window_sec: float) -> list[Impact]:
    return [Impact(i * window_sec, max(0.0, float(env[i] - env[i - 1])))
            for i in range(1, len(env))]


def by_crest(e: Envelopes) -> list[Impact]:
    n = min(len(e.peak), len(e.rms))
    if n == 0:
        return []
    audible = float(e.peak.max()) * 0.05
    return [Impact(i * e.window_sec, float(e.peak[i]) / max(float(e.rms[i]), 1e-5))
            for i in range(n) if e.peak[i] >= audible]


def by_decay(env: np.ndarray, window_sec: float) -> list[Impact]:
    out: list[Impact] = []
    for i in range(1, len(env) - 2):
        rise = float(env[i] - env[i - 1])
        fall = float(env[i] - env[i + 2])
        out.append(Impact(i * window_sec, rise * fall if rise > 0 and fall > 0 else 0.0))
    return out


def by_sharp(e: Envelopes) -> list[Impact]:
    n = min(len(e.hf), len(e.peak))
    out: list[Impact] = []
    for cand in by_attack(e.hf[:n], e.window_sec):
        i = min(max(int(cand.time_sec / e.window_sec), 0), n - 1)
        out.append(Impact(cand.time_sec, cand.score * float(e.peak[i])))
    return out


# ---------------------------------------------------------------- the candidate replacements


#: How finely the background floor is sampled. Half a second holds a hundred 5 ms windows - far
#: more than any transient occupies, so a strike cannot move its own block's median.
BACKGROUND_BLOCK_S = 0.5


def rolling_background(env: np.ndarray, seconds: float, window_sec: float) -> np.ndarray:
    """The shipped floor, so the bench's `band`/`click` are measured against the same one."""
    return audio_impact.background_floor(env)


def by_band_onset(e: Envelopes) -> list[Impact]:
    """
    Rise in HIGH-BAND energy over a robust local floor.

    The idea HF was reaching for, done with a spectrum instead of a first difference. A one-tap
    difference is not a high-pass with a corner anywhere near a strike: its gain rises linearly
    with frequency, so a LOUD low thump still out-scores a quiet click, which is exactly the
    confusion the method exists to avoid. Band energy above 4 kHz has no such leak.
    """
    if len(e.band) < 8:
        return []
    floor = rolling_background(e.band, 2.0, e.window_sec)
    ratio = e.band / floor
    prev = np.concatenate([[1e-6], np.maximum(e.band[:-1], 1e-6)])
    attack = e.band / prev
    hits = np.flatnonzero((ratio > PEAK_RATIO) & (attack > 2.0))
    return [Impact(int(i) * e.window_sec, float(ratio[i] * attack[i])) for i in hits]


def by_click(e: Envelopes) -> list[Impact]:
    """
    Band onset x impulsiveness x decay - three independent facts about a ball strike, ANDed.

    Each term rejects a different impostor and none of them is loudness:
      * band onset - the energy above 4 kHz jumps out of its own local floor (rejects wind,
        footsteps, traffic, anything with a low centre of mass);
      * crest - the window is one spike in near-silence rather than a wall of sound (rejects
        a shout, a mower, a gust filling the window);
      * decay - it is over two windows later (rejects everything that sustains, which is
        everything except an impact).
    Multiplied rather than summed on purpose: a candidate that fails ANY of the three is not a
    strike, and a sum lets one enormous term carry two failures.
    """
    n = min(len(e.band), len(e.peak), len(e.rms))
    if n < 8:
        return []
    floor = rolling_background(e.band[:n], 2.0, e.window_sec)
    ratio = e.band[:n] / floor
    prev = np.concatenate([[1e-6], np.maximum(e.band[: n - 1], 1e-6)])
    attack = e.band[:n] / prev
    crest = e.peak[:n] / np.maximum(e.rms[:n], 1e-5)
    # Two windows out: a strike's own ring-down owns the window immediately after it.
    fall = np.zeros(n)
    fall[: n - 2] = e.band[: n - 2] / np.maximum(e.band[2:n], 1e-6)

    out: list[Impact] = []
    for i in range(1, n - 2):
        if ratio[i] <= PEAK_RATIO or attack[i] <= 2.0 or fall[i] <= 1.0:
            continue
        out.append(Impact(i * e.window_sec, float(ratio[i] * attack[i] * crest[i] * fall[i])))
    return out



def by_swish(e: Envelopes) -> list[Impact]:
    """
    **The shipped method — and this calls the SHIPPED CODE**, `swingsage.audio_impact`, rather
    than a bench copy of it.

    Every other method in this file is a port, re-implemented here so the phone's eight legacy
    discriminators can be compared at all. `swish` is not: it is what runs in the analyzer and
    (as Kotlin) on the phone, so a bench copy would be a third implementation whose score belonged
    to none of them. The envelope it reads is `audio_impact.band_envelope` too, for the same
    reason — the filter IS the detector.
    """
    return [Impact(t, sc) for t, sc in audio_impact.score_band(audio_impact.band_envelope(
        e.pcm, e.rate))]


def snap_to_onset(e: Envelopes, time_sec: float) -> float:
    """
    Walk back to where the burst STARTED.

    `separate` keeps the loudest window of an event, and the loudest window of a strike is not
    the first one - the ball hitting a simulator screen 45 ms later is louder than the club
    hitting the ball. The moment being reported is contact, so the answer is the leading edge of
    the run, not its summit.
    """
    floor = rolling_background(e.band, 2.0, e.window_sec)
    i = int(round(time_sec / e.window_sec))
    i = min(max(i, 0), len(e.band) - 1)
    while i > 0 and e.band[i - 1] > floor[i - 1] * PEAK_RATIO:
        i -= 1
    return i * e.window_sec


# ---------------------------------------------------------------- the pick, as the app makes it


def weight_by_time(cands: list[Impact], duration: float, enabled: bool) -> list[Impact]:
    if not enabled or duration <= 0:
        return cands
    edge = min(EDGE_SEC, duration * EDGE_MAX_FRACTION)
    if edge <= 0:
        return cands
    out: list[Impact] = []
    for c in cands:
        nearest = min(c.time_sec, duration - c.time_sec)
        if nearest >= edge:
            out.append(c)
        else:
            ramp = min(max(nearest / edge, 0.0), 1.0)
            out.append(Impact(c.time_sec, c.score * (EDGE_FLOOR + (1 - EDGE_FLOOR) * ramp)))
    return out


def separate(scored: list[Impact], limit: int) -> list[Impact]:
    merged: list[Impact] = []
    for c in sorted(scored, key=lambda x: -x.score):
        if c.score <= 0.0:
            break
        if all(abs(m.time_sec - c.time_sec) >= MIN_SEPARATION_S for m in merged):
            merged.append(c)
        if len(merged) >= limit:
            break
    return merged


def by_ensemble(e: Envelopes, methods: dict) -> list[Impact]:
    votes: list[Impact] = []
    for name, fn in methods.items():
        top = separate(fn(e), 3)
        best = max((c.score for c in top), default=0.0)
        if best <= 0:
            continue
        votes.extend(Impact(c.time_sec, c.score / best) for c in top)
    if not votes:
        return []
    pooled: list[Impact] = []
    for v in sorted(votes, key=lambda x: x.time_sec):
        if pooled and abs(pooled[-1].time_sec - v.time_sec) < MIN_SEPARATION_S:
            last = pooled[-1]
            total = last.score + v.score
            pooled[-1] = Impact(
                (last.time_sec * last.score + v.time_sec * v.score) / total, total
            )
        else:
            pooled.append(v)
    return pooled


def seed(cands: list[Impact], floor: float = CANDIDATE_FLOOR) -> float | None:
    """
    The mark the review screen would start on.

    Historically: the LAST candidate within `floor` of the best, on the reasoning that a golfer
    takes a practice swing before the real one. Measured against `audio_truth.json`, that rule is
    what loses most of the clips it loses - on 6iron3 the real strike is the FIRST of three
    bursts and "take the last" walks straight past it, and on 6iron-1 it turns a correct top
    candidate into an answer four seconds into the walk back.

    The premise was wrong anyway. A practice swing is a whoosh with NO click on the end of it, so
    a detector that requires the click never had a practice swing near the top of its list; the
    rule was compensating for a scorer that could not tell them apart. Raising the floor keeps the
    case it is actually for - two real balls struck in one take, where the second genuinely
    should win - and drops the case it was never for.
    """
    if not cands:
        return None
    best = max(c.score for c in cands)
    real = [c for c in cands if c.score >= best * floor]
    real.sort(key=lambda c: c.time_sec)
    return real[-1].time_sec if real else None


NATIVE_METHODS = {
    "attack": lambda e: by_attack(e.peak, e.window_sec),
    "peak": lambda e: by_level(e.peak, e.window_sec),
    "hf": lambda e: by_attack(e.hf, e.window_sec),
    "flux": lambda e: by_flux(e.peak, e.window_sec),
    "sharp": by_sharp,
    "crest": by_crest,
    "decay": lambda e: by_decay(e.peak, e.window_sec),
}
CANDIDATE_METHODS = {
    "band": by_band_onset,
    "click": by_click,
    "swish": by_swish,
}
ALL_METHODS = {**NATIVE_METHODS, **CANDIDATE_METHODS}


def run_method(
    name: str, e: Envelopes, duration: float, edge: bool, floor: float, snap: bool
) -> tuple[float | None, list[Impact]]:
    raw = by_ensemble(e, NATIVE_METHODS) if name == "ensemble" else ALL_METHODS[name](e)
    cands = separate(weight_by_time(raw, duration, edge), 3)
    picked = seed(cands, floor)
    if picked is not None and snap:
        picked = snap_to_onset(e, picked)
    return picked, cands


# ---------------------------------------------------------------- the picture


def frame_at(path: Path, time_sec: float, width: int = 420) -> np.ndarray | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_MSEC, time_sec * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        return None
    h, w = frame.shape[:2]
    return cv2.resize(frame, (width, max(1, int(h * width / w))))


def sheet(path: Path, results: dict[str, tuple[float | None, list[Impact]]], out: Path) -> None:
    """One tile per method: the frame it chose, its time, and its runners-up."""
    tiles: list[np.ndarray] = []
    for name, (t, cands) in results.items():
        img = frame_at(path, t) if t is not None else None
        if img is None:
            img = np.full((560, 420, 3), 30, dtype=np.uint8)
        pad = np.full((img.shape[0] + 76, img.shape[1], 3), 18, dtype=np.uint8)
        pad[76:, :] = img
        label = f"{name}: {t:.3f}s" if t is not None else f"{name}: nothing heard"
        cv2.putText(pad, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        others = "  ".join(f"{c.time_sec:.2f}" for c in sorted(cands, key=lambda c: c.time_sec))
        cv2.putText(pad, others[:52], (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 200, 255), 1)
        tiles.append(pad)

    if not tiles:
        return
    height = max(t.shape[0] for t in tiles)
    tiles = [
        np.pad(t, ((0, height - t.shape[0]), (0, 0), (0, 0)), constant_values=18) for t in tiles
    ]
    per_row = 5
    rows = [np.hstack(tiles[i:i + per_row]) for i in range(0, len(tiles), per_row)]
    width = max(r.shape[1] for r in rows)
    rows = [
        np.pad(r, ((0, 0), (0, width - r.shape[1]), (0, 0)), constant_values=18) for r in rows
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.vstack(rows))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("out/audio"))
    ap.add_argument("--methods", default=",".join([*ALL_METHODS, "ensemble"]))
    ap.add_argument("--no-edge", action="store_true", help="turn the edge prior off")
    ap.add_argument("--floor", type=float, default=CANDIDATE_FLOOR,
                    help="how close to the best a LATER candidate must be to win")
    ap.add_argument("--snap", action="store_true", help="walk the pick back to the burst's onset")
    ap.add_argument("--truth", action="store_true",
                    help="score every method against scripts/audio_truth.json")
    args = ap.parse_args()

    truth: dict[str, dict[str, float]] = {}
    if args.truth:
        truth = json.loads((Path(__file__).with_name("audio_truth.json")).read_text())["clips"]
    errors: dict[str, list[float]] = {n: [] for n in
                                      [m.strip() for m in args.methods.split(",") if m.strip()]}

    names = [m.strip() for m in args.methods.split(",") if m.strip()]
    summary: dict[str, dict[str, float | None]] = {}

    for video in args.videos:
        pcm, rate = decode_audio(video)
        if not len(pcm):
            print(f"{video.name}: NO AUDIO TRACK - nothing to detect", file=sys.stderr)
            continue
        e = envelopes(pcm, rate)
        duration = len(e.peak) * e.window_sec
        results = {n: run_method(n, e, duration, not args.no_edge, args.floor, args.snap)
                   for n in names}
        summary[video.name] = {n: t for n, (t, _) in results.items()}
        print(f"\n{video.name}  ({duration:.1f}s audio, {rate} Hz)")
        want = truth.get(video.stem, {}).get("audio_onset_sec")
        for n, (t, cands) in results.items():
            picks = ", ".join(f"{c.time_sec:.3f}" for c in sorted(cands, key=lambda c: c.time_sec))
            shown = "none" if t is None else f"{t:.3f}"
            mark = ""
            if want is not None:
                # A miss is unbounded, so it is recorded as one rather than averaged into a mean
                # that would read as "half a second out" when the answer was a different event.
                err = 9.999 if t is None else t - want
                errors[n].append(err)
                mark = f"  err={err:+.3f}s {'HIT ' if abs(err) <= 0.25 else 'MISS'}"
            print(f"  {n:<9} seed={shown:<9} candidates=[{picks}]{mark}")
        sheet(video, results, args.out / f"{video.stem}.jpg")
        print(f"  -> {args.out / (video.stem + '.jpg')}")

    if truth:
        print()
        print(f"{'method':<10}{'hits':>7}{'median |err|':>14}{'worst':>10}")
        for n, errs in errors.items():
            if not errs:
                continue
            hits = sum(1 for x in errs if abs(x) <= 0.25)
            med = float(np.median([abs(x) for x in errs]))
            print(f"  {n:<8}{hits:>4}/{len(errs)}{med:>14.3f}{max(abs(x) for x in errs):>10.3f}")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
