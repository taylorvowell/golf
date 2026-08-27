"""Which frames each subsystem actually looks at — decided once, explicitly, and recorded.

Every CV stage in this pipeline used to touch every normalized frame. That is defensible at
60 fps, where a clip is a few hundred frames; it is the whole cost problem at 240, where the
same swing is 1,200 frames and the interesting part of it is still about a second long. Running
a 384x288 top-down pose model over 1,200 frames to measure a golfer who is standing still for
two thirds of them is not thoroughness, it is arithmetic nobody chose.

So cadence stops being an emergent property of "the loop runs to the end" and becomes a
**policy**: a named, versioned object that a pure function turns into explicit frame sets, one
per subsystem. The sets are written into `analysis.json`, so what was looked at is a fact about
the artifact rather than a fact about the code that happened to produce it — an old artifact
stays reproducible when the default policy moves.

Two properties do the load-bearing work, and both are unit-tested rather than argued:

* **Determinism.** Same inputs and same policy version produce the same sets, byte for byte.
  Nothing here reads a clock, a random seed, or the environment beyond the policy name. That is
  what makes a stored `frame_policy` a re-runnable description rather than a log line.

* **The forced-frame guarantee.** Any frame a measurement is *taken at* — the eight events, the
  ten checkpoints — is in `pose_direct`. A scoring band read off an interpolated pose is a
  number with no observation under it, and the whole point of an adaptive cadence is that it
  must be invisible exactly where the pipeline reads values. `plan()` cannot return a plan that
  breaks this: forced frames are unioned into direct at the end, after every stride decision.

The legacy behaviour is not a special case in the pipeline, it is the policy `v0-dense` —
every frame direct, nothing propagated. That is what keeps this one pipeline instead of two:
the dense path is a plan, the adaptive path is a plan, and the stages consume plans.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterable, Sequence

#: The policy in force when nothing says otherwise. `SWINGSAGE_FRAME_POLICY` overrides it,
#: which is the rollback the step's Rollback section names — a pin back to `v0-dense` needs no
#: deploy, only an environment variable.
DEFAULT_POLICY = "v0-dense"

DENSE = "v0-dense"

#: `adaptive-v1@<refine_hz>` — the family the E2.1 ablation sweeps. The refine rate is IN the
#: version string on purpose: two runs at different cadences are two different policies, and an
#: artifact that recorded only "adaptive-v1" would not say which one produced it.
_ADAPTIVE_RE = re.compile(r"^adaptive-v1@(\d+(?:\.\d+)?)hz$")


@dataclass(frozen=True)
class Policy:
    """A named cadence rule. Frozen because a plan quotes its version as provenance."""

    version: str
    #: Every frame is a direct observation; nothing is propagated. The legacy shape.
    dense: bool = False
    #: Direct-inference rate inside the active swing, in Hz. Clamped by the clip's own fps —
    #: asking for 120 Hz on 60 fps footage means every frame, not an error.
    refine_hz: float = 60.0
    #: Direct-inference rate over the rest of the clip (approach, waggle, held finish).
    coarse_hz: float = 30.0
    #: Seconds of margin either side of the detected swing window that still count as active.
    #: The window comes from a COARSE detection, so it is approximately right; this is the
    #: allowance for that, not for the swing being longer than it is.
    swing_pad_s: float = 0.15

    @property
    def is_dense(self) -> bool:
        return self.dense

    def stride_in(self, fps: float) -> int:
        return _stride(fps, self.refine_hz)

    def stride_out(self, fps: float) -> int:
        return _stride(fps, self.coarse_hz)


def _stride(fps: float, hz: float) -> int:
    """Frames between direct observations to sample at `hz` on a clip running at `fps`.

    Rounded rather than floored so 60 fps at 30 Hz is stride 2 and not stride 1, and never less
    than 1 — a policy can ask for more observations than the clip has frames and simply get
    every frame.
    """
    if hz <= 0 or fps <= 0:
        return 1
    return max(1, int(round(fps / float(hz))))


def policy(name: str | None = None) -> Policy:
    """Resolve a policy name. Unknown names raise — a typo must not silently run dense."""
    name = (name or default_policy_name()).strip()
    if name == DENSE:
        return Policy(version=DENSE, dense=True)
    m = _ADAPTIVE_RE.match(name)
    if m:
        hz = float(m.group(1))
        return Policy(version=name, dense=False, refine_hz=hz, coarse_hz=min(30.0, hz))
    raise ValueError(
        f"unknown frame policy {name!r} — expected {DENSE!r} or 'adaptive-v1@<hz>hz'")


def default_policy_name() -> str:
    return os.environ.get("SWINGSAGE_FRAME_POLICY", "").strip() or DEFAULT_POLICY


# --------------------------------------------------------------------------- span encoding

def encode_spans(frames: Iterable[int]) -> list[list[int]]:
    """Sorted frame indices -> `[[start, stop, step], ...]`, stop EXCLUSIVE.

    A 1,200-frame dense set is one span, not 1,200 integers. The artifact carries the plan for
    reproducibility, and a plan that adds a megabyte to every artifact would be quietly dropped
    the first time someone measured payload size — so it is stored in the shape it was built in.
    Runs are greedy on a constant step, which is exactly how strided sampling comes out.
    """
    fs = sorted({int(f) for f in frames})
    if not fs:
        return []
    spans: list[list[int]] = []
    i = 0
    while i < len(fs):
        if i + 1 == len(fs):
            spans.append([fs[i], fs[i] + 1, 1])
            break
        step = fs[i + 1] - fs[i]
        j = i + 1
        while j + 1 < len(fs) and fs[j + 1] - fs[j] == step:
            j += 1
        if j == i + 1:
            # A pair only — emitting it as a strided run would swallow the next frame's own
            # step. Emit the head alone and reconsider from the second element.
            spans.append([fs[i], fs[i] + 1, 1])
            i += 1
            continue
        spans.append([fs[i], fs[j] + 1, step])
        i = j + 1
    return spans


def decode_spans(spans: Sequence[Sequence[int]]) -> list[int]:
    out: set[int] = set()
    for span in spans or ():
        start, stop, step = int(span[0]), int(span[1]), int(span[2] if len(span) > 2 else 1)
        out.update(range(start, stop, max(1, step)))
    return sorted(out)


def _clip(frames: Iterable[int], n: int) -> tuple[int, ...]:
    return tuple(sorted({f for f in (int(x) for x in frames) if 0 <= f < n}))


def _window(w, n: int) -> tuple[int, int] | None:
    if w is None:
        return None
    a, b = int(w[0]), int(w[1])
    a, b = max(0, min(a, n - 1)), max(0, min(b, n - 1))
    return (a, b) if b >= a else None


# ------------------------------------------------------------------------------- the inputs

@dataclass(frozen=True)
class PlanInputs:
    """Everything the planner is allowed to know. No video, no models, no clock.

    Deliberately a value object of plain facts: the plan is a pure function of these, which is
    what lets a test assert determinism without a clip on disk and lets the ablation harness
    re-plan a cached run at five cadences without re-decoding anything.
    """

    n_frames: int
    fps: float
    #: Motion burst around the speed peak, from the coarse pass. None on the dense path, which
    #: needs no such input, and on a clip where events could not be detected at all.
    swing_window: tuple[int, int] | None = None
    #: Frames a measurement will be READ at — event frames, checkpoint frames. The guarantee.
    forced: tuple[int, ...] = ()
    #: Where the club solver works natively: Top .. Impact + a few. Recorded for step 09/10.
    club_window: tuple[int, int] | None = None
    #: Neighbourhoods a later step will refine an event inside (step 10 consumes these).
    event_refine_windows: tuple[tuple[int, int], ...] = ()
    #: Where the ball can be looked for — around Address and around Impact.
    ball_windows: tuple[tuple[int, int], ...] = ()
    #: Should the silhouette ride this run at all (`--no-silhouette` turns it off).
    silhouette: bool = True
    #: Frames the silhouette actually came off, when that is not the direct set. It rides the
    #: MediaPipe pass, which under an adaptive policy is the COARSE set — recording the direct
    #: set instead would have the artifact claim outlines on frames that have none.
    silhouette_frames: tuple[int, ...] | None = None


@dataclass(frozen=True)
class FramePlan:
    """The answer: which frames, per subsystem, plus the provenance to reproduce it."""

    version: str
    n_frames: int
    fps: float
    pose_direct: tuple[int, ...]
    pose_forced: tuple[int, ...]
    club_native_window: tuple[int, int] | None
    ball_windows: tuple[tuple[int, int], ...]
    event_refine_windows: tuple[tuple[int, int], ...]
    silhouette_frames: tuple[int, ...]
    stride_in: int = 1
    stride_out: int = 1
    notes: tuple[str, ...] = ()

    def __post_init__(self):
        # Membership is asked per frame by the propagator and by the parity assertions, so the
        # set is built once here rather than rebuilt inside every `is_direct` call. Frozen
        # dataclass, hence the explicit setattr; excluded from equality by being derived.
        object.__setattr__(self, "_direct_set", frozenset(self.pose_direct))

    @property
    def dense(self) -> bool:
        return len(self.pose_direct) == self.n_frames

    @property
    def propagated(self) -> tuple[int, ...]:
        """Frames with no direct observation — what the propagator has to fill."""
        return tuple(f for f in range(self.n_frames) if f not in self._direct_set)

    def is_direct(self, f: int) -> bool:
        return f in self._direct_set

    def with_direct(self, extra, forced=()) -> "FramePlan":
        """The same plan with more frames observed — what the forced top-up produces.

        A plan is a record of what was measured, not only of what was intended, so when the
        pipeline goes back and measures frames the plan did not select, the artifact must say
        so. Returning a new plan rather than mutating one keeps the object frozen and keeps
        "the plan as decided" and "the plan as executed" from being the same mutable thing.
        """
        return FramePlan(
            version=self.version, n_frames=self.n_frames, fps=self.fps,
            pose_direct=tuple(sorted(set(self.pose_direct) | {int(f) for f in extra})),
            pose_forced=tuple(sorted(set(self.pose_forced) | {int(f) for f in forced})),
            club_native_window=self.club_native_window, ball_windows=self.ball_windows,
            event_refine_windows=self.event_refine_windows,
            silhouette_frames=self.silhouette_frames,
            stride_in=self.stride_in, stride_out=self.stride_out,
            notes=self.notes + (f"top-up: {len(set(extra) - set(self.pose_direct))} frames "
                                f"re-measured after the refined events moved",))

    def as_doc(self) -> dict:
        """The `frame_policy` block of `analysis.json`. Additive, and span-encoded."""
        return {
            "version": self.version,
            "n_frames": self.n_frames,
            "fps": round(float(self.fps), 6),
            "stride_in": self.stride_in,
            "stride_out": self.stride_out,
            "direct_count": len(self.pose_direct),
            "direct_pct": round(100.0 * len(self.pose_direct) / self.n_frames, 2)
            if self.n_frames else 0.0,
            "sets": {
                "pose_direct_frames": encode_spans(self.pose_direct),
                "pose_forced_frames": encode_spans(self.pose_forced),
                "club_native_window": (list(self.club_native_window)
                                       if self.club_native_window else None),
                "ball_windows": [list(w) for w in self.ball_windows],
                "event_refine_windows": [list(w) for w in self.event_refine_windows],
                "silhouette_frames": encode_spans(self.silhouette_frames),
            },
            "notes": list(self.notes),
        }


# ------------------------------------------------------------------------------ the planner

def plan(inputs: PlanInputs, pol: Policy | str | None = None) -> FramePlan:
    """Frame sets for one clip under one policy. Pure, total, deterministic.

    Total in the sense that every degenerate input has a defined answer rather than an
    exception: a zero-frame clip plans nothing, a clip with no detected swing treats the whole
    clip as active (which is the conservative direction — more observations, not fewer), and a
    forced frame outside the clip is dropped rather than widening the plan past the footage.
    """
    pol = pol if isinstance(pol, Policy) else policy(pol)
    n = max(0, int(inputs.n_frames))
    fps = float(inputs.fps) if inputs.fps and inputs.fps > 0 else 60.0
    if n == 0:
        return FramePlan(version=pol.version, n_frames=0, fps=fps, pose_direct=(),
                         pose_forced=(), club_native_window=None, ball_windows=(),
                         event_refine_windows=(), silhouette_frames=())

    forced = _clip(inputs.forced, n)
    club_window = _window(inputs.club_window, n)
    refine = tuple(w for w in (_window(w, n) for w in inputs.event_refine_windows) if w)
    balls = tuple(w for w in (_window(w, n) for w in inputs.ball_windows) if w)

    if pol.is_dense:
        every = tuple(range(n))
        return FramePlan(
            version=pol.version, n_frames=n, fps=fps,
            pose_direct=every, pose_forced=forced,
            club_native_window=club_window, ball_windows=balls,
            event_refine_windows=refine,
            silhouette_frames=every if inputs.silhouette else (),
            stride_in=1, stride_out=1)

    stride_in = pol.stride_in(fps)
    stride_out = pol.stride_out(fps)
    notes: list[str] = []

    active = _window(inputs.swing_window, n)
    if active is None:
        # No coarse swing window means no basis for treating any part of the clip as quiet.
        # Refine everything: the cost is the dense cost, which is the honest fallback.
        active = (0, n - 1)
        notes.append("no swing window; whole clip treated as active")
    else:
        pad = int(round(pol.swing_pad_s * fps))
        active = (max(0, active[0] - pad), min(n - 1, active[1] + pad))

    direct: set[int] = set(range(0, n, stride_out))
    # Anchored on the active span's START, not on frame 0: the samples that matter are the ones
    # spanning the swing, and aligning them to the clip origin would let the phase of a stride
    # decide whether Impact-adjacent frames are observed.
    direct.update(range(active[0], active[1] + 1, stride_in))

    # Endpoints always. The first and last frame anchor every interpolation and both are read
    # directly by the player (the freeze-frame pad holds them).
    direct.add(0)
    direct.add(n - 1)
    direct.add(active[1])

    # The club solves natively inside its window and the shaft is measured against the hands
    # there, so a propagated grip inside it would be a measurement resting on an inference.
    if club_window is not None:
        direct.update(range(club_window[0], club_window[1] + 1, stride_in))

    # Event refinement (step 10) reads a native signal frame by frame inside these.
    for a, b in refine:
        direct.update(range(a, b + 1, stride_in))

    # LAST, and unconditionally: the forced-frame guarantee. Everything above is a stride
    # decision and every stride decision is subordinate to this.
    direct.update(forced)

    ordered = tuple(sorted(direct))
    return FramePlan(
        version=pol.version, n_frames=n, fps=fps,
        pose_direct=ordered, pose_forced=forced,
        club_native_window=club_window, ball_windows=balls,
        event_refine_windows=refine,
        # The silhouette rides whatever pass MediaPipe makes; it has never been its own decode
        # and must not become one. Sparse rings are fine — the player fills even-odd.
        silhouette_frames=(_clip(inputs.silhouette_frames, n)
                           if inputs.silhouette_frames is not None else ordered)
        if inputs.silhouette else (),
        stride_in=stride_in, stride_out=stride_out, notes=tuple(notes))


def coarse_frames(n_frames: int, fps: float, pol: Policy | str | None = None) -> tuple[int, ...]:
    """The S2 coarse pass's own frame set — what runs BEFORE there is anything to plan with.

    Separate from `plan()` because it is the input to the plan, not an output of it: the coarse
    pass is what produces the motion curve and the candidate events the planner then reads. On
    the dense policy it is every frame, so the pipeline's single path collapses to today's
    behaviour with no branch.
    """
    pol = pol if isinstance(pol, Policy) else policy(pol)
    n = max(0, int(n_frames))
    if n == 0:
        return ()
    if pol.is_dense:
        return tuple(range(n))
    stride = pol.stride_out(float(fps) if fps and fps > 0 else 60.0)
    out = set(range(0, n, stride))
    out.add(n - 1)
    return tuple(sorted(out))
