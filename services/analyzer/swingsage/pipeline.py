"""The one entry point for the full analysis pipeline.

`run(AnalysisRequest)` is everything `scripts/burnin.py` used to do in `main()`: normalize,
pose, post-process, events, club, checkpoints, metrics, silhouette, `analysis.json`, scoring,
renders. The CLI is now a thin shell over this function, and the future queue-driven worker
imports it directly instead of spawning a child process.

Two compatibility surfaces, both binding:

* **stdout is a protocol.** `apps/web/src/lib/jobs.ts` regex-parses the printed stage lines
  (`source `, `normalized `, `mediapipe N frames`, `rtmpose N frames`, `stage3 `, `events `,
  `  club `, `  face `, `metrics `, `coach `, `rendered `) for its progress bar. The `print()`
  calls in here moved from burnin.py verbatim and must keep emitting the same lines until the
  worker replaces stdout-scraping with the `on_event` callback end to end.
* **`analysis.json` is the contract.** Doc assembly lives here now, but not a single key may
  change as a side effect of a refactor; `contract.write_json` stays the only writer.

The `on_event` callback is additive — structured stage boundaries and per-frame progress for
in-process consumers (the worker), emitted alongside the prints, never instead of them.
"""
from __future__ import annotations

import copy as copy0
import os
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Optional

from . import (audio_impact, checkpoints, club, club_detect, clubpath, contract, events,
               face, metrics, pose, pose_rtm, postprocess, render, scoring, silhouette,
               source_timing, video)
from .skeleton import KEYPOINT_NAMES, strip_derived

# Bump whenever a field is ADDED to analysis.json, not only on breaking changes.
#
# The artifact is the contract (the architecture spec) and the player renders it and nothing else, so editing
# the analyzer never changes a stored analysis. That is fine — but a reader has to be able to
# tell an old artifact from a new one, and this was left at 1 through several field additions.
# The result was silent degradation: the player hid controls whose data was simply absent, which
# is indistinguishable from a broken UI. Version it, and staleness becomes diagnosable.
#
#   1  original pose/club/events/metrics contract
#   2  + club.detector (provenance and raw boxes), + club.variants (alternative solutions)
#   3  + checkpoints (P1-P10), + metrics.checkpoints/angle_fields (the angle catalogue and
#      its per-angle drawing geometry). Also the point at which keypoint confidence began
#      being TRUNCATED rather than rounded — a v2 artifact can disagree with its own overlay
#      by ~2 deg where a confidence rounded up onto the MIN_CONF gate.
#   4  + club.frames[].from_model (did the detector or the solver place this head) and the
#      trace-only variants. from_model exists so the trace can be rebuilt from the artifact
#      alone, without re-running pose and club solving to iterate on it.
#   5  + playback_window: the span of the clip worth playing (approach, swing, held finish),
#      so the player can drop the dead footage at both ends. NOT swing_window, which is the
#      Stage 3 motion-burst gate and is far too tight to play.
#   6  + club.trace_frames (and per variant): which frame each trace point was measured on.
#      The trace is not one point per frame, so without it a player growing the path with the
#      playhead can only guess by counting — which put the head of the line up to 34 frames
#      from the club. It is also what identifies the spans nothing was measured in, so
#      they can be drawn as the fabricated chords they are rather than as measured path.
#   7  + keypoint 48 `waist`, a derived belt-line torso node (midpoint of spine_mid and
#      mid_hip). Appended after the measured block, not beside its siblings in the derived
#      one, because indices 0-47 are published. Nothing renders differently on a v6 artifact
#      — the joint is skipped when absent and no bone was re-routed through it.
#   8  + posture.butt_line: the DTL setup reference line, tangent to the rear of the seat and
#      locked at address. Small and always in analysis.json. The per-frame outline it is
#      measured from is NOT here — it is `silhouette.json` beside this file, because it is
#      large and only wanted when the overlay is switched on (swingsage/silhouette.py).
#   9  + playback_pad: frames of the fixed 1s approach / 1s finish the clip is too short to
#      supply, which the player holds as a freeze frame so every swing's lead-in and run-out
#      are the same length. The window itself is now pinned to address-1s .. finish+1s, where
#      it used to run on to a second past the golfer settling — faithful to one swing, and
#      inconsistent across the several a comparison puts side by side.
SCHEMA_VERSION = 10

# What each version added, so the player can say what re-analysing would actually get you
# rather than just reporting a number mismatch.
SCHEMA_FEATURES = {
    2: "raw club-detector output and alternative club solutions",
    3: "the ten swing checkpoints and selectable angle overlays",
    4: "trace-only club variants and per-frame from_model provenance",
    5: "an auto-trimmed playback window, so the player drops the dead footage at both ends",
    6: "a club trace that follows the playhead exactly and shows where it was never measured",
    7: "a waist joint on the torso, between the sternum and the hips",
    8: "the setup butt line, the DTL reference the seat should stay against",
    9: "a fixed one-second approach and finish, freeze-padded when the clip is too short",
}


class PipelineError(RuntimeError):
    """A refusal with a user-readable reason (bad input, locked output directory).

    The CLI maps this to `SystemExit(str(e))` so the exit code and message are exactly what
    burnin.py produced before the extraction; the worker catches it and fails the job with
    the message as the reason.
    """


@dataclass(frozen=True)
class AnalysisRequest:
    """Everything one analysis run needs. Field names are the CLI flags, positively phrased
    (`--no-stage3` -> `stage3=False`); defaults are identical to the CLI's defaults, and
    `tests/test_pipeline.py` enforces that equivalence so the two can never drift apart.
    """
    video: Path
    out_dir: Optional[Path] = None          # default: out/<video stem>/
    view: str = "dtl"                       # dtl | face_on
    handedness: str = "right"               # right | left
    club_type: Optional[str] = None         # driver | irons; None = unknown, never guessed
    scoring_config: str = "v2"
    scoring: bool = True                    # Stage 8
    retry: bool = True                      # IMAGE-mode re-detection over dropout spans
    silhouette: bool = True                 # Stage 2b outline + butt line
    analysis_short_side: int = 720
    stage3: bool = True                     # post-processing
    pose_model: str = "rtmpose"             # mediapipe | rtmpose
    rtm_mode: str = "performance"           # performance | balanced
    club: bool = True                       # Stage 4
    # No default weights, ever: an omitted detector is the deliberate classical-only path,
    # and defaulting from disk is exactly the silent-overwrite trap CLAUDE.md warns about.
    club_detector: Optional[str] = None
    club_detector_device: Optional[str] = None
    club_detector_gain: Optional[float] = None
    club_detector_stick_gain: Optional[float] = None
    club_detector_inject: str = "heads"     # none | heads | sticks | both
    club_detector_radius: bool = False
    club_detector_conf: float = 0.15
    club_ball_anchor: bool = False
    club_ball_detect: bool = False
    club_takeaway: bool = True
    club_takeaway_lookback: Optional[int] = None
    club_takeaway_tol: Optional[float] = None
    club_rigid: bool = False
    club_head_from_model: bool = False
    club_model_min_conf: Optional[float] = None
    club_model_smooth: bool = False
    club_model_traj_gate: bool = False
    club_variants: bool = True
    wholebody: bool = True
    # Capture-clock facts from the client's SOURCE MANIFEST, threaded through the job spec by
    # the enqueue side (the only party that reads storage). 0.0 = unknown: the pipeline then
    # probes the container's own tag exactly as it always has. The manifest wins over tags
    # because the phone-side remux DROPS `com.android.capture.fps` — a trimmed slow-mo import
    # otherwise analyzes at its slowed length (the 2,445-frame incident class, 2026-08-26).
    capture_fps: float = 0.0     # what the sensor did (240 for a Samsung slow-mo)
    source_fps: float = 0.0      # the container's presentation rate, for the guard's cross-check


@dataclass(frozen=True)
class PipelineEvent:
    """A structured stage boundary or progress tick, for in-process consumers.

    kind: "stage_started" | "stage_progress" | "stage_done" | "warning"
    stage: short id ("normalize", "pose_localiser", "pose", "stage3", "events", "detector",
           "club", "variants", "face", "checkpoints", "metrics", "silhouette", "contract",
           "scoring", "render")
    done/total: frame counts, on stage_progress only.
    """
    kind: str
    stage: str
    message: Optional[str] = None
    done: Optional[int] = None
    total: Optional[int] = None


@dataclass(frozen=True)
class PipelineResult:
    out_dir: Path
    artifacts: tuple[Path, ...]
    schema_version: int
    elapsed_s: float
    warnings: tuple[str, ...] = field(default_factory=tuple)


OnEvent = Callable[[PipelineEvent], None]


class OutputLock:
    """Refuse to run if another analysis already owns this output directory.

    Two concurrent runs over one directory corrupt it: they overwrite the same videos while
    the other is reading them, and the loser writes a partial artifact. That happened — four
    orphaned processes raced over two swings and destroyed both analyses. A stale lock from a
    killed process is detected and cleared rather than blocking forever, since the common case
    for a leftover lock is exactly that.
    """

    def __init__(self, out: Path):
        self.path = out / ".analysis.lock"

    def __enter__(self):
        if self.path.exists():
            try:
                pid = int(self.path.read_text().split()[0])
            except (ValueError, IndexError, OSError):
                pid = None
            if pid is not None and _alive(pid):
                raise PipelineError(
                    f"another analysis is already running for {self.path.parent.name} "
                    f"(pid {pid}). Wait for it, or kill it first — two runs over one output "
                    f"directory corrupt each other.")
            print(f"           ! clearing stale lock from dead pid {pid}")
        self.path.write_text(f"{os.getpid()} {time.time():.0f}\n", encoding="utf-8")
        return self

    def __exit__(self, *exc):
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            pass
        return False


#: How far the video-side Impact may sit from the heard strike and still count as agreement.
#:
#: Generous on purpose, and asymmetric in spirit: the audio is expected to land LATE by the
#: recording pipeline's latency, which was 121-148 ms on every clip it has been measured on. A
#: quarter of a second covers that plus a frame or two of labelling slack, so `agrees: false`
#: means the two witnesses are describing different events rather than the same one imprecisely.
AUDIO_AGREE_TOLERANCE_S = 0.25


def _audio_impact_doc(heard, impact_frame: int, fps: float) -> dict | None:
    """The heard strike as it goes into the artifact, or None when nothing was heard."""
    if heard is None or fps <= 0:
        return None
    frame = int(round(heard.time_sec * fps))
    delta = impact_frame - frame
    return {
        "frame": max(0, frame),
        "time_sec": round(heard.time_sec, 3),
        "confidence": round(heard.confidence, 3),
        "agrees": abs(delta) <= AUDIO_AGREE_TOLERANCE_S * fps,
        "delta_frames": delta,
    }


def _alive(pid: int) -> bool:
    """Is this pid running? Windows has no signal-0 trick, so ask the OS directly."""
    if os.name == "nt":
        import subprocess
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                               capture_output=True, text=True, timeout=10)
            return str(pid) in r.stdout
        except Exception:
            return False
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def _checked_source(src) -> str:
    """The original clip's path, verified to still be one.

    `video.source.path` is what `lib/jobs.ts` re-reads to re-analyse a swing, so it is the one
    string in the artifact whose wrongness is invisible until someone asks for a re-run.
    """
    p = Path(src)
    if not p.is_file():
        raise PipelineError(
            f"refusing to write analysis.json: video.source.path is not a readable file "
            f"({str(src)[:120]!r}). Re-analysis reads this path back, so a bad one would only "
            f"surface when someone pressed Re-analyze.")
    return str(p)


def run(req: AnalysisRequest, on_event: OnEvent = None) -> PipelineResult:  # noqa: C901
    """Run the full pipeline for one clip. Body moved verbatim from burnin.py main() —
    `args.X` became `req.X` (negatives flipped: `not args.no_club` -> `req.club`), the lock
    became a `with` block, and `emit()` calls were added at the existing print boundaries.
    Behavior, artifacts and stdout are otherwise identical by design; see the module
    docstring before changing any printed line.
    """
    def emit(kind: str, stage: str, message: str = None,
             done: int = None, total: int = None):
        if on_event is not None:
            on_event(PipelineEvent(kind=kind, stage=stage, message=message,
                                   done=done, total=total))

    warnings: list[str] = []

    def warn(stage: str, message: str):
        warnings.append(message)
        emit("warning", stage, message)

    src = Path(req.video).resolve()
    if not src.exists():
        raise PipelineError(f"no such video: {src}")
    out = Path(req.out_dir).resolve() if req.out_dir else Path("out") / src.stem
    out.mkdir(parents=True, exist_ok=True)
    artifacts: list[Path] = []

    # Claim the output directory for the duration. A `with` block releases it on any exit
    # including exceptions; a hard kill skips __exit__, which is exactly the case
    # OutputLock's stale-pid detection handles.
    with OutputLock(out):
        t_all = time.time()

        # --- Stage 0: probe + normalize -------------------------------------------------
        emit("stage_started", "probe")
        src_info = video.probe(src)
        print(f"source     {src_info.width}x{src_info.height} {src_info.codec} "
              f"rot={src_info.rotation} fps={src_info.fps:.3f} "
              f"(nominal {src_info.nominal_fps:.3f}) frames={src_info.frame_count} "
              f"{'VFR' if src_info.is_vfr else 'CFR'}")
        if src_info.is_vfr:
            print("           -> VFR detected; CFR normalization is mandatory for frame sync")
        emit("stage_done", "probe")

        emit("stage_started", "normalize")
        t = time.time()
        # A phone slow-mo (captured 240, WRITTEN 30) is put back on the world's clock here —
        # the com.android.capture.fps stamp is the only record of what the sensor did, and
        # analysing the slowed file measures a swing that appears to take twenty seconds
        # (every tempo and velocity number 8x wrong, found on the first hosted import,
        # 2026-08-23). The retimed clip then normalizes at its TRUE rate, so nothing
        # downstream knows the file was ever slow.
        tag_capture_fps = video.probe_capture_fps(src)
        # The manifest's fact beats the container tag (see AnalysisRequest.capture_fps) — and
        # the provenance is recorded in the artifact, so a wrong retime is attributable.
        capture_fps = req.capture_fps or tag_capture_fps
        capture_fps_source = (
            "manifest" if req.capture_fps
            else ("container_tag" if tag_capture_fps else "none")
        )
        retime = video.retime_factor(src_info, capture_fps)
        if retime:
            print(f"retime     slow-motion source: capture {capture_fps:.0f}fps written at "
                  f"{src_info.fps:.3f} — timestamps x{retime:.6f}")
            src_info.fps = capture_fps
            src_info.nominal_fps = capture_fps
        # The capture rate, not a hardcoded 60: a 240fps in-app take keeps all its frames and
        # the player gets frame-true slow motion for free (see video.cfr_target_fps).
        target_fps = video.cfr_target_fps(src_info)
        norm = video.normalize(src, out / "normalized.mp4", short_side=1080, fps=target_fps,
                               itsscale=retime)
        anal = video.normalize(src, out / "analysis.mp4",
                               short_side=req.analysis_short_side, fps=target_fps,
                               itsscale=retime)
        print(f"normalized {norm.width}x{norm.height} @ {norm.fps:.3f} "
              f"frames={norm.frame_count} | analysis {anal.width}x{anal.height} "
              f"({time.time() - t:.1f}s)")
        artifacts += [out / "normalized.mp4", out / "analysis.mp4"]
        emit("stage_done", "normalize")

        # Source timing sidecar: what the camera actually observed, before the CFR
        # resample rewrote it. Degrades to a warning — the pipeline never fails over metadata.
        # A RETIMED clip skips it: the sidecar maps SOURCE timestamps onto output frames, and
        # after itsscale those live on different clocks — a map built across them would be
        # confidently wrong rather than absent.
        try:
            if retime:
                raise RuntimeError("slow-motion retime applied; source timestamps are on the slowed clock")
            timing = source_timing.build(src, out_fps=norm.fps,
                                         out_frame_count=norm.frame_count)
            source_timing.write_sidecar(timing, out)
            artifacts.append(out / source_timing.SIDECAR_NAME)
            dups = sum(1 for o in timing.observations if o.is_duplicate_group)
            print(f"timing     {timing.distinct_observation_count} source observations "
                  f"({dups} duplicated into CFR), audio="
                  + (f"{timing.audio_sample_rate}Hz {timing.audio_codec}"
                     if timing.has_audio else "none"))
        except Exception as e:  # noqa: BLE001 — sidecar is advisory, never fatal
            print(f"           ! source timing failed ({e}); "
                  f"{source_timing.SIDECAR_NAME} skipped")
            warn("timing", f"source timing failed ({e}); {source_timing.SIDECAR_NAME} skipped")

        # --- Stage 0c: the strike, HEARD -------------------------------------------------
        # Read off the SOURCE, not the normalized copy: `video.normalize` passes `-an`, so the
        # analysis clip has no audio at all. Normalization never trims, so a source timestamp and
        # a normalized one mean the same instant and the frame index below is simply t x fps.
        #
        # Advisory in exactly the way the timing sidecar is — an unreadable or silent track is a
        # normal answer, and nothing downstream is allowed to need this.
        heard = None
        try:
            heard = audio_impact.heard_impact(src)
            # The witness listened to the SOURCE, whose clock the retime just rescaled — its
            # timestamp moves onto the normalized clock with the same factor, or the agreement
            # check below would compare seconds from two different worlds.
            if heard and retime:
                heard = replace(heard, time_sec=heard.time_sec * retime)
            print("audio      "
                  + (f"strike heard at {heard.time_sec:.3f}s "
                     f"(confidence {heard.confidence:.2f})" if heard else "no strike heard"))
        except Exception as e:  # noqa: BLE001 - a second witness is never load-bearing
            print(f"           ! audio impact detection failed ({e}); continuing without it")
            warn("audio", f"audio impact detection failed ({e})")

        # --- Stage 2: pose --------------------------------------------------------------
        # One reporter for every per-frame loop (both pose passes, the detector, the club
        # solver). The printed line is part of the stdout protocol; the emitted event carries
        # the stage id current at the time.
        class _Prog:
            stage = "pose_localiser"

            def __call__(self, done, total):
                print(f"\r  pose {done}/{total or '?'}", end="", flush=True)
                emit("stage_progress", self.stage, done=done, total=total)

        prog = _Prog()

        def snapshot(s):
            """Quality of a series without disturbing it (finalize mutates)."""
            return pose.quality(pose.finalize(pose.RawPoseSeries(
                model=s.model, frames=copy0.deepcopy(s.frames), detected=list(s.detected))))

        # MediaPipe always runs. It is the fallback estimator, and when RTMPose is selected it
        # is also the person localiser that supplies RTMPose's per-frame box (see pose_rtm.py).
        emit("stage_started", "pose_localiser")
        t = time.time()
        mp_series = pose.estimate(anal.path, progress=prog,
                                  silhouette=req.silhouette)
        print(f"\r  mediapipe          {len(mp_series.frames)} frames in {time.time() - t:.1f}s"
              + (f" · silhouette on {len(mp_series.silhouette)}/{len(mp_series.frames)}"
                 if mp_series.silhouette else ""))
        if req.retry:
            fixed = pose.retry_gaps(anal.path, mp_series)
            if fixed:
                print(f"  retry recovered {fixed} frames via IMAGE-mode re-detection")
        quality_mp = snapshot(mp_series)
        emit("stage_done", "pose_localiser")

        if req.pose_model == "rtmpose":
            emit("stage_started", "pose")
            prog.stage = "pose"
            boxes = pose_rtm.bboxes_from_series(mp_series)
            t = time.time()
            series = pose_rtm.estimate(anal.path, boxes, mode=req.rtm_mode, progress=prog,
                                       wholebody=req.wholebody)
            dt = max(time.time() - t, 1e-6)
            print(f"\r  rtmpose            {len(series.frames)} frames in {dt:.1f}s "
                  f"({len(series.frames) / dt:.1f} fps)")
            n = min(len(mp_series.frames), len(series.frames))
            series.frames = series.frames[:n]
            series.detected = series.detected[:n]
            emit("stage_done", "pose")
        else:
            series = mp_series

        # --- Stage 3: post-processing (the pose spec) ---------------------------------------
        # Raw quality of the *chosen* model, so the table below isolates Stage 3's effect.
        before = snapshot(series)

        rep = None
        if req.stage3:
            emit("stage_started", "stage3")
            # A rough swing window from the raw pose gates the grip prior; the definitive
            # events are detected afterwards on the cleaned series.
            pose.finalize(pose.RawPoseSeries(model=series.model, frames=series.frames,
                                             detected=series.detected))
            try:
                _pre, pre_sg = events.detect(series.frames, req.handedness, norm.fps)
                window = tuple(_pre["swing_window"])
            except Exception:
                window = None
            # Undo the provisional derived joints. They live in two non-adjacent blocks, so this
            # is skeleton's job, not a slice here (see strip_derived). `st` is left alone —
            # postprocess rewrites it wholesale from its own status matrix.
            for fr in series.frames:
                strip_derived(fr["kp"])
            t = time.time()
            series, rep = postprocess.postprocess(
                series, window=window,
                trust_hands=(req.pose_model == "rtmpose" and req.wholebody))
            print(f"stage3     side-swaps {rep.swaps}, bone rejects {rep.bone_rejects}, "
                  f"grip rejects {rep.grip_rejects}, outliers {rep.outlier_rejects}, "
                  f"promoted {rep.promoted}, interpolated {rep.interpolated} "
                  f"({time.time() - t:.1f}s)")
            for n in rep.notes:
                print(f"           ! {n}")
                warn("stage3", n)
            emit("stage_done", "stage3")

        pose.finalize(series)
        q = pose.quality(series)

        # --- Stage 5: swing events (the scoring spec) -------------------------------------------
        emit("stage_started", "events")
        t = time.time()
        ev, sg = events.detect(series.frames, req.handedness, norm.fps)
        print(f"events     " + "  ".join(
            f"{k.split('_')[0][:3].upper()}{'' if k.count('_') < 1 else k.split('_')[-1][:1].upper()}"
            f"={v['frame']}" for k, v in ev["events"].items()))
        if ev["tempo"]:
            print(f"           tempo {ev['tempo']['ratio']}:1  "
                  f"(backswing {ev['tempo']['backswing_ms']}ms / "
                  f"downswing {ev['tempo']['downswing_ms']}ms)  "
                  f"window {ev['swing_window'][0]}-{ev['swing_window'][1]}  ({time.time()-t:.1f}s)")
        _pw = ev["playback_window"]
        print(f"           playback {_pw[0]}-{_pw[1]}  "
              f"({(_pw[1] - _pw[0] + 1) / norm.fps:.2f}s of {len(series.frames) / norm.fps:.2f}s)")
        for n_ in ev["notes"]:
            print(f"           ! {n_}")
            warn("events", n_)
        emit("stage_done", "events")

        # --- Stage 4: club tracking (the club-tracking spec) --------------------------------------------
        cl = None
        det = None
        club_variants: dict = {}
        # Alternative solves, keyed by variant name. Hoisted out of the variants block because
        # `refine_events` below needs the detector-measured heads one of them carries.
        solves: dict = {}
        if req.club:
            cfg_club = replace(club.ClubConfig(),
                               use_rigid=req.club_rigid,
                               detector_inject=req.club_detector_inject,
                               detector_radius=req.club_detector_radius,
                               detector_head_primary=req.club_head_from_model,
                               detector_smooth=req.club_model_smooth,
                               detector_traj_gate=req.club_model_traj_gate,
                               ball_detect=req.club_ball_detect,
                               ball_anchor=req.club_ball_anchor,
                               takeaway_refine=req.club_takeaway)
            if req.club_takeaway_lookback is not None:
                cfg_club = replace(cfg_club, takeaway_lookback=req.club_takeaway_lookback)
            if req.club_takeaway_tol is not None:
                cfg_club = replace(cfg_club, takeaway_move_tol=req.club_takeaway_tol)
            if req.club_model_min_conf is not None:
                cfg_club = replace(cfg_club,
                                   detector_primary_min_conf=req.club_model_min_conf)
            if req.club_detector:
                if req.club_detector_gain is not None:
                    cfg_club = replace(cfg_club, detector_gain=req.club_detector_gain)
                if req.club_detector_stick_gain is not None:
                    cfg_club = replace(cfg_club,
                                       detector_stick_gain=req.club_detector_stick_gain)
                emit("stage_started", "detector")
                prog.stage = "detector"
                t = time.time()
                d = club_detect.ClubDetector(req.club_detector,
                                             conf=req.club_detector_conf,
                                             device=req.club_detector_device)
                det = d.run(anal.path, n_frames=len(series.frames), progress=prog)
                m = det.model
                n_stick = sum(1 for fr in det.per_frame
                              for x in fr if x.cls == club_detect.STICK)
                print(f"\r  detector   heads {m['head_detections']} on "
                      f"{m['frames_with_head']}/{m['frames']} frames · sticks {n_stick}  "
                      f"inject={req.club_detector_inject}  {m['weights']}@{m['sha256']}  "
                      f"({time.time() - t:.1f}s)")
                for n_ in det.notes:
                    print(f"           ! {n_}")
                    warn("detector", n_)
                emit("stage_done", "detector")

            emit("stage_started", "club")
            prog.stage = "club"
            t = time.time()
            cl = club.track(anal.path, series.frames, ev, req.handedness, cfg=cfg_club,
                            progress=prog, detector=det)
            cov = cl.coverage
            print(f"\r  club       coverage back {cov.get('backswing', 0) * 100:.0f}% / "
                  f"down {cov.get('downswing', 0) * 100:.0f}% / "
                  f"through {cov.get('followthrough', 0) * 100:.0f}%  "
                  f"club_len {cl.club_len:.3f}  ({time.time() - t:.1f}s)")
            for n_ in cl.notes:
                print(f"           ! {n_}")
                warn("club", n_)

            # --- Stage 4c: alternative club solutions, in the SAME artifact ----------------
            # The club can be solved several ways and there is no ground-truth metric yet to pick
            # a winner, so the honest thing is to ship the alternatives and let a human
            # compare them on real pixels. Storing them together means one video and one page
            # rather than a directory per experiment — the player switches between them, so the
            # comparison is a click instead of a re-run.
            #
            # Only the render-relevant fields are kept per variant; `club` above remains the
            # single input to metrics, face and event refinement, so nothing downstream forks.
            if det is not None and req.club_variants:
                emit("stage_started", "variants")
                VARIANTS = [
                    ("classical", "Classical only (no detector)",
                     dict(detector_inject="none", detector_head_primary=False, use_rigid=False)),
                    ("evidence", "Detector as evidence",
                     dict(detector_inject="both", detector_head_primary=False, use_rigid=False)),
                    ("model", "Model head, unsmoothed",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False)),
                    # Keeps the MEASURED radius and only de-noises it, unlike model_rigid which
                    # imposes the calibrated club length. The calibration looks ~1.5x too long
                    #, so trusting the measurement over it is the point.
                    ("model_smooth", "Model head + smoothed",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True)),
                    # Trajectory continuity INSTEAD of a confidence threshold. Note the low
                    # min_conf: with the default 0.35 this variant was byte-identical to
                    # model_smooth, because the threshold had already discarded the jumpy frames
                    # (conf 0.29-0.33) and the gate had nothing left to reject — 0 outliers.
                    #
                    # So admit almost everything the model says and let the Hampel gate decide.
                    # That is the better question anyway: "is this position consistent with the
                    # path?" survives a miscalibrated confidence, where a threshold does not, and
                    # it keeps the frames where the model was right but unsure — which the
                    # backswing is full of (mean conf falls 0.77 -> 0.59 there).
                    ("model_traj", "Model head + trajectory gate (low conf admitted)",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.15)),
                    # Same gate, no smoothing of what it kept. The smoothing in `model_traj` is
                    # applied evenly across the swing, and evenly is wrong: it cost the downswing
                    # ~50px of reach at the ball on swing2, the same failure that made
                    # `trace_win_downswing` 0. Here the measured frames keep their measurements and
                    # the per-segment trace smoothing does the de-noising instead, which already
                    # leaves the downswing alone. Gaps are still interpolated for the per-frame club
                    # and still marked `interp`, so the trace excludes them either way.
                    ("model_traj_raw", "Trajectory gate, measurements unsmoothed",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.15, detector_smooth_win=1,
                          detector_radius_smooth_win=1)),
                    ("model_rigid", "Model head + rigid length",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=True)),
                    # --- the START/BOTTOM anchor dimension (Taylor, 2026-08-19) -----------------
                    # Where the trace STARTS (takeaway refine vs the hand-based Address) and where
                    # it BOTTOMS OUT at Impact (free vs anchored) are solver decisions, invisible
                    # to the render-side pickers — so comparing them needs stored solves. All
                    # three are the incumbent trajectory-gated solve (model_traj_raw) with exactly
                    # one anchor knob changed, so what differs on screen is the anchor and nothing
                    # else. ball_anchor's tradeoff is MEASURED and mixed (fixes pro_2 by 196px,
                    # degrades perfect by 48px — see ClubConfig), which is precisely why it is
                    # a stored comparison and not a default.
                    ("model_traj_anchor", "Trajectory gate + impact anchored (Address landmark)",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.15, detector_smooth_win=1,
                          detector_radius_smooth_win=1, ball_anchor=True)),
                    ("model_traj_ball", "Trajectory gate + impact anchored (detected ball)",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.15, detector_smooth_win=1,
                          detector_radius_smooth_win=1, ball_anchor=True, ball_detect=True)),
                    ("model_traj_nostart", "Trajectory gate, hand-based start (no takeaway)",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.15, detector_smooth_win=1,
                          detector_radius_smooth_win=1, takeaway_refine=False)),
                    # --- the STRICT cross (Taylor, 2026-08-19) -----------------------------------
                    # The incumbent's opposite bet: instead of admitting conf-0.15 detections and
                    # letting the Hampel gate reject on trajectory, keep ONLY high-confidence
                    # heads (0.5, well above the 0.35 default) AND gate them — so every kept
                    # point is both sure and path-consistent, and the solver's trajectory
                    # interpolation carries the gaps that stricter selection opens up.
                    ("model_traj_strict", "Strict confidence + trajectory gate",
                     dict(detector_inject="both", detector_head_primary=True, use_rigid=False,
                          detector_smooth=True, detector_traj_gate=True,
                          detector_primary_min_conf=0.5, detector_smooth_win=1,
                          detector_radius_smooth_win=1)),
                ]
                # Trace-only variants share one solve. They differ purely in how the polyline is
                # rebuilt from an identical set of head positions, so re-solving the club for each
                # would burn ~20s a piece to produce the same frames. `from` names the solve.
                TRACE_MODES = [
                    ("model_trace_measured", "Model head + trace: detector frames only",
                     "measured", "model", {}),
                    ("model_trace_moving", "Model head + trace: moving average",
                     "moving", "model", {}),
                    ("model_trace_savgol", "Model head + trace: Savitzky-Golay",
                     "savgol", "model", {}),
                    # Reject, don't average. A bad detection pulls a smoother off the real club for
                    # frames either side; a consensus fit identifies it and drops it instead, so the
                    # drawn path passes THROUGH measured heads rather than near their mean. Worst
                    # case for smoothing is the bottom of the swing, where the club is fastest.
                    ("model_trace_robust", "Model head + trace: reject outliers, no smoothing",
                     "robust", "model", {}),
                    # The one the player defaults to. Two changes from the four above, both aimed at
                    # the same complaint — the line leaves the club near the ball:
                    #
                    #  * it is built on `model_traj_raw`, which admits detections down to conf 0.15
                    #    and lets the Hampel gate reject them on trajectory instead. A 0.35 floor threw
                    #    away 31 frames of real club head on `perfect`, and they are not spread
                    #    evenly: the detector is least sure exactly where the head is fastest and
                    #    most blurred, so those frames cluster into the approach to impact. Dropping
                    #    the floor collapses the pre-impact holes there from 24 frames to 10.
                    #  * trace_min_conf 0 rather than 0.30, which would otherwise re-apply the floor
                    #    this variant exists to remove.
                    #
                    # Smoothing is the per-segment kind, which exempts the downswing — the segment
                    # that is best measured and worst served by an even-handed filter, and the one
                    # whose last few points are the strike itself.
                    ("model_traj_measured", "Trajectory-gated head + trace: measured frames only",
                     "savgol", "model_traj_raw", dict(trace_min_conf=0.0)),
                    # Same trajectory-gated solve, moving-average trace instead of savgol —
                    # the player's chosen legacy solution (user directive 2026-08-08).
                    # `scripts/addvariant.py` back-fills it into artifacts analysed before
                    # this entry existed, without a re-run.
                    ("model_traj_moving", "Trajectory-gated head + trace: moving average",
                     "moving", "model_traj_raw", dict(trace_min_conf=0.0)),
                    # The anchor solves above, each with the incumbent's moving-average trace, so
                    # the anchored/unanchored comparison holds the trace method constant.
                    ("model_traj_moving_anchor", "Anchored (landmark) + trace: moving average",
                     "moving", "model_traj_anchor", dict(trace_min_conf=0.0)),
                    ("model_traj_moving_ball", "Anchored (detected ball) + trace: moving average",
                     "moving", "model_traj_ball", dict(trace_min_conf=0.0)),
                    ("model_traj_moving_nostart", "Hand-based start + trace: moving average",
                     "moving", "model_traj_nostart", dict(trace_min_conf=0.0)),
                    # The strict solve, both ways of treating its (larger) gaps: the moving trace
                    # includes the solver's trajectory fill; the measured trace draws only the
                    # high-confidence detections and leaves honest dashed chords between them.
                    ("model_traj_strict_moving", "Strict + gate + trace: trajectory-filled",
                     "moving", "model_traj_strict", dict(trace_min_conf=0.0)),
                    ("model_traj_strict_measured", "Strict + gate + trace: measured frames only",
                     "savgol", "model_traj_strict", dict(trace_min_conf=0.0)),
                    # Consensus-fit rejection over the gated solves (Taylor, 2026-08-19): the
                    # around-the-body head jumps deviate from any plausible swing path, so fit
                    # the path, DROP what deviates, and connect around it — reject, don't
                    # average. Same construction as model_trace_robust, on the better solves.
                    ("model_traj_robust", "Trajectory gate + trace: reject path outliers",
                     "robust", "model_traj_raw", dict(trace_min_conf=0.0)),
                    ("model_traj_strict_robust", "Strict + gate + trace: reject path outliers",
                     "robust", "model_traj_strict", dict(trace_min_conf=0.0)),
                    # Over the Viterbi path (built between the two loops below): its measured
                    # trace is the chosen candidates only; the moving trace includes the
                    # polar-space gap fill.
                    ("model_viterbi_moving", "Viterbi path + trace: moving average",
                     "moving", "model_viterbi", dict(trace_min_conf=0.0)),
                    ("model_viterbi_measured", "Viterbi path + trace: chosen candidates only",
                     "measured", "model_viterbi", dict(trace_min_conf=0.0)),
                ]

                for key, label, over in VARIANTS:
                    t = time.time()
                    v = club.track(anal.path, series.frames, ev, req.handedness,
                                   cfg=replace(cfg_club, **over), detector=det)
                    solves[key] = (v, replace(cfg_club, **over))
                    club_variants[key] = {
                        "label": label,
                        "coverage": v.coverage,
                        "club_len": round(v.club_len, 5),
                        "butt_len": round(v.butt_len, 5),
                        "notes": v.notes,
                        "frames": [{"f": c.f,
                                    "shaft": ([[round(x, 5) for x in p] for p in c.shaft]
                                              if c.shaft else None),
                                    "head": [round(x, 5) for x in c.head] if c.head else None,
                                    "butt": [round(x, 5) for x in c.butt] if c.butt else None,
                                    "conf": round(c.conf, 3),
                                    "interp": c.interp,
                                    "from_model": c.from_model,
                                    "from_ball": c.from_ball}
                                   for c in v.frames],
                        "trace": v.trace,
                        "trace_frames": v.trace_frames,
                    }
                    vc = v.coverage
                    print(f"\r  variant    {key:<20} back {vc.get('backswing', 0)*100:3.0f}% / "
                          f"down {vc.get('downswing', 0)*100:3.0f}% / "
                          f"through {vc.get('followthrough', 0)*100:3.0f}%  ({time.time()-t:.1f}s)")

                # --- the candidate-Viterbi path (2026-08-19 brainstorm) ----------------------
                # A GLOBAL solve over the detector's candidates in grip-polar space, with
                # anchored ends and bounded skipping — see swingsage/clubpath.py. A refinement
                # over the trajectory-gated solve rather than a re-solve, so it costs
                # milliseconds, not another 25s club pass.
                if "model_traj_raw" in solves:
                    t = time.time()
                    vb, vb_cfg = solves["model_traj_raw"]
                    v = clubpath.viterbi_refine(vb, det, ev, len(series.frames), vb_cfg)
                    solves["model_viterbi"] = (v, vb_cfg)
                    club_variants["model_viterbi"] = {
                        "label": "Viterbi: global best path over detector candidates",
                        "coverage": v.coverage,
                        "club_len": round(v.club_len, 5),
                        "butt_len": round(v.butt_len, 5),
                        "notes": v.notes,
                        "frames": [{"f": c.f,
                                    "shaft": ([[round(x, 5) for x in p] for p in c.shaft]
                                              if c.shaft else None),
                                    "head": [round(x, 5) for x in c.head] if c.head else None,
                                    "butt": [round(x, 5) for x in c.butt] if c.butt else None,
                                    "conf": round(c.conf, 3),
                                    "interp": c.interp,
                                    "from_model": c.from_model,
                                    "from_ball": c.from_ball}
                                   for c in v.frames],
                        "trace": v.trace,
                        "trace_frames": v.trace_frames,
                    }
                    vc = v.coverage
                    print(f"\r  variant    {'model_viterbi':<20} back {vc.get('backswing', 0)*100:3.0f}% / "
                          f"down {vc.get('downswing', 0)*100:3.0f}% / "
                          f"through {vc.get('followthrough', 0)*100:3.0f}%  ({time.time()-t:.1f}s)")

                # --- trace-only variants, rebuilt over an existing solve --------------------
                # The per-frame head is already right; it is the polyline joining the points that
                # is jagged, because `_build_trace` includes frames the detector declined and those
                # carry the solver's head instead. These rebuild the line and touch nothing else.
                # `base_key`, not `src` — this loop used to bind `src`, which is the *video path*
                # in the enclosing scope, and Python's for-target leaks. Every artifact written
                # since then recorded `video.source.path` as "model_traj_raw", the last entry in
                # TRACE_MODES, so Re-analyze could not find the clip it was meant to re-run.
                for key, label, mode, base_key, over in TRACE_MODES:
                    if base_key not in solves:
                        continue
                    t = time.time()
                    base, base_cfg = solves[base_key]
                    v = copy0.deepcopy(base)
                    club.smooth_trace(v, ev, len(series.frames),
                                      replace(base_cfg, trace_smooth=mode, **over))
                    pts = {k: len(p) for k, p in v.trace.items()}
                    club_variants[key] = {
                        "label": label,
                        # Coverage and frames are identical to the source solve by construction —
                        # only `trace` differs. Stated rather than implied so the numbers make sense.
                        "coverage": v.coverage,
                        "club_len": round(v.club_len, 5),
                        "butt_len": round(v.butt_len, 5),
                        "notes": v.notes,
                        "frames": club_variants[base_key]["frames"],
                        "trace": v.trace,
                        "trace_frames": v.trace_frames,
                    }
                    print(f"\r  variant    {key:<20} trace pts back {pts.get('backswing', 0)} / "
                          f"down {pts.get('downswing', 0)} / "
                          f"through {pts.get('followthrough', 0)}  ({time.time()-t:.1f}s)")
                emit("stage_done", "variants")
            # The architecture spec quality gate: below 50% across the swing the trace is disabled rather
            # than shown as a fabricated path.
            if cov.get("swing", 0) < 0.5:
                print(f"           ! trace disabled — swing coverage "
                      f"{cov.get('swing', 0) * 100:.0f}% < 50%")
                warn("club", f"trace disabled — swing coverage "
                             f"{cov.get('swing', 0) * 100:.0f}% < 50%")

            # The scoring spec promised Phase 4 would refine the shaft-defined events once club data existed.
            # It does now, so take it — and hand over the DETECTOR's heads rather than letting it
            # read the primary solve's, which are the solver's estimate and the thing Impact and the
            # address hold are being corrected against. `model_traj_raw` is the solve whose heads are
            # measurements and nothing else (see its entry in VARIANTS).
            det_heads = None
            for key in ("model_traj_raw", "model"):
                solved = solves.get(key)
                if solved:
                    det_heads = {c.f: c.head for c in solved[0].frames
                                 if c.head and c.from_model and not c.interp}
                    break
            seen_notes = len(cl.notes)
            for msg in club.refine_events(cl, ev, cfg_club, heads=det_heads,
                                          fps=norm.fps or 60.0):
                print(f"           refined {msg}")
            # Refinement declining to move an event is as informative as it moving one — it is the
            # answer to "why did the backswing not start where the club did on this clip" — and the
            # club notes were already printed above, so anything appended here needs printing now.
            for n_ in cl.notes[seen_notes:]:
                print(f"           ! {n_}")
                warn("club", n_)
            emit("stage_done", "club")

            # --- club head orientation through the swing (the club-tracking spec tier 2) --------------
            emit("stage_started", "face")
            t = time.time()
            fc = face.analyse(anal.path, cl.frames, cl.club_len or 0.25, ev)
            got = sum(1 for x in fc.frames if x.to_shaft_deg is not None)
            print(f"  face       head orientation on {got}/{len(fc.frames)} frames "
                  f"({time.time() - t:.1f}s)")
            for k in ("address", "toe_up", "top"):
                c = fc.checkpoints.get(k)
                if c:
                    print(f"           {k:<8} {c['class']:<20} "
                          f"{('rel ' + str(c.get('head_to_shaft_deg')) + 'deg') if 'head_to_shaft_deg' in c else ''}"
                          f"  conf {c['conf']}")
            emit("stage_done", "face")

        # --- Stage 5b: the ten coaching checkpoints (P1-P10) ----------------------------
        # After club refinement, because P2/P6/P8 are shaft-defined and only resolve properly
        # once the shaft exists. Falls back to pose proxies with --no-club, at lower confidence.
        emit("stage_started", "checkpoints")
        cps = checkpoints.build(ev, sg, series.frames, req.handedness, club=cl,
                                n_frames=len(series.frames))
        print("checkpoints " + "  ".join(
            f"{i['p']}={i['frame']}" for i in cps["items"]))
        for n_ in cps["notes"]:
            print(f"           ! {n_}")
            warn("checkpoints", n_)
        emit("stage_done", "checkpoints")

        # --- Stage 6: metrics (the scoring spec's Part B) -------------------------------------------
        # After Stage 4: wrist hinge is lead-forearm vs club shaft, so it needs club data.
        emit("stage_started", "metrics")
        t = time.time()
        club_frames = [{"f": c.f, "head": c.head, "conf": c.conf}
                       for c in cl.frames] if cl else None
        mt = metrics.compute(series.frames, ev, req.view, req.handedness,
                             aspect=norm.width / norm.height, fps=norm.fps,
                             club_frames=club_frames, checkpoints=cps)
        s = mt["summary"]
        print(f"metrics    spine@addr {s['spine_at_address']}deg  lead-arm@top {s['lead_arm_at_top']}deg"
              f"  hinge@top {s['lead_wrist_hinge_at_top']}deg  stance {s['stance_width_ratio']}")
        print(f"           max head sway {s['max_head_sway']} bh (nose-bridge {s['max_face_sway']})"
              f"  max hip sway {s['max_hip_sway']} bh  head turn {s['max_head_turn']}")
        print(f"           turn@top shoulder {s['shoulder_turn_at_top']}deg "
              f"hip {s['hip_turn_at_top']}deg  x-factor {s['xfactor_rotation_at_top']}deg"
              f"  spine-curve@addr {s['spine_curvature_at_address']}")
        print(f"           heel lift trail {s['max_trail_heel_lift']} lead "
              f"{s['max_lead_heel_lift']} bh  lead forearm roll@impact "
              f"{s['lead_forearm_roll_at_impact']}deg  ({time.time() - t:.1f}s)")
        bd = mt["glossary"].get("ball_direction")
        print(f"           ball direction {('+' if bd['sign'] > 0 else '-') + 'x' if bd else 'n/a'}"
              f"  (hands {bd['offset_bh']:+.3f} bh off the hip line, conf {bd['conf']})"
              if bd else "           ball direction n/a — stack angles stay unsigned")
        emit("stage_done", "metrics")

        # --- the angle table, one column per checkpoint ---------------------------------
        # The single most useful thing to eyeball after a run: every angle across the whole
        # swing, so a number that jumps between adjacent positions is visible immediately.
        if mt["checkpoints"]:
            cols = mt["checkpoints"]
            print("\n" + " " * 31 + "".join(f"{c['p']:>8}" for c in cols))
            print(f"{'angle':<28}{'@f':>3}" + "".join(f"{c['frame']:>8}" for c in cols))
            for spec in mt["angle_fields"]:
                vals = [c["values"].get(spec["field"]) for c in cols]
                if all(v is None for v in vals):
                    continue
                tag = {"both": "", "dtl": "D", "face_on": "F"}[spec["view"]]
                # A setup-only angle is printed at P1 and blanked everywhere else, because the
                # value elsewhere is real geometry under a name that does not apply there.
                if spec["when"] == "setup":
                    vals = [v if c["id"] == "address" else None for v, c in zip(vals, cols)]
                    tag += "s"
                row = f"{spec['label'][:28]:<28}{tag:>3}"
                for v in vals:
                    row += f"{'-':>8}" if v is None else f"{v:>8.1f}"
                print(row)
            # Printed directly under the angles because they are how you read them: an arm
            # pointing at the lens foreshortens and its elbow angle collapses toward "folded".
            # Near 1.0 the arm is in the image plane and its angle means what it says.
            for role in ("lead", "trail"):
                vals = [c["values"].get(f"{role}_arm_in_plane") for c in cols]
                print(f"{role + ' arm in plane (0-1)':<28}{'':>3}"
                      + "".join(f"{'-':>8}" if v is None else f"{v:>8.2f}" for v in vals))
            print(f"{'checkpoint confidence':<28}{'':>3}" + "".join(f"{c['conf']:>8.2f}" for c in cols))
            print("  D = down-the-line only, F = face-on only, s = setup only; omitted rows are "
                  "fields no frame could measure")

        # --- Stage 2b: silhouette + the setup reference lines it supports ----------------
        # The masks were collected back in Stage 2; only now are the address hold and the body
        # height known, which is what the butt line needs. Nothing here re-reads the video.
        sil_doc, butt, butt_notes = None, None, []
        if mp_series.silhouette:
            emit("stage_started", "silhouette")
            butt, butt_notes = silhouette.butt_line(
                mp_series.silhouette, series.frames, KEYPOINT_NAMES,
                ev.get("address_span"), mt["body_height_norm"], req.view)
            sil_doc = silhouette.payload(
                mp_series.silhouette, series.frames, KEYPOINT_NAMES, mp_series.model,
                anal.width, anal.height, len(series.frames))
            print(f"silhouette {sil_doc['coverage'] * 100:.0f}% of frames, "
                  f"{sum(len(f['p']) for f in sil_doc['frames'])} rings", end="")
            print(f"  ·  butt line x={butt['x']:.4f} conf {butt['conf']} "
                  f"(spread {butt['spread_bh'] * 100:.1f}% bh over {butt['n']} frames)"
                  if butt else "  ·  no butt line")
            for n_ in sil_doc["notes"] + butt_notes:
                print(f"           ! {n_}")
                warn("silhouette", n_)
            emit("stage_done", "silhouette")

        # --- analysis.json (pose portion of the architecture spec contract) ------------------------
        emit("stage_started", "contract")
        doc = {
            "schema_version": SCHEMA_VERSION,
            "video": {
                "fps": norm.fps, "frame_count": len(series.frames),
                "width": norm.width, "height": norm.height,
                "view": req.view, "handedness": req.handedness,
                "source": {
                    # Checked, not assumed. Re-analysis re-reads exactly this string, so a wrong
                    # one is only discovered when someone presses Re-analyze — and it was: a loop
                    # variable named `src` shadowed this path and every artifact silently recorded
                    # a stringified ClubResult instead. Cheap to verify, and the artifact is the
                    # contract (the architecture spec), so it fails here rather than writing a broken one.
                    "path": _checked_source(src), "width": src_info.width, "height": src_info.height,
                    "codec": src_info.codec, "rotation": src_info.rotation,
                    "fps": src_info.fps, "is_vfr": src_info.is_vfr,
                    # Where the retime decision's capture rate came from — additive provenance
                    # (step 02): "manifest" | "container_tag" | "none". 0.0 = real-time clip.
                    "capture_fps": capture_fps, "capture_fps_source": capture_fps_source,
                },
                "analysis_res": {"width": anal.width, "height": anal.height},
            },
            "pose": {
                "model": series.model,
                "keypoint_names": KEYPOINT_NAMES,
                "frames": [
                    {"f": fr["f"],
                     # Confidence is TRUNCATED, not rounded to nearest. Every consumer re-applies
                     # the same MIN_CONF gate the analyzer used, so a confidence that rounds *up*
                     # onto the threshold makes the client include a point the analyzer treated as
                     # missing — and the two then describe different geometry. Measured: swing2
                     # frame 102 stored left_foot_index at exactly 0.35, which put a foot into the
                     # player's stack-angle reference that the metric itself had dropped, moving
                     # the drawn angle ~2 deg off its own label (scripts/checkangles.py).
                     # Truncating can only ever move a value away from the gate, never onto it.
                     "kp": [[round(x, 5), round(y, 5), int(c * 10000) / 10000]
                            for x, y, c in fr["kp"]],
                     # st: 0 missing, 1 provisional/unverified, 2 confirmed, 3 interpolated
                     "st": fr.get("st"),
                     "interp": bool(fr.get("interp", False))}
                    for fr in series.frames
                ],
            },
            "events": ev["events"],
            # The ten coaching positions (P1-P10). The eight events above stay the GolfDB
            # contract; this is the same swing indexed the way a coach talks about it, with two
            # positions GolfDB does not label (P6 shaft-parallel down, P9 trail-arm-parallel
            # through). Angles at each live in metrics.checkpoints.
            "checkpoints": cps["items"],
            "phases": ev["phases"],
            "swing_window": ev["swing_window"],
            # The part of the clip worth playing: one second of approach, the swing, and one
            # second of the held finish. Everything outside it is the golfer settling in and
            # then walking off. Anchored on the Address event at the front and on the golfer
            # actually coming to REST at the back — the Finish event fires when motion decays,
            # which is a few tenths before the finish position is reached and held.
            "playback_window": ev["playback_window"],
            # How many frames of the fixed 1s approach / 1s run-out the clip could not supply.
            # The player holds a freeze frame for these so every swing's lead-in and follow-out are
            # the same length whatever the footage gives (schema 7).
            "playback_pad": ev.get("playback_pad") or [0, 0],
            # The strike as HEARD - a second witness to Impact that shares none of the video
            # side's failure modes, because it is not reading the pixels. It moves nothing: audio
            # carries the recording pipeline's latency (121-148 ms measured on five stock-camera
            # takes, never measured on SwingSage's own recorder) and video wins on precision.
            #
            # `agrees` is what this is FOR. A renderer that draws phase bands can dim them when
            # the two witnesses disagree instead of drawing a confident wrong answer - and on the
            # 7wood-1 fixture they disagree by about forty frames, which is the stored Impact
            # being late, not the microphone.
            "audio_impact": _audio_impact_doc(heard, ev["events"]["impact"]["frame"], norm.fps),
            # The quasi-static hold that ends at the address event. Setup measurements are
            # medians over this span rather than samples of its last frame.
            "address_span": ev.get("address_span"),
            "tempo": ev["tempo"],
            "club": ({
                "club_len": round(cl.club_len, 5),
                "coverage": cl.coverage,
                "trace_enabled": cl.coverage.get("swing", 0) >= 0.5,
                "notes": cl.notes,
                # Which club model produced this, so a stored report stays traceable when the
                # tracker changes underneath it — the same reason pose records its model, and
                # the gap STATUS.md §7 lists as known debt. null = classical path only.
                #
                # `boxes` is the model's RAW output and nothing else: every detection it returned,
                # unfiltered, unweighted, unsmoothed, with no geometric rejection and no dependence
                # on grip_center, club_px, the solver or the swing plane. It exists so the model can
                # be judged on its own — the rest of this block is the pipeline's opinion, this is
                # the model's. Normalised against the ANALYSIS video (what the detector saw), which
                # shares its aspect ratio with the player video, so the usual x*W / y*H applies.
                "detector": ({
                    **det.model,
                    "inject": req.club_detector_inject,
                    "classes": {club_detect.CLUBHEAD: "clubhead", club_detect.STICK: "stick"},
                    "boxes": [
                        {"f": i,
                         "d": [{"c": x.cls,
                                "xy": [round(x.xy[0] / anal.width, 5),
                                       round(x.xy[1] / anal.height, 5)],
                                "wh": [round(x.wh[0] / anal.width, 5),
                                       round(x.wh[1] / anal.height, 5)],
                                "p": round(x.conf, 3)}
                               for x in fr]}
                        for i, fr in enumerate(det.per_frame) if fr
                    ],
                } if det else None),
                "butt_len": round(cl.butt_len, 5),
                # Where the ball was, when it could be found — located by disappearing at impact
                # (club.find_ball), not by a detector. It is what anchors the club head at the
                # strike on a swing too fast for the head to be detected there, and it is the
                # landmark the club-tracking spec has always assumed. Null means it was not found, and the
                # anchor fell back to the club head at Address.
                "ball": cl.ball,
                "frames": [{"f": c.f,
                            "shaft": ([[round(v, 5) for v in p] for p in c.shaft]
                                      if c.shaft else None),
                            "head": [round(v, 5) for v in c.head] if c.head else None,
                            "butt": [round(v, 5) for v in c.butt] if c.butt else None,
                            "conf": round(c.conf, 3),
                            "shaft_angle_deg": round(c.angle, 1) if c.angle is not None else None,
                            "blurred": c.blurred, "interp": c.interp,
                            # Whether this head came from the detector or the solver. Stored so the
                            # trace can be rebuilt from the artifact alone — joining a model head to
                            # a solver head is what makes the polyline zigzag, and iterating on that
                            # should not need a 4-minute re-run of pose and club solving.
                            "from_model": c.from_model,
                            # Placed on the ball at Impact from the Address landmark rather than
                            # found in this frame (club.anchor_ball). Never conflated with
                            # from_model: it is a derived position, and the UI labels it as one.
                            "from_ball": c.from_ball}
                           for c in cl.frames],
                "trace": cl.trace,
                # The frame each trace point was measured on. The polyline is not one point per
                # frame, so a player growing it with the playhead has to be told the mapping —
                # deriving it from the point count puts the head of the line tens of frames away
                # from the club (see swingsage/club.py ClubResult.trace_frames).
                "trace_frames": cl.trace_frames,
                # Alternative solutions over the same frames and the same detections, for
                # side-by-side comparison in the player. There is no ground-truth metric yet to
                # choose between them, so shipping all of them and letting a human look is
                # more honest than picking one silently. Render-only: metrics, face and event
                # refinement all read the primary block above.
                "variants": club_variants or None,
            } if cl else None),
            "face": ({
                # Head orientation only. Impact face angle is intentionally absent — the club-tracking spec.
                "checkpoints": fc.checkpoints,
                "frames": [{"f": x.f, "head_axis_deg": x.head_axis_deg,
                            "to_shaft_deg": x.to_shaft_deg, "conf": x.conf}
                           for x in fc.frames],
                "capability_note": ("Head orientation relative to the shaft, measured at frames "
                                    "where the head has a resolvable silhouette. Face angle at "
                                    "impact requires launch monitor data."),
            } if cl and fc else None),
            "metrics": mt,
            # Setup reference geometry measured off the silhouette rather than off keypoints —
            # a coaching line is tangent to the body's outline, which no keypoint knows about.
            # Small enough to live here; the per-frame outline it came from does not (it is
            # `silhouette.json`, fetched only when that overlay is turned on).
            "posture": ({"butt_line": butt, "notes": butt_notes} if mp_series.silhouette else None),
            "quality": q,
            "quality_raw": before,
            "quality_mediapipe": quality_mp if req.pose_model == "rtmpose" else None,
            "stage3": ({"body_height_px": round(rep.body_height * anal.height, 1),
                        "side_swaps": rep.swaps, "bone_rejects": rep.bone_rejects,
                        "grip_rejects": rep.grip_rejects, "outlier_rejects": rep.outlier_rejects,
                        "promoted": rep.promoted, "interpolated": rep.interpolated,
                        "notes": rep.notes} if rep else None),
        }
        # Validated against packages/schema, then written atomically.
        #
        # Validation first because a break that reaches a device cannot be hotfixed — an app in a
        # store keeps reading these for months. Atomic because a re-run overwrites in place while the
        # web app may be reading, and a partial read is not a partial artifact: the reader parses the
        # whole file, so a truncated read throws, returns null, and the player 404s on a swing that
        # exists. os.replace on the same filesystem means a reader sees either the old artifact or
        # the new one and never a half-written one.
        contract.write_json("analysis", doc, out / "analysis.json")
        artifacts.append(out / "analysis.json")

        # Its own file, and written the same way for the same reasons: the web app may be reading it
        # while a re-analysis rewrites it, and a truncated read is not a partial silhouette — it
        # throws and the overlay 404s on a swing that has one.
        if sil_doc:
            contract.write_json("silhouette", sil_doc, out / "silhouette.json")
            artifacts.append(out / "silhouette.json")
        emit("stage_done", "contract")

        # --- Stage 8: deterministic scoring (the scoring spec's Part C1) -----------------------------
        # After analysis.json, not before: coach_report.json is a separate artifact (the architecture spec's data
        # model already names it, `swings.coach_report_path`) that reads metrics/checkpoints/tempo
        # rather than being folded into the versioned analysis.json contract. AI is never a hard
        # dependency for `ready` (CLAUDE.md) — this is the whole scorecard with no AI call at all;
        # a real AIProvider narrative (the AI-provider spec) is a later, separate phase that replaces the
        # `_narrative()` half of scoring.py without changing this file's shape.
        if req.scoring:
            emit("stage_started", "scoring")
            t = time.time()
            cfg = scoring.load_config(req.scoring_config)
            report = scoring.write_coach_report(
                out, cfg, mt["checkpoints"], mt["summary"], mt["glossary"], ev["tempo"],
                req.view, club_type=req.club_type)
            print(f"coach      overall {report['overall']} ({report['band']}) — "
                  f"scoring_config {cfg['version']}  ({time.time() - t:.1f}s)")
            for cat, c in report["categories"].items():
                if c["score"] is not None:
                    print(f"           {cat:<24} {c['score']:>5.1f}  "
                          f"({c['n_measurable']}/{c['n_total']} checks measurable)")
            artifacts.append(out / "coach_report.json")
            emit("stage_done", "scoring")

        # --- Gate 1 renders -------------------------------------------------------------
        emit("stage_started", "render")
        t = time.time()
        render.burn_in(norm.path, series.frames, out / "overlay.mp4",
                       detected=series.detected, fps=norm.fps)
        render.contact_sheet(norm.path, series.frames, out / "contact.jpg")
        print(f"rendered   overlay.mp4 + contact.jpg ({time.time() - t:.1f}s)")
        artifacts += [out / "overlay.mp4", out / "contact.jpg"]
        emit("stage_done", "render")

        # --- Quality report -------------------------------------------------------------
        print(f"\ndetection coverage {q['detection_coverage'] * 100:.1f}%  "
              f"overall mean conf {q['overall_mean_conf']:.3f}"
              + (f"   (full-frame baseline {before['overall_mean_conf']:.3f})" if before else ""))
        key = ["head_center", "neck", "left_shoulder", "right_shoulder", "left_elbow",
               "right_elbow", "left_wrist", "right_wrist", "grip_center", "mid_hip",
               "left_knee", "right_knee", "left_ankle", "right_ankle",
               "left_foot_index", "right_foot_index"]
        # The wholebody-only points. Listed separately because they are absent on the MediaPipe
        # and Halpe26 paths, where printing them as 0% would read as a regression rather than
        # as "this model does not produce them".
        if req.pose_model == "rtmpose" and req.wholebody:
            key += ["left_index", "right_index", "left_middle_mcp", "right_middle_mcp",
                    "left_small_toe", "right_small_toe", "chin", "nose_bridge"]
        if before:
            rtm = req.pose_model == "rtmpose"
            hdr = f"{'joint':<18}{'final':>9}{'raw':>9}"
            if rtm:
                hdr += f"{'mediapipe':>11}"
            print(hdr + f"{'mean conf':>12}")
            for name in key:
                s, b = q["per_joint"].get(name), before["per_joint"].get(name)
                if not (s and b):
                    continue
                row = (f"{name:<18}{s['coverage'] * 100:>8.1f}%{b['coverage'] * 100:>8.1f}%")
                if rtm:
                    m = quality_mp["per_joint"].get(name)
                    row += f"{(m['coverage'] * 100 if m else 0):>10.1f}%"
                gain = (s["coverage"] - (quality_mp["per_joint"][name]["coverage"]
                                         if rtm and name in quality_mp["per_joint"]
                                         else b["coverage"]))
                mark = "  ++" if gain > 0.15 else ("  +" if gain > 0.03 else
                                                   ("  --" if gain < -0.03 else ""))
                print(row + f"{s['mean_conf']:>12.3f}{mark}")
        else:
            print(f"{'joint':<18}{'coverage':>10}{'mean conf':>12}")
            for name in key:
                s = q["per_joint"].get(name)
                if s:
                    flag = "  <-- low" if s["coverage"] < 0.9 else ""
                    print(f"{name:<18}{s['coverage'] * 100:>9.1f}%{s['mean_conf']:>12.3f}{flag}")

        elapsed = time.time() - t_all
        print(f"\ntotal {elapsed:.1f}s -> {out}")
        return PipelineResult(out_dir=out, artifacts=tuple(artifacts),
                              schema_version=SCHEMA_VERSION, elapsed_s=elapsed,
                              warnings=tuple(warnings))
