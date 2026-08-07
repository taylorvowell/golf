"""Global candidate-graph solve (test plan §10): one DP over the whole swing.

The core §3.4 inversion: a low-confidence candidate exactly where the trajectory wants to
go is worth more than a high-confidence detection parked on a shoe. Node cost comes from
detection confidence; transition cost from implied speed, direction change against the
predecessor's velocity, and skipped observations. Pure function — no I/O, no ctx.

Second-order terms are approximated Viterbi-style: each state remembers its best
predecessor, and the curvature penalty is computed against that predecessor's implied
velocity. Exact second-order DP would square the state space for accuracy this baseline
does not need (Test 10 is the full-physics treatment).
"""
from __future__ import annotations

import math

from .model import ClubCandidate

# Cost weights — visual-plausibility tuned on the fixtures, not truth-tuned (there is no
# automated truth by design). Speeds are normalized units/second.
#
# The one structural constraint: SKIP_PENALTY must exceed the node cost of any candidate
# worth visiting (W_NODE at conf 0), or the DP's cheapest "chain" is a single node — every
# visited observation adds positive cost, so coverage has to be what skipping forfeits.
W_NODE = 0.8            # weight of (1 - confidence). Deliberately low: §3.4 — detector
                        # confidence must not outrank trajectory coherence, or a confident
                        # decoy plus cheap skip edges beats a weak-but-coherent chain.
W_SPEED = 1.2           # per unit of speed beyond PLAUSIBLE_SPEED
W_DVEL = 0.35           # velocity-CHANGE penalty (plan §10's "velocity change" edge term).
                        # This is what kills decoy camping: teleport in, stop dead, and
                        # teleport out are three large Δv's, while a real swing's velocity
                        # evolves smoothly — a direction-only penalty gates off at v=0 and
                        # lets a parked decoy sit for free.
SKIP_PENALTY = 2.2      # per skipped observation (> W_NODE, see above)
PLAUSIBLE_SPEED = 16.0  # normalized units/s; ~90px/frame at 720p/60 is ~7.5 — soft gate
GRIP_BAND = (0.03, 0.62)  # plausible normalized grip->head distance
W_GRIP = 1.4            # penalty when outside the band


def _node_cost(c: ClubCandidate) -> float:
    cost = W_NODE * (1.0 - c.confidence)
    gd = c.features.get("grip_distance")
    if gd is not None:
        lo, hi = GRIP_BAND
        if gd < lo:
            cost += W_GRIP * (lo - gd) / lo
        elif gd > hi:
            cost += W_GRIP * (gd - hi) / hi
    return cost


def solve(cands_by_obs: list[list[ClubCandidate]], times: list[float],
          max_skip: int = 12) -> list[tuple[int, ClubCandidate]]:
    """Min-cost chain through per-observation candidate lists.

    `cands_by_obs[i]` are the candidates at observation i (time `times[i]`); empty lists
    are allowed and simply skipped. Returns [(obs_index, candidate), ...] in time order.
    """
    n = len(cands_by_obs)
    if n == 0:
        return []

    # state: (obs i, cand k) -> best cost, predecessor, implied velocity
    INF = float("inf")
    cost: list[list[float]] = [[INF] * len(c) for c in cands_by_obs]
    pred: list[list[tuple[int, int] | None]] = [[None] * len(c) for c in cands_by_obs]
    vel: list[list[tuple[float, float]]] = [[(0.0, 0.0)] * len(c) for c in cands_by_obs]

    # Starting at observation i means every earlier observation was skipped.
    for i in range(n):
        for k, c in enumerate(cands_by_obs[i]):
            cost[i][k] = _node_cost(c) + i * SKIP_PENALTY

    for j in range(n):
        for kj, cj in enumerate(cands_by_obs[j]):
            for i in range(max(0, j - max_skip), j):
                if not cands_by_obs[i]:
                    continue
                dt = max(times[j] - times[i], 1e-6)
                for ki, ci in enumerate(cands_by_obs[i]):
                    if cost[i][ki] == INF:
                        continue
                    dx, dy = cj.x - ci.x, cj.y - ci.y
                    speed = math.hypot(dx, dy) / dt
                    trans = SKIP_PENALTY * (j - i - 1)
                    if speed > PLAUSIBLE_SPEED:
                        trans += W_SPEED * (speed - PLAUSIBLE_SPEED)
                    vx, vy = vel[i][ki]
                    if pred[i][ki] is not None:  # a start state has no velocity yet
                        trans += W_DVEL * math.hypot(dx / dt - vx, dy / dt - vy)
                    total = cost[i][ki] + trans + _node_cost(cj)
                    if total < cost[j][kj]:
                        cost[j][kj] = total
                        pred[j][kj] = (i, ki)
                        vel[j][kj] = (dx / dt, dy / dt)

    # Best terminal state, preferring chains that reach near the end.
    best: tuple[int, int] | None = None
    best_score = INF
    for i in range(n):
        for k in range(len(cands_by_obs[i])):
            if cost[i][k] == INF:
                continue
            score = cost[i][k] + (n - 1 - i) * SKIP_PENALTY
            if score < best_score:
                best_score = score
                best = (i, k)
    if best is None:
        return []

    chain: list[tuple[int, ClubCandidate]] = []
    cur: tuple[int, int] | None = best
    while cur is not None:
        i, k = cur
        chain.append((i, cands_by_obs[i][k]))
        cur = pred[i][k]
    chain.reverse()
    return chain
