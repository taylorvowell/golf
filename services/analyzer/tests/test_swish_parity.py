"""The SWISH parity fixtures, Python half (C9 — video-analysis-redesign step 02).

Two swish implementations exist: this package's ``audio_impact`` (the analyzer's impact
witness) and the Kotlin ``SwingClip`` detector (the phone's review-window seed). They were
written separately and nothing pinned them to the same answers. These fixtures are the pin:
``tests/data/swish_parity.json`` states signals as PARAMETERS (a seeded noise floor, whooshes,
clicks), this test synthesizes the PCM and asserts the expectations against the Python path,
and the future Kotlin test synthesizes the SAME PCM from the SAME file and asserts the same
expectations. Sharing parameters rather than bytes is what makes one fixture file serve two
languages.

The Kotlin half does not exist yet — the expo-module has no gradle test infrastructure — and
is this step's named shortfall, recorded in the track's ``_PROGRESS.md``.

Real ffmpeg decodes the WAV here (the same decode path a real clip takes), so this suite is
skipped where ffmpeg is missing rather than failing on an unrelated machine.
"""
from __future__ import annotations

import json
import shutil
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import audio_impact  # noqa: E402

SPEC = json.loads((Path(__file__).parent / "data" / "swish_parity.json").read_text("utf-8"))

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not on PATH — the decode half of the path under test",
)


def synthesize(clip: dict) -> np.ndarray:
    """The clip's PCM, float32 [-1, 1] — deterministic, from parameters alone.

    A ``click`` is a broadband impulse with a fast exponential decay; a ``whoosh`` is
    band-limited noise with a smooth rise — deliberately simple shapes, because the point is
    agreement between two implementations, not realism.
    """
    rate = SPEC["sample_rate"]
    rng = np.random.default_rng(SPEC["noise_seed"])
    n = int(clip["duration_s"] * rate)
    pcm = rng.standard_normal(n).astype(np.float32) * SPEC["noise_floor_amplitude"]

    for event in clip["events"]:
        if event["kind"] == "click":
            at = int(event["at_s"] * rate)
            length = int(0.008 * rate)
            t = np.arange(length, dtype=np.float32)
            burst = rng.standard_normal(length).astype(np.float32) * np.exp(-t / (0.002 * rate))
            pcm[at:at + length] += event["amplitude"] * burst
        elif event["kind"] == "whoosh":
            start = int(event["start_s"] * rate)
            end = int(event["end_s"] * rate)
            length = end - start
            envelope = np.sin(np.linspace(0.0, np.pi, length)).astype(np.float32)
            body = rng.standard_normal(length).astype(np.float32)
            # Concentrate energy above the detector's high-pass, like air over a shaft does:
            # difference the noise (a crude high-pass) so the whoosh is heard, not buried.
            body = np.diff(body, prepend=0.0).astype(np.float32)
            pcm[start:end] += event["amplitude"] * envelope * body
    return np.clip(pcm, -1.0, 1.0)


def write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SPEC["sample_rate"])
        w.writeframes((pcm * 32767.0).astype("<i2").tobytes())


def _clip(name: str) -> dict:
    return next(c for c in SPEC["clips"] if c["name"] == name)


def test_the_canonical_strike_lands_on_the_click(tmp_path):
    clip = _clip("whoosh_then_click")
    wav = tmp_path / "whoosh_then_click.wav"
    write_wav(wav, synthesize(clip))
    found = audio_impact.candidates(wav)
    assert found, "a whoosh ending in a click must be heard"
    expect = clip["expect"]
    assert abs(found[0].time_sec - expect["top_candidate_s"]) <= expect["tolerance_s"]


def test_a_swung_click_beats_a_louder_bare_transient(tmp_path):
    # The whole reason swish shipped: the loudest transient on a real take is routinely a
    # dropped ball or a club tapped on the floor, and every strength-only method chases it.
    clip = _clip("bare_click_loses_to_swung_click")
    wav = tmp_path / "bare_vs_swung.wav"
    write_wav(wav, synthesize(clip))
    found = audio_impact.candidates(wav)
    assert found, "the swung click must be heard"
    expect = clip["expect"]
    assert abs(found[0].time_sec - expect["top_candidate_s"]) <= expect["tolerance_s"], (
        f"top candidate at {found[0].time_sec:.2f}s — the bare transient won over the swung click"
    )


def test_silence_answers_nothing_rather_than_inventing_a_strike(tmp_path):
    clip = _clip("silence_answers_nothing")
    wav = tmp_path / "silence.wav"
    write_wav(wav, synthesize(clip))
    found = audio_impact.candidates(wav)
    # The floor is featureless noise: whatever ranking falls out of it must not present a
    # CLEAR winner — a consumer acting only on separation reads confidence, and it must say
    # "nothing stands out here".
    assert not found or found[0].confidence < 0.5
