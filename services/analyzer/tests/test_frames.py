"""The shared frame provider — one decode, cached planes, a bounded budget.

Every test here runs against a synthetic clip written by ffmpeg rather than a fixture: the
properties being pinned (how many times the file is read, how much is held, whether a plane
matches the call it replaced) are about the provider, not about any golfer.
"""
from __future__ import annotations

import subprocess

import cv2
import numpy as np
import pytest

from swingsage import frames as fm
from swingsage.video import FFMPEG


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    """24 frames of moving noise at 64x48 — small enough to be free, textured enough that
    Sobel and MOG2 have something real to say."""
    out = tmp_path_factory.mktemp("frames") / "clip.mp4"
    try:
        subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "testsrc2=size=64x48:rate=12:duration=2",
             "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
             "-g", "4", "-pix_fmt", "yuv420p", str(out)],
            check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError) as e:  # pragma: no cover — env-dependent
        pytest.skip(f"ffmpeg unavailable for synthetic clip: {e}")
    return out


def test_probe_matches_opencv(clip):
    fp = fm.FrameProvider(clip)
    cap = cv2.VideoCapture(str(clip))
    assert (fp.width, fp.height) == (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                                     int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    cap.release()
    assert fp.frame_count > 0
    assert fp.decode_passes == 0, "construction must not decode"


def test_grays_match_a_per_stage_decode(clip):
    """The planes every consumer now shares must equal the ones each used to build alone."""
    fp = fm.FrameProvider(clip)
    got = fp.grays

    cap = cv2.VideoCapture(str(clip))
    want = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        want.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()

    assert len(got) == len(want)
    for a, b in zip(got, want):
        assert np.array_equal(a, b)


def test_grays_decode_once_and_are_cached(clip):
    fp = fm.FrameProvider(clip)
    fp.grays
    assert fp.decode_passes == 1
    fp.grays
    fp.sobel(3)
    fp.bg_masks()
    assert fp.decode_passes == 1, "cached planes must never re-read the file"


def test_unbounded_stream_fills_the_gray_store(clip):
    """The piggyback that takes a full analysis from four decodes to three."""
    fp = fm.FrameProvider(clip)
    n = sum(1 for _ in fp.stream_bgr())
    assert fp.decode_passes == 1
    assert len(fp.grays) == n
    assert fp.decode_passes == 1, "the store was filled by the stream, not a second read"


def test_bounded_stream_does_not_fill_the_store(clip):
    """A short store would silently shorten every consumer downstream."""
    fp = fm.FrameProvider(clip)
    got = [f for f, _ in fp.stream_bgr(limit=5)]
    assert got == [0, 1, 2, 3, 4]
    assert fp._grays is None
    assert len(fp.grays) > 5


def test_abandoned_stream_does_not_commit_a_partial_store(clip):
    fp = fm.FrameProvider(clip)
    it = fp.stream_bgr()
    next(it)
    next(it)
    it.close()
    assert fp._grays is None
    assert len(fp.grays) == fp.frame_count


def test_sobel_matches_the_full_clip_precompute(clip):
    """Identical arithmetic to the list-comprehension it replaced — only lazier."""
    fp = fm.FrameProvider(clip)
    for f in (0, 4, 9):
        blur = cv2.GaussianBlur(fp.grays[f], (3, 3), 0)
        gx, gy = fp.sobel(f)
        assert np.array_equal(gx, cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3))
        assert np.array_equal(gy, cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3))


def test_sobel_cache_is_bounded(clip):
    fp = fm.FrameProvider(clip)
    for f in range(len(fp.grays)):
        fp.sobel(f)
    assert len(fp._sobel) == fm.SOBEL_CACHE


def test_bg_masks_match_a_local_mog2_and_are_shared(clip):
    """MOG2 is deterministic given the same planes and parameters, which is what makes one
    result shared across thirteen club solves parity-preserving rather than an approximation."""
    fp = fm.FrameProvider(clip)
    grays = fp.grays
    sub = cv2.createBackgroundSubtractorMOG2(
        history=len(grays), varThreshold=24, detectShadows=False)
    for g in grays:
        sub.apply(g, learningRate=-1)
    want = [sub.apply(g, learningRate=0.0) for g in grays]

    got = fp.bg_masks()
    assert len(got) == len(want)
    for f, w in enumerate(want):
        assert np.array_equal(got[f], w), f"frame {f}"
    assert fp.bg_masks() is got, "recomputing per caller is the cost this removes"


def test_packed_masks_round_trip_exactly():
    h, w = 7, 11
    pm = fm.PackedMasks(3, (h, w))
    rng = np.random.default_rng(0)
    for f in range(3):
        m = (rng.integers(0, 2, (h, w)) * 255).astype(np.uint8)
        pm.set(f, m)
        assert np.array_equal(pm[f], m)
    assert pm.nbytes < 3 * h * w


def test_batches_cover_every_frame_once(clip):
    fp = fm.FrameProvider(clip)
    seen = []
    for start, batch in fp.batches_bgr(5):
        assert start == len(seen)
        seen.extend(range(start, start + len(batch)))
    assert seen == list(range(fp.frame_count))


def test_batches_respect_the_limit(clip):
    fp = fm.FrameProvider(clip)
    got = sum(len(b) for _s, b in fp.batches_bgr(5, limit=7))
    assert got == 7


def test_budget_refuses_with_a_number_instead_of_being_oom_killed(clip):
    fp = fm.FrameProvider(clip, mem_ceiling_mb=0.0001)
    with pytest.raises(fm.FrameBudgetError) as e:
        fp.assert_budget()
    assert "MB" in str(e.value) and "ceiling" in str(e.value)
    with pytest.raises(fm.FrameBudgetError):
        fp.grays


def test_estimate_bytes_is_the_arithmetic_the_guard_can_reuse():
    """One place to be wrong, and it is the place that does the allocating."""
    n, w, h = 1200, 720, 1280
    got = fm.estimate_bytes(n, w, h)
    px = w * h
    assert got == n * px + n * ((px + 7) // 8) + fm.SOBEL_CACHE * 2 * px * 4
    assert 1.0e9 < got < 1.5e9, "a 1,200-frame 720p clip plans at ~1.2 GB, not ~12"


def test_high_water_tracks_what_is_actually_held(clip):
    fp = fm.FrameProvider(clip)
    assert fp.mem_high_water_mb == 0.0
    fp.grays
    fp.bg_masks()
    fp.sobel(1)
    assert fp.mem_high_water_mb > 0
    tel = fp.telemetry()
    assert tel["decode_passes"] == 1
    assert tel["frames"] == fp.frame_count
    assert tel["mem_high_water_mb"] == fp.mem_high_water_mb


def test_close_releases_the_planes(clip):
    fp = fm.FrameProvider(clip)
    fp.grays
    fp.bg_masks()
    fp.close()
    assert fp._grays is None and not fp._masks


def test_provider_for_reuses_and_reports_ownership(clip):
    mine = fm.FrameProvider(clip)
    got, owned = fm.provider_for(clip, mine)
    assert got is mine and owned is False
    got, owned = fm.provider_for(clip, None)
    assert isinstance(got, fm.FrameProvider) and owned is True
    got.close()


def test_missing_file_is_reported_at_construction(tmp_path):
    with pytest.raises(RuntimeError):
        fm.FrameProvider(tmp_path / "nope.mp4")


def test_bgr_at_returns_the_frame_it_was_asked_for(clip):
    """Seeking must land on the exact index, or the top-up measures the wrong frame.

    This is the load-bearing assumption of the forced top-up (`pose_rtm.estimate_at`): it
    reaches a couple of dozen scattered frames by seeking rather than by a fourth sequential
    pass, and a seek that lands one frame off would write a measurement under the wrong frame id
    — silently, and exactly at the event frames a score is read from. Checked by nearest-
    neighbour rather than by equality alone: "close to frame f" is not the claim, "closer to f
    than to f±3" is.
    """
    fp = fm.FrameProvider(clip)
    grays = fp.grays
    want = [0, 1, 5, 11, 12, len(grays) - 1]
    seen = 0
    for f, img in fp.bgr_at(want):
        got = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(int)
        scores = {k: float(np.abs(got - grays[k].astype(int)).mean())
                  for k in range(max(0, f - 3), min(len(grays), f + 4))}
        assert min(scores, key=scores.get) == f, f"seek to {f} landed on another frame: {scores}"
        seen += 1
    assert seen == len(want)


def test_bgr_at_is_counted_as_seeks_not_as_a_decode_pass(clip):
    """The pass count means "full sequential reads of the file". Charging a handful of seeks to
    it would make the number stop meaning that, which is the whole reason it is reported."""
    fp = fm.FrameProvider(clip)
    fp.grays                                    # one real pass
    before = fp.decode_passes
    list(fp.bgr_at([2, 7, 9]))
    assert fp.decode_passes == before
    assert fp.telemetry()["seek_reads"] == 3
