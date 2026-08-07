"""Stage 4 — club shaft and head tracking (doc 04). The hardest CV problem in the app.

Layered hybrid per doc 04 §2, anchored by the pose skeleton:

  A  motion mask   three-frame differencing, ANDed, morphologically closed to heal the
                   thin shaft, with the golfer's own body suppressed
  B  shaft         probabilistic Hough inside an annulus around grip_center, candidates
                   scored on grip proximity, length plausibility and angular continuity
  C  head          the distal endpoint, refined against the motion blob
  D  temporal      per-segment smoothing splines (the path is only piecewise smooth — it
                   reverses sharply at Top, so one spline across the whole swing would cut
                   the corner)

Designed for graceful degradation throughout: doc 02's quality gate disables the trace below
50% coverage rather than drawing a fabricated path, and every frame carries its own
confidence so the renderer can show what was actually measured.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import cv2
import numpy as np
from scipy.signal import savgol_filter

from . import club_detect, events
from .skeleton import IDX


@dataclass
class ClubConfig:
    diff_thresh: int = 8           # per-pixel motion threshold (0-255)
    body_dilate: float = 0.030     # body suppression radius, fraction of golfer height
    min_len: float = 0.22          # shaft length bounds, fraction of calibrated club length
    max_len: float = 1.45
    hough_thresh: int = 12
    max_angle_step: float = 55.0   # deg/frame; the club is fast but not discontinuous
    search_scale: float = 1.6      # annulus radius, multiples of club length
    grip_tol: float = 0.55         # how far the shaft's near end may sit from the hands
    # A driver head covers ~0.7m between frames at 60fps against a ~1m club, so the gate has
    # to allow most of a club length of travel or it rejects the real downswing.
    max_jump: float = 0.90         # head travel gate per frame, multiples of club length
    smooth_win: int = 5            # head-path smoothing window, frames
    angle_cost: float = 3.0        # weight on angular travel between frames
    support_weight: float = 6.0    # weight on measured motion support vs smoothness
    use_background_model: bool = True   # MOG2 foreground; suppresses wind-blown foliage
    use_shaft_lines: bool = True   # detect the shaft as an oriented line, not a motion blob
    edge_thresh: float = 18.0      # min oriented-gradient evidence to count as shaft
    edge_gap: int = 3              # samples of hole tolerated within one shaft run
    static_line_weight: float = 0.25   # how much a line with NO motion still counts
    plane_weight: float = 4.0      # weight on staying on the fitted swing plane
    # Deliberately loose. The gate exists to reject flipped/teleported frames, not to shape
    # the path — a plane that shifts mid-backswing is normal technique. Tightening this
    # regresses both backswings while only helping swing1's downswing.
    # Tuned by total head-path acceleration across both fixtures and both segments:
    # no plane 264, tol 0.12 -> 246, tol 0.20 -> 274. Looser stops catching swing1's
    # downswing outliers; tighter starts shaping the path instead of gating it.
    plane_tol: float = 0.12        # off-plane distance counted as an outlier, club-lengths
    # Low-order path curve. Degree 3 permits exactly one change of direction, which is the
    # most a real club head path shows within a single segment.
    #
    # OFF by default — implemented, measured, and it does not beat what is already there.
    # Total head-path accel p95 across both swing1 segments: no curve 85.0, curve with a
    # global blend 98.3, curve with a seam-local blend 178.6. The DP already enforces
    # smoothness and the plane gate already removes outliers, so a third smoothing mostly
    # fights them, and excluding the transition leaves a seam that costs more than the
    # outliers it removes. Kept behind the flag because the underlying constraint is sound
    # and would matter more with a noisier detector. See DECISIONS D20.
    use_path_curve: bool = False
    curve_degree: int = 3
    # Learned head detector (Stage 4b, swingsage/club_detect.py). Evidence only — it is added
    # to the same angular profile the two hand-built detectors write, never used on its own
    # (doc 04 §2). With no weights supplied every value below is inert.
    #
    # `detector_gain` is on the same 0-1 scale as motion support, so 1.0 makes a
    # full-confidence detection worth about as much as a fully-supported motion ray. Starting
    # deliberately below that: until doc 04 §7's position-error metric exists there is no
    # falsifiable basis for trusting it *more* than the measurements already there (D20).
    detector_gain: float = 0.8
    detector_spread_bins: float = 1.5   # angular uncertainty of a box centre, in bins (~6 deg)
    # `stick` is the model's strong class — mAP50 0.976 against clubhead's 0.686 (D23a) — and
    # the solver's state IS shaft angle (D17), so a shaft box is direct evidence about the
    # quantity being solved. Weighted above the head accordingly.
    detector_stick_gain: float = 1.2
    detector_stick_spread_bins: float = 2.0
    # Which detector classes feed the solver: "none" | "heads" | "sticks" | "both".
    # "none" still runs the detector and still stores its raw boxes in analysis.json — it just
    # does not let them touch the solve. That is the honest baseline for judging the model.
    detector_inject: str = "heads"
    # Assert the detected distance into `reach`. OFF: an earlier version wrote each frame's raw
    # radius straight in, bypassing D17's radius smoothing, and the drawn club length at the
    # address hold — where the club is not moving — went from stdev 18.8px to 29.4px.
    detector_radius: bool = False
    # Rebuild every frame's club from hands + one smoothed angle at a fixed length
    # (`rigidify`). The function was written, documented and never called — `_build_club` ran
    # instead and re-derived length per frame, which is the length jitter. OFF by default only
    # so the two can be A/B'd; see DECISIONS D32.
    use_rigid: bool = False
    # Take the head straight from the model where it is confident, instead of only nudging the
    # solver's profile. Measured justification: with injection alone the solved head still sat a
    # median 60px from the model's head and only 30% of frames landed within 20px — evidence
    # weighting cannot outvote the motion profile, shaft lines, plane prior and angle-travel
    # cost combined, while the model's raw boxes are visibly on the club head (D32).
    #
    # This sets raw_angle/length per frame; `use_rigid` then smooths them and holds the length
    # rigid. That ordering is the point — trace first, smooth second.
    #
    # Frames with no confident detection fall back to the solver's answer, so this is never
    # detector-only and stays within doc 04 §2.
    detector_head_primary: bool = False
    detector_primary_min_conf: float = 0.35
    # Smooth the measured head path in polar coordinates about the hands, keeping the measured
    # radius rather than imposing the calibrated club length the way `rigidify` does. See
    # `smooth_detector_path`.
    detector_smooth: bool = False
    detector_smooth_win: int = 5
    # Radius window. 0 keeps the historical `max(detector_smooth_win + 4, 7)`. Separable from
    # the angle window because the two are smoothed for different reasons — see
    # `smooth_detector_path` — and because both need to be able to reach *off*: a window under 3
    # means "gate and interpolate, but do not smooth what was measured". The downswing is why.
    # Smoothing the head path uniformly costs it ~50px of reach at the ball on swing2, which is
    # the same effect that made `trace_win_downswing` 0: an even-handed filter over a tightly
    # curving arc flattens curvature that is real, worst at the extreme the swing is judged on.
    detector_radius_smooth_win: int = 0
    # Reject isolated head jumps by trajectory continuity before smoothing (Hampel on the shaft
    # angle). Aimed at the backswing, where the club passes behind the golfer and the detector
    # can misfire for a frame or two — the head jumps a long way and comes straight back, which
    # a local-median test catches and a smoother alone would only average in.
    detector_traj_gate: bool = False
    # Floor on the Hampel tolerance. MAD goes to zero where the club is nearly stationary, so
    # without a floor every small wobble reads as an outlier.
    detector_traj_tol_deg: float = 6.0
    # Trace-only cleanup: "none" | "measured" | "moving" | "savgol". Applies to the polylines
    # the renderer draws and NOTHING else — per-frame head positions are untouched, because the
    # per-frame detection is already good and only the line joining the points is jagged.
    trace_smooth: str = "none"
    trace_win: int = 7
    # The downswing is deliberately NOT smoothed. It is the best-measured segment — the club is
    # large, bright and moving against open background, and its raw head placement is the most
    # accurate of the three. It is also the shortest (25 points against the backswing's 43 on
    # swing2), so a fixed window covers 28% of it versus 16% of the backswing: the segment that
    # needs smoothing least was getting the most, and an order-2 fit over a tightly curving arc
    # flattens curvature that is real. Phase-dependent windows for the same reason D17 needed
    # phase-dependent gap tolerance and D19 needed a phase-dependent detector.
    trace_win_downswing: int = 0
    trace_min_conf: float = 0.30
    # How far past an event a segment may reach for one more measured point, so consecutive
    # segments share a boundary and the line stays continuous through it. 4 frames = 2 source
    # frames on 30fps footage. Bounded because "the nearest measurement" is not always near: at
    # Top on `perfect` the closest measured frames are 20 before and 25 after, and joining to
    # those would make the backswing and the downswing each draw the same long chord across the
    # transition in its own colour, which is worse than leaving the hole the data really has.
    trace_join_frames: int = 4
    # Ball anchoring at Impact (`anchor_ball`). The trigger is a miss larger than this fraction
    # of body height — 5% is about a club head's width at these framings, so anything above it is
    # a visible hole rather than a localisation error. Window is how far either side of the
    # Impact event to look for the frame whose path passes closest to the ball.
    # OFF by default, and the reason is measured rather than cautious. Anchoring fixes `pro_2`
    # (the drawn path reaches 18.8px of the ball instead of missing it by 196px) and *degrades*
    # `perfect`, where it replaces a good detection at the strike with a landmark 48px away. The
    # two cases are indistinguishable from inside: on both clips the tracked path misses the
    # Address landmark by 47px, and the only difference is that on `pro_2` that landmark is the
    # ball and on `perfect` it is not. Making this safe needs the ball itself — see `find_ball`
    # and DECISIONS D44. Until then it is `--club-ball-anchor`, and hand-placed markers
    # (D45) are the supported way to put the head on the ball.
    ball_anchor: bool = False
    ball_anchor_tol: float = 0.05
    ball_anchor_window: int = 6
    # Confidence floor for an anchored frame. High, and deliberately so: the club head being at
    # the ball at Impact is the most certain thing known about the whole swing. It is still
    # flagged `from_ball` so nothing mistakes it for a detection.
    ball_anchor_conf: float = 0.9
    # Ball detection (`find_ball`). OFF: implemented, measured, and it is not good enough to
    # write a club position from. On the four fixtures it finds the golfer's shoe twice and
    # nothing twice — see `find_ball`'s docstring and DECISIONS D44 for what each gate does and
    # why the remaining failures need a learned detector rather than another threshold. The
    # anchor falls back to doc 04 §3's Address landmark, which is what it used before this
    # existed. Turn on with `--club-ball-detect` to iterate; `scripts/checkball.py --live`
    # iterates without a re-run.
    ball_detect: bool = False
    # The ball is found by disappearing at impact, so these are about where and what size to
    # look for, not how bright a golf ball is in the abstract.
    ball_after_impact: int = 8      # frames to skip past Impact before the ball counts as gone
    ball_search_frac: float = 0.40  # search radius around the Address head, in body heights
    ball_diam_frac: float = 0.030   # a golf ball is ~3% of a golfer's height across
    ball_min_bright: float = 90.0   # a ball is light against turf; below this it is a shadow
    # How much brighter the blob has to be than the ring of turf around it. The test that
    # keeps the search off the golfer's shoe — see `find_ball`.
    ball_min_contrast: float = 28.0
    # Event refinement from the club (`refine_events`). Impact snaps to the head's lowest point
    # within this many frames — a refinement of a working hand-based estimate, not a
    # re-detection, so the window is small and a far-away "lowest head" is treated as the
    # detector being wrong rather than the event.
    impact_snap_frames: int = 10
    impact_snap_min_frames: int = 6
    # How much lower the candidate has to be before Impact moves, as a fraction of club length.
    # Without it a tie moves the event for nothing: pro_2's "lowest" head two frames later was
    # 0px lower. ~2% is a few pixels — below that the current frame is already the low point.
    impact_snap_min_drop: float = 0.02
    # How far the head may drift and still count as "at rest" during the address hold, as a
    # fraction of club length. The hold is trimmed only when the club moved more than twice
    # this across it, which leaves a genuinely static setup untouched.
    address_still_tol: float = 0.08
    # Stop the follow-through at the club's high point, before it goes over the shoulder. Past
    # that the head is behind the golfer and heavily occluded, so the tail of the trace is both
    # the least reliable part of the path and the part that says least about the swing — it
    # loops back across everything already drawn and reads as scribble.
    trace_clip_followthrough: bool = True
    # Consensus tolerance for the "robust" mode, in multiples of the median residual. Lower is
    # stricter. Relative rather than absolute because the club moves ~4px/frame in the takeaway
    # and ~90px through impact — no pixel threshold is right for both.
    trace_robust_tol: float = 2.5
    # Radius, in normalised units, within which the drawn path counts as passing through a
    # detection. ~0.008 is about 6px on a 720-wide analysis frame.
    trace_fidelity_tol: float = 0.008
    curve_tol: float = 0.18        # residual from the curve counted as an outlier
    curve_conf_floor: float = 0.45  # below this, take the curve instead of the measurement
    transition_frames: int = 5     # frames each side of Top excluded from the fit


@dataclass
class ClubFrame:
    f: int
    shaft: list | None = None      # [[butt],[head]] normalized — the drawn club
    head: list | None = None       # [x,y] normalized
    butt: list | None = None       # [x,y] normalized, end of the grip above the hands
    conf: float = 0.0
    angle: float | None = None     # deg from horizontal, grip -> head
    raw_angle: float | None = None # pre-smoothing measurement, kept for debugging
    length: float | None = None    # projected grip->head length, px
    cands: list | None = None      # legacy discrete candidates (unused by the angle solver)
    profile: object = None         # (support[bins], reach[bins]) around the hands
    grip_px: object = None         # hands in pixel space, for direction resolution
    blurred: bool = False
    interp: bool = False
    # True where the head came from the learned detector rather than the solver. The trace has
    # to know: it is a polyline over frames, and joining a model-measured head to a
    # solver-derived one produces a lurch between two different estimators, not a club path.
    from_model: bool = False
    # True where the head was placed on the ball at Impact from the Address landmark rather than
    # found in this frame (`anchor_ball`). A third provenance on purpose: it is neither a
    # detection nor a solver estimate, and the one thing it must never do is pass for a detection.
    from_ball: bool = False


@dataclass
class ClubResult:
    frames: list = field(default_factory=list)
    trace: dict = field(default_factory=dict)
    # Which frame each trace point was measured on, parallel to `trace[key]`.
    #
    # The polyline is NOT one point per frame — the trace modes keep only the frames the
    # detector answered — so a renderer growing the path with the playhead cannot recover the
    # mapping by counting. Published alongside the points rather than folded into them so the
    # `[[x,y],...]` shape every existing consumer reads stays exactly as it was.
    trace_frames: dict = field(default_factory=dict)
    club_len: float = 0.0
    butt_len: float = 0.0
    width: int = 0
    height: int = 0
    coverage: dict = field(default_factory=dict)
    # The ball, when `find_ball` located it: {x, y, r, source}, normalized. None when it could
    # not be found — never a guess, because `anchor_ball` writes a club position from it.
    ball: dict | None = None
    notes: list = field(default_factory=list)


# Both profile builders must agree on resolution — the DP solves over these bins.
# 90 bins (4 deg) beat 180: finer bins give the solver more near-identical options to jitter
# between without adding real information, since the shaft is several pixels wide anyway.
N_BINS = 90


def _segments(hough):
    """HoughLinesP returns (N,1,4) on OpenCV 4 and (N,4) on OpenCV 5 — normalise to (N,4)."""
    if hough is None:
        return []
    return np.asarray(hough).reshape(-1, 4)


def _kp(frames, f, name, min_conf=0.2):
    p = frames[f]["kp"][IDX[name]]
    return (p[0], p[1]) if p[2] >= min_conf else None


def _body_mask(shape, frames, f, body_h, cfg):
    """Suppress the golfer's torso so their own moving pixels don't look like a club.

    Deliberately the TORSO ONLY — shoulders, hips and head — not a hull over every keypoint.
    A full-body hull spans the arms and legs, and the club swings straight through that
    corridor: at impact it passes right by the legs, so the hull was erasing the club exactly
    where we most need it and the tracker latched onto the butt side instead. The torso is
    the large moving mass worth removing; the limb corridor must stay visible.
    """
    h, w = shape
    mask = np.zeros((h, w), np.uint8)
    kp = frames[f]["kp"]
    names = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "head_center"]
    pts = [(kp[IDX[n]][0] * w, kp[IDX[n]][1] * h) for n in names
           if IDX[n] < len(kp) and kp[IDX[n]][2] > 0.3]
    if len(pts) < 3:
        return mask
    r = max(3, int(cfg.body_dilate * body_h * h))
    hull = cv2.convexHull(np.array(pts, np.float32).reshape(-1, 1, 2).astype(np.int32))
    cv2.fillConvexPoly(mask, hull, 255)
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))


def _motion(prev, cur, nxt, cfg, bg=None):
    """Doc 04 Layer A — pixels moving *at* time f, isolated by ANDing both differences.

    Optionally intersected with a background-model foreground mask. Three-frame differencing
    alone produced 46k-77k white pixels per frame on swing1 against a club worth a few
    hundred: wind-blown foliage speckles the whole upper frame and every edge of the golfer
    lights up. The tracker was choosing among noise, which is why tuning its costs kept
    trading one segment against another instead of fixing anything.
    """
    d1 = cv2.absdiff(cur, prev)
    d2 = cv2.absdiff(nxt, cur)
    _, m1 = cv2.threshold(d1, cfg.diff_thresh, 255, cv2.THRESH_BINARY)
    _, m2 = cv2.threshold(d2, cfg.diff_thresh, 255, cv2.THRESH_BINARY)
    m = cv2.bitwise_and(m1, m2)
    if bg is not None:
        m = cv2.bitwise_and(m, bg)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)


def background_masks(grays, history=None):
    """Per-frame foreground via a learned background model (MOG2).

    The camera is static, so every pixel has a stable distribution over the clip. MOG2 models
    each pixel as a mixture, which is what makes it handle *repetitive* motion — leaves
    oscillating in wind settle into the background model, whereas frame differencing flags
    them every frame because they genuinely moved.

    Run twice over the clip: the first pass trains the model, the second reads it back, so
    early frames get the same quality as late ones.
    """
    n = len(grays)
    sub = cv2.createBackgroundSubtractorMOG2(
        history=history or n, varThreshold=24, detectShadows=False)
    for g in grays:
        sub.apply(g, learningRate=-1)
    out = []
    for g in grays:
        fg = sub.apply(g, learningRate=0.0)
        out.append(fg)
    return out


def _score_candidate(p0, p1, grip_px, club_px, prev_angle, cfg):
    """Rank a Hough segment as a shaft hypothesis (doc 04 Layer B)."""
    a, b = np.array(p0, float), np.array(p1, float)
    da, db = np.linalg.norm(a - grip_px), np.linalg.norm(b - grip_px)
    near, far = (a, b) if da <= db else (b, a)
    d_near = min(da, db)

    # The shaft must start at the hands.
    if d_near > club_px * cfg.grip_tol:
        return None
    length = np.linalg.norm(far - near)
    if not (club_px * cfg.min_len <= length <= club_px * cfg.max_len):
        return None

    ang = float(np.degrees(np.arctan2(-(far[1] - near[1]), far[0] - near[0])))
    s = 0.0
    s += 1.0 - min(1.0, d_near / (club_px * cfg.grip_tol))   # grip proximity
    s += min(1.0, length / club_px)                          # prefer full-length shafts
    if prev_angle is not None:
        # Soft continuity: a hard reject loses the club for the rest of the swing whenever
        # one frame's angle is off, and the tracker never recovers. Penalise instead.
        step = abs((ang - prev_angle + 180) % 360 - 180)
        s += 1.0 - min(1.5, step / cfg.max_angle_step)
    return s, near, far, ang


def hand_shaft_dirs(pose_frames, handedness, w, h, smooth=7):
    """Shaft direction per frame, measured from the two hands.

    The hands sit adjacent along the grip, so the vector between their knuckle centroids
    lies along the shaft — and it is *directed*: for a right-handed golfer the lead (left)
    hand is nearest the butt and the trail (right) hand is below it toward the head, so
    lead -> trail points at the club head. Mirrored for a left-handed golfer.

    This is the piece every previous approach was missing. Hough gives an undirected line
    (hence the 180 deg flips), and the motion mask is defeated by a cluttered background.
    The hands are measured from the body by the pose model at ~1.0 confidence, in every
    frame, regardless of what is behind the golfer.

    The two points are close together so the raw angle is noisy — it is smoothed, and used
    as a prior to steer the search rather than as the final answer.
    """
    n = len(pose_frames)
    lead, trail = ("left", "right") if handedness == "right" else ("right", "left")
    vec = np.full((n, 2), np.nan)
    for f, fr in enumerate(pose_frames):
        hands = fr.get("hands") or {}
        a, b = hands.get(lead), hands.get(trail)
        if not a or not b or a[2] < 0.3 or b[2] < 0.3:
            continue
        v = np.array([(b[0] - a[0]) * w, (b[1] - a[1]) * h])
        nv = np.linalg.norm(v)
        if nv > 1e-6:
            vec[f] = v / nv

    ok = ~np.isnan(vec[:, 0])
    if ok.sum() < 4:
        return None
    idx = np.arange(n)
    for ax in (0, 1):
        vec[:, ax] = np.interp(idx, idx[ok], vec[ok, ax])
        vec[:, ax] = _smooth1d(vec[:, ax], smooth)
    nrm = np.linalg.norm(vec, axis=1, keepdims=True)
    return np.divide(vec, np.maximum(nrm, 1e-9))


def arm_suppression(pose_frames, f, gp, n_bins, w, h, lead_side="left", half_deg=22.0):
    """Weights that suppress ray directions running back up the forearms.

    A forearm is a straight, high-contrast edge that terminates at the hands — the exact
    signature the shaft detector looks for, and it starts at the search anchor. Pose gives us
    the elbows, so this is resolvable exactly rather than heuristically: the club can never
    point from the hands back toward an elbow (that would put the shaft lying along the arm,
    aimed at the shoulder). Only the grip->elbow direction is suppressed, so the address
    position — where shaft and lead arm form a near-straight line in the *opposite* direction
    — is untouched.
    """
    weights = np.ones(n_bins)
    kp = pose_frames[f]["kp"]
    # LEAD arm only. The trail arm is bent through most of the swing, so it is a poor
    # straight-line impostor — and worse, at mid-downswing its elbow tucks to the body and
    # the grip->elbow direction genuinely coincides with where the club is. Suppressing both
    # arms cost the downswing more than the lead arm alone gained (accel 54 -> 92).
    for side in (lead_side,):
        el = kp[IDX[f"{side}_elbow"]]
        if el[2] < 0.3:
            continue
        v = np.array([el[0] * w - gp[0], el[1] * h - gp[1]])
        nv = np.linalg.norm(v)
        if nv < 1e-6:
            continue
        th_arm = np.arctan2(v[1], v[0])
        idx = np.arange(n_bins)
        d = np.abs(((2 * np.pi * idx / n_bins) - th_arm + np.pi) % (2 * np.pi) - np.pi)
        weights *= np.where(d < np.radians(half_deg), 0.15, 1.0)
    return weights


def shaft_profile(gx, gy, gp, club_px, cfg, n_bins=180, motion=None, suppress=None):
    """Line evidence per direction: is there a straight SHAFT along this ray?

    The shaft is a thin straight line running from the hands to the head, and it is visible
    as an edge structure even in frames where the motion mask is useless — at the top where
    the club is nearly still, or against a cluttered background. Ray-marching motion blobs
    threw that away and asked only "did anything move near this ray".

    The discriminator is **gradient orientation**. Along a real shaft the intensity changes
    across it, so the image gradient points perpendicular to the shaft direction. Foliage and
    grass edges have essentially random orientation, so requiring perpendicularity rejects
    them without needing them to be stationary. Evidence is scored as

        max(0, |g . perpendicular| - |g . along|)

    which is large only for structures genuinely oriented along the ray.

    Returns (support[n_bins], reach[n_bins]) where reach is the end of the longest
    contiguous run of line evidence — i.e. where the shaft stops, which is the club head.
    """
    h, w = gx.shape
    r = np.arange(club_px * 0.18, club_px * 1.06, 2.0)
    if len(r) < 4:
        return np.zeros(n_bins), np.zeros(n_bins)

    support = np.zeros(n_bins)
    reach = np.zeros(n_bins)
    # A thin shaft can fall between samples; check a small perpendicular offset either side.
    offs = (-1.5, 0.0, 1.5)

    for i in range(n_bins):
        th = 2 * np.pi * i / n_bins
        c, s = np.cos(th), np.sin(th)
        px, py = -s, c                      # unit perpendicular

        best = None
        for o in offs:
            xs = np.rint(gp[0] + c * r + px * o).astype(int)
            ys = np.rint(gp[1] + s * r + py * o).astype(int)
            ok = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
            if ok.sum() < 4:
                continue
            xs, ys = np.clip(xs, 0, w - 1), np.clip(ys, 0, h - 1)
            gxx, gyy = gx[ys, xs], gy[ys, xs]
            along = np.abs(gxx * c + gyy * s)
            perp = np.abs(gxx * px + gyy * py)
            ev = np.maximum(0.0, perp - along)
            ev[~ok] = 0.0
            if best is None or ev.sum() > best.sum():
                best = ev
        if best is None:
            continue

        hit = best > cfg.edge_thresh
        if motion is not None:
            # Motion GATES the line evidence rather than merely bonusing it. Oriented-edge
            # detection alone locks onto the fence behind swing1's golfer — fence posts and
            # rails are perfect straight lines, so a pure line detector prefers them. Static
            # structure is therefore heavily attenuated, but not zeroed: at the top the club
            # is nearly stationary and must stay detectable from its edges.
            mx = np.rint(gp[0] + c * r).astype(int)
            my = np.rint(gp[1] + s * r).astype(int)
            inb = (mx >= 0) & (mx < w) & (my >= 0) & (my < h)
            mv = np.zeros(len(r), float)
            mv[inb] = (motion[np.clip(my, 0, h - 1)[inb],
                              np.clip(mx, 0, w - 1)[inb]] > 0).astype(float)
            best = best * (cfg.static_line_weight + (1.0 - cfg.static_line_weight) * mv)

        # Longest contiguous run of evidence, allowing brief holes (blur breaks the shaft).
        run = 0
        best_run = 0
        best_end = 0.0
        gap = 0
        for k, hk in enumerate(hit):
            if hk:
                run += 1
                gap = 0
                if run > best_run:
                    best_run, best_end = run, r[k]
            else:
                gap += 1
                if gap > cfg.edge_gap:
                    run = 0
        if best_run < 3:
            continue
        reach[i] = best_end
        support[i] = float(np.mean(best[hit]) if hit.any() else 0.0) / 255.0 * \
            (0.35 + 0.65 * best_end / club_px)

    if suppress is not None:
        support = support * suppress
    if support.max() > 1e-9:
        support /= support.max()
    return support, reach


def angular_profile(motion, gp, club_px, cfg, n_bins=90, gap_frac=0.09):
    """Support and reach for every direction around the hands, as a dense profile.

    Returns (support[n_bins], reach[n_bins]). Unlike peak-picking this never *decides*
    anything — it just reports how much evidence exists in each direction, including
    directions with none. That matters because the failure mode is not a wrong peak, it is a
    frame where the correct direction has no peak at all: during the takeaway the club goes
    dark against grass and shorts, the mask nearly vanishes, and any peak-picker is forced to
    choose among wrong options. With a full profile the path solver can push a low-evidence
    frame through on smoothness instead.
    """
    h, w = motion.shape
    step = 3.0
    r_max = club_px * 1.05
    # Gap tolerance is phase-dependent, because what a "hole in the shaft" means changes.
    # Slow phases: the shaft is continuous, so a long hole means the ray has jumped past the
    # head onto background motion — wind in the foliage behind swing1's golfer made the club
    # read near-full length at the top, where it is actually heavily foreshortened.
    # Downswing: the shaft genuinely breaks into blur streaks (doc 04 §4), so the same tight
    # tolerance truncates the real club. Tightening it globally fixed the backswing and broke
    # the downswing; it has to vary.
    gap_limit = club_px * gap_frac
    support = np.zeros(n_bins)
    reach = np.zeros(n_bins)

    for i in range(n_bins):
        th = (2 * np.pi * i) / n_bins
        d = np.array([np.cos(th), np.sin(th)])
        hits = total = 0
        last = 0.0
        gap = 0.0
        r = step
        while r <= r_max:
            p = gp + d * r
            x, y = int(round(p[0])), int(round(p[1]))
            ok = False
            if 0 <= x < w and 0 <= y < h:
                x0, x1 = max(0, x - 3), min(w, x + 4)
                y0, y1 = max(0, y - 3), min(h, y + 4)
                ok = bool(motion[y0:y1, x0:x1].any())
            total += 1
            if ok:
                hits += 1
                last = r
                gap = 0.0
            else:
                gap += step
                if gap > gap_limit and last > 0:
                    break
            r += step
        support[i] = (hits / max(total, 1)) * (0.35 + 0.65 * last / club_px)
        reach[i] = last
    return support, reach


def _head_candidates(motion, gp, club_px, cfg, n_rays=180, prior=None, span_deg=45.0):
    """Find where the club head can be, given the hands.

    The club is rigid and held at the hands, so the head always lies on an arc centred on
    grip_center with radius at most the calibrated club length — shorter only through
    foreshortening. That reduces a 2D search to a 1D one: sweep rays out from the hands and
    ask how far motion support continues along each.

    Returns [(point, score, radius)] for the best-supported directions. Scoring rewards
    reaching full club length and continuous support along the ray, so a stray blob at the
    right distance cannot outrank an actual shaft.
    """
    h, w = motion.shape
    r_min, r_max = club_px * cfg.min_len, club_px * 1.05
    step = 2.0
    out = []

    # With a hand-measured prior we only sweep a narrow arc around it. That kills the 180 deg
    # ambiguity outright, ignores clutter elsewhere in the frame, and is several times faster
    # than the full circle.
    if prior is not None:
        base = np.arctan2(prior[1], prior[0])
        half = np.radians(span_deg)
        angles = np.linspace(base - half, base + half, 61)
    else:
        angles = (2 * np.pi * np.arange(n_rays)) / n_rays

    for th in angles:
        d = np.array([np.cos(th), np.sin(th)])
        hits = total = 0
        last = 0.0
        gap = 0.0
        r = step
        while r <= r_max:
            p = gp + d * r
            x, y = int(round(p[0])), int(round(p[1]))
            ok = False
            if 0 <= x < w and 0 <= y < h:
                x0, x1 = max(0, x - 3), min(w, x + 4)
                y0, y1 = max(0, y - 3), min(h, y + 4)
                ok = bool(motion[y0:y1, x0:x1].any())
            total += 1
            if ok:
                hits += 1
                last = r
                gap = 0.0
            else:
                gap += step
                if gap > club_px * 0.18 and last > 0:
                    break
            r += step
        if last < r_min:
            continue
        support = hits / max(total, 1)
        out.append((gp + d * last, float(support * (0.35 + 0.65 * last / club_px)), float(last)))

    if not out:
        return []
    out.sort(key=lambda c: -c[1])
    # Keep peaks that are genuinely distinct directions, not neighbours of the same ray.
    kept = []
    for c in out:
        if all(np.linalg.norm(c[0] - k[0]) > club_px * 0.25 for k in kept):
            kept.append(c)
        if len(kept) >= 6:
            break
    return kept


def _ellipse_dist(P, ell):
    """Approximate geometric distance from points to an ellipse, in pixels."""
    (cx, cy), (MA, ma), angle = ell
    a, b = max(MA / 2.0, 1e-6), max(ma / 2.0, 1e-6)
    th = np.radians(angle)
    R = np.array([[np.cos(th), np.sin(th)], [-np.sin(th), np.cos(th)]])
    Q = (np.asarray(P, float) - np.array([cx, cy])) @ R.T
    r = np.sqrt((Q[:, 0] / a) ** 2 + (Q[:, 1] / b) ** 2)
    return np.abs(r - 1.0) * min(a, b)


def fit_plane_from_hands(hand_pts, head_pts, trim=0.3):
    """Fit the club-head plane using the HANDS to pin its centre and orientation.

    The hands are the most accurate thing in the whole pipeline — grip_center is 100%
    coverage at ~1.00 confidence off measured knuckles — while the club head is the least.
    Fitting the head's plane from head data alone means fitting five free parameters
    (centre x/y, two axes, rotation) to the noisiest signal we have, so the model absorbs the
    very outliers it is supposed to reject.

    The hands and the club head sweep near-concentric arcs on the same swing plane: the head
    is simply further out along the same rotation. So take centre and orientation from the
    hand ellipse, and fit only a single scale factor to the head points — one robust
    parameter on noisy data instead of five.
    """
    hp = np.asarray(hand_pts, float)
    if len(hp) < 8 or len(head_pts) < 8:
        return None
    try:
        hand_ell = cv2.fitEllipse(hp.astype(np.float32))
    except cv2.error:
        return None

    (cx, cy), (MA, ma), angle = hand_ell
    a0, b0 = max(MA / 2.0, 1e-3), max(ma / 2.0, 1e-3)
    th = np.radians(angle)
    R = np.array([[np.cos(th), np.sin(th)], [-np.sin(th), np.cos(th)]])
    Q = (np.asarray(head_pts, float) - np.array([cx, cy])) @ R.T
    # Radial scale of each head point relative to the hand ellipse; median is robust to the
    # flipped frames we are trying to detect.
    r = np.sqrt((Q[:, 0] / a0) ** 2 + (Q[:, 1] / b0) ** 2)
    r = r[np.isfinite(r) & (r > 1e-3)]
    if len(r) < 5:
        return None
    lo, hi = np.quantile(r, trim / 2), np.quantile(r, 1 - trim / 2)
    scale = float(np.median(r[(r >= lo) & (r <= hi)]))
    if not np.isfinite(scale) or scale <= 1e-3:
        return None
    return ((cx, cy), (a0 * scale * 2.0, b0 * scale * 2.0), angle)


def fit_swing_plane(points, trim=0.25, iters=5):
    """Robustly fit the swing plane: an ellipse through the club head path.

    A golfer swings the club on a plane, and a circle on a tilted plane projects to an
    ellipse in 2D. So the head path is not free — every position must lie near one curve, and
    a point far off it is wrong no matter how much motion support the pixels gave it. That is
    a far stronger constraint than frame-to-frame smoothness, because it is global: a
    consistently-wrong run of frames still fails it, while smoothness alone would accept it.

    Fitted with iterative trimming (soft RANSAC) so the outliers we are hunting cannot drag
    the model onto themselves.
    """
    P = np.asarray(points, float)
    if len(P) < 8:
        return None
    keep = np.ones(len(P), bool)
    ell = None
    for _ in range(iters):
        pts = P[keep].astype(np.float32)
        if len(pts) < 5:
            break
        try:
            ell = cv2.fitEllipse(pts)
        except cv2.error:
            return None
        d = _ellipse_dist(P, ell)
        thr = float(np.quantile(d[keep], 1.0 - trim)) if keep.any() else 0.0
        new_keep = d <= max(thr, 1e-6)
        if new_keep.sum() < 5:
            break
        keep = new_keep
    return ell


def _track_angle_dp(res: ClubResult, addr_f, seed, club_px, cfg, ball=None, impact_f=None,
                    n_bins=90, plane=None, plane_span=None, plane_w=0.0, plane_tol=0.12):
    """Viterbi over shaft ANGLE, using the dense support profile.

    Angle is the natural state: the head rides an arc of roughly fixed radius around the
    hands, so the club's motion is rotation. Solving in angle separates rotation from the
    radius changes caused by foreshortening, and — more importantly — every frame has a
    candidate in every direction, so a frame with no pixel evidence is carried by its
    neighbours rather than forced onto a wrong peak.

    Transition cost is angular travel, wrapped. Emission rewards measured support and pins
    the two anchors we trust: the calibrated club at Address and the ball at Impact.
    """
    n = len(res.frames)
    # Resolution comes from whichever profile builder ran, so the two cannot drift apart.
    for cf in res.frames:
        if cf.profile is not None:
            n_bins = len(cf.profile[0])
            break
    bins = np.arange(n_bins)
    ang = 2 * np.pi * bins / n_bins

    # Wrapped angular distance between every pair of bins, in bins.
    diff = np.abs(bins[:, None] - bins[None, :])
    diff = np.minimum(diff, n_bins - diff).astype(float)
    # Quadratic: gentle rotation is nearly free, a flip across the hands is very expensive.
    trans = (diff / n_bins * 2 * np.pi) ** 2 * cfg.angle_cost

    em = np.zeros((n, n_bins))
    valid = np.zeros(n, bool)
    for f, cf in enumerate(res.frames):
        prof = cf.profile
        if prof is None or cf.grip_px is None:
            em[f] = 0.0
            continue
        support, _ = prof
        valid[f] = True
        em[f] = -support * cfg.support_weight

        gp = cf.grip_px
        if seed is not None and f == addr_f:
            d = np.stack([np.cos(ang), np.sin(ang)], 1) * club_px + gp
            em[f] += np.linalg.norm(d - seed, axis=1) / club_px * 8.0
        if ball is not None and impact_f is not None and abs(f - impact_f) <= 2:
            d = np.stack([np.cos(ang), np.sin(ang)], 1) * club_px + gp
            em[f] += np.linalg.norm(d - ball, axis=1) / club_px * 5.0

        # Swing-plane prior, applied as a HINGE not a proportional pull.
        #
        # A real swing plane is not a perfect ellipse — a golfer can start the takeaway
        # straight and shift it left or right mid-backswing, and a plane that shifts is
        # normal technique, not error. Penalising distance proportionally drags the path onto
        # an idealised curve and measurably made things worse (swing1 backswing accel p95
        # 61 -> 92). Deviations inside `plane_tol` are therefore FREE; only gross departures
        # — the head on the wrong side of the hands, a flipped frame — are pushed back.
        if plane is not None and plane_w > 0.0 and (
                plane_span is None or plane_span[0] <= f <= plane_span[1]):
            reach = prof[1]
            r = np.where(reach >= club_px * 0.35, reach, club_px * 0.9)
            cand = gp + np.stack([np.cos(ang), np.sin(ang)], 1) * r[:, None]
            dev = _ellipse_dist(cand, plane) / club_px
            em[f] += np.maximum(0.0, dev - plane_tol) * plane_w

    if not valid.any():
        return [None] * n

    dp = np.zeros((n, n_bins))
    back = np.zeros((n, n_bins), int)
    dp[0] = em[0]
    for f in range(1, n):
        tot = dp[f - 1][:, None] + trans
        back[f] = np.argmin(tot, axis=0)
        dp[f] = tot[back[f], bins] + em[f]

    path = np.zeros(n, int)
    path[-1] = int(np.argmin(dp[-1]))
    for f in range(n - 1, 0, -1):
        path[f - 1] = back[f][path[f]]

    # Radius is smoothed as its own signal rather than defaulted per frame. The projected
    # club length shortens through foreshortening — pronounced at the top, where support is
    # also weakest — so a fixed "assume near-full length" fallback overshoots exactly where
    # it is used most, pushing the drawn head past the real one.
    radii = np.full(n, np.nan)
    for f, cf in enumerate(res.frames):
        if cf.grip_px is None or cf.profile is None:
            continue
        _, reach = cf.profile
        r = reach[path[f]]
        if r >= club_px * 0.35:
            radii[f] = r
    ok_r = ~np.isnan(radii)
    if ok_r.any():
        idx = np.arange(n)
        radii = np.interp(idx, idx[ok_r], radii[ok_r])
        radii = _smooth1d(radii, 9)
    else:
        radii[:] = club_px * 0.9

    out = []
    for f, cf in enumerate(res.frames):
        if cf.grip_px is None or cf.profile is None:
            out.append(None)
            continue
        support, _ = cf.profile
        b = path[f]
        th = ang[b]
        out.append(cf.grip_px + np.array([np.cos(th), np.sin(th)]) * radii[f])
        # Confidence reflects measured support, and drops where the radius was inferred.
        cf.conf = float(np.clip(0.25 + support[b] * 1.6, 0.1, 0.98))
        if not ok_r[f]:
            cf.conf = min(cf.conf, 0.35)
            cf.interp = True
    return out


def _track_head_dp(res: ClubResult, addr_f, seed, club_px, cfg, ball=None, impact_f=None):
    """Pick the head per frame by globally optimal dynamic programming (Viterbi).

    A greedy walk cannot work here. It commits frame by frame, so one wrong branch early —
    say at the takeaway, where the club is slow and the mask is thin — propagates through the
    entire swing, and no later evidence can overturn it. That is exactly what happened: swing1
    tracked correctly while swing2 flipped from the takeaway onward and never recovered, even
    with the ball anchored at impact.

    DP instead scores whole *paths*. Two anchors pin it down — the club head at Address is the
    calibrated ball position, and at Impact it is back at that same ball — and the path
    between them is chosen to minimise total travel. A branch that looks locally attractive
    but requires the head to teleport across the hands to reach Impact is rejected on its
    global cost, which is the property greedy tracking lacks.

    O(frames x candidates^2), which at ~6 candidates is nothing.
    """
    n = len(res.frames)
    states, costs = [], []
    for f in range(n):
        cands = list(res.frames[f].cands or [])
        if ball is not None and impact_f is not None and abs(f - impact_f) <= 3:
            cands.append((np.asarray(ball, float), 0.30, club_px))
        pts = [np.asarray(c[0], float) for c in cands]
        # Emission: prefer well-supported candidates, and pin the two frames we know.
        em = [-c[1] * 1.2 for c in cands]
        if seed is not None and f == addr_f:
            em = [e + float(np.linalg.norm(p - seed)) / club_px * 6.0
                  for e, p in zip(em, pts)]
        if ball is not None and impact_f is not None and abs(f - impact_f) <= 2:
            em = [e + float(np.linalg.norm(p - ball)) / club_px * 4.0
                  for e, p in zip(em, pts)]
        states.append(pts)
        costs.append(em)

    first = next((f for f in range(n) if states[f]), None)
    if first is None:
        return [None] * n

    best = [None] * n
    dp = [list(costs[first])]
    back: list = [[-1] * len(states[first])]
    idxs = [first]

    for f in range(first + 1, n):
        if not states[f]:
            continue
        prev_f = idxs[-1]
        prev_dp = dp[-1]
        gap = max(1, f - prev_f)
        cur = []
        bk = []
        for j, pj in enumerate(states[f]):
            bestc, besti = None, -1
            for i, pi in enumerate(states[prev_f]):
                # Quadratic travel penalty, normalised by club length and the frame gap, so
                # a smooth arc is cheap and a jump across the hands is not.
                d = float(np.linalg.norm(pj - pi)) / (club_px * gap)
                c = prev_dp[i] + d * d * 2.5
                if bestc is None or c < bestc:
                    bestc, besti = c, i
            cur.append(bestc + costs[f][j])
            bk.append(besti)
        dp.append(cur)
        back.append(bk)
        idxs.append(f)

    k = int(np.argmin(dp[-1]))
    for t in range(len(idxs) - 1, -1, -1):
        best[idxs[t]] = states[idxs[t]][k]
        k = back[t][k] if back[t][k] >= 0 else 0
    return best


def _track_head(res: ClubResult, addr_f, seed, club_px, cfg, ball=None, impact_f=None):
    """Choose one head per frame so the path stays smooth (doc 04 Layer D).

    Walks outward from Address in both time directions. Each step predicts where the head
    should be by constant-velocity extrapolation and takes the candidate that best balances
    agreement with that prediction against its own motion support. A frame whose best
    candidate is implausibly far from the prediction is left empty rather than forced — the
    gap is filled later by interpolating between confident detections, which is smoother
    and more honest than committing to a bad point.
    """
    n = len(res.frames)
    chosen: list = [None] * n
    start = int(np.clip(addr_f, 0, n - 1))

    # Seed from the static address calibration where the club is unambiguous.
    cands = res.frames[start].cands or []
    if seed is not None and cands:
        chosen[start] = min(cands, key=lambda c: float(np.linalg.norm(c[0] - seed)))[0]
    elif cands:
        chosen[start] = cands[0][0]

    for direction in (1, -1):
        prev, prev2 = chosen[start], None
        f = start + direction
        while 0 <= f < n:
            cands = list(res.frames[f].cands or [])
            # At impact the head is at the ball — that is what impact means. The club is a
            # faint blur streak there, so offer the ball itself as a candidate; it wins only
            # if nothing better is actually visible.
            if ball is not None and impact_f is not None and abs(f - impact_f) <= 3:
                cands.append((np.asarray(ball, float), 0.30, club_px))
            if not cands:
                chosen[f] = None
                f += direction
                continue
            pred = None
            if prev is not None:
                pred = prev if prev2 is None else prev + (prev - prev2)
            if pred is None:
                best = cands[0][0]
            else:
                # Distance to prediction dominates; support breaks ties.
                def cost(c):
                    v = float(np.linalg.norm(c[0] - pred)) - c[1] * club_px * 0.35
                    # Near impact the head must come back to the ball, whose position we
                    # measured at address. This is the one moment the club is a blur streak
                    # with motion support on BOTH sides of the hands, so trajectory alone
                    # picks the wrong end — the head was being drawn where the club came
                    # from rather than at the ball.
                    if ball is not None and impact_f is not None and abs(f - impact_f) <= 4:
                        v += float(np.linalg.norm(c[0] - ball)) * 0.8
                    return v

                cand = min(cands, key=cost)
                # Never drop a frame outright: losing one forces a re-seed and the tracker
                # can come back on the wrong side. Keep the best candidate and let the
                # smoothing pass and its low confidence carry the uncertainty instead.
                gate = club_px * cfg.max_jump
                best = cand[0]
                if float(np.linalg.norm(cand[0] - pred)) > gate * 2.0:
                    best = pred
            chosen[f] = best
            if best is not None:
                prev2, prev = prev, best
            f += direction
    return chosen


def _extend_to_head(motion, near, direction, club_px, tol=7.0):
    """March out along the shaft from the hands, stopping at the first real break.

    Hough fragments a thin, partly-blurred shaft, so the distal endpoint of the best
    *segment* often sits barely past the hands. But taking the farthest collinear motion
    pixel is worse: motion pixels include wind-blown trees and horizon artefacts, and a
    single distant noise pixel that happens to line up drags the "head" far off the club —
    which is exactly what turned the first traces into scribbles.

    Marching instead enforces what the collinearity test threw away: the shaft is
    *continuous*. We step outward, keep going while motion is present, and stop at the
    first gap wider than a shaft break plausibly is. Distance is capped at the club length
    calibrated at address, since a rigid club cannot project longer than it is.
    """
    h, w = motion.shape
    d = direction / (np.linalg.norm(direction) + 1e-9)
    step = 2.0
    max_reach = club_px * 1.05
    gap_limit = club_px * 0.16
    reach, gap, last = 0.0, 0.0, 0.0
    t = step
    while t <= max_reach:
        p = near + d * t
        x, y = int(round(p[0])), int(round(p[1]))
        hit = False
        if 0 <= x < w and 0 <= y < h:
            x0, x1 = max(0, x - int(tol)), min(w, x + int(tol) + 1)
            y0, y1 = max(0, y - int(tol)), min(h, y + int(tol) + 1)
            hit = motion[y0:y1, x0:x1].any()
        if hit:
            last = t
            gap = 0.0
        else:
            gap += step
            if gap > gap_limit:
                break
        t += step
    reach = last
    if reach < club_px * 0.25:
        return None, 0.0
    return near + d * reach, float(reach)


def calibrate(gray_frames, pose_frames, addr_f, body_h, cfg):
    """Doc 04 §3 — measure club length at Address, where everything is static.

    Sets the search radius and length bounds for every later frame, so getting it right
    once removes most of the ambiguity from the rest of the swing.
    """
    h, w = gray_frames[addr_f].shape
    grip = _kp(pose_frames, addr_f, "grip_center")
    if grip is None:
        return None
    gp = np.array([grip[0] * w, grip[1] * h])

    best = None
    for f in range(max(0, addr_f - 6), min(len(gray_frames), addr_f + 7)):
        img = cv2.GaussianBlur(gray_frames[f], (3, 3), 0)
        edges = cv2.Canny(img, 40, 120)
        # Only look below the hands, out to a generous radius — the club points at the ball.
        mask = np.zeros_like(edges)
        r = int(body_h * h * 1.1)
        cv2.circle(mask, tuple(gp.astype(int)), r, 255, -1)
        mask[: int(gp[1]) - int(0.05 * body_h * h), :] = 0
        edges = cv2.bitwise_and(edges, mask)

        segs = _segments(cv2.HoughLinesP(edges, 1, np.pi / 180, cfg.hough_thresh,
                                         minLineLength=int(body_h * h * 0.22), maxLineGap=12))
        for x1, y1, x2, y2 in segs:
            a, b = np.array([x1, y1], float), np.array([x2, y2], float)
            da, db = np.linalg.norm(a - gp), np.linalg.norm(b - gp)
            near, far = (a, b) if da <= db else (b, a)
            if min(da, db) > body_h * h * 0.18:
                continue
            if far[1] <= near[1]:            # club head must be below the hands at address
                continue
            L = float(np.linalg.norm(far - near))
            if best is None or L > best[0]:
                best = (L, near / [w, h], far / [w, h])
    return best


def track(video_path, pose_frames, ev, handedness="right", cfg: ClubConfig | None = None,
          progress=None, detector=None) -> ClubResult:
    """`detector` is an optional pre-computed club_detect.DetectorResult over this same video.

    It contributes evidence into the per-frame angular profile and nothing else, so passing
    None reproduces the classical path exactly (doc 04 §2 — never detector-only).
    """
    cfg = cfg or ClubConfig()
    res = ClubResult()
    det_frames = 0

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")
    grays = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        grays.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()
    n = min(len(grays), len(pose_frames))
    if n < 3:
        res.notes.append("too few frames for club tracking")
        return res
    h, w = grays[0].shape

    # Golfer height in normalized units — every threshold scales off it.
    hc = [p for p in (_kp(pose_frames, i, "head_center") for i in range(n)) if p]
    ak = [p for p in (_kp(pose_frames, i, "left_ankle") for i in range(n)) if p]
    body_h = float(np.median([a[1] for a in ak]) - np.median([c[1] for c in hc])) \
        if hc and ak else 0.4
    body_h = max(body_h, 0.05)

    addr_f = ev["events"]["address"]["frame"]
    cal = calibrate(grays, pose_frames, addr_f, body_h, cfg)
    if cal is None:
        club_px = body_h * h * 0.95
        res.notes.append("address calibration failed; using height-derived club length")
    else:
        club_px = cal[0]
        res.club_len = float(club_px / h)
    club_px = float(np.clip(club_px, body_h * h * 0.55, body_h * h * 1.35))

    # Gradients once per clip — the shaft-line detector reads them for every ray.
    gxs = gys = None
    if cfg.use_shaft_lines:
        blur = [cv2.GaussianBlur(g, (3, 3), 0) for g in grays]
        gxs = [cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3) for g in blur]
        gys = [cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3) for g in blur]

    bgm = None
    if cfg.use_background_model:
        try:
            bgm = background_masks(grays)
        except cv2.error as e:
            res.notes.append(f"background model unavailable ({e}); using frame differencing")

    hand_dirs = hand_shaft_dirs(pose_frames, handedness, w, h)
    if hand_dirs is None:
        res.notes.append("no hand keypoints — falling back to full-circle search "
                         "(use --wholebody for the hand-measured shaft prior)")
    prev_angle, miss = None, 0
    out = []
    for f in range(n):
        cf = ClubFrame(f=f)
        grip = _kp(pose_frames, f, "grip_center")
        if grip is None or f == 0 or f >= n - 1:
            out.append(cf)
            continue
        gp = np.array([grip[0] * w, grip[1] * h])

        motion = _motion(grays[f - 1], grays[f], grays[f + 1], cfg,
                         bg=bgm[f] if bgm is not None else None)
        motion = cv2.bitwise_and(motion, cv2.bitwise_not(
            _body_mask((h, w), pose_frames, f, body_h, cfg)))

        # Restrict to an annulus around the hands (doc 04 Layer B).
        ring = np.zeros_like(motion)
        cv2.circle(ring, tuple(gp.astype(int)), int(club_px * cfg.search_scale), 255, -1)
        motion = cv2.bitwise_and(motion, ring)

        # One unknown per frame: where the head is. The shaft is then just the line from the
        # hands to it. No line detection means no undirected-segment ambiguity to resolve.
        # NOTE: the hand-pair direction prior is computed but deliberately NOT used to
        # restrict the search — see DECISIONS D15. The two hands overlap on the grip, only
        # ~12-50px apart, so the vector between them is dominated by keypoint noise rather
        # than shaft geometry. Narrowing the sweep around it cut coverage from 67/96/64% to
        # 40/32/15%. Kept here because the same hand data supports a longer, better
        # conditioned baseline (wrist -> knuckles), which is the version worth trying next.
        # Downswing (Top -> just past Impact) is where motion blur breaks the shaft into
        # streaks; everywhere else the shaft is continuous and a tight tolerance keeps the
        # ray from running past the head into moving background.
        fast = ev["events"]["top"]["frame"] <= f <= ev["events"]["impact"]["frame"] + 4
        # Two detectors, each used where it measurably wins (head-path accel p95, swing1):
        #
        #                    motion profile   shaft lines
        #   backswing              31.1           69.5     <- motion wins
        #   downswing              92.5           46.0     <- lines win
        #
        # The reason is the failure modes are opposite. In slow phases the club barely moves
        # but the static fence behind the golfer is a perfect straight line, so a line
        # detector is drawn to the background. In the downswing the club is a blur — its
        # motion mask is smeared and unreliable, while its shaft is still a clean oriented
        # edge. Using both everywhere is worse than using each where it belongs.
        if cfg.use_shaft_lines and fast:
            gate = cv2.dilate(motion, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
            cfg_f = replace(cfg, static_line_weight=1.0)   # blur: do not gate on motion
            sup = arm_suppression(pose_frames, f, gp, N_BINS, w, h,
                                  lead_side="left" if handedness == "right" else "right")
            cf.profile = shaft_profile(gxs[f], gys[f], gp, club_px, cfg_f,
                                       motion=gate, n_bins=N_BINS, suppress=sup)
        else:
            cf.profile = angular_profile(motion, gp, club_px, cfg,
                                         n_bins=N_BINS, gap_frac=0.09)
        # Stage 4b: fold in the learned detector as a further evidence source. Deliberately
        # phase-independent, unlike the D19 motion/lines split — a learned detector has no
        # reason to fail specifically in the downswing the way ray-marching does, and asserting
        # a phase preference before the position-error metric exists would be exactly the
        # unfalsifiable tuning D20 warns against.
        #
        # `detector_inject="none"` skips this entirely while the detector still runs and still
        # publishes its raw boxes, so the model can be judged without the solver in the way.
        if detector is not None and cf.profile is not None and cfg.detector_inject != "none":
            got = 0
            if cfg.detector_inject in ("sticks", "both"):
                cf.profile, n_ = club_detect.inject_sticks(
                    cf.profile, detector.sticks(f), gp, club_px, cfg, N_BINS)
                got += n_
            if cfg.detector_inject in ("heads", "both"):
                cf.profile, n_ = club_detect.inject_heads(
                    cf.profile, detector.heads(f), gp, club_px, cfg, N_BINS)
                got += n_
            det_frames += 1 if got else 0

        cf.grip_px = gp
        out.append(cf)
        if progress and (f % 30 == 0 or f == n - 1):
            progress(f + 1, n)

    res.frames = out
    if detector is not None:
        if cfg.detector_inject == "none":
            res.notes.append("club detector ran but did NOT feed the solver "
                             "(detector_inject=none); raw boxes published for inspection only")
        else:
            res.notes.append(
                f"club detector [{cfg.detector_inject}] contributed on {det_frames}/{n} frames "
                f"(head gain {cfg.detector_gain}, stick gain {cfg.detector_stick_gain}, "
                f"radius {'on' if cfg.detector_radius else 'off'}, "
                f"{detector.model.get('sha256', '?')})")
        res.notes.extend(detector.notes)

    # Butt offset: how far the grip end sits beyond the hands. Measured once at address
    # from the calibrated shaft, then held constant like the club length.
    butt_px = club_px * 0.14
    if cal is not None:
        near_addr = np.array(cal[1]) * [w, h]
        grip_addr = _kp(pose_frames, addr_f, "grip_center")
        if grip_addr is not None:
            gp_addr = np.array([grip_addr[0] * w, grip_addr[1] * h])
            butt_px = float(np.clip(np.linalg.norm(gp_addr - near_addr),
                                    club_px * 0.05, club_px * 0.25))
    res.butt_len = float(butt_px / h)

    # The club head at address IS the ball position (doc 04 §3) — the single most useful
    # landmark we get for free, and the anchor for resolving impact.
    seed = np.array(cal[2]) * [w, h] if cal is not None else None
    imp_f = ev["events"]["impact"]["frame"]
    chosen = _track_angle_dp(res, addr_f, seed, club_px, cfg, ball=seed, impact_f=imp_f)

    # Pass 2: fit the swing plane to pass 1's path, then re-solve with that as a prior.
    # Backswing and downswing sit on slightly different planes (the downswing is shallower),
    # so they are fitted separately — one ellipse across both would be a compromise that
    # fits neither and would reject good points at the extremes.
    top_f = ev["events"]["top"]["frame"]
    fin_f = min(len(res.frames) - 1, ev["events"]["finish"]["frame"])
    for lo, hi, label in ((addr_f, top_f, "backswing"), (top_f, fin_f, "downswing")):
        rng = range(max(0, lo), min(len(chosen), hi + 1))
        pts = [chosen[f] for f in rng if chosen[f] is not None]
        hands = [res.frames[f].grip_px for f in rng
                 if chosen[f] is not None and res.frames[f].grip_px is not None]
        if len(pts) < 8:
            continue
        # Prefer the hand-anchored fit; fall back to fitting the head path alone.
        plane = None
        if len(hands) == len(pts):
            plane = fit_plane_from_hands(hands, pts)
        if plane is None:
            plane = fit_swing_plane(pts)
        if plane is None:
            continue
        d = _ellipse_dist(pts, plane)
        off = int((d > club_px * cfg.plane_tol).sum())
        res.notes.append(
            f"{label} plane fitted; {off}/{len(pts)} frames off-plane "
            f"(median dev {np.median(d) / club_px:.3f} club-lengths)")
        refit = _track_angle_dp(res, addr_f, seed, club_px, cfg, ball=seed, impact_f=imp_f,
                                plane=plane, plane_span=(lo, hi), plane_w=cfg.plane_weight,
                                plane_tol=cfg.plane_tol)
        for f in range(max(0, lo), min(len(chosen), hi + 1)):
            if refit[f] is not None:
                chosen[f] = refit[f]
    res.width, res.height = w, h
    _build_club(res, chosen, pose_frames, club_px, butt_px, w, h, cfg)
    # Measure first: let the model's confident detections replace the solved head, BEFORE any
    # smoothing runs, so what gets smoothed is a measurement rather than a compromise.
    if detector is not None and cfg.detector_head_primary:
        took, saw, took_frames = apply_detector_heads(res, detector, pose_frames, club_px,
                                                      butt_px, w, h, cfg)
        res.notes.append(
            f"head taken from the model on {took}/{n} frames "
            f"(confident detections on {saw}; min conf {cfg.detector_primary_min_conf})")
        # Then de-noise what was measured. Order matters and is the same principle as
        # `use_rigid`: measure first, smooth second (D32). `measured=took_frames` is what stops
        # the smoother averaging the model's answer together with the solver's on the frames
        # the model declined — the source of the visible jumps.
        if cfg.detector_smooth or cfg.detector_traj_gate:
            rej = smooth_detector_path(res, pose_frames, club_px, butt_px, w, h, cfg,
                                       gate=cfg.detector_traj_gate, measured=took_frames)
            res.notes.append(
                f"head path smoothed over the {len(took_frames)} model frames "
                f"(window {cfg.detector_smooth_win}), {n - len(took_frames)} interpolated"
                + (f"; {rej} trajectory outlier{'' if rej == 1 else 's'} rejected"
                   if cfg.detector_traj_gate else ""))
    if cfg.use_rigid:
        # Rebuild from a rigid model: hands + one smoothed angle at a smoothed length.
        # `_build_club` re-derives length per frame and clamps only the upper bound, so the
        # drawn club changes length frame to frame even at the address hold where the club is
        # physically stationary (measured stdev 18.8px). rigidify() was written for exactly
        # this and was never called. See DECISIONS D32.
        before = [c.length for c in res.frames if c.length is not None]
        rigidify(res, pose_frames, club_px, butt_px, w, h, cfg)
        after = [c.length for c in res.frames if c.length is not None]
        if before and after:
            res.notes.append(
                f"rigid club model applied; length spread "
                f"{max(before) - min(before):.0f}px -> {max(after) - min(after):.0f}px")
    if cfg.use_path_curve:
        refine_path_curve(res, ev, club_px, cfg)
        # Shaft endpoints follow whatever the curve moved.
        for cf in res.frames:
            if cf.head is None or cf.grip_px is None:
                continue
            gp = cf.grip_px
            hd = np.array([cf.head[0] * w, cf.head[1] * h])
            v = hd - gp
            L = float(np.linalg.norm(v))
            if L < 1e-6:
                continue
            d = v / L
            butt = gp - d * butt_px
            cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
            cf.shaft = [cf.butt, cf.head]
            cf.angle = float(np.degrees(np.arctan2(-d[1], d[0])))
            cf.length = L
    # The club head is at the ball at Impact. Asserted last, after every estimator has had its
    # say, so it corrects a miss rather than competing with a measurement — and before the trace
    # is built, so the drawn line goes through it.
    if cfg.ball_anchor:
        addr_head = res.frames[addr_f].head if res.frames[addr_f].head else None
        ball_xy = None
        if addr_head is not None and cfg.ball_detect:
            try:
                found = find_ball(grays, ev, addr_head, body_h, w, h, cfg)
            except cv2.error as exc:
                found, _ = None, res.notes.append(f"ball search failed ({exc})")
            if found:
                ball_xy = (found[0], found[1])
                res.ball = {"x": round(found[0], 5), "y": round(found[1], 5),
                            "r": round(found[2] / h, 5), "source": "vanished_at_impact"}
                d_addr = float(np.hypot((found[0] - addr_head[0]) * w,
                                        (found[1] - addr_head[1]) * h))
                res.notes.append(
                    f"ball found at ({found[0]:.3f}, {found[1]:.3f}) by disappearance at impact; "
                    f"{d_addr:.0f}px from the club head at Address "
                    f"({100 * d_addr / (body_h * h):.0f}% of body height)")
            else:
                res.notes.append("ball not found by disappearance; "
                                 "falling back to the club head at Address (doc 04 §3)")
        anchor_ball(res, ev, pose_frames, club_px, butt_px, w, h, body_h, cfg, ball_xy=ball_xy)
    _build_trace(res, ev, n, cfg)
    # Trace-only cleanup, after coverage has been computed from the untouched path so the
    # quality gate still reports what was measured rather than what was drawn.
    if cfg.trace_smooth != "none":
        dropped, rejected, fid = smooth_trace(res, ev, n, cfg)
        tot = sum(dropped.values())
        res.notes.append(
            f"trace rebuilt [{cfg.trace_smooth}] from detector frames only; "
            f"{tot} non-model/low-conf points excluded "
            f"(back {dropped.get('backswing', 0)}, down {dropped.get('downswing', 0)}, "
            f"through {dropped.get('followthrough', 0)})")
        if rejected:
            res.notes.append(
                f"trace consensus rejected {sum(rejected.values())} skewing detections "
                f"(back {rejected.get('backswing', 0)}, down {rejected.get('downswing', 0)}, "
                f"through {rejected.get('followthrough', 0)})")
        # The falsifiable number: does the drawn line actually go through the measured heads?
        # Smoothness cannot answer that, which is the whole D20 lesson.
        hits = sum(h for h, _ in fid.values())
        tots = sum(t for _, t in fid.values())
        per = "  ".join(f"{k[:4]} {h}/{t}" for k, (h, t) in fid.items())
        res.notes.append(
            f"trace fidelity: passes within {cfg.trace_fidelity_tol:.3f} of "
            f"{hits}/{tots} measured heads ({100 * hits / max(tots, 1):.0f}%)  [{per}]")
    return res


def _smooth_segments(res: ClubResult, ev, n):
    """Doc 04 Layer D — smooth per swing segment; the path reverses sharply at Top."""
    e = ev["events"]
    bounds = [e["address"]["frame"], e["top"]["frame"], e["impact"]["frame"],
              min(n - 1, e["finish"]["frame"])]
    heads = np.array([fr.head if fr.head else [np.nan, np.nan] for fr in res.frames], float)

    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 4:
            continue
        idx = np.arange(a, b + 1)
        ok = ~np.isnan(heads[a:b + 1, 0])
        if ok.sum() < 4:
            continue
        for ax in (0, 1):
            vals = heads[a:b + 1, ax]
            # Fit only within the segment so the reversal at Top is never smoothed across.
            sm = np.interp(idx, idx[ok], vals[ok])
            k = 5 if (b - a) >= 5 else 3
            ker = np.ones(k) / k
            sm = np.convolve(np.pad(sm, (k // 2, k // 2), mode="edge"), ker, mode="valid")
            heads[a:b + 1, ax] = sm[:len(idx)]
        for i, f in enumerate(idx):
            if not ok[i] and 0 <= f < len(res.frames):
                res.frames[f].interp = True
            if 0 <= f < len(res.frames):
                res.frames[f].head = [float(heads[f, 0]), float(heads[f, 1])]


def _resolve_direction(res: ClubResult, addr_f, cal, club_px, w, h):
    """Settle the shaft's 180 deg ambiguity by following the head's own path.

    Per-frame rules do not work. "Further from the torso" inverts whenever the club points
    at the ground past the hips, and it also fails on an over-the-top or chopping move where
    the head comes down inside the hands. Frame-to-frame angle continuity just propagates
    whichever sign the first frame guessed.

    What *is* always true is that the head travels a continuous path — it cannot teleport to
    the opposite side of the hands between two frames at 60fps. So we seed at Address, where
    the static calibration gives a known-good direction, then walk outward in both
    directions in time, each step choosing the candidate closest to where constant-velocity
    extrapolation says the head should be. This is doc 04 Layer D's gating idea applied to
    the sign rather than to the position.
    """
    n = len(res.frames)
    seed_dir = None
    if cal is not None:
        near, far = np.array(cal[1]) * [w, h], np.array(cal[2]) * [w, h]
        v = far - near
        if np.linalg.norm(v) > 1e-6:
            seed_dir = v / np.linalg.norm(v)

    chosen: list = [None] * n

    def pick(f, pred):
        cf = res.frames[f]
        if not cf.cands or cf.grip_px is None:
            return None
        if pred is None:
            if seed_dir is None:
                return max(cf.cands, key=lambda c: c[1])[0]
            gp = cf.grip_px
            return min(cf.cands, key=lambda c: -float(np.dot((c[0] - gp), seed_dir)))[0]
        return min(cf.cands, key=lambda c: float(np.linalg.norm(c[0] - pred)))[0]

    start = int(np.clip(addr_f, 0, n - 1))
    chosen[start] = pick(start, None)

    for step in (1, -1):
        prev, prev2 = chosen[start], None
        f = start + step
        while 0 <= f < n:
            pred = None
            if prev is not None:
                pred = prev if prev2 is None else prev + (prev - prev2)
            got = pick(f, pred)
            chosen[f] = got
            if got is not None:
                prev2, prev = prev, got
            f += step

    for f, cf in enumerate(res.frames):
        if chosen[f] is None or cf.grip_px is None:
            continue
        v = chosen[f] - cf.grip_px
        cf.raw_angle = float(np.degrees(np.arctan2(-v[1], v[0])))
        cf.length = float(np.linalg.norm(v))


def _build_club(res: ClubResult, chosen, pose_frames, club_px, butt_px, w, h, cfg):
    """Smooth the head path, fill gaps, then draw the shaft from the hands to it.

    Gaps are bridged by interpolating between *confident* detections and smoothing the
    result, which is what a club actually does — it sweeps a continuous arc, so a lost frame
    is far better served by the path either side of it than by whatever the motion mask
    happened to offer in that one frame.
    """
    n = len(res.frames)
    P = np.full((n, 2), np.nan)
    for f, p in enumerate(chosen):
        if p is not None:
            P[f] = p
    ok = ~np.isnan(P[:, 0])
    if ok.sum() < 4:
        res.notes.append("club head not trackable")
        return

    idx = np.arange(n)
    for ax in (0, 1):
        P[:, ax] = np.interp(idx, idx[ok], P[ok, ax])
        P[:, ax] = _smooth1d(P[:, ax], cfg.smooth_win)

    for f, cf in enumerate(res.frames):
        grip = _kp(pose_frames, f, "grip_center", 0.15)
        if grip is None:
            cf.shaft = cf.head = cf.butt = None
            cf.conf = 0.0
            continue
        gp = np.array([grip[0] * w, grip[1] * h])
        head = P[f]
        v = head - gp
        L = float(np.linalg.norm(v))
        if L < 1e-6:
            cf.shaft = cf.head = cf.butt = None
            continue
        d = v / L
        # A rigid club can project shorter through foreshortening but never longer.
        L = min(L, club_px * 1.02)
        head = gp + d * L
        butt = gp - d * butt_px

        cf.head = [float(head[0]) / w, float(head[1]) / h]
        cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
        cf.shaft = [cf.butt, cf.head]
        cf.length = L
        cf.angle = float(np.degrees(np.arctan2(-d[1], d[0])))
        cf.interp = not ok[f]
        cf.conf = 0.2 if not ok[f] else float(np.clip(0.45 + 0.55 * L / club_px, 0.2, 0.98))
        cf.blurred = bool(L < club_px * 0.6)


def apply_detector_heads(res: ClubResult, detector, pose_frames, club_px, butt_px, w, h, cfg):
    """Overwrite the head with the model's own detection wherever it is confident.

    The solver is very good at *continuity* and poor at agreeing with a detector that is
    visibly right: injecting detections as profile evidence left the solved head a median 60px
    away with only 30% of frames within 20px (D32). Where the model has a confident box on the
    club head, that box is a better answer than a cost minimum, so take it.

    What this deliberately does NOT do is smooth or interpolate. It writes `raw_angle` and
    `length` — the two quantities `rigidify` consumes — so the sequence is *measure, then
    smooth*, rather than smoothing a measurement that was already a compromise. Frames without
    a confident detection keep whatever the solver produced.

    Returns (n_taken, n_frames_with_a_detection, frames_taken) — the caller needs the set,
    because a frame this skipped still holds the *solver's* answer, which is a different
    quantity. Mixing the two sources on adjacent frames is what produces the visible jumps:
    model, model, solver-somewhere-else, model. A downstream smoother must treat the skipped
    frames as gaps to interpolate across, not as measurements to average in.
    """
    taken = seen = 0
    took_frames: set[int] = set()
    for cf in res.frames:
        dets = [d for d in detector.heads(cf.f) if d.conf >= cfg.detector_primary_min_conf]
        if not dets:
            continue
        seen += 1
        grip = _kp(pose_frames, cf.f, "grip_center", 0.15)
        if grip is None:
            continue
        gp = np.array([grip[0] * w, grip[1] * h])
        best = max(dets, key=lambda d: d.conf)
        v = np.array(best.xy, float) - gp
        L = float(np.hypot(v[0], v[1]))
        # The club is rigid and held at the hands. Keep the geometric guard — a box somewhere
        # implausible is not this golfer's club head — but note it rejects only ~4% here, so it
        # is a safety net rather than the thing shaping the output.
        if not (club_px * cfg.min_len <= L <= club_px * cfg.max_len):
            continue
        d = v / L
        cf.raw_angle = float(np.degrees(np.arctan2(-d[1], d[0])))
        cf.length = L
        cf.head = [float(best.xy[0]) / w, float(best.xy[1]) / h]
        butt = gp - d * butt_px
        cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
        cf.shaft = [cf.butt, cf.head]
        cf.angle = cf.raw_angle
        cf.interp = False
        # The model's own confidence, not a length-derived proxy. It is what the UI should dim
        # on, and unlike the classical score it is not high merely because the shaft was long.
        cf.conf = float(np.clip(best.conf, 0.0, 0.99))
        cf.blurred = False
        cf.from_model = True
        taken += 1
        took_frames.add(cf.f)
    return taken, seen, took_frames


def smooth_detector_path(res: ClubResult, pose_frames, club_px, butt_px, w, h, cfg,
                         gate=False, measured=None):
    """Smooth the head path in polar coordinates about the hands, optionally de-spiking first.

    `rigidify` is the other smoother, and it does a different job: it *imposes* a rigid club,
    holding length at the calibrated value and treating any frame without its own measurement
    as interpolated — which is why its coverage reads low and honest. That is the right model
    when the angle is all you trust. But the detector gives a genuinely good head position, and
    forcing it onto a calibrated length throws that away — especially since the calibration
    looks ~1.5x too long (D32).

    So this keeps the measured radius and only removes noise from it. Polar about the hands
    rather than raw x/y because the head rides an arc: smoothing x and y independently cuts the
    corner at the top, where the path reverses sharply.

    `gate=True` first rejects isolated outliers with a **Hampel filter** on the angle series.
    A fixed degree tolerance cannot work here — the shaft legitimately sweeps ~40 deg/frame
    through the downswing and barely moves during the takeaway — so the test is against the
    local median with a tolerance scaled by the local MAD. That adapts: tight where the club is
    slow, loose where it is genuinely fast. This is aimed at exactly the failure the backswing
    produces, where the club is behind the golfer, the detector misfires for a frame or two, and
    the head jumps a long way and comes straight back.
    """
    n = len(res.frames)
    ang = np.full(n, np.nan)
    rad = np.full(n, np.nan)
    grips = [None] * n
    for f, cf in enumerate(res.frames):
        grip = _kp(pose_frames, f, "grip_center", 0.15)
        if grip is None:
            continue
        grips[f] = np.array([grip[0] * w, grip[1] * h])
        # Only frames the detector actually answered count as measurements. A frame it skipped
        # still holds the solver's head, which is a different estimate entirely — averaging the
        # two sources together is what makes the path lurch between them.
        if cf.head is None or (measured is not None and f not in measured):
            continue
        gp = grips[f]
        v = np.array([cf.head[0] * w, cf.head[1] * h]) - gp
        r = float(np.hypot(v[0], v[1]))
        if r < 1e-6:
            continue
        ang[f] = np.arctan2(v[1], v[0])
        rad[f] = r

    ok = ~np.isnan(ang)
    if ok.sum() < 6:
        res.notes.append("too few head measurements to smooth")
        return 0

    idx = np.arange(n)
    unwrapped = np.full(n, np.nan)
    unwrapped[ok] = np.unwrap(ang[ok])

    rejected = 0
    if gate:
        # Hampel over the unwrapped angle. Half-window 3 frames: long enough to have a median
        # worth comparing against, short enough that a real direction change is not treated as
        # an outlier.
        K = 3
        keep = ok.copy()
        fs = idx[ok]
        for f in fs:
            lo, hi = f - K, f + K
            nb = [g for g in fs if lo <= g <= hi and g != f]
            if len(nb) < 3:
                continue
            vals = unwrapped[nb]
            med = float(np.median(vals))
            mad = float(np.median(np.abs(vals - med)))
            # MAD collapses to 0 where the club is stationary, which would reject every tiny
            # wobble. Floor it at a fraction of a bin so the gate stays a spike detector.
            tol = max(cfg.detector_traj_tol_deg * np.pi / 180.0, 3.0 * 1.4826 * mad)
            if abs(float(unwrapped[f]) - med) > tol:
                keep[f] = False
                rejected += 1
        if rejected:
            # Re-unwrap from the surviving points only: an outlier left in the sequence biases
            # the unwrap of everything after it.
            unwrapped[:] = np.nan
            unwrapped[keep] = np.unwrap(ang[keep])
            rad[~keep] = np.nan
            ok = keep

    a_fill = np.interp(idx, idx[ok], unwrapped[ok])
    r_fill = np.interp(idx, idx[ok], rad[ok])
    # Radius is the noisier of the two — a box centre wobbling a couple of pixels moves it
    # directly — so it gets the longer window by default. It is NOT clamped to club_px: the
    # measurement is trusted over the calibration here, which is the whole point of this variant.
    r_win = cfg.detector_radius_smooth_win or max(cfg.detector_smooth_win + 4, 7)
    # A window under 3 turns the filter off, leaving the gate and the gap interpolation. The
    # measured frames then keep exactly what was measured, which is what the trace is drawn
    # through; `_smooth1d` floors its own window at 3, so this has to be checked here.
    a_sm = _smooth1d(a_fill, cfg.detector_smooth_win) if cfg.detector_smooth_win >= 3 else a_fill
    r_sm = _smooth1d(r_fill, r_win) if r_win >= 3 else r_fill

    for f, cf in enumerate(res.frames):
        gp = grips[f]
        if gp is None:
            gp = _kp(pose_frames, f, "grip_center", 0.15)
            if gp is None:
                continue
            gp = np.array([gp[0] * w, gp[1] * h])
        d = np.array([np.cos(a_sm[f]), np.sin(a_sm[f])])
        head = gp + d * r_sm[f]
        butt = gp - d * butt_px
        cf.head = [float(head[0]) / w, float(head[1]) / h]
        cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
        cf.shaft = [cf.butt, cf.head]
        cf.length = float(r_sm[f])
        cf.angle = float(np.degrees(np.arctan2(-d[1], d[0])))
        if not ok[f]:
            # Reconstructed from neighbours rather than measured — say so, and cap the
            # confidence so the UI dashes it (doc 02's interp styling).
            cf.interp = True
            cf.conf = min(cf.conf, 0.35)
    return rejected


def rigidify(res: ClubResult, pose_frames, club_px, butt_px, w, h, cfg):
    """Rebuild every frame's club from a rigid model: hands + one smoothed angle.

    Per-frame re-detection is what produced the jitter — length and both endpoints were
    re-measured independently each frame, so noise in any of them shook the whole club. A
    club is a rigid body: its length is fixed at address and does not change. The only
    quantity that genuinely varies frame to frame is the shaft's *direction*.

    So we keep one measurement (the angle), smooth it as a continuous signal, and
    reconstruct geometry from the hands outward:

        butt = grip - dir * butt_px          (grip end, just above the hands)
        head = grip + dir * length           (heel of the club)

    Length is held at the calibrated value and only allowed to shorten smoothly, because a
    2D projection of a rigid club can look shorter through foreshortening — routine at the
    top of the backswing — but can never look longer.
    """
    n = len(res.frames)
    ang = np.array([c.raw_angle if c.raw_angle is not None else np.nan
                    for c in res.frames], float)
    length = np.array([c.length if c.length is not None else np.nan
                       for c in res.frames], float)
    conf = np.array([c.conf for c in res.frames], float)

    ok = ~np.isnan(ang)
    if ok.sum() < 6:
        res.notes.append("too few shaft measurements to build a rigid model")
        return

    # Unwrap before smoothing: the shaft sweeps well past +/-180 deg during a swing, and
    # averaging across the wrap point would swing the club to the opposite side.
    idx = np.arange(n)
    # Window kept short: the downswing sweeps ~40 deg per frame, and a wide average there
    # would lag the club behind the real one through the fastest, most-scrutinised phase.
    a_fill = np.interp(idx, idx[ok], np.unwrap(np.radians(ang[ok]), period=2 * np.pi))
    a_sm = _smooth1d(a_fill, 5)

    l_fill = np.interp(idx, idx[ok], np.clip(length[ok], club_px * 0.45, club_px))
    l_sm = np.clip(_smooth1d(l_fill, 15), club_px * 0.45, club_px)

    for f, cf in enumerate(res.frames):
        grip = _kp(pose_frames, f, "grip_center", 0.15)
        if grip is None:
            cf.shaft = cf.head = cf.butt = None
            cf.conf = 0.0
            continue
        gp = np.array([grip[0] * w, grip[1] * h])
        d = np.array([np.cos(a_sm[f]), -np.sin(a_sm[f])])
        head = gp + d * l_sm[f]
        butt = gp - d * butt_px

        cf.angle = float(np.degrees(np.arctan2(-d[1], d[0])))
        cf.length = float(l_sm[f])
        cf.head = [float(head[0]) / w, float(head[1]) / h]
        cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
        cf.shaft = [cf.butt, cf.head]
        cf.interp = not ok[f]
        if not ok[f]:
            # Reconstructed from neighbours, not measured — say so rather than inheriting
            # a confidence the measurement never earned.
            cf.conf = float(min(conf[f], 0.25))
        cf.blurred = bool(l_sm[f] < club_px * 0.6)


def _smooth1d(x, k):
    """Zero-phase moving average — offline, so no reason to accept smoothing lag."""
    k = max(3, k | 1)
    if len(x) < k:
        return x
    pad = np.pad(x, (k // 2, k // 2), mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")[:len(x)]


def refine_path_curve(res: ClubResult, ev, club_px, cfg):
    """Fit a low-order curve per swing segment and re-derive the uncertain frames from it.

    The user's observation, and it is a stronger constraint than anything else available: a
    club head path is a straight line, a smooth curve, or a curve with **at most one change
    of direction**. It is never jagged. That makes it a low-degree polynomial in time — and
    unlike frame-to-frame smoothness, which happily accepts a globally wrong path that is
    locally smooth (exactly how swing2 stayed flipped for a whole segment), a cubic simply
    cannot express a run of frames on the wrong side of the hands.

    The transition is deliberately excluded. Around the top the club is nearly stationary,
    heavily foreshortened and has almost no motion signal, so those frames are the least
    reliable input we own — and they are also the ones nobody analyses. Letting them into the
    fit corrupts the model that the rest of the segment depends on.

    High-confidence detections define the curve; low-confidence ones are replaced by it.
    """
    e = ev["events"]
    n = len(res.frames)
    trans = max(2, int(cfg.transition_frames))
    segs = [("backswing", e["address"]["frame"], e["top"]["frame"] - trans),
            ("downswing", e["top"]["frame"] + trans, e["impact"]["frame"])]

    for label, lo, hi in segs:
        lo, hi = max(0, lo), min(n - 1, hi)
        if hi - lo < 8:
            continue
        idx, pts, cfs = [], [], []
        for f in range(lo, hi + 1):
            cf = res.frames[f]
            if cf.head is None or cf.grip_px is None:
                continue
            idx.append(f)
            pts.append(cf.head)
            cfs.append(cf.conf)
        if len(idx) < 8:
            continue

        t = np.array(idx, float)
        P = np.array(pts, float)
        wt = np.clip(np.array(cfs, float), 0.05, 1.0)
        deg = min(cfg.curve_degree, max(1, len(idx) // 4))

        keep = np.ones(len(t), bool)
        coef = None
        for _ in range(4):
            if keep.sum() <= deg + 1:
                break
            coef = [np.polyfit(t[keep], P[keep, ax], deg, w=wt[keep]) for ax in (0, 1)]
            pred = np.stack([np.polyval(coef[ax], t) for ax in (0, 1)], 1)
            resid = np.linalg.norm((pred - P) * [[1.0, 1.0]], axis=1)
            thr = max(float(np.quantile(resid[keep], 0.75)) * 1.5, 1e-6)
            new = resid <= thr
            if new.sum() <= deg + 1:
                break
            keep = new
        if coef is None:
            continue

        pred = np.stack([np.polyval(coef[ax], t) for ax in (0, 1)], 1)
        # Residual in pixels, so the tolerance means the same thing at any camera distance.
        h = res.frames[idx[0]]
        resid_px = np.linalg.norm(
            (pred - P) * np.array([[res.width, res.height]]), axis=1) if res.width else \
            np.linalg.norm(pred - P, axis=1)
        tol = club_px * cfg.curve_tol
        replaced = 0
        for k, f in enumerate(idx):
            cf = res.frames[f]
            off = resid_px[k] > tol
            weak = cf.conf < cfg.curve_conf_floor
            if off or weak:
                cf.head = [float(pred[k, 0]), float(pred[k, 1])]
                cf.interp = True
                cf.conf = min(cf.conf, 0.4)
                replaced += 1
        res.notes.append(
            f"{label} curve (deg {deg}) re-derived {replaced}/{len(idx)} frames; "
            f"median residual {np.median(resid_px) / club_px:.3f} club-lengths")

    # Blend the seams. The fit deliberately skips the transition, so re-derived frames butt
    # up against untouched ones at each segment edge and leave a step — which is worse than
    # the outliers being removed (it cost more acceleration than it saved). A light pass over
    # the whole path removes the step without undoing the fit.
    # Confined to the seam around Top, not applied globally: the downswing was already
    # smooth, and blending it again distorted the genuinely fast, tightly-curving part of the
    # path (accel 54 -> 76). Only the boundary needs repairing.
    heads = np.array([cf.head if cf.head else [np.nan, np.nan] for cf in res.frames], float)
    ok = ~np.isnan(heads[:, 0])
    if ok.sum() > 5:
        t = np.arange(len(heads))
        top = e["top"]["frame"]
        lo, hi = max(0, top - 3 * trans), min(len(heads) - 1, top + 3 * trans)
        smoothed = heads.copy()
        for ax in (0, 1):
            col = np.interp(t, t[ok], heads[ok, ax])
            smoothed[:, ax] = _smooth1d(col, 5)
        for f in range(lo, hi + 1):
            cf = res.frames[f]
            if cf.head is not None:
                cf.head = [float(smoothed[f, 0]), float(smoothed[f, 1])]


def robust_inliers(pts, confs, degree=3, tol_mult=2.5, iters=5):
    """Which detections lie on a smooth low-order path, and which are skewing it.

    The problem this solves: smoothing *averages in* a bad detection instead of discarding it, so
    one wrong point drags the drawn path off the real club for several frames either side. That is
    worst exactly where it matters most — at the bottom of the swing, where the club is fastest
    and a few pixels of pull is visible.

    So reject rather than average. This is RANSAC's idea run as IRLS: fit a cubic in normalised
    time to x and y, measure each point's residual, keep the consensus and refit without the rest.
    Degree 3 because a club-head path within one segment is a straight line, a smooth curve, or a
    curve with at most one direction change — never jagged (the same constraint D20b tested).

    Two details that matter:
      * The tolerance is **scaled by the median residual**, not fixed. Fixed pixels cannot work
        across segments where the club moves 4px between frames in the takeaway and 90px through
        impact.
      * Detector confidence seeds the weights, so a point the model itself was unsure about has
        to agree with its neighbours to survive, while a confident one is given the benefit of
        the doubt. Confidence alone was not enough (D32 showed a 0.35 threshold silently
        discarding good frames) but as a prior on a consensus fit it is exactly right.

    Returns a boolean mask over `pts`.
    """
    n = len(pts)
    if n < degree + 3:
        return np.ones(n, bool)
    t = np.linspace(0.0, 1.0, n)
    P = np.asarray(pts, float)
    wts = np.clip(np.asarray(confs, float), 0.05, 1.0)
    keep = np.ones(n, bool)
    for _ in range(iters):
        deg = min(degree, int(keep.sum()) - 1)
        if deg < 1:
            break
        resid2 = np.zeros(n)
        for ax in (0, 1):
            c = np.polyfit(t[keep], P[keep, ax], deg, w=wts[keep])
            resid2 += (np.polyval(c, t) - P[:, ax]) ** 2
        resid = np.sqrt(resid2)
        scale = float(np.median(resid[keep]))
        if scale <= 0:
            break
        new = resid <= tol_mult * 1.4826 * scale
        # Never reject so much that the fit is unconstrained — that is how a robust method
        # collapses onto a handful of points and calls the rest outliers.
        if int(new.sum()) < degree + 2 or bool((new == keep).all()):
            break
        keep = new
    return keep


def trace_fidelity(drawn, measured, tol):
    """How many real detections does the drawn path actually pass through?

    The metric this whole exercise was missing. Smoothness says nothing about whether the line
    follows the club — a path can be beautifully smooth and nowhere near the detections, which is
    the D20 complaint in miniature. This asks the falsifiable question instead: of the heads the
    model measured, how many does the rendered polyline pass within `tol` of?

    Point-to-segment, not point-to-vertex: after filtering, the polyline's vertices are sparse, so
    measuring to vertices alone would report a miss for a point the line passes straight through.
    """
    if not drawn or not measured:
        return 0, len(measured)
    D = np.asarray(drawn, float)
    hit = 0
    for p in measured:
        q = np.asarray(p, float)
        if len(D) == 1:
            d = float(np.hypot(*(q - D[0])))
        else:
            a, b = D[:-1], D[1:]
            ab = b - a
            L2 = (ab ** 2).sum(1)
            L2[L2 == 0] = 1e-12
            s = np.clip(((q - a) * ab).sum(1) / L2, 0.0, 1.0)
            proj = a + s[:, None] * ab
            d = float(np.min(np.hypot(*(q - proj).T)))
        if d <= tol:
            hit += 1
    return hit, len(measured)


def apex_cut(pts):
    """How many leading points of a follow-through polyline to keep: cut it at the club's
    highest point on screen.

    "Where it starts to turn at the top" has a clean definition: the head sweeps up after impact,
    reaches an apex, then travels back over the shoulder. The apex is the minimum y (image y
    grows downward), so everything past that index is the club coming down behind the golfer.

    Dropping it is not only cosmetic. Past the apex the head is occluded by the body, which is
    where detection is weakest — on both fixtures the follow-through has the worst coverage of
    any segment — and the path loops back across everything already drawn, so it obscures the
    part of the trace that carries the information.

    Left alone if the apex is at either extreme: that means no turn was captured, and guessing
    would truncate a legitimate path.

    A count rather than the cut list, so the parallel frame-index list can be cut to exactly the
    same length.
    """
    if len(pts) < 4:
        return len(pts)
    ys = [p[1] for p in pts]
    i = int(np.argmin(ys))
    if i < 2 or i >= len(pts) - 1:
        return len(pts)
    return i + 1


def smooth_trace(res: ClubResult, ev, n, cfg):
    """Rebuild the trace polylines only. Per-frame head positions are NOT touched.

    The trace and the per-frame club are different products with different failure modes, and
    conflating them is why this looked unfixable. `_build_trace` appends every frame that has a
    head, with no confidence gate and no check on where it came from — so once the detector
    supplies most heads, the minority of frames it declined contribute the *solver's* answer and
    the polyline lurches between two estimators. The frame-by-frame overlay stays correct
    throughout, because each individual head is fine; only the line joining them is wrong.

    So this fixes the line and leaves the heads alone. `cfg.trace_smooth` picks the tactic:

      "measured"  drop frames the detector did not answer. No smoothing at all — the honest
                  baseline, and it isolates how much of the jaggedness was source-mixing rather
                  than noise.
      "moving"    + a box filter. Cheap, and it shortens the path through tight curvature.
      "savgol"    + Savitzky-Golay, which fits a local polynomial instead of averaging, so it
                  preserves the curvature at Top where a box filter cuts the corner. Same
                  reason doc 03 §3.5 chose it for the pose series.

    Smoothing is per segment. The path reverses sharply at Top, so one pass across the whole
    swing would round off the corner that defines the transition.
    """
    mode = cfg.trace_smooth
    if mode == "none":
        return {}
    e = ev["events"]
    spans = {
        "backswing": (e["address"]["frame"], e["top"]["frame"]),
        "downswing": (e["top"]["frame"], e["impact"]["frame"]),
        "followthrough": (e["impact"]["frame"], min(n - 1, e["finish"]["frame"])),
    }

    def measured(f):
        """Is frame f a detector measurement this trace should be drawn through?

        `interp` matters as much as `from_model`: once `smooth_detector_path` has run, a frame
        the detector declined — or one its trajectory gate threw out — still carries a head, but
        one reconstructed from its neighbours. Drawing through those would make the polyline
        assert measurements it does not have.

        `from_ball` counts. It is not a detection, but it is not an estimate either: it is the
        Address landmark asserted at Impact (`anchor_ball`), and on a swing fast enough to have
        no detection at the strike it is the only thing that puts the line on the ball.
        """
        fr = res.frames[f]
        if not fr.head or any(np.isnan(fr.head)):
            return False
        if fr.from_ball:
            return True
        return bool(fr.from_model and not fr.interp and fr.conf >= cfg.trace_min_conf)

    swing_lo, swing_hi = max(0, e["address"]["frame"]), min(n - 1, e["finish"]["frame"])
    meas_fs = [f for f in range(swing_lo, swing_hi + 1) if measured(f)]

    dropped, rejected, fidelity = {}, {}, {}
    for key, (a, b) in spans.items():
        # One measured point BEYOND each end of the span, so consecutive segments share their
        # boundary and the drawn path is continuous.
        #
        # The events are the frames a phase is named for, not frames the club was measured on,
        # and cutting the point list at them leaves each segment ending at the last measurement
        # strictly inside it. Through impact the head moves ~90px a frame, so on `perfect` the
        # downswing stopped 102px short of the ball and the follow-through began 88px past it —
        # a hole around the one position in the swing a golfer most wants the line to reach.
        inside = [f for f in meas_fs if a <= f <= b]
        before = [f for f in meas_fs if a - cfg.trace_join_frames <= f < a]
        after = [f for f in meas_fs if b < f <= b + cfg.trace_join_frames]
        seg_fs = before[-1:] + inside + after[:1]
        skipped = sum(1 for f in range(max(0, a), min(n, b + 1))
                      if res.frames[f].head and not measured(f))
        pts = [[res.frames[f].head[0], res.frames[f].head[1]] for f in seg_fs]
        confs = [res.frames[f].conf for f in seg_fs]
        dropped[key] = skipped
        raw_pts = [list(p) for p in pts]

        # "robust": reject the detections that skew a fit, then draw the survivors UNSMOOTHED, so
        # the path passes through real measurements instead of near an average of them.
        if mode == "robust" and len(pts) >= 6:
            keep = robust_inliers(pts, confs, tol_mult=cfg.trace_robust_tol)
            kept = [p for p, k in zip(pts, keep) if k]
            rejected[key] = len(pts) - len(kept)
            if len(kept) >= 2:
                pts = kept
                seg_fs = [f for f, k in zip(seg_fs, keep) if k]

        # Per-segment window; 0 means leave this segment's measurements alone.
        want = cfg.trace_win_downswing if key == "downswing" else cfg.trace_win
        if want and len(pts) >= 5 and mode in ("moving", "savgol"):
            arr = np.array(pts, float)
            win = min(want, len(pts) if len(pts) % 2 else len(pts) - 1)
            if win >= 5:
                for ax in (0, 1):
                    if mode == "moving":
                        arr[:, ax] = _smooth1d(arr[:, ax], win)
                    else:
                        arr[:, ax] = savgol_filter(arr[:, ax], win, 2)
            pts = arr.tolist()
        # Clip AFTER smoothing: the apex of the smoothed path is the one that gets drawn, and
        # clipping first would let the smoother pull points back past the cut.
        if key == "followthrough" and cfg.trace_clip_followthrough:
            cut = apex_cut(pts)
            pts, seg_fs = pts[:cut], seg_fs[:cut]
        res.trace[key] = [[round(float(x), 5), round(float(y), 5)] for x, y in pts]
        res.trace_frames[key] = [int(f) for f in seg_fs]
        # Measured against the points that were available BEFORE any rejection or smoothing, so
        # a mode cannot score well by simply discarding what it fails to fit.
        fidelity[key] = trace_fidelity(res.trace[key], raw_pts, cfg.trace_fidelity_tol)
    return dropped, rejected, fidelity


def refine_events(res: ClubResult, ev, cfg: ClubConfig | None = None, heads=None,
                  fps: float = 60.0):
    """Doc 05 A.5/A.8 — replace the pose proxies for the events the club can see better.

    Toe-Up and Mid-Follow-Through were always here. Impact and the address hold joined them
    because they are the other two things the club measures better than the hands do, and both
    were measurably wrong: Impact 7 frames early on `perfect`, and its "quasi-static" setup hold
    spanning 127px of club travel. Top is deliberately NOT refined here — see D49 for the
    numbers showing the club cannot answer that one.

    Both events are defined by the *shaft being horizontal*, which Phase 3 could only
    approximate from wrist height because no club data existed. Now it does, so use the
    real criterion. Only accept it when the shaft was tracked confidently through the
    candidate span; otherwise the proxy stands, since a confident wrong answer is worse
    than an honestly uncertain one.
    """
    cfg = cfg or ClubConfig()
    e = ev["events"]
    ang = {c.f: c.angle for c in res.frames if c.angle is not None and c.conf >= 0.35}
    changed = []

    def horizontal_in(lo, hi):
        cands = [(abs(_wrap180(a)), f) for f, a in ang.items() if lo < f < hi]
        if len(cands) < 3:
            return None
        best = min(cands)
        return best[1] if best[0] <= 18.0 else None

    # Same plausibility window as the Phase 3 proxy: Toe-Up sits roughly a third of the way
    # into the backswing. A "shaft horizontal" hit a few frames after Address is the club
    # still sitting at the ball, not the takeaway checkpoint.
    a0, t0 = e["address"]["frame"], e["top"]["frame"]
    span = max(1, t0 - a0)
    tu = horizontal_in(a0 + int(0.15 * span), a0 + int(0.60 * span))
    if tu is not None and tu != e["toe_up"]["frame"]:
        changed.append(f"toe_up {e['toe_up']['frame']} -> {tu} (shaft horizontal)")
        e["toe_up"] = {"frame": int(tu), "conf": 0.8}

    h = res.height or 1
    club_px = (res.club_len or 0.2) * h
    # `heads` is where the DETECTOR put the club head, frame -> normalized xy. The caller has to
    # supply it: this runs on the primary solve, which uses the detector as evidence rather than
    # as the head (`detector_head_primary` is off), so `from_model` is false on every one of its
    # frames and the solver's own head is exactly the estimate these refinements exist to correct.
    if heads:
        measured = {int(f): np.array(p) * [res.width or 1, h] for f, p in heads.items()}
    else:
        measured = {c.f: np.array(c.head) * [res.width or 1, h] for c in res.frames
                    if c.head and c.from_model and not c.interp and not any(np.isnan(c.head))}

    # --- Impact: the club head's lowest point ------------------------------------------
    #
    # Impact is where the head reaches the bottom of its arc, and that is a thing the club can
    # be *seen* doing — unlike Top, where the detector has nothing (D49). The Stage 5 estimate
    # comes from hand height and is good but not exact: on `perfect` it lands 7 frames early, so
    # the drawn trace turns follow-through-white while the club is still coming down.
    #
    # Only a small correction is allowed. This is a refinement of a working estimate, not a
    # re-detection — if the lowest measured head is far from it, the detector is more likely
    # wrong than the event, and the event stands.
    imp = e["impact"]["frame"]
    # Bounded by its neighbours as well as by the window. Events are strictly ordered and the
    # invariant suite enforces it, so a snap that crossed Mid-Downswing or Mid-Follow-Through
    # would produce an artifact that fails its own contract rather than a better Impact.
    lo = max(imp - cfg.impact_snap_frames, e["mid_downswing"]["frame"] + 1)
    hi = min(imp + cfg.impact_snap_frames, e["mid_follow_through"]["frame"] - 1)
    near = [f for f in measured if lo <= f <= hi]
    if len(near) >= cfg.impact_snap_min_frames and imp in measured:
        # Ties broken toward the CURRENT frame, not toward the end of the window. A 30fps source
        # normalised to 60fps repeats every frame, so exact ties are common — and taking the
        # later one moved pro_2's Impact two frames for a head that was 0px lower, which is a
        # coin toss dressed as a measurement.
        low = min(near, key=lambda f: (-measured[f][1], abs(f - imp)))
        drop = float(measured[low][1] - measured[imp][1])
        if low != imp and drop >= cfg.impact_snap_min_drop * club_px:
            changed.append(
                f"impact {imp} -> {low} (club head's lowest point, "
                f"{drop:.0f}px below the old frame)")
            e["impact"] = {"frame": int(low), "conf": max(0.7, e["impact"]["conf"])}

    # Mid-Follow-Through is searched from Impact, so it has to be resolved AFTER any correction
    # to it — off the old frame it would be measuring from a moment the swing was not at.
    mft = horizontal_in(e["impact"]["frame"], e["finish"]["frame"])
    if mft is not None and mft != e["mid_follow_through"]["frame"]:
        changed.append(
            f"mid_follow_through {e['mid_follow_through']['frame']} -> {mft} (shaft horizontal)")
        e["mid_follow_through"] = {"frame": int(mft), "conf": 0.8}

    # --- Address hold: require the CLUB to be still, not just the hands ------------------
    #
    # `address_span` is the quasi-static hold setup measurements are medianed over (D28), and it
    # is found from hand motion. That misses a golfer who walks the club into the ball: on
    # `perfect` the head travels 127px — 22% of body height — across the detected hold while the
    # hands move 15px, so the "setup" is measured over a club still sliding into position, and
    # the ball landmark taken from it (D44) is a median of a moving club.
    #
    # Trim the span back from Address to the frames where the head actually sat still. Only when
    # it is badly wrong: the other three fixtures move 4-23px across their holds and are left
    # exactly as they are.
    span = ev.get("address_span")
    a_f = e["address"]["frame"]
    if span and a_f in measured:
        inside = sorted(f for f in measured if span[0] <= f <= span[1])
        if len(inside) >= 4:
            travel = float(np.linalg.norm(measured[inside[-1]] - measured[inside[0]]))
            if travel > cfg.address_still_tol * club_px * 2:
                tol = cfg.address_still_tol * club_px
                start = a_f
                for f in reversed(inside):
                    if float(np.linalg.norm(measured[f] - measured[a_f])) > tol:
                        break
                    start = f
                if start > span[0]:
                    changed.append(
                        f"address_span {span} -> [{start}, {span[1]}] (club head moved "
                        f"{travel:.0f}px across the old hold; setup is not static before "
                        f"frame {start})")
                    ev["address_span"] = [int(start), int(span[1])]

    if changed:
        # Phase spans are derived from event frames, so they must be rebuilt in step.
        order = ["address", "toe_up", "mid_backswing", "top",
                 "mid_downswing", "impact", "mid_follow_through", "finish"]
        ev["phases"] = [{"name": f"{a}->{b}", "from": e[a]["frame"], "to": e[b]["frame"]}
                        for a, b in zip(order[:-1], order[1:])]
        # And so is tempo, which is Address->Top->Impact and nothing else. Snapping Impact to
        # the club's low point moves it, and a tempo left over from before is the number the
        # scorecard reads and the one the implausibility check fires on — stale, it both
        # misreports the swing and blames the wrong event for it.
        if ev.get("tempo") is not None:
            tempo, odd = events.build_tempo(e, fps)
            if tempo is not None:
                before = ev["tempo"].get("ratio")
                ev["tempo"] = tempo
                if before is not None and before != tempo["ratio"]:
                    changed.append(f"tempo {before}:1 -> {tempo['ratio']}:1 (events moved)")
    return changed


def find_ball(grays, ev, near_norm, body_h, w, h, cfg):
    """Locate the ball by the one thing that distinguishes it from every other bright blob:
    it is there, and then it is not.

    A golf ball is a few pixels of white on grass. So are range balls scattered behind the
    golfer, a shoe, a yardage marker, a sprinkler head and the reflection off a divot — a
    brightness-and-roundness search picks a different one of those on every clip (measured: a
    first-cut Hough search found the ball on 2 of 4 fixtures and something else, or nothing, on
    the others). Being *struck* is what only the ball does. Median the frames before Impact,
    median the frames after, and the ball is the small bright thing present in the first and
    missing from the second.

    Returns `(x, y, radius_px)` normalized, or None. Deliberately conservative: a wrong ball is
    worse than no ball, because `anchor_ball` writes a club position from it.

    Why bother rather than just using the club head at Address (doc 04 §3): that landmark is
    only the ball if Address lands on a frame where the club is actually grounded behind it. On
    `perfect` it does not — the detected Address frame catches the club still off the turf, 150px
    (18% of body height) from the ball.

    **NEGATIVE RESULT — this is off by default (`ClubConfig.ball_detect`).** Measured on all four
    fixtures: it finds the golfer's *shoe* on `perfect` and swing2 and nothing on pro_2 and
    swing1. Each gate below removes a real false positive and none of them is the missing one:
    every individually-discriminative property of a golf ball (small, round, bright, static,
    gone after impact) is also a property of a shoe edge, a divot, a background range ball, or a
    turf speck, and the combination that excludes all of them also excludes the ball. That is
    the case for a learned detector — the club-head model already in the pipeline had the same
    shape of problem — not for another threshold. See DECISIONS D44.
    """
    e = ev["events"]
    addr_f, imp_f = e["address"]["frame"], e["impact"]["frame"]
    n = len(grays)
    span = ev.get("address_span") or [addr_f, addr_f]
    pre_fs = [f for f in range(max(0, span[0]), min(n, span[1] + 1))][:30]
    if len(pre_fs) < 3:
        pre_fs = [f for f in range(max(0, addr_f - 10), min(n, addr_f + 1))]
    # Well clear of impact: the club, the divot and the ball's first few frames of flight are
    # all still in the neighbourhood immediately after the strike.
    post_fs = [f for f in range(min(n - 1, imp_f + cfg.ball_after_impact),
                                min(n, imp_f + cfg.ball_after_impact + 20))]
    if len(pre_fs) < 3 or len(post_fs) < 3:
        return None
    pre = np.median(np.stack([grays[f] for f in pre_fs]), axis=0)
    post = np.median(np.stack([grays[f] for f in post_fs]), axis=0)
    gone = np.clip(pre - post, 0, 255).astype(np.uint8)

    # Only look where the ball can be: within reach of the hands' low point, and not up in the
    # golfer. `near_norm` is the club head at Address — the right neighbourhood even on the
    # clips where it is not the right point.
    mask = np.zeros(gone.shape, np.uint8)
    cv2.circle(mask, (int(near_norm[0] * w), int(near_norm[1] * h)),
               int(cfg.ball_search_frac * body_h * h), 255, -1)
    gone = cv2.bitwise_and(gone, mask)

    thr = cv2.threshold(gone, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    nlab, _, stats, cent = cv2.connectedComponentsWithStats(thr, 8)
    r_want = cfg.ball_diam_frac * body_h * h / 2.0
    best = None
    for i in range(1, nlab):
        _, _, bw, bh, area = stats[i]
        if area < 3:
            continue
        r = 0.5 * (bw + bh) / 2.0
        # Ball-shaped: roughly round, roughly the right size, and mostly filled.
        if not (0.5 <= bw / max(bh, 1) <= 2.0):
            continue
        if not (r_want * 0.45 <= r <= r_want * 2.2):
            continue
        if area < 0.4 * bw * bh:
            continue
        cx, cy = cent[i]
        ix, iy = int(cx), int(cy)
        bright = float(pre[iy, ix])
        drop = float(gone[iy, ix])
        if bright < cfg.ball_min_bright:
            continue
        # Isolated, not part of something bigger. This is the test that separates a ball from
        # the golfer's shoe — and the shoe is what a disappearance search picks without it,
        # because the feet move between Address and the finish, so a shoe "vanishes" from its
        # Address position just as convincingly as a struck ball does. A ball is surrounded by
        # turf; a fragment of shoe is surrounded by more shoe. Measured in the BEFORE image,
        # where the ball is still sitting there.
        ring = np.zeros(pre.shape, np.uint8)
        cv2.circle(ring, (ix, iy), int(max(3, r) * 4), 255, -1)
        cv2.circle(ring, (ix, iy), int(max(2, r) + 2), 0, -1)
        core = np.zeros(pre.shape, np.uint8)
        cv2.circle(core, (ix, iy), max(1, int(r)), 255, -1)
        inner = cv2.mean(pre.astype(np.uint8), core)[0]
        outer = cv2.mean(pre.astype(np.uint8), ring)[0]
        if inner - outer < cfg.ball_min_contrast:
            continue
        # Prefer the biggest drop in brightness, i.e. the thing that most definitely left.
        if best is None or drop > best[0]:
            best = (drop, cx, cy, r)
    if best is None:
        return None
    _, cx, cy, r = best
    return (float(cx) / w, float(cy) / h, float(r))


def anchor_ball(res: ClubResult, ev, pose_frames, club_px, butt_px, w, h, body_h, cfg,
                ball_xy=None):
    """Put the club head on the ball at Impact when nothing detected it there (doc 04 §3).

    The club head at Address *is* the ball. That is doc 04's own statement and it is already how
    `calibrate` seeds the solver — but it was only ever used going forwards, and the same
    landmark says something about Impact: the head returns to that point, because otherwise
    there is no shot. Nothing in the pipeline was asserting that.

    It matters most exactly where the detector is worst. Through impact the head is moving
    ~90px/frame and smears across the turf, so the frames either side of the strike are the
    least likely in the whole swing to carry a confident box — a fast pro swing can have no
    detection at the ball at all. On `pro_2` the solved head never comes within **196px (35% of
    body height)** of the ball, so the drawn path swings past the strike and back up; the one
    position a golfer is looking for is the one the line misses.

    So: if the head never gets near the ball around Impact, place it there. Three guards, because
    this writes a position rather than measuring one:

      * It only fires when the head misses by more than 5% of body height. Where the detector
        already reaches the ball (`perfect` 17.7px, swing2 10.4px) nothing happens.
      * The anchor frame is the one whose path segment passes closest to the ball, searched in a
        window around Impact — not Impact itself. The event is a detection with its own error,
        and anchoring the wrong frame would drag the head off the club to fix a hole.
      * The ball has to be reachable: |ball - hands| must fall inside the same length bounds a
        detection has to satisfy. If it does not, the Address head was not the ball (or Impact is
        badly wrong) and this abstains rather than inventing geometry.

    The written frame is marked `from_ball`, never `from_model`. It is a derived landmark, not a
    detection, and every consumer that distinguishes the two should keep distinguishing them.
    """
    e = ev["events"]
    addr_f, imp_f = e["address"]["frame"], e["impact"]["frame"]
    n = len(res.frames)
    if not (0 <= imp_f < n):
        return None

    # Where the ball is. `find_ball` if it answered — it is a measurement of the ball itself.
    # Otherwise the club head over the Address hold, medianed so one bad frame in the
    # quasi-static span cannot move it (the same reason D28 takes setup metrics that way). That
    # fallback is doc 04 §3's landmark and is right whenever Address caught the club grounded
    # behind the ball; `find_ball`'s docstring covers the clip where it does not.
    if ball_xy is not None:
        ball = np.array([float(ball_xy[0]), float(ball_xy[1])])
    else:
        span = ev.get("address_span") or [addr_f, addr_f]
        heads = [res.frames[f].head for f in range(max(0, span[0]), min(n, span[1] + 1))
                 if res.frames[f].head and not any(np.isnan(res.frames[f].head))]
        if not heads:
            return None
        ball = np.array([float(np.median([p[0] for p in heads])),
                         float(np.median([p[1] for p in heads]))])
    ball_px = ball * [w, h]

    tol = cfg.ball_anchor_tol * body_h * h
    K = cfg.ball_anchor_window
    lo, hi = max(0, imp_f - K), min(n - 1, imp_f + K)
    have = [f for f in range(lo, hi + 1)
            if res.frames[f].head and not any(np.isnan(res.frames[f].head))]
    if len(have) < 2:
        return None
    near = min(float(np.linalg.norm(np.array(res.frames[f].head) * [w, h] - ball_px))
               for f in have)
    if near <= tol:
        return None

    # Closest approach of the drawn path, not of its samples: between two frames the head can
    # sweep straight past the ball without either endpoint being near it, which is the whole
    # failure at 90px/frame. Anchor whichever endpoint the crossing is nearer.
    best = None
    for f0, f1 in zip(have[:-1], have[1:]):
        p0 = np.array(res.frames[f0].head) * [w, h]
        p1 = np.array(res.frames[f1].head) * [w, h]
        seg = p1 - p0
        L2 = float(seg @ seg)
        t = 0.0 if L2 < 1e-9 else float(np.clip((ball_px - p0) @ seg / L2, 0.0, 1.0))
        d = float(np.linalg.norm(p0 + seg * t - ball_px))
        if best is None or d < best[0]:
            best = (d, f1 if t > 0.5 else f0)
    if best is None:
        return None
    f = best[1]

    grip = _kp(pose_frames, f, "grip_center", 0.15)
    if grip is None:
        return None
    gp = np.array([grip[0] * w, grip[1] * h])
    v = ball_px - gp
    L = float(np.hypot(v[0], v[1]))
    if not (club_px * cfg.min_len <= L <= club_px * cfg.max_len):
        res.notes.append(
            f"ball anchor declined at frame {f}: ball sits {L / club_px:.2f} club-lengths from "
            f"the hands, outside [{cfg.min_len}, {cfg.max_len}] — Address head or Impact is wrong")
        return None

    d = v / L
    cf = res.frames[f]
    cf.head = [float(ball[0]), float(ball[1])]
    butt = gp - d * butt_px
    cf.butt = [float(butt[0]) / w, float(butt[1]) / h]
    cf.shaft = [cf.butt, cf.head]
    cf.angle = cf.raw_angle = float(np.degrees(np.arctan2(-d[1], d[0])))
    cf.length = L
    cf.interp = False
    cf.from_ball = True
    cf.conf = max(cf.conf, cfg.ball_anchor_conf)
    res.notes.append(
        f"club head anchored to the ball at frame {f} (Impact {imp_f}); the tracked path missed "
        f"it by {near:.0f}px ({100 * near / (body_h * h):.0f}% of body height)")
    return f


def _wrap180(a):
    return (a + 90.0) % 180.0 - 90.0


def _build_trace(res: ClubResult, ev, n, cfg: ClubConfig | None = None):
    """Segment the head path into the three polylines the renderer draws (doc 04 §5)."""
    cfg = cfg or ClubConfig()
    e = ev["events"]
    spans = {
        "backswing": (e["address"]["frame"], e["top"]["frame"]),
        "downswing": (e["top"]["frame"], e["impact"]["frame"]),
        "followthrough": (e["impact"]["frame"], min(n - 1, e["finish"]["frame"])),
    }
    # Coverage counts frames whose head was *measured with reasonable confidence*, not
    # merely present. Counting presence reported 97% on a downswing whose trace is visibly
    # wrong — the gate in doc 02 is meant to stop exactly that from reaching the UI, and a
    # presence-based number defeats it.
    measured = {}
    for key, (a, b) in spans.items():
        pts, fs, got, tot = [], [], 0, 0
        for f in range(max(0, a), min(n, b + 1)):
            fr = res.frames[f]
            tot += 1
            if fr.head and not any(np.isnan(fr.head)):
                pts.append([round(fr.head[0], 5), round(fr.head[1], 5)])
                fs.append(f)
                if fr.conf >= 0.30 and not fr.interp:
                    got += 1
        # Coverage is computed from the full span above; only the drawn polyline is clipped, so
        # the quality gate still reports every frame that was measured.
        if key == "followthrough" and cfg.trace_clip_followthrough:
            cut = apex_cut(pts)
            pts, fs = pts[:cut], fs[:cut]
        res.trace[key] = pts
        res.trace_frames[key] = fs
        measured[key] = round(got / tot, 3) if tot else 0.0
    res.coverage = measured
    swing = [k for k in ("backswing", "downswing") ]
    res.coverage["swing"] = round(
        float(np.mean([measured[k] for k in swing])), 3) if swing else 0.0
