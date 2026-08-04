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


@dataclass
class ClubResult:
    frames: list = field(default_factory=list)
    trace: dict = field(default_factory=dict)
    club_len: float = 0.0
    butt_len: float = 0.0
    width: int = 0
    height: int = 0
    coverage: dict = field(default_factory=dict)
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
          progress=None) -> ClubResult:
    cfg = cfg or ClubConfig()
    res = ClubResult()

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
        cf.grip_px = gp
        out.append(cf)
        if progress and (f % 30 == 0 or f == n - 1):
            progress(f + 1, n)

    res.frames = out

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
    _build_trace(res, ev, n)
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


def refine_events(res: ClubResult, ev):
    """Doc 05 A.5/A.8 — replace the pose proxies for Toe-Up and Mid-Follow-Through.

    Both events are defined by the *shaft being horizontal*, which Phase 3 could only
    approximate from wrist height because no club data existed. Now it does, so use the
    real criterion. Only accept it when the shaft was tracked confidently through the
    candidate span; otherwise the proxy stands, since a confident wrong answer is worse
    than an honestly uncertain one.
    """
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

    mft = horizontal_in(e["impact"]["frame"], e["finish"]["frame"])
    if mft is not None and mft != e["mid_follow_through"]["frame"]:
        changed.append(
            f"mid_follow_through {e['mid_follow_through']['frame']} -> {mft} (shaft horizontal)")
        e["mid_follow_through"] = {"frame": int(mft), "conf": 0.8}

    if changed:
        # Phase spans are derived from event frames, so they must be rebuilt in step.
        order = ["address", "toe_up", "mid_backswing", "top",
                 "mid_downswing", "impact", "mid_follow_through", "finish"]
        ev["phases"] = [{"name": f"{a}->{b}", "from": e[a]["frame"], "to": e[b]["frame"]}
                        for a, b in zip(order[:-1], order[1:])]
    return changed


def _wrap180(a):
    return (a + 90.0) % 180.0 - 90.0


def _build_trace(res: ClubResult, ev, n):
    """Segment the head path into the three polylines the renderer draws (doc 04 §5)."""
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
        pts, got, tot = [], 0, 0
        for f in range(max(0, a), min(n, b + 1)):
            fr = res.frames[f]
            tot += 1
            if fr.head and not any(np.isnan(fr.head)):
                pts.append([round(fr.head[0], 5), round(fr.head[1], 5)])
                if fr.conf >= 0.30 and not fr.interp:
                    got += 1
        res.trace[key] = pts
        measured[key] = round(got / tot, 3) if tot else 0.0
    res.coverage = measured
    swing = [k for k in ("backswing", "downswing") ]
    res.coverage["swing"] = round(
        float(np.mean([measured[k] for k in swing])), 3) if swing else 0.0
