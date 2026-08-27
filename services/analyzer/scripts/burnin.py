"""Gate 1 harness: swing video -> analysis.json + overlay.mp4 + contact sheet.

No web app, no database, no AI. This exists to answer one question in isolation — is the
pose correct? — before any browser code can confuse pose error with frame-sync error.

    python scripts/burnin.py <video> [--out DIR] [--no-retry]

Outputs into DIR (default: out/<video stem>/):
    normalized.mp4   CFR 60, rotation baked, short side 1080  (player + burn-in source)
    analysis.mp4     CFR 60, short side 720                   (what the CV consumed)
    analysis.json    pose portion of the architecture spec contract
    overlay.mp4      skeleton burned into pixels              <- watch this at 0.25x
    contact.jpg      24-frame grid of the whole swing

This script is a thin CLI over `swingsage.pipeline.run()` — the composition, the doc
assembly and the output lock all live there now, so the queue-driven worker and this
harness are the same pipeline with different front doors. Add a flag here only by adding
the field to `AnalysisRequest` first; `tests/test_pipeline.py` fails if the two drift.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingsage.pipeline import AnalysisRequest, PipelineError, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default=None)
    ap.add_argument("--view", default="dtl", choices=["dtl", "face_on"])
    ap.add_argument("--handedness", default="right", choices=["right", "left"])
    # Club TYPE (driver vs irons) for scoring's club-aware bands (the scoring spec) — distinct from
    # the `club`/`club_detect` modules, which track the physical club object in-frame.
    # Not part of analysis.json (that contract is versioned and this is scoring-only metadata,
    # not a CV output); recorded straight into coach_report.json instead. Defaults to unknown
    # rather than guessing — scoring.py skips club-scoped checks rather than scoring them
    # against the wrong band, which is worse than not scoring them at all.
    ap.add_argument("--club-type", default=None, choices=["driver", "irons"],
                    help="for scoring's club-aware bands; omit if unknown")
    ap.add_argument("--scoring-config", default="v2",
                    help="scoring_config/<version>.json to score against (Stage 8)")
    ap.add_argument("--no-scoring", action="store_true",
                    help="skip Stage 8 (deterministic scoring, the scoring spec)")
    ap.add_argument("--no-retry", action="store_true",
                    help="skip the IMAGE-mode re-detection pass over dropout spans")
    ap.add_argument("--no-silhouette", action="store_true",
                    help="skip Stage 2b — the golfer's outline (silhouette.json) and the "
                         "address butt line derived from it. It rides along on the MediaPipe "
                         "pass that always runs, so it costs ~2s on a 400-frame clip; skip it "
                         "only when isolating that.")
    # ROI cropping was removed from this pipeline — it measurably hurt on both fixtures, and
    # its three helpers (video.crop_scale, pose.swing_bbox, pose.remap_to_full) went with it.
    # Redoing it means writing them again against the shared FrameProvider, which is a
    # different shape from what they assumed anyway.
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
                         "strong class (mAP50 0.976 vs clubhead 0.686)")
    ap.add_argument("--club-detector-inject",
                    choices=["none", "heads", "sticks", "both"], default="heads",
                    help="which detector classes feed the solver. 'none' still runs the "
                         "detector and still publishes its raw boxes for the player's raw "
                         "overlay — it just does not let them affect the solve. Use 'none' to "
                         "see the model unmodified by anything else.")
    ap.add_argument("--club-detector-radius", action="store_true",
                    help="let detections assert the head DISTANCE as well as its angle. Off by "
                         "default: it bypasses radius smoothing and measurably increased "
                         "club-length jitter (address-hold stdev 18.8px -> 29.4px)")
    ap.add_argument("--club-detector-conf", type=float, default=0.15,
                    help="detector confidence floor. Low on purpose — the solver decides, and "
                         "a high floor recreates candidate starvation")
    ap.add_argument("--club-ball-anchor", action="store_true",
                    help="put the club head on the ball at Impact when the tracked path misses "
                         "it (club.anchor_ball). OFF: it fixes pro_2 and degrades perfect, and "
                         "the two are indistinguishable without knowing where the ball actually "
                         "is. Hand-placed markers are the supported fix meanwhile.")
    ap.add_argument("--club-ball-detect", action="store_true",
                    help="look for the ball by its disappearance at impact and anchor the club "
                         "head to it. OFF: on the four fixtures it finds the golfer's shoe "
                         "twice and nothing twice. Without it the impact anchor uses the "
                         "club head at Address, the club-tracking spec's landmark. "
                         "`scripts/checkball.py --live` iterates on it without a re-run.")
    ap.add_argument("--club-takeaway", action="store_true", default=True,
                    help="move Address back to the frame the club head left its rest position, "
                         "when the detector shows it leaving before the hands do. Bounded by "
                         "--club-takeaway-lookback, and only when the head is demonstrably still "
                         "just before that frame — otherwise a golfer walking the club into the "
                         "ball looks identical. On by default.")
    ap.add_argument("--no-club-takeaway", dest="club_takeaway", action="store_false")
    ap.add_argument("--club-takeaway-lookback", type=int, default=None,
                    help="how many frames before the hand-based Address to search (default 12, "
                         "0.20s at the CFR 60 every clip is normalised to)")
    ap.add_argument("--club-takeaway-tol", type=float, default=None,
                    help="head travel over 3 frames, as a fraction of club length, that counts "
                         "as the club moving (default 0.005). Lower reaches further back; the "
                         "fixtures are stable across 0.005-0.006 and collapse by 0.008")
    ap.add_argument("--club-rigid", action="store_true",
                    help="rebuild the club from a rigid model: hands + one smoothed angle at a "
                         "fixed length (club.rigidify). Fixes the frame-to-frame length jitter "
                         "that `_build_club` produces by re-deriving length every frame")
    ap.add_argument("--club-head-from-model", action="store_true",
                    help="take the head straight from the detector where it is confident, "
                         "instead of only nudging the solver. With injection alone the solved "
                         "head still sat a median 60px from the model's. Combine with "
                         "--club-rigid to smooth AFTER measuring")
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
    return ap


def request_from_args(args: argparse.Namespace) -> AnalysisRequest:
    """CLI namespace -> AnalysisRequest. The `--no-X` flags flip to positive fields here;
    everything else maps by name."""
    return AnalysisRequest(
        video=Path(args.video),
        out_dir=Path(args.out) if args.out else None,
        view=args.view,
        handedness=args.handedness,
        club_type=args.club_type,
        scoring_config=args.scoring_config,
        scoring=not args.no_scoring,
        retry=not args.no_retry,
        silhouette=not args.no_silhouette,
        analysis_short_side=args.analysis_short_side,
        stage3=not args.no_stage3,
        pose_model=args.pose_model,
        rtm_mode=args.rtm_mode,
        club=not args.no_club,
        club_detector=args.club_detector,
        club_detector_device=args.club_detector_device,
        club_detector_gain=args.club_detector_gain,
        club_detector_stick_gain=args.club_detector_stick_gain,
        club_detector_inject=args.club_detector_inject,
        club_detector_radius=args.club_detector_radius,
        club_detector_conf=args.club_detector_conf,
        club_ball_anchor=args.club_ball_anchor,
        club_ball_detect=args.club_ball_detect,
        club_takeaway=args.club_takeaway,
        club_takeaway_lookback=args.club_takeaway_lookback,
        club_takeaway_tol=args.club_takeaway_tol,
        club_rigid=args.club_rigid,
        club_head_from_model=args.club_head_from_model,
        club_model_min_conf=args.club_model_min_conf,
        club_model_smooth=args.club_model_smooth,
        club_model_traj_gate=args.club_model_traj_gate,
        club_variants=args.club_variants,
        wholebody=args.wholebody,
    )


def main() -> int:
    args = build_parser().parse_args()
    src = Path(args.video).resolve()
    if not src.exists():
        print(f"no such video: {src}")
        return 1
    try:
        run(request_from_args(args))
    except PipelineError as e:
        # Same exit code (1) and same message the pre-extraction SystemExits produced.
        raise SystemExit(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
