"""Gate 1 harness: swing video -> analysis.json + overlay.mp4 + contact sheet.

No web app, no database, no AI. This exists to answer one question in isolation — is the
pose correct? — before any browser code can confuse pose error with frame-sync error.

    python scripts/burnin.py <video> [--out DIR] [--no-retry]

Outputs into DIR (default: out/<video stem>/):
    normalized.mp4   CFR 60, rotation baked, short side 1080  (player + burn-in source)
    analysis.mp4     CFR 60, short side 720                   (what the CV consumed)
    analysis.json    pose portion of the doc 02 contract
    overlay.mp4      skeleton burned into pixels              <- watch this at 0.25x
    contact.jpg      24-frame grid of the whole swing
"""
from __future__ import annotations

import argparse
import atexit
import copy as copy0
import json
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingsage import (checkpoints, club, club_detect, events, face,  # noqa: E402
                       metrics, pose, pose_rtm, postprocess, render, scoring,
                       silhouette, source_timing, video)
from swingsage.skeleton import KEYPOINT_NAMES, strip_derived  # noqa: E402

# Bump whenever a field is ADDED to analysis.json, not only on breaking changes.
#
# The artifact is the contract (doc 02) and the player renders it and nothing else, so editing
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
#      by ~2 deg where a confidence rounded up onto the MIN_CONF gate (D33).
#   4  + club.frames[].from_model (did the detector or the solver place this head) and the
#      trace-only variants. from_model exists so the trace can be rebuilt from the artifact
#      alone, without re-running pose and club solving to iterate on it.
#   5  + playback_window: the span of the clip worth playing (approach, swing, held finish),
#      so the player can drop the dead footage at both ends. NOT swing_window, which is the
#      Stage 3 motion-burst gate and is far too tight to play.
#   6  + club.trace_frames (and per variant): which frame each trace point was measured on.
#      The trace is not one point per frame, so without it a player growing the path with the
#      playhead can only guess by counting — which put the head of the line up to 34 frames
#      from the club (D43). It is also what identifies the spans nothing was measured in, so
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
SCHEMA_VERSION = 9

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
                raise SystemExit(
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
        raise SystemExit(
            f"refusing to write analysis.json: video.source.path is not a readable file "
            f"({str(src)[:120]!r}). Re-analysis reads this path back, so a bad one would only "
            f"surface when someone pressed Re-analyze.")
    return str(p)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default=None)
    ap.add_argument("--view", default="dtl", choices=["dtl", "face_on"])
    ap.add_argument("--handedness", default="right", choices=["right", "left"])
    # Club TYPE (driver vs irons) for scoring's club-aware bands (doc 05 C1) — distinct from
    # the `club`/`club_detect` modules above, which track the physical club object in-frame.
    # Not part of analysis.json (that contract is versioned and this is scoring-only metadata,
    # not a CV output); recorded straight into coach_report.json instead. Defaults to unknown
    # rather than guessing — scoring.py skips club-scoped checks rather than scoring them
    # against the wrong band, which is worse than not scoring them at all.
    ap.add_argument("--club-type", default=None, choices=["driver", "irons"],
                    help="for scoring's club-aware bands; omit if unknown")
    ap.add_argument("--scoring-config", default="v2",
                    help="scoring_config/<version>.json to score against (Stage 8)")
    ap.add_argument("--no-scoring", action="store_true",
                    help="skip Stage 8 (deterministic scoring, doc 05 C1)")
    ap.add_argument("--no-retry", action="store_true",
                    help="skip the IMAGE-mode re-detection pass over dropout spans")
    ap.add_argument("--no-silhouette", action="store_true",
                    help="skip Stage 2b — the golfer's outline (silhouette.json) and the "
                         "address butt line derived from it. It rides along on the MediaPipe "
                         "pass that always runs, so it costs ~2s on a 400-frame clip; skip it "
                         "only when isolating that.")
    # ROI cropping was removed from this pipeline — it measurably hurt on both fixtures
    # (docs/DECISIONS.md D5). video.crop_scale / pose.swing_bbox remain if it needs redoing.
    ap.add_argument("--analysis-short-side", type=int, default=720,
                    help="resolution the CV pipeline consumes")
    ap.add_argument("--no-stage3", action="store_true",
                    help="skip post-processing (raw Stage 2 baseline for A/B)")
    ap.add_argument("--pose-model", choices=["mediapipe", "rtmpose"], default="rtmpose",
                    help="landmark model; rtmpose is markedly better on occluded limbs")
    ap.add_argument("--rtm-mode", choices=["performance", "balanced"], default="performance")
    ap.add_argument("--no-club", action="store_true", help="skip Stage 4 club tracking")
    ap.add_argument("--club-detector", default=None, metavar="WEIGHTS",
                    help="fine-tuned YOLO club-head weights (e.g. runs/clubhead/weights/"
                         "best.pt). Adds learned evidence to the existing tracker; omit for "
                         "the classical-only path. A/B the two to judge it.")
    ap.add_argument("--club-detector-device", default=None,
                    help="'cpu' or a CUDA index. Default auto; pass cpu if a training run "
                         "is using the GPU.")
    ap.add_argument("--club-detector-gain", type=float, default=None,
                    help="override ClubConfig.detector_gain (evidence weight, 0-1 scale)")
    ap.add_argument("--club-detector-stick-gain", type=float, default=None,
                    help="override ClubConfig.detector_stick_gain. `stick` is the model's "
                         "strong class (mAP50 0.976 vs clubhead 0.686, D23a)")
    ap.add_argument("--club-detector-inject",
                    choices=["none", "heads", "sticks", "both"], default="heads",
                    help="which detector classes feed the solver. 'none' still runs the "
                         "detector and still publishes its raw boxes for the player's raw "
                         "overlay — it just does not let them affect the solve. Use 'none' to "
                         "see the model unmodified by anything else.")
    ap.add_argument("--club-detector-radius", action="store_true",
                    help="let detections assert the head DISTANCE as well as its angle. Off by "
                         "default: it bypasses D17 radius smoothing and measurably increased "
                         "club-length jitter (address-hold stdev 18.8px -> 29.4px)")
    ap.add_argument("--club-detector-conf", type=float, default=0.15,
                    help="detector confidence floor. Low on purpose — the solver decides, and "
                         "a high floor recreates the candidate starvation of D14")
    ap.add_argument("--club-ball-anchor", action="store_true",
                    help="put the club head on the ball at Impact when the tracked path misses "
                         "it (club.anchor_ball). OFF: it fixes pro_2 and degrades perfect, and "
                         "the two are indistinguishable without knowing where the ball actually "
                         "is (D44). Hand-placed markers are the supported fix meanwhile.")
    ap.add_argument("--club-ball-detect", action="store_true",
                    help="look for the ball by its disappearance at impact and anchor the club "
                         "head to it. OFF: on the four fixtures it finds the golfer's shoe "
                         "twice and nothing twice (D44). Without it the impact anchor uses the "
                         "club head at Address, doc 04 §3's landmark. "
                         "`scripts/checkball.py --live` iterates on it without a re-run.")
    ap.add_argument("--club-rigid", action="store_true",
                    help="rebuild the club from a rigid model: hands + one smoothed angle at a "
                         "fixed length (club.rigidify). Fixes the frame-to-frame length jitter "
                         "that `_build_club` produces by re-deriving length every frame")
    ap.add_argument("--club-head-from-model", action="store_true",
                    help="take the head straight from the detector where it is confident, "
                         "instead of only nudging the solver. With injection alone the solved "
                         "head still sat a median 60px from the model's. Combine with "
                         "--club-rigid to smooth AFTER measuring (D32)")
    ap.add_argument("--club-model-min-conf", type=float, default=None,
                    help="min detection confidence for --club-head-from-model (default 0.35)")
    ap.add_argument("--club-model-smooth", action="store_true",
                    help="smooth the measured head path in polar coords about the hands, KEEPING "
                         "the measured radius (unlike --club-rigid, which imposes the calibrated "
                         "club length)")
    ap.add_argument("--club-model-traj-gate", action="store_true",
                    help="before smoothing, reject isolated head jumps by trajectory continuity "
                         "(Hampel on the shaft angle). For the backswing, where the club passes "
                         "behind the golfer and the detector can misfire for a frame or two")
    ap.add_argument("--club-variants", action="store_true", default=True,
                    help="also solve the club the other ways and store them all in "
                         "analysis.json, so the player can switch between them without a "
                         "re-run. Needs --club-detector. On by default.")
    ap.add_argument("--no-club-variants", dest="club_variants", action="store_false")
    ap.add_argument("--wholebody", action="store_true", default=True,
                    help="RTMW 133-kpt model; gives real knuckles so grip_center is the "
                         "hands rather than the wrist bone")
    ap.add_argument("--no-wholebody", dest="wholebody", action="store_false")
    args = ap.parse_args()

    src = Path(args.video).resolve()
    if not src.exists():
        print(f"no such video: {src}")
        return 1
    out = Path(args.out).resolve() if args.out else Path("out") / src.stem
    out.mkdir(parents=True, exist_ok=True)

    # Claim the output directory for the duration. Registered with atexit rather than wrapped
    # in `with` to keep this a small change; a hard kill skips atexit, which is exactly the
    # case OutputLock's stale-pid detection handles.
    lock = OutputLock(out).__enter__()
    atexit.register(lock.__exit__)

    t_all = time.time()

    # --- Stage 0: probe + normalize -------------------------------------------------
    src_info = video.probe(src)
    print(f"source     {src_info.width}x{src_info.height} {src_info.codec} "
          f"rot={src_info.rotation} fps={src_info.fps:.3f} "
          f"(nominal {src_info.nominal_fps:.3f}) frames={src_info.frame_count} "
          f"{'VFR' if src_info.is_vfr else 'CFR'}")
    if src_info.is_vfr:
        print("           -> VFR detected; CFR normalization is mandatory for frame sync")

    t = time.time()
    norm = video.normalize(src, out / "normalized.mp4", short_side=1080, fps=60)
    anal = video.normalize(src, out / "analysis.mp4",
                           short_side=args.analysis_short_side, fps=60)
    print(f"normalized {norm.width}x{norm.height} @ {norm.fps:.3f} "
          f"frames={norm.frame_count} | analysis {anal.width}x{anal.height} "
          f"({time.time() - t:.1f}s)")

    # Source timing sidecar (D54): what the camera actually observed, before the CFR
    # resample rewrote it. Degrades to a warning — the pipeline never fails over metadata.
    try:
        timing = source_timing.build(src, out_fps=norm.fps,
                                     out_frame_count=norm.frame_count)
        source_timing.write_sidecar(timing, out)
        dups = sum(1 for o in timing.observations if o.is_duplicate_group)
        print(f"timing     {timing.distinct_observation_count} source observations "
              f"({dups} duplicated into CFR), audio="
              + (f"{timing.audio_sample_rate}Hz {timing.audio_codec}"
                 if timing.has_audio else "none"))
    except Exception as e:  # noqa: BLE001 — sidecar is advisory, never fatal
        print(f"           ! source timing failed ({e}); {source_timing.SIDECAR_NAME} skipped")

    # --- Stage 2: pose --------------------------------------------------------------
    def prog(done, total):
        print(f"\r  pose {done}/{total or '?'}", end="", flush=True)

    def snapshot(s):
        """Quality of a series without disturbing it (finalize mutates)."""
        return pose.quality(pose.finalize(pose.RawPoseSeries(
            model=s.model, frames=copy0.deepcopy(s.frames), detected=list(s.detected))))

    # MediaPipe always runs. It is the fallback estimator, and when RTMPose is selected it
    # is also the person localiser that supplies RTMPose's per-frame box (see pose_rtm.py).
    t = time.time()
    mp_series = pose.estimate(anal.path, progress=prog,
                              silhouette=not args.no_silhouette)
    print(f"\r  mediapipe          {len(mp_series.frames)} frames in {time.time() - t:.1f}s"
          + (f" · silhouette on {len(mp_series.silhouette)}/{len(mp_series.frames)}"
             if mp_series.silhouette else ""))
    if not args.no_retry:
        fixed = pose.retry_gaps(anal.path, mp_series)
        if fixed:
            print(f"  retry recovered {fixed} frames via IMAGE-mode re-detection")
    quality_mp = snapshot(mp_series)

    if args.pose_model == "rtmpose":
        boxes = pose_rtm.bboxes_from_series(mp_series)
        t = time.time()
        series = pose_rtm.estimate(anal.path, boxes, mode=args.rtm_mode, progress=prog,
                                   wholebody=args.wholebody)
        dt = max(time.time() - t, 1e-6)
        print(f"\r  rtmpose            {len(series.frames)} frames in {dt:.1f}s "
              f"({len(series.frames) / dt:.1f} fps)")
        n = min(len(mp_series.frames), len(series.frames))
        series.frames = series.frames[:n]
        series.detected = series.detected[:n]
    else:
        series = mp_series

    # --- Stage 3: post-processing (doc 03 §3) ---------------------------------------
    # Raw quality of the *chosen* model, so the table below isolates Stage 3's effect.
    before = snapshot(series)

    rep = None
    if not args.no_stage3:
        # A rough swing window from the raw pose gates the grip prior; the definitive
        # events are detected afterwards on the cleaned series.
        pose.finalize(pose.RawPoseSeries(model=series.model, frames=series.frames,
                                         detected=series.detected))
        try:
            _pre, pre_sg = events.detect(series.frames, args.handedness, norm.fps)
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
            trust_hands=(args.pose_model == "rtmpose" and args.wholebody))
        print(f"stage3     side-swaps {rep.swaps}, bone rejects {rep.bone_rejects}, "
              f"grip rejects {rep.grip_rejects}, outliers {rep.outlier_rejects}, "
              f"promoted {rep.promoted}, interpolated {rep.interpolated} "
              f"({time.time() - t:.1f}s)")
        for n in rep.notes:
            print(f"           ! {n}")

    pose.finalize(series)
    q = pose.quality(series)

    # --- Stage 5: swing events (doc 05 A) -------------------------------------------
    t = time.time()
    ev, sg = events.detect(series.frames, args.handedness, norm.fps)
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

    # --- Stage 4: club tracking (doc 04) --------------------------------------------
    cl = None
    det = None
    club_variants: dict = {}
    # Alternative solves, keyed by variant name. Hoisted out of the variants block because
    # `refine_events` below needs the detector-measured heads one of them carries.
    solves: dict = {}
    if not args.no_club:
        cfg_club = replace(club.ClubConfig(),
                           use_rigid=args.club_rigid,
                           detector_inject=args.club_detector_inject,
                           detector_radius=args.club_detector_radius,
                           detector_head_primary=args.club_head_from_model,
                           detector_smooth=args.club_model_smooth,
                           detector_traj_gate=args.club_model_traj_gate,
                           ball_detect=args.club_ball_detect,
                           ball_anchor=args.club_ball_anchor)
        if args.club_model_min_conf is not None:
            cfg_club = replace(cfg_club,
                               detector_primary_min_conf=args.club_model_min_conf)
        if args.club_detector:
            if args.club_detector_gain is not None:
                cfg_club = replace(cfg_club, detector_gain=args.club_detector_gain)
            if args.club_detector_stick_gain is not None:
                cfg_club = replace(cfg_club,
                                   detector_stick_gain=args.club_detector_stick_gain)
            t = time.time()
            d = club_detect.ClubDetector(args.club_detector,
                                         conf=args.club_detector_conf,
                                         device=args.club_detector_device)
            det = d.run(anal.path, n_frames=len(series.frames), progress=prog)
            m = det.model
            n_stick = sum(1 for fr in det.per_frame
                          for x in fr if x.cls == club_detect.STICK)
            print(f"\r  detector   heads {m['head_detections']} on "
                  f"{m['frames_with_head']}/{m['frames']} frames · sticks {n_stick}  "
                  f"inject={args.club_detector_inject}  {m['weights']}@{m['sha256']}  "
                  f"({time.time() - t:.1f}s)")
            for n_ in det.notes:
                print(f"           ! {n_}")

        t = time.time()
        cl = club.track(anal.path, series.frames, ev, args.handedness, cfg=cfg_club,
                        progress=prog, detector=det)
        cov = cl.coverage
        print(f"\r  club       coverage back {cov.get('backswing', 0) * 100:.0f}% / "
              f"down {cov.get('downswing', 0) * 100:.0f}% / "
              f"through {cov.get('followthrough', 0) * 100:.0f}%  "
              f"club_len {cl.club_len:.3f}  ({time.time() - t:.1f}s)")
        for n_ in cl.notes:
            print(f"           ! {n_}")

        # --- Stage 4c: alternative club solutions, in the SAME artifact ----------------
        # The club can be solved several ways and there is no ground-truth metric yet to pick
        # a winner (D20), so the honest thing is to ship the alternatives and let a human
        # compare them on real pixels. Storing them together means one video and one page
        # rather than a directory per experiment — the player switches between them, so the
        # comparison is a click instead of a re-run.
        #
        # Only the render-relevant fields are kept per variant; `club` above remains the
        # single input to metrics, face and event refinement, so nothing downstream forks.
        if det is not None and args.club_variants:
            VARIANTS = [
                ("classical", "Classical only (no detector)",
                 dict(detector_inject="none", detector_head_primary=False, use_rigid=False)),
                ("evidence", "Detector as evidence (D23)",
                 dict(detector_inject="both", detector_head_primary=False, use_rigid=False)),
                ("model", "Model head, unsmoothed",
                 dict(detector_inject="both", detector_head_primary=True, use_rigid=False)),
                # Keeps the MEASURED radius and only de-noises it, unlike model_rigid which
                # imposes the calibrated club length. The calibration looks ~1.5x too long
                # (D32), so trusting the measurement over it is the point.
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
            ]

            for key, label, over in VARIANTS:
                t = time.time()
                v = club.track(anal.path, series.frames, ev, args.handedness,
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
        # Doc 02 quality gate: below 50% across the swing the trace is disabled rather
        # than shown as a fabricated path.
        if cov.get("swing", 0) < 0.5:
            print(f"           ! trace disabled — swing coverage "
                  f"{cov.get('swing', 0) * 100:.0f}% < 50%")

        # Doc 05 promised Phase 4 would refine the shaft-defined events once club data existed.
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
        for msg in club.refine_events(cl, ev, cfg_club, heads=det_heads,
                                      fps=norm.fps or 60.0):
            print(f"           refined {msg}")

        # --- club head orientation through the swing (doc 04 §6 tier 2) --------------
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

    # --- Stage 5b: the ten coaching checkpoints (P1-P10) ----------------------------
    # After club refinement, because P2/P6/P8 are shaft-defined and only resolve properly
    # once the shaft exists. Falls back to pose proxies with --no-club, at lower confidence.
    cps = checkpoints.build(ev, sg, series.frames, args.handedness, club=cl,
                            n_frames=len(series.frames))
    print("checkpoints " + "  ".join(
        f"{i['p']}={i['frame']}" for i in cps["items"]))
    for n_ in cps["notes"]:
        print(f"           ! {n_}")

    # --- Stage 6: metrics (doc 05 Part B) -------------------------------------------
    # After Stage 4: wrist hinge is lead-forearm vs club shaft, so it needs club data.
    t = time.time()
    club_frames = [{"f": c.f, "head": c.head, "conf": c.conf} for c in cl.frames] if cl else None
    mt = metrics.compute(series.frames, ev, args.view, args.handedness,
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
        butt, butt_notes = silhouette.butt_line(
            mp_series.silhouette, series.frames, KEYPOINT_NAMES,
            ev.get("address_span"), mt["body_height_norm"], args.view)
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

    # --- analysis.json (pose portion of the doc 02 contract) ------------------------
    doc = {
        "schema_version": SCHEMA_VERSION,
        "video": {
            "fps": norm.fps, "frame_count": len(series.frames),
            "width": norm.width, "height": norm.height,
            "view": args.view, "handedness": args.handedness,
            "source": {
                # Checked, not assumed. Re-analysis re-reads exactly this string, so a wrong
                # one is only discovered when someone presses Re-analyze — and it was: a loop
                # variable named `src` shadowed this path and every artifact silently recorded
                # a stringified ClubResult instead. Cheap to verify, and the artifact is the
                # contract (doc 02), so it fails here rather than writing a broken one.
                "path": _checked_source(src), "width": src_info.width, "height": src_info.height,
                "codec": src_info.codec, "rotation": src_info.rotation,
                "fps": src_info.fps, "is_vfr": src_info.is_vfr,
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
        # The quasi-static hold that ends at the address event. Setup measurements are
        # medians over this span rather than samples of its last frame (D28).
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
                "inject": args.club_detector_inject,
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
            # landmark doc 04 §3 has always assumed. Null means it was not found, and the
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
            # choose between them (D20), so shipping all of them and letting a human look is
            # more honest than picking one silently. Render-only: metrics, face and event
            # refinement all read the primary block above.
            "variants": club_variants or None,
        } if cl else None),
        "face": ({
            # Head orientation only. Impact face angle is intentionally absent — doc 04 §6.
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
        "quality_mediapipe": quality_mp if args.pose_model == "rtmpose" else None,
        "stage3": ({"body_height_px": round(rep.body_height * anal.height, 1),
                    "side_swaps": rep.swaps, "bone_rejects": rep.bone_rejects,
                    "grip_rejects": rep.grip_rejects, "outlier_rejects": rep.outlier_rejects,
                    "promoted": rep.promoted, "interpolated": rep.interpolated,
                    "notes": rep.notes} if rep else None),
    }
    # Write atomically. A re-run overwrites this file in place while the web app may be
    # reading it, and a partial read is not a partial artifact — `getAnalysis` parses the whole
    # file, so a truncated read throws, returns null, and the player 404s on a swing that
    # exists. os.replace is atomic on the same filesystem, so a reader sees either the old
    # artifact or the new one and never a half-written one.
    tmp = out / "analysis.json.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, out / "analysis.json")

    # Its own file, and written the same atomic way for the same reason: the web app may be
    # reading it while a re-analysis rewrites it, and a truncated read is not a partial
    # silhouette — it throws and the overlay 404s on a swing that has one.
    if sil_doc:
        tmp = out / "silhouette.json.tmp"
        tmp.write_text(json.dumps(sil_doc), encoding="utf-8")
        os.replace(tmp, out / "silhouette.json")

    # --- Stage 8: deterministic scoring (doc 05 Part C1) -----------------------------
    # After analysis.json, not before: coach_report.json is a separate artifact (doc 02's data
    # model already names it, `swings.coach_report_path`) that reads metrics/checkpoints/tempo
    # rather than being folded into the versioned analysis.json contract. AI is never a hard
    # dependency for `ready` (CLAUDE.md) — this is the whole scorecard with no AI call at all;
    # a real AIProvider narrative (doc 07) is a later, separate phase that replaces the
    # `_narrative()` half of scoring.py without changing this file's shape.
    if not args.no_scoring:
        t = time.time()
        cfg = scoring.load_config(args.scoring_config)
        report = scoring.write_coach_report(
            out, cfg, mt["checkpoints"], mt["summary"], mt["glossary"], ev["tempo"],
            args.view, club_type=args.club_type)
        print(f"coach      overall {report['overall']} ({report['band']}) — "
              f"scoring_config {cfg['version']}  ({time.time() - t:.1f}s)")
        for cat, c in report["categories"].items():
            if c["score"] is not None:
                print(f"           {cat:<24} {c['score']:>5.1f}  "
                      f"({c['n_measurable']}/{c['n_total']} checks measurable)")

    # --- Gate 1 renders -------------------------------------------------------------
    t = time.time()
    render.burn_in(norm.path, series.frames, out / "overlay.mp4",
                   detected=series.detected, fps=norm.fps)
    render.contact_sheet(norm.path, series.frames, out / "contact.jpg")
    print(f"rendered   overlay.mp4 + contact.jpg ({time.time() - t:.1f}s)")

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
    if args.pose_model == "rtmpose" and args.wholebody:
        key += ["left_index", "right_index", "left_middle_mcp", "right_middle_mcp",
                "left_small_toe", "right_small_toe", "chin", "nose_bridge"]
    if before:
        rtm = args.pose_model == "rtmpose"
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

    print(f"\ntotal {time.time() - t_all:.1f}s -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
