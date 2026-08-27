"""Shared frame access — one decode per video, derived planes computed where they are read.

Before this module every CV stage opened its own `cv2.VideoCapture` over the same
`analysis.mp4`: MediaPipe, RTMPose, the club detector, `club.track` (once per variant —
thirteen times with variants on) and `face.analyse`. Sixteen sequential decodes of one clip,
and four of them materialised the whole clip in RAM first. `club_detect.run` held every BGR
frame (~2.8 MB/frame at 720p); `club.track` held grays, a blurred copy, two float32 Sobel
planes and a full set of MOG2 masks (~10 MB/frame) — a 1,200-frame 240 fps take is ~12 GB
inside one call on a 16 GB worker, which is the latent OOM the audit named.

What changes here:

  * **One decode per resolution tier.** `analysis.mp4` is decoded once into a single
    contiguous `(n, h, w)` uint8 gray store that every gray consumer shares. Stages that need
    colour pixels stream them (`stream_bgr` / `batches_bgr`) with no residency at all.
  * **Derived planes are computed lazily, not up front.** Sobel gradients used to be
    materialised for the WHOLE clip even though `club.track` reads them only between Top and
    Impact+4 — a few dozen frames of several hundred. They are now produced on demand behind a
    small LRU, so the float32 planes never exceed a handful of frames.
  * **MOG2 runs once per video, not once per caller.** The two-pass train/read is a pure
    function of the gray planes and its parameters, so thirteen `club.track` calls over one
    clip shared no work at all. The one result is cached, bit-packed — with
    `detectShadows=False` the masks are binary, so packing round-trips exactly at an eighth of
    the residency.
  * **Residency is measured and bounded.** `assert_budget()` refuses a clip whose planes could
    not fit, with a number, rather than letting the kernel kill the worker mid-job.
    `estimate_bytes()` is the same arithmetic for a caller deciding BEFORE the decode — the
    workload guard's memory input.

Nothing here moves a pixel: every plane is produced by the same OpenCV call the stage used to
make for itself, in the same order, with the same parameters.
"""
from __future__ import annotations

import os
from collections import OrderedDict
from pathlib import Path
from typing import Iterator, Optional

import cv2
import numpy as np

#: Ceiling on the planes ONE provider holds. Deliberately well above any real clip
#: (a 3,000-frame 720p take plans at ~3.1 GB) — this exists to turn the 12 GB pathological
#: case into an attributable refusal, not to second-guess ordinary work.
DEFAULT_MEM_CEILING_MB = float(os.environ.get("SWINGSAGE_FRAME_MEM_MB", "6144"))

#: How many frames' Sobel planes stay resident. `club.track` walks f ascending and reads one
#: frame's gx/gy per iteration, so anything above 2 is slack for a caller that looks back;
#: six pairs of float32 at 720p is ~44 MB.
SOBEL_CACHE = 6

#: Frames decoded per streaming batch when a consumer asks for batches.
DEFAULT_CHUNK = 64


class FrameBudgetError(RuntimeError):
    """Planned plane residency exceeds the configured ceiling.

    Raised BEFORE the allocation, so the message can name the clip that would not fit instead
    of the process being killed with no attribution.
    """


class PackedMasks:
    """Bit-packed binary masks.

    MOG2 with `detectShadows=False` emits 0 or 255 and nothing between, so packing to one bit
    per pixel and unpacking on read is exact — not an approximation traded for space. Indexing
    returns the same `(h, w)` uint8 0/255 plane the caller would have got from a list.
    """

    def __init__(self, n: int, shape: tuple[int, int]):
        self.shape = shape
        self._n = n
        self._buf = np.zeros((n, (shape[0] * shape[1] + 7) // 8), np.uint8)

    def set(self, f: int, mask: np.ndarray) -> None:
        self._buf[f] = np.packbits(np.ascontiguousarray(mask > 0).reshape(-1))

    def __len__(self) -> int:
        return self._n

    def __getitem__(self, f: int) -> np.ndarray:
        h, w = self.shape
        bits = np.unpackbits(self._buf[f], count=h * w)
        return (bits.reshape(h, w) * np.uint8(255)).astype(np.uint8)

    @property
    def nbytes(self) -> int:
        return int(self._buf.nbytes)


def estimate_bytes(n_frames: int, width: int, height: int) -> int:
    """Planned plane residency for a clip of this size, before anything is decoded.

    The workload guard (step 01) multiplies its estimated frame count through this rather than
    carrying its own per-frame constant — one place to be wrong, and it is the place that
    actually does the allocating.
    """
    px = max(0, int(width)) * max(0, int(height))
    n = max(0, int(n_frames))
    gray = n * px
    masks = n * ((px + 7) // 8)
    sobel = SOBEL_CACHE * 2 * px * 4
    return int(gray + masks + sobel)


class FrameProvider:
    """Sequential decode of one video, shared by every stage that reads its pixels.

    Construction only probes; nothing is decoded until a consumer asks. `grays` and
    `bg_masks()` are cached for the provider's lifetime — that sharing IS the point, so a
    provider is scoped to one video for one job and closed with it.
    """

    def __init__(self, path: str | Path, *, mem_ceiling_mb: float | None = None,
                 chunk: int = DEFAULT_CHUNK):
        self.path = str(path)
        self.chunk = max(1, int(chunk))
        self.mem_ceiling_mb = float(
            mem_ceiling_mb if mem_ceiling_mb is not None else DEFAULT_MEM_CEILING_MB)

        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise RuntimeError(f"could not open {self.path}")
        self.fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()

        #: Full sequential reads of the file. The number this step exists to drive down, so it
        #: is counted rather than asserted — including the reads a consumer takes for itself.
        self.decode_passes = 0
        #: Individual frames pulled by seeking (`bgr_at`). Not a pass, and reported apart from
        #: one so the pass count keeps meaning "full sequential reads of the file".
        self.seek_reads = 0
        self._grays: Optional[np.ndarray] = None
        self._masks: dict[int, PackedMasks] = {}
        self._sobel: "OrderedDict[int, tuple[np.ndarray, np.ndarray]]" = OrderedDict()
        self._high_water = 0
        self._filling = False

    # ---------------------------------------------------------------- streaming (no residency)

    def stream_bgr(self, limit: int | None = None) -> Iterator[tuple[int, np.ndarray]]:
        """Yield `(frame_index, bgr)` in order, holding exactly one frame.

        The decoder is the only thing that owns memory here — the caller must not retain the
        array past its iteration, which is precisely the discipline `club_detect.run` used to
        break by appending every frame to a list.

        An UNBOUNDED stream also fills the gray store on its way past, when nothing has built
        one yet. That piggyback is what takes a full analysis from four decodes to three: the
        pose localiser reads every frame first and always, so the gray planes the club solver
        wants later are a colour conversion on pixels already in hand rather than a fourth
        read of the file. A bounded stream never fills it — a short store would silently
        shorten every consumer downstream.
        """
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise RuntimeError(f"could not open {self.path}")
        self.decode_passes += 1
        fill = limit is None and self._grays is None and not self._filling
        buf = None
        if fill:
            self.assert_budget()
            self._filling = True
            buf = np.empty((max(self.frame_count, 1), self.height, self.width), np.uint8)
        try:
            f = 0
            while limit is None or f < limit:
                ok, img = cap.read()
                if not ok:
                    break
                if buf is not None:
                    if f >= len(buf):
                        buf = np.concatenate(
                            [buf, np.empty((self.chunk, self.height, self.width), np.uint8)])
                    cv2.cvtColor(img, cv2.COLOR_BGR2GRAY, dst=buf[f])
                yield f, img
                f += 1
            if buf is not None:
                self._grays = buf[:f]
                self._note_residency()
        finally:
            # A consumer that breaks out early leaves a partial buffer, which must NOT become
            # the store: `close()` on the generator lands here with `_grays` still unset.
            self._filling = False
            cap.release()

    def batches_bgr(self, size: int | None = None,
                    limit: int | None = None) -> Iterator[tuple[int, list[np.ndarray]]]:
        """Yield `(start_index, [bgr, ...])` — for consumers that batch into a model."""
        size = self.chunk if size is None else max(1, int(size))
        batch: list[np.ndarray] = []
        start = 0
        for f, img in self.stream_bgr(limit=limit):
            if not batch:
                start = f
            batch.append(img)
            if len(batch) >= size:
                yield start, batch
                batch = []
        if batch:
            yield start, batch

    def bgr_at(self, frames) -> "Iterator[tuple[int, np.ndarray]]":
        """Yield `(frame_index, bgr)` for a SPARSE set, by seeking rather than streaming.

        Deliberately not a fourth sequential pass. The forced top-up re-measures a couple of
        dozen frames scattered across the clip, and reading the whole file again to reach them
        would undo the decode budget step 06 established for the sake of work that is under 3%
        of it. Seeking is the wrong tool for a hundred frames and the right one for twenty.

        Counted as `seek_reads`, not as a decode pass, because it is not one — conflating the
        two would make the pass count stop meaning what it was introduced to mean.
        """
        want = sorted({int(f) for f in frames})
        if not want:
            return
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise RuntimeError(f"could not open {self.path}")
        self.seek_reads += len(want)
        try:
            for f in want:
                cap.set(cv2.CAP_PROP_POS_FRAMES, f)
                ok, img = cap.read()
                if ok:
                    yield f, img
        finally:
            cap.release()

    # ------------------------------------------------------------------- cached gray planes

    @property
    def grays(self) -> np.ndarray:
        """The whole clip as one contiguous `(n, h, w)` uint8 array, decoded once.

        A real ndarray rather than a list of them, so `grays[f]`, `grays[f - 1]`, `len(grays)`
        and iteration all behave exactly as the list they replace — every consumer of the old
        `grays` list works unchanged — while the residency is one allocation instead of n.
        """
        if self._grays is None:
            self.assert_budget()
            h, w = self.height, self.width
            buf = np.empty((max(self.frame_count, 1), h, w), np.uint8)
            i = 0
            for _f, img in self.stream_bgr():
                if i >= len(buf):
                    # CAP_PROP_FRAME_COUNT under-reported. Grow rather than truncate: a short
                    # read here would silently shorten the analysis.
                    buf = np.concatenate([buf, np.empty((self.chunk, h, w), np.uint8)])
                cv2.cvtColor(img, cv2.COLOR_BGR2GRAY, dst=buf[i])
                i += 1
            self._grays = buf[:i]
            self._note_residency()
        return self._grays

    def sobel(self, f: int) -> tuple[np.ndarray, np.ndarray]:
        """Blurred-then-Sobel gradients for one frame, behind an LRU.

        Identical arithmetic to the full-clip precompute it replaces (3x3 Gaussian, then
        ksize-3 Sobel in each axis on the blurred plane) — the only change is WHEN, and how
        many exist at once.
        """
        hit = self._sobel.get(f)
        if hit is not None:
            self._sobel.move_to_end(f)
            return hit
        blur = cv2.GaussianBlur(self.grays[f], (3, 3), 0)
        gx = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)
        self._sobel[f] = (gx, gy)
        while len(self._sobel) > SOBEL_CACHE:
            self._sobel.popitem(last=False)
        self._note_residency()
        return gx, gy

    def bg_masks(self, history: int | None = None) -> PackedMasks:
        """MOG2 foreground masks for the whole clip, computed once per (video, history).

        The camera is static, so every pixel has a stable distribution over the clip; MOG2
        models each as a mixture, which is what lets wind-blown foliage settle into the
        background instead of being flagged every frame by plain differencing. Two passes —
        train, then read back at learningRate 0 — so early frames get the same quality as late
        ones. Deterministic given the same planes and parameters, which is why sharing one
        result across thirteen callers is parity-preserving rather than an approximation.
        """
        grays = self.grays
        n = len(grays)
        key = int(history or n)
        got = self._masks.get(key)
        if got is not None:
            return got

        sub = cv2.createBackgroundSubtractorMOG2(
            history=key, varThreshold=24, detectShadows=False)
        for g in grays:
            sub.apply(g, learningRate=-1)
        packed = PackedMasks(n, (self.height, self.width))
        for f, g in enumerate(grays):
            packed.set(f, sub.apply(g, learningRate=0.0))
        self._masks[key] = packed
        self._note_residency()
        return packed

    # ------------------------------------------------------------------------- accounting

    def plan_bytes(self, n_frames: int | None = None) -> int:
        n = self.frame_count if n_frames is None else n_frames
        return estimate_bytes(n, self.width, self.height)

    def assert_budget(self, n_frames: int | None = None) -> None:
        """Refuse, with a number, rather than being OOM-killed with none."""
        want = self.plan_bytes(n_frames)
        ceiling = self.mem_ceiling_mb * 1024 * 1024
        if want > ceiling:
            raise FrameBudgetError(
                f"{Path(self.path).name}: frame planes need "
                f"{want / 1024 / 1024:.0f} MB ({self.frame_count} frames at "
                f"{self.width}x{self.height}) against a {self.mem_ceiling_mb:.0f} MB ceiling. "
                f"Raise SWINGSAGE_FRAME_MEM_MB or trim the clip.")

    def _note_residency(self) -> None:
        held = 0
        if self._grays is not None:
            held += int(self._grays.base.nbytes if self._grays.base is not None
                        else self._grays.nbytes)
        held += sum(m.nbytes for m in self._masks.values())
        held += sum(gx.nbytes + gy.nbytes for gx, gy in self._sobel.values())
        self._high_water = max(self._high_water, held)

    @property
    def mem_high_water_mb(self) -> float:
        return round(self._high_water / 1024 / 1024, 1)

    def telemetry(self) -> dict:
        """The step-05 span fields this provider knows: how many decodes, and how much RAM."""
        return {
            "decode_passes": self.decode_passes,
            "seek_reads": self.seek_reads,
            "mem_high_water_mb": self.mem_high_water_mb,
            "frames": int(len(self._grays)) if self._grays is not None else self.frame_count,
            "width": self.width,
            "height": self.height,
        }

    # ----------------------------------------------------------------------------- lifetime

    def close(self) -> None:
        self._grays = None
        self._masks.clear()
        self._sobel.clear()

    def __enter__(self) -> "FrameProvider":
        return self

    def __exit__(self, *exc) -> bool:
        self.close()
        return False


def provider_for(path: str | Path, provider: FrameProvider | None = None
                 ) -> tuple[FrameProvider, bool]:
    """`(provider, owned)` — reuse the caller's, or make one this call must close.

    Every stage takes an optional provider so the pipeline can hand one shared instance to all
    of them, while a script, a test or a standalone `python -c` still calls the stage with a
    path alone and gets the old self-contained behaviour.
    """
    if provider is not None:
        return provider, False
    return FrameProvider(path), True
