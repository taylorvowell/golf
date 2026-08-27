"""Stage 3 — pose post-processing (the pose spec). "This is where quality is won."

Runs in the documented order: confidence handling, anatomical sanity, side-swap repair,
temporal outlier rejection, gap interpolation, smoothing. Three deliberate refinements to
the original spec, each measured on the fixtures:

  1.  Low confidence means *unverified*, not *wrong*. The pose spec sends visibility < 0.3
      straight to missing; on fixture swing2 that discards a correctly-placed grip. Instead
      low-confidence joints enter as PROVISIONAL and are demoted only when a positive check
      fails, so evidence removes a joint rather than a threshold.
  2.  Bone-length sanity is upper-bound only. A 2D bone can look arbitrarily short through
      foreshortening (routine for arms in DTL) but can never look longer than it is, so a
      symmetric +/-35% band flags legitimate geometry. We flag only over-long bones.
  3.  One-Euro is applied forward and backward and averaged. The filter is causal and lags;
      the whole point of choosing it over a moving average was to not corrupt the fast
      downswing, and offline we can cancel its phase lag outright.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.signal import savgol_filter

from .skeleton import TRACKED_NAMES, UNRELIABLE

MISSING, PROVISIONAL, OK, INTERP = 0, 1, 2, 3
# 4 — the frame carried no direct inference at all because the frame PLAN did not select it
# (swingsage/planner.py). Distinct from INTERP on purpose: INTERP means the model looked and
# came back with nothing, PROPAGATED means nobody looked. A client dims both, but only one of
# them is evidence that the pose is hard on this clip, and only one of them is recoverable by
# re-analysing at a denser policy. Appended rather than inserted so 0-3 keep their meaning in
# every stored artifact.
PROPAGATED = 4
# Stage 3 runs over the native block *and* the measured extras. Derived joints are
# deliberately absent — the pose spec recomputes those from smoothed parents afterwards.
N = len(TRACKED_NAMES)
NAME_IDX = {n: i for i, n in enumerate(TRACKED_NAMES)}

# Bones checked for length plausibility. Arms are included but only ever flagged for being
# too long () — the same rule applies to every bone, so nothing needs excluding.
CHECK_BONES = [
    ("left_shoulder", "right_shoulder"), ("left_hip", "right_hip"),
    ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
    ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
    ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
    ("left_ankle", "left_heel"), ("right_ankle", "right_heel"),
]

# Max plausible per-frame acceleration, as a fraction of golfer height. Wrists and elbows
# genuinely whip through the downswing; hips, head and ankles do not.
# Matched by substring in insertion order, so a more specific key must come first.
# "nose_bridge" is covered by "nose"; the rest of the measured extras need their own.
ACCEL_LIMIT = {
    "wrist": 0.150, "elbow": 0.110, "shoulder": 0.050, "hip": 0.040,
    "knee": 0.055, "ankle": 0.040, "heel": 0.045, "foot": 0.050,
    "ear": 0.035, "eye": 0.035, "nose": 0.035, "mouth": 0.035,
    "mcp": 0.150,      # rides the wrist, so it whips through the downswing just as hard
    "toe": 0.050,      # matches "foot" — the same rigid segment
    "chin": 0.035, "jaw": 0.035,   # head, which does not accelerate like a limb
}
DEFAULT_ACCEL = 0.060


@dataclass
class PostConfig:
    conf_ok: float = 0.5
    bone_tol: float = 0.30        # allowed overshoot above a bone's p95 observed length
    swap_max_run: int = 5
    max_gap: int = 8              # the pose spec — ~130ms at 60fps
    #: How far a PLANNED gap may be bridged. Separate from `max_gap` because the two answer
    #: different questions: `max_gap` is "how long may the model have been blind before we stop
    #: guessing", and this is "how far apart did we CHOOSE to look". A planner that samples at
    #: 30 Hz on a 240 fps clip leaves 8-frame gaps by design, and refusing to fill them would
    #: turn a deliberate cadence into a hole in the artifact.
    propagate_max_gap: int = 64
    #: Per-frame confidence decay away from the nearest direct observation. 0.94 costs a
    #: propagated point ~18% of its confidence three frames out, which is where a 240 fps clip
    #: sampled at 60 Hz puts its worst case.
    propagate_decay: float = 0.94
    propagate_floor: float = 0.20
    grip_max_sep: float = 0.20    # wrist separation ceiling, fraction of golfer height
    min_cutoff: float = 1.0
    beta: float = 0.3
    savgol: bool = True
    savgol_window: int = 7
    savgol_order: int = 2


@dataclass
class PostReport:
    body_height: float = 0.0
    provisional: int = 0
    promoted: int = 0
    bone_rejects: int = 0
    grip_rejects: int = 0
    outlier_rejects: int = 0
    swaps: int = 0
    interpolated: int = 0
    propagated: int = 0
    still_missing: int = 0
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------- helpers

def _arrays(series):
    xy = np.array([[[p[0], p[1]] for p in fr["kp"][:N]] for fr in series.frames], float)
    conf = np.array([[p[2] for p in fr["kp"][:N]] for fr in series.frames], float)
    return xy, conf


def _accel_limit(name):
    for key, v in ACCEL_LIMIT.items():
        if key in name:
            return v
    return DEFAULT_ACCEL


def body_height(xy, status):
    """Median head-to-ankle distance — the scale every threshold is expressed against.

    Normalizing by the golfer's own pixel height (the pose spec) makes thresholds independent
    of camera distance, which matters because our two fixtures differ by 40% in subject size.
    """
    ears = [NAME_IDX["left_ear"], NAME_IDX["right_ear"]]
    ank = [NAME_IDX["left_ankle"], NAME_IDX["right_ankle"]]
    hs = []
    for f in range(xy.shape[0]):
        head = [xy[f, i, 1] for i in ears if status[f, i] >= PROVISIONAL]
        feet = [xy[f, i, 1] for i in ank if status[f, i] >= PROVISIONAL]
        if head and feet:
            hs.append(max(feet) - min(head))
    return float(np.median(hs)) if hs else 1.0


# ---------------------------------------------------------------- stages

def gate(conf, cfg, trust_hands=False):
    """Refinement 1: nothing is discarded on confidence alone; sub-threshold points are PROVISIONAL.

    `trust_hands` keeps the index/pinky/thumb slots. They are rejected outright for
    MediaPipe, which infers them from a body model that cannot see a closed fist, but a
    wholebody model measures those knuckles directly and they carry the grip's roll.
    """
    status = np.full(conf.shape, MISSING, np.int8)
    status[conf > 0.0] = PROVISIONAL
    status[conf >= cfg.conf_ok] = OK
    if not trust_hands:
        for name in UNRELIABLE:                   # hand landmarks, unusable on a grip
            status[:, NAME_IDX[name]] = MISSING
    return status


def fix_side_swaps(xy, conf, status, cfg, rep):
    """The pose spec — brief left/right inversions are a known detector glitch, not motion."""
    pairs = [(NAME_IDX[n], NAME_IDX["right_" + n[5:]])
             for n in TRACKED_NAMES if n.startswith("left_")
             and "right_" + n[5:] in NAME_IDX]
    for a, b in [(NAME_IDX["left_shoulder"], NAME_IDX["right_shoulder"]),
                 (NAME_IDX["left_hip"], NAME_IDX["right_hip"])]:
        ok = (status[:, a] >= PROVISIONAL) & (status[:, b] >= PROVISIONAL)
        if ok.sum() < 10:
            continue
        sign = np.sign(xy[:, a, 0] - xy[:, b, 0])
        majority = np.sign(np.median(sign[ok])) or 1.0

        f = 0
        while f < len(sign):
            if ok[f] and sign[f] == -majority:
                g = f
                while g < len(sign) and ok[g] and sign[g] == -majority:
                    g += 1
                if (g - f) <= cfg.swap_max_run:       # brief flip => glitch, swap it back
                    for i, j in pairs:
                        xy[f:g, [i, j]] = xy[f:g, [j, i]]
                        conf[f:g, [i, j]] = conf[f:g, [j, i]]
                        status[f:g, [i, j]] = status[f:g, [j, i]]
                    rep.swaps += g - f
                f = g
            else:
                f += 1
    return xy


def check_bones(xy, status, conf, cfg, rep):
    """Refinement 2 — flag only implausibly LONG bones; shortness is foreshortening, not error."""
    for a_name, b_name in CHECK_BONES:
        a, b = NAME_IDX[a_name], NAME_IDX[b_name]
        both = (status[:, a] >= PROVISIONAL) & (status[:, b] >= PROVISIONAL)
        if both.sum() < 10:
            continue
        d = np.linalg.norm(xy[:, a] - xy[:, b], axis=1)
        limit = np.percentile(d[both], 95) * (1.0 + cfg.bone_tol)
        bad = both & (d > limit)
        for f in np.flatnonzero(bad):
            # Drop whichever endpoint the model trusts less.
            j = a if conf[f, a] < conf[f, b] else b
            if status[f, j] != MISSING:
                status[f, j] = MISSING
                rep.bone_rejects += 1


def grip_prior(xy, conf, status, bh, cfg, rep, window=None):
    """Golf-specific prior: both hands are on the club, so the wrists travel together.

    Measured on the fixtures, confident wrists sit 0.03-0.13 of body height apart. A pair
    further apart than `grip_max_sep` means one is wrong — drop the less-confident one and
    let grip_center derive from the survivor, rather than averaging a good wrist with a bad
    one and poisoning the club-search anchor (the club-tracking spec's Layer B).
    """
    lw, rw = NAME_IDX["left_wrist"], NAME_IDX["right_wrist"]
    limit = cfg.grip_max_sep * bh
    both = (status[:, lw] >= PROVISIONAL) & (status[:, rw] >= PROVISIONAL)

    # The prior only holds while the golfer is actually gripping the club. Before address
    # and after the finish they may be standing with one hand off it, and separated wrists
    # there are correct — rejecting them would discard good data for no benefit.
    if window is not None:
        inside = np.zeros(len(status), bool)
        inside[max(0, window[0]):min(len(status), window[1] + 1)] = True
        both &= inside

    sep = np.linalg.norm(xy[:, lw] - xy[:, rw], axis=1)
    for f in np.flatnonzero(both & (sep > limit)):
        j = lw if conf[f, lw] < conf[f, rw] else rw
        status[f, j] = MISSING
        rep.grip_rejects += 1

    # A provisional wrist that agrees with a confident partner is corroborated, so promote
    # it — this is the check that rescues correctly-placed but low-confidence grips.
    # Confidence is raised alongside status: the third element of a keypoint is *our*
    # post-validation confidence, not the model's raw opinion, because that is what the UI
    # renders and what later stages act on. Leaving conf untouched here silently discards
    # the corroboration.
    agree = both & (sep <= limit)
    for j, other in ((lw, rw), (rw, lw)):
        promote = agree & (status[:, j] == PROVISIONAL) & (status[:, other] == OK)
        status[promote, j] = OK
        conf[promote, j] = np.maximum(conf[promote, j], 0.60)
        rep.promoted += int(promote.sum())


def promote_consistent(xy, conf, status, bh, rep, radius=4):
    """Refinement 1, general case: a provisional point that lands where confident neighbours predict.

    This is positive evidence, not merely absence of rejection — a spurious detection has no
    reason to fall on the trajectory interpolated between two confirmed observations. Only
    points bracketed by OK frames within `radius` are eligible, so isolated guesses in a long
    dropout stay unverified.
    """
    for j, name in enumerate(TRACKED_NAMES):
        ok_idx = np.flatnonzero(status[:, j] == OK)
        if len(ok_idx) < 4:
            continue
        lim = _accel_limit(name) * bh
        for f in np.flatnonzero(status[:, j] == PROVISIONAL):
            before = ok_idx[ok_idx < f]
            after = ok_idx[ok_idx > f]
            if not len(before) or not len(after):
                continue
            a, b = before[-1], after[0]
            if (f - a) > radius or (b - f) > radius:
                continue
            t = (f - a) / float(b - a)
            pred = xy[a, j] * (1 - t) + xy[b, j] * t
            if np.linalg.norm(xy[f, j] - pred) <= lim:
                status[f, j] = OK
                conf[f, j] = max(conf[f, j], 0.55)
                rep.promoted += 1


def reject_outliers(xy, status, bh, rep):
    """The pose spec — a point that cannot be reached from its neighbours is a detection error.

    Uses the second difference (acceleration) rather than raw velocity: fast joints are
    legitimate in a golf swing, but a joint that teleports away and back in one frame is not.
    """
    n = xy.shape[0]
    for j, name in enumerate(TRACKED_NAMES):
        lim = _accel_limit(name) * bh
        valid = status[:, j] >= PROVISIONAL
        for f in range(1, n - 1):
            if not (valid[f] and valid[f - 1] and valid[f + 1]):
                continue
            mid = (xy[f - 1, j] + xy[f + 1, j]) / 2.0
            if np.linalg.norm(xy[f, j] - mid) > lim:
                status[f, j] = MISSING
                rep.outlier_rejects += 1


def interpolate_gaps(xy, status, cfg, rep, planned=None):
    """The pose spec — cubic-spline fill for gaps <= max_gap; longer gaps stay honestly missing.

    `planned` is the boolean per-frame mask of frames the FRAME PLAN never asked anyone to look
    at. A gap made entirely of those is a cadence decision, not a detection failure, so it is
    bridged under `propagate_max_gap` instead of `max_gap` and labelled PROPAGATED. A gap that
    mixes the two is treated as a detection failure — the stricter of the two rules wins,
    because a model that failed inside a planned gap is exactly the case where guessing further
    is least justified.
    """
    n = xy.shape[0]
    for j in range(N):
        valid = status[:, j] >= PROVISIONAL
        if valid.sum() < 4:
            continue
        idx = np.flatnonzero(valid)
        f = 0
        while f < n:
            if valid[f]:
                f += 1
                continue
            g = f
            while g < n and not valid[g]:
                g += 1
            before = idx[idx < f]
            after = idx[idx >= g]
            unlooked = planned is not None and bool(planned[f:g].all())
            if unlooked:
                # LINEAR between the bracketing observations, not the cubic used for a
                # detection gap. Two reasons, and neither is laziness. A planned gap is
                # regular and short by construction, where the difference between a line and a
                # spline is below the noise floor of the measurement either side of it; and a
                # spline needs four support points per side, which a gap starting at frame 1
                # does not have — that limitation is invisible for a rare dropout and would
                # leave the opening frames of EVERY adaptive run empty. E2.2 compares
                # alternatives against labels later; a line is the honest first answer.
                if (g - f) <= cfg.propagate_max_gap and len(before) and len(after):
                    for ax in (0, 1):
                        xy[f:g, j, ax] = np.interp(np.arange(f, g), idx, xy[idx, j, ax])
                    status[f:g, j] = PROPAGATED
                    rep.propagated += g - f
            elif (g - f) <= cfg.max_gap and len(before) >= 2 and len(after) >= 2:
                # Fit locally: a global spline through the whole clip would ring.
                sup = np.concatenate([before[-4:], after[:4]])
                for ax in (0, 1):
                    cs = CubicSpline(sup, xy[sup, j, ax])
                    xy[f:g, j, ax] = cs(np.arange(f, g))
                status[f:g, j] = INTERP
                rep.interpolated += g - f
            f = g


def propagate_conf(conf, status, cfg):
    """Confidence for points nobody looked at — the bracketing observations, decayed by distance.

    Not a constant, and not the neighbour's value copied over. A propagated point two frames
    from a 0.9 observation is a far better bet than one two frames from a 0.4 one, and a point
    in the middle of a long planned gap is a worse bet than one adjacent to its anchor. Both
    facts are already in hand, so the number carries them: linear interpolation of the two
    bracketing confidences, multiplied by `decay ** distance-to-the-nearest-anchor`.

    The result is only ever LOWER than what a direct observation would have scored, which is the
    direction that matters: every consumer re-applies the same MIN_CONF gate, so a propagated
    point may drop out of a client's rendering, and must never be admitted to one on the
    strength of a guess.
    """
    n = conf.shape[0]
    out = np.zeros_like(conf)
    for j in range(N):
        prop = np.flatnonzero(status[:, j] == PROPAGATED)
        if not len(prop):
            continue
        anchors = np.flatnonzero((status[:, j] == OK) | (status[:, j] == PROVISIONAL))
        if not len(anchors):
            out[prop, j] = cfg.propagate_floor
            continue
        base = np.interp(prop, anchors, conf[anchors, j])
        dist = np.min(np.abs(prop[:, None] - anchors[None, :]), axis=1)
        out[prop, j] = np.maximum(base * (cfg.propagate_decay ** dist), cfg.propagate_floor)
    return out


def one_euro(x, fps, min_cutoff, beta):
    """One-Euro filter over a 1-D signal (Casiez et al.)."""
    out = np.empty_like(x)
    dx_hat = 0.0
    x_hat = x[0]
    out[0] = x_hat
    te = 1.0 / fps
    for i in range(1, len(x)):
        dx = (x[i] - x_hat) / te
        a_d = 1.0 / (1.0 + (fps / (2 * np.pi * 1.0)))
        dx_hat = a_d * dx + (1 - a_d) * dx_hat
        cutoff = min_cutoff + beta * abs(dx_hat)
        a = 1.0 / (1.0 + (fps / (2 * np.pi * cutoff)))
        x_hat = a * x[i] + (1 - a) * x_hat
        out[i] = x_hat
    return out


def smooth(xy, status, fps, cfg):
    """Refinement 3 — zero-phase One-Euro (forward+backward averaged), then optional Savitzky-Golay."""
    for j in range(N):
        present = status[:, j] >= PROVISIONAL
        if present.sum() < 5:
            continue
        runs = []
        f = 0
        while f < len(present):
            if present[f]:
                g = f
                while g < len(present) and present[g]:
                    g += 1
                runs.append((f, g))
                f = g
            else:
                f += 1
        for a, b in runs:
            if b - a < 5:
                continue
            for ax in (0, 1):
                seg = xy[a:b, j, ax]
                fwd = one_euro(seg, fps, cfg.min_cutoff, cfg.beta)
                bwd = one_euro(seg[::-1], fps, cfg.min_cutoff, cfg.beta)[::-1]
                sm = (fwd + bwd) / 2.0
                if cfg.savgol and (b - a) >= cfg.savgol_window:
                    w = cfg.savgol_window | 1
                    sm = savgol_filter(sm, w, cfg.savgol_order)
                xy[a:b, j, ax] = sm


# ---------------------------------------------------------------- entry point

def postprocess(series, cfg: PostConfig | None = None, window=None, trust_hands=False,
                propagated=None):
    """`propagated` — frame indices the frame plan never selected for direct inference.

    Empty (or None) is the dense case and every line below behaves exactly as it did before the
    planner existed, which is what makes `v0-dense` parity a property of the code rather than a
    thing to re-measure.
    """
    cfg = cfg or PostConfig()
    rep = PostReport()
    xy, conf = _arrays(series)
    n_f = xy.shape[0]
    planned = None
    if propagated is not None:
        idx = np.fromiter((f for f in propagated if 0 <= f < n_f), int)
        if len(idx):
            planned = np.zeros(n_f, bool)
            planned[idx] = True

    status = gate(conf, cfg, trust_hands)
    rep.provisional = int((status == PROVISIONAL).sum())

    bh = body_height(xy, status)
    rep.body_height = bh
    if bh <= 0.01:
        rep.notes.append("could not establish golfer height; thresholds unreliable")
        bh = 1.0

    fix_side_swaps(xy, conf, status, cfg, rep)
    check_bones(xy, status, conf, cfg, rep)
    grip_prior(xy, conf, status, bh, cfg, rep, window)
    reject_outliers(xy, status, bh, rep)
    promote_consistent(xy, conf, status, bh, rep)   # after rejection: never promote a reject
    interpolate_gaps(xy, status, cfg, rep, planned)
    pconf = propagate_conf(conf, status, cfg) if planned is not None else None
    smooth(xy, status, series.fps or 60.0, cfg)

    rep.still_missing = int((status == MISSING).sum())

    # Write back. Interpolated points carry a modest confidence so existing renderers dash
    # them; `st` preserves the exact provenance for the UI and for later stages.
    for f, fr in enumerate(series.frames):
        kp = []
        for j in range(N):
            st = status[f, j]
            if st == MISSING:
                kp.append([0.0, 0.0, 0.0])
            elif st == INTERP:
                kp.append([float(xy[f, j, 0]), float(xy[f, j, 1]), 0.45])
            elif st == PROPAGATED:
                kp.append([float(xy[f, j, 0]), float(xy[f, j, 1]),
                           float(pconf[f, j]) if pconf is not None else 0.45])
            else:
                kp.append([float(xy[f, j, 0]), float(xy[f, j, 1]), float(conf[f, j])])
        fr["kp"] = kp
        fr["st"] = [int(s) for s in status[f]]
        # `interp` has always meant "this frame's pose was not detected on this frame", which
        # is equally true of a propagated one — the client dims both. `st` is where the two are
        # told apart; this flag stays the cheap per-frame answer it has always been.
        fr["interp"] = bool(((status[f] == INTERP) | (status[f] == PROPAGATED)).any())

    return series, rep
