"""Candidate-Viterbi club-head path — a global solve over detector candidates.

The 2026-08-19 tracking brainstorm's "use existing detections smarter" family, in one
refinement: instead of accepting/rejecting each frame's detection locally (confidence floors,
Hampel gates — both LOCAL decisions), pose the whole swing as one shortest-path problem over
every candidate the detector offered and pick the single smoothest, most-confident path.

Three of the brainstormed ideas land here together:

* **Grip-anchored polar space.** Candidates are scored as (angle, radius) around the hands —
  which pose tracks reliably — so "the head jumped across the body" is not an outlier to catch
  but a transition whose angular velocity prices it out of the optimum.
* **Global path (Viterbi).** Dynamic programming over frames-with-candidates, with bounded
  skipping: a glitch frame is simply not on the cheapest path. A greedy filter cannot do this —
  it has already committed by the time the glitch is obvious.
* **Anchored ends.** Address and impact are where detection is most reliable, so candidates
  near the base solve's answer at those frames get a bonus — the path is pulled taut between
  the two ends it is most sure of, and the top of the swing becomes a middle, not a frontier.

Frames the path skips are filled by interpolating IN POLAR SPACE between chosen neighbours —
the "fill gaps from trajectory" ask — and are marked `interp` so measured-only traces still
exclude them: the fill is a trajectory estimate, never a detection.

Known limit, stated: angular steps across a gap are resolved to the smaller arc, so a gap in
which the club really swept more than ~180 degrees would fold. At 60fps CFR that is several
consecutive missing frames at peak speed — the skip cost already fights choosing such a path.

Consumes an existing solve (for grips, butts, calibration and out-of-window frames) and the
raw detector output; produces the same `ClubResult` shape every other variant emits. Pure
post-processing: nothing here re-reads video.
"""

from __future__ import annotations

import copy

import numpy as np

from .club import ClubConfig, ClubResult, _build_trace, smooth_trace


def _wrap180(a: float) -> float:
    """Signed smallest equivalent angle difference, degrees."""
    return (a + 180.0) % 360.0 - 180.0


def viterbi_refine(
    base: ClubResult,
    det,
    ev,
    n_frames: int,
    cfg: ClubConfig,
    *,
    min_conf: float = 0.10,
    max_step_deg: float = 45.0,
    k_back: int = 8,
    skip_cost: float = 0.8,
) -> ClubResult:
    """The Viterbi path over detector head candidates, as a new ClubResult.

    `min_conf` is deliberately LOW: the whole point is that path consistency, not a confidence
    floor, decides which detections survive — the same bet `model_traj` made, taken globally.
    """
    res = copy.deepcopy(base)
    w, h = res.width, res.height
    e = ev["events"]
    a_f = e["address"]["frame"]
    i_f = e["impact"]["frame"]
    fin_f = min(n_frames - 1, e["finish"]["frame"])

    lens = [fr.length for fr in res.frames if fr.length]
    if not lens or w <= 0 or h <= 0:
        res.notes.append("viterbi: no calibrated club length on the base solve; left unchanged")
        return res
    club_px = float(np.median(lens))

    # --- candidate steps: frames in the window with a grip and at least one plausible head ---
    steps: list[tuple[int, np.ndarray, list[tuple[np.ndarray, float, float, float]]]] = []
    for f in range(a_f, fin_f + 1):
        fr = res.frames[f]
        if fr.grip_px is None:
            continue
        gp = np.asarray(fr.grip_px, dtype=float)
        cands = []
        for d in det.heads(f):
            if d.conf < min_conf:
                continue
            p = np.asarray(d.xy, dtype=float)
            v = p - gp
            r = float(np.hypot(v[0], v[1]))
            # A head detection nowhere near a club's reach off the hands is a false positive
            # regardless of confidence — the grip anchor makes that a geometric statement.
            if not (club_px * 0.35 <= r <= club_px * 1.9):
                continue
            th = float(np.degrees(np.arctan2(v[1], v[0])))
            cands.append((p, r, th, float(d.conf)))
        if cands:
            steps.append((f, gp, cands))

    if len(steps) < 6:
        res.notes.append(f"viterbi: only {len(steps)} candidate frames in the window; left unchanged")
        return res

    # --- emission: confidence + club-length agreement + anchor pull at the sure ends ---------
    anchors = {}
    for af in (a_f, i_f):
        bh = res.frames[af].head if 0 <= af < len(res.frames) else None
        if bh and not any(np.isnan(bh)):
            anchors[af] = np.array([bh[0] * w, bh[1] * h])

    def emission(f: int, p: np.ndarray, r: float, conf: float) -> float:
        c = 1.4 * (1.0 - conf) + 1.8 * abs(r - club_px) / club_px
        for af, ap in anchors.items():
            if abs(f - af) <= 2:
                c += min(2.0, float(np.hypot(*(p - ap))) / max(1.0, club_px * 0.5))
        return c

    # --- the DP: edges reach up to k_back steps back, priced per skipped candidate frame -----
    INF = float("inf")
    cost: list[list[float]] = []
    back: list[list[tuple[int, int] | None]] = []
    for j, (fj, _gpj, cj) in enumerate(steps):
        cost.append([INF] * len(cj))
        back.append([None] * len(cj))
        for jc, (p, r, th, conf) in enumerate(cj):
            ec = emission(fj, p, r, conf)
            if j == 0:
                cost[j][jc] = ec
                continue
            best, arg = INF, None
            for i in range(max(0, j - k_back), j):
                fi, _gpi, ci = steps[i]
                gap = fj - fi
                for ic, (_p0, r0, th0, _c0) in enumerate(ci):
                    prev = cost[i][ic]
                    if prev >= INF:
                        continue
                    rate = abs(_wrap180(th - th0)) / gap
                    tc = (rate / max_step_deg) ** 2
                    tc += 0.6 * abs(r - r0) / club_px
                    tc += skip_cost * (j - i - 1)
                    if prev + tc < best:
                        best, arg = prev + tc, (i, ic)
            if arg is not None:
                cost[j][jc] = best + ec
                back[j][jc] = arg

    # Terminate on the cheapest reachable candidate near the end, then walk back.
    endj, endc, bestend = None, None, INF
    for j in range(len(steps) - 1, max(-1, len(steps) - 4), -1):
        for jc, c in enumerate(cost[j]):
            if c < bestend:
                endj, endc, bestend = j, jc, c
    if endj is None:
        res.notes.append("viterbi: no reachable path; left unchanged")
        return res

    chosen: dict[int, tuple[np.ndarray, float, float, float]] = {}
    j, jc = endj, endc
    while True:
        f, _gp, cj = steps[j]
        chosen[f] = cj[jc]
        nxt = back[j][jc]
        if nxt is None:
            break
        j, jc = nxt

    # --- apply: chosen frames become detector-provenance heads; gaps fill in polar space -----
    order = sorted(chosen)
    ths = np.unwrap(np.radians([chosen[f][2] for f in order]))
    rs = np.array([chosen[f][1] for f in order], dtype=float)
    fs = np.array(order, dtype=float)

    kept, filled = 0, 0
    for f in range(a_f, fin_f + 1):
        fr = res.frames[f]
        if f in chosen:
            p, r, th, conf = chosen[f]
            fr.head = [float(p[0] / w), float(p[1] / h)]
            fr.conf = max(fr.conf, conf)
            fr.from_model = True
            fr.interp = False
            fr.length = r
            fr.angle = th
            if fr.butt:
                fr.shaft = [fr.butt, fr.head]
            kept += 1
            continue
        if fr.grip_px is None or f < order[0] or f > order[-1]:
            continue
        # Trajectory fill: interpolate angle (unwrapped) and radius between chosen neighbours,
        # around THIS frame's own grip. Marked interp — an estimate must never pass for a
        # detection, so measured-only traces still exclude it.
        th_i = float(np.interp(f, fs, ths))
        r_i = float(np.interp(f, fs, rs))
        gp = np.asarray(fr.grip_px, dtype=float)
        p = gp + np.array([np.cos(th_i), np.sin(th_i)]) * r_i
        fr.head = [float(p[0] / w), float(p[1] / h)]
        fr.conf = min(fr.conf, 0.25)
        fr.from_model = False
        fr.interp = True
        fr.length = r_i
        fr.angle = float(np.degrees(th_i))
        if fr.butt:
            fr.shaft = [fr.butt, fr.head]
        filled += 1

    total_cands = sum(len(c) for _f, _g, c in steps)
    res.notes.append(
        f"viterbi: kept {kept} of {total_cands} candidates across {len(steps)} frames, "
        f"filled {filled} gap frames in polar space"
    )

    # Rebuild the polylines from the new heads; the per-frame club above is already final.
    _build_trace(res, ev, n_frames, cfg)
    smooth_trace(res, ev, n_frames, cfg)
    return res
