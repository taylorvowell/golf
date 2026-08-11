"""Stage 8 — the deterministic scoring engine (the scoring spec's Part C1).

Reads `scoring_config/<version>.json` (never a hardcoded threshold — CLAUDE.md's non-negotiable)
plus this swing's own `metrics.checkpoints` / `metrics.summary` / `metrics.glossary` /
`tempo`, and produces a scorecard: a 0-100 per check, aggregated into category scores and into
the ten-checkpoint (P1-P10) rail the player already renders, plus a deterministic narrative
(no AI — CLAUDE.md: "AI is an enhancement, never a hard dependency for a swing reaching
`ready`"). Writes `coach_report.json` next to `analysis.json` (the architecture spec's data model already
names this file; this closes the gap).

Every check's evaluation follows the scoring spec's Part C1 exactly:
  1. **Distance-from-band, soft falloff** — 100 inside the band, decaying linearly to 0 over
     `falloff` units past the nearer edge. Not a hard pass/fail: a value 1 degree outside a
     band should not read the same as one 20 degrees outside it.
  2. **Confidence gating** — a check with an untracked field, or a checkpoint whose own
     detection confidence is below its `min_checkpoint_conf`, is *skipped*, not scored 0.
     Category weights renormalize over what was actually measurable, and the category result
     says "n of m checks measurable" (the scoring spec's literal phrasing) rather than hiding the gap.
  3. **Club/view gating** — a check scoped to `driver`/`irons` is skipped when the swing's club
     type is unknown or doesn't match; a check scoped to one camera view is skipped in the
     other, the same pattern `missingCapabilities()` in the web app already uses.

Every score also carries `scoring_config["version"]` (`scoring_model_version` once stored),
so old reports stay reproducible even after the config changes (CLAUDE.md's non-negotiable).
"""
from __future__ import annotations

import json
from pathlib import Path

from swingsage import contract

CONFIG_DIR = Path(__file__).resolve().parent.parent / "scoring_config"
# `checkpoints.py`'s own ordering-violation clamp caps a suspect frame's confidence at exactly
# 0.35 (the same value as metrics.py's MIN_CONF) — that is this codebase's established "no
# longer reliable" floor, not 0.5. Both fixtures read the Top checkpoint at exactly 0.35 on
# the frozen test snapshot, which is event-timing uncertainty (the scoring spec's known-open item, not
# a scoring.py bug) — gating at 0.5 would silently exclude every backswing-top check on every
# swing. Set just below the floor so a checkpoint AT it still scores, and only genuinely
# lower (ordering-violation-clamped or worse) confidence gets skipped.
DEFAULT_MIN_CHECKPOINT_CONF = 0.3

# The web side reads these back off `coach_report.json` via `lib/scoreDisplay.ts` rather than
# keeping a second copy of the cutoffs (the old `lib/mockScoring.ts` that mirrored them is
# deleted). This stays the single definition.
BANDS = [(90, "Elite"), (75, "Pure"), (60, "Solid"), (40, "Building"), (0, "Reset")]


def score_band(score: float) -> str:
    for lo, name in BANDS:
        if score >= lo:
            return name
    return BANDS[-1][1]


def load_config(version: str = "v2") -> dict:
    return json.loads((CONFIG_DIR / f"{version}.json").read_text(encoding="utf-8"))


def _get_value(check: dict, checkpoints_by_p: dict, summary: dict, glossary: dict, tempo: dict):
    """Returns (value, checkpoint_conf). `checkpoint_conf` is None for non-checkpoint sources —
    those have no per-frame detection confidence of their own to gate on."""
    source, field = check["source"], check["field"]
    if source == "checkpoint":
        cp = checkpoints_by_p.get(check["checkpoint"])
        if cp is None:
            return None, None
        return cp["values"].get(field), cp.get("conf")
    if source == "checkpoint_delta":
        # The CHANGE in one field between two checkpoints — how much a golfer added or lost,
        # not where they ended up. Several criteria.md rows are phrased this way ("near the
        # address value", "retained vs address") and reading them as absolutes is what made
        # TKA-01 unscoreable in v1: the same physical position is a different absolute angle
        # for every golfer's setup, but the delta is comparable across them.
        #
        # Gated on the WEAKER of the two checkpoints' confidence, because a delta is only as
        # trustworthy as its shakier end — a confident P2 read against a guessed P1 is a
        # guessed number.
        cp = checkpoints_by_p.get(check["checkpoint"])
        ref = checkpoints_by_p.get(check.get("ref_checkpoint"))
        if cp is None or ref is None:
            return None, None
        v, rv = cp["values"].get(field), ref["values"].get(field)
        if v is None or rv is None:
            return None, min(cp.get("conf", 0.0), ref.get("conf", 0.0))
        return round(v - rv, 1), min(cp.get("conf", 0.0), ref.get("conf", 0.0))
    if source == "summary":
        return summary.get(field), None
    if source == "glossary":
        return glossary.get(field), None
    if source == "tempo":
        return (tempo or {}).get(field), None
    return None, None


# The slowest real golf backswings sit near 1.5s; `events.detect`'s own plausibility window
# tops out at 1300ms. 2000ms is set well clear of both so an unusually slow-but-real swing is
# still scored and only a genuinely wrong timebase trips it. Deliberately a one-sided test on
# the backswing: a slow-motion clip inflates every duration together, whereas a rushed or
# dragged real swing shows up in one phase, so the long end of the LONGER phase is the cleanest
# separator available without a playback-rate signal from the container (there isn't one —
# `perfect.mp4` reports an ordinary 30fps and the slow motion is baked into the pixels).
SLOW_MOTION_BACKSWING_MS = 2000


def _is_slow_motion(tempo: dict | None) -> bool:
    ms = (tempo or {}).get("backswing_ms")
    return ms is not None and ms > SLOW_MOTION_BACKSWING_MS


def _band_score(value: float, band: dict, abs_value: bool) -> float:
    v = abs(value) if abs_value else value
    lo, hi, falloff = band["min"], band["max"], band["falloff"]
    if lo <= v <= hi:
        return 100.0
    d = (lo - v) if v < lo else (v - hi)
    return max(0.0, 100.0 * (1.0 - d / falloff))


def score_check(check: dict, checkpoints_by_p: dict, summary: dict, glossary: dict,
                tempo: dict, view: str, club_type: str | None) -> dict:
    """One check's full evaluation. `score` is None (with `skip_reason` set) when the check
    could not be measured on this swing — never silently 0."""
    result = {
        "id": check["id"], "label": check["label"], "category": check["category"],
        "weight": check["weight"], "fix": check["fix"], "unit": check.get("unit"),
        "checkpoint": check.get("checkpoint"), "field": check["field"],
        "value": None, "score": None, "skip_reason": None,
        # Plain-language, DIRECTIONAL "what to do differently" — filled in below once the
        # score exists and we know which side of the band (if any) the value missed on. Never
        # the technical `label` — that stays available for Advanced/debugging.
        "advice": None,
        # The Leverage Score (see `_leverage` below) and what it's made of, so the UI's info
        # tooltip can show the actual blend rather than asserting a number.
        "leverage": None, "leverage_breakdown": None, "effort": check.get("effort", 3),
        # What "good" means for this check, so a consumer can answer "why this score" without
        # re-deriving it from scoring_config.json — the target range for a band check, or the
        # accepted values for a categorical one. Not present at all until now; the UI could
        # show a score but never the number it was measured against.
        "kind": check["kind"],
        "band": check.get("band") if check["kind"] == "band" else None,
        "abs_value": check.get("abs_value", False),
        "good_values": check.get("good_values") if check["kind"] == "categorical" else None,
        # True when this check is authored but permanently abstaining on every swing, as
        # opposed to skipped for something about THIS swing (wrong club, low confidence). The
        # two look identical in `skip_reason` alone and mean opposite things to a consumer:
        # "we can't score this yet, for anyone" vs "your clip didn't support it".
        "deferred": bool(check.get("deferred")),
    }

    # Deferred first, ahead of every other gate: a check that cannot be measured honestly must
    # abstain regardless of whether this swing happens to have the data. Reporting "not tracked
    # on this swing" for a check that is broken for ALL swings would send the reader looking at
    # their video quality for a problem that is ours.
    if check.get("deferred"):
        result["skip_reason"] = check["deferred"]
        return result

    if check["club"] != "both":
        if not club_type:
            result["skip_reason"] = "club type not recorded for this swing"
            return result
        if check["club"] != club_type:
            result["skip_reason"] = f"scored for {check['club']}, this swing is {club_type}"
            return result
    if check["view"] != "both" and check["view"] != view:
        result["skip_reason"] = f"requires {check['view']} view, this swing is {view}"
        return result

    # Absolute durations in milliseconds only mean anything if the clip runs at real speed.
    # `perfect` does not — it is slow-motion footage, and v1 scored its 3.27s backswing and
    # 1.97s downswing 0, which is a fact about the camera rather than the swing.
    #
    # Deliberately NOT gated on `tempo.implausible`, even though that flag exists and fires
    # here: it also fires for a genuinely slow or rushed golfer, so gating on it would skip
    # these two checks exactly when they have something to say. swing2 is the case that proves
    # it — its tempo is flagged (483ms downswing, 1.55:1 ratio) but its 750ms backswing is
    # ordinary, so its downswing really is too slow and should be scored, not excused.
    #
    # `_is_slow_motion` separates the two: a backswing beyond any human duration means the
    # timebase is wrong, not the golfer. The tempo RATIO survives either way because it is
    # scale-invariant, which is why SEQ-02 is deliberately not gated at all.
    if check.get("requires_plausible_tempo") and _is_slow_motion(tempo):
        result["skip_reason"] = (
            f"absolute durations not scoreable — a {(tempo or {}).get('backswing_ms')}ms "
            f"backswing is beyond any real swing, so this clip is slow-motion footage and its "
            f"millisecond durations are not real time. The tempo ratio is still scored")
        return result

    value, cp_conf = _get_value(check, checkpoints_by_p, summary, glossary, tempo)
    if value is None:
        result["skip_reason"] = "not tracked on this swing (low pose/club confidence or missing data)"
        return result
    result["value"] = value

    configured_min_conf = check.get("min_checkpoint_conf")
    min_conf = DEFAULT_MIN_CHECKPOINT_CONF if configured_min_conf is None else configured_min_conf
    if cp_conf is not None and cp_conf < min_conf:
        result["skip_reason"] = f"checkpoint confidence {cp_conf:.2f} below {min_conf:.2f}"
        return result

    guard_field = check.get("guard_field")
    if guard_field and check["source"] in ("checkpoint", "checkpoint_delta"):
        guard_val = checkpoints_by_p.get(check["checkpoint"], {}).get("values", {}).get(guard_field)
        guard_min = check.get("guard_min", 0)
        if guard_val is not None and guard_val < guard_min:
            result["skip_reason"] = (
                f"{guard_field}={guard_val:.2f} below {guard_min} — the limb is too foreshortened "
                f"in this view for a 2D angle to be trustworthy here (see metrics.py's "
                f"*_arm_in_plane guard)")
            return result

    if check["kind"] == "band":
        b, abs_value = check["band"], check.get("abs_value", False)
        result["score"] = round(_band_score(value, b, abs_value), 1)
        v = abs(value) if abs_value else value
        if v < b["min"]:
            result["advice"] = check.get("advice_under")
        elif v > b["max"]:
            result["advice"] = check.get("advice_over")
        # else: in band, nothing to fix — advice stays None.
    else:
        good = value in check["good_values"]
        result["score"] = 100.0 if good else 40.0
        if not good:
            result["advice"] = check.get("advice")

    result["leverage"], result["leverage_breakdown"] = _leverage(result["score"], check)
    return result


def _leverage(score: float, check: dict) -> tuple[float, dict]:
    """The Leverage Score — SwingSage's own blend of "is this worth fixing right now",
    equal parts:
      severity  how far off the target this swing measured (100 - score)
      impact    how much this check matters to strike quality/distance/accuracy —
                literally `criteria.md`'s own causal weight column, already 1-100
      ease      how quick a fix this is to make, from the authored 1 (quick conscious
                adjustment) .. 5 (deep pattern change) `effort` rating in build_v1.py,
                inverted onto the same 0-100 scale so a bigger number always means "more
                worth doing"
    A simple, disclosed equal-thirds average on purpose — not a tuned or hidden formula. The
    UI's info tooltip renders this same breakdown, so "why is this ranked first" is always a
    real answer, not marketing copy.
    """
    severity = round(100.0 - score, 1)
    impact = float(check["weight"])
    ease = round((6 - check.get("effort", 3)) * 20, 1)
    leverage = round((severity + impact + ease) / 3, 1)
    return leverage, {"severity": severity, "impact": impact, "ease": ease}


def _category_result(cat: str, checks: list[dict]) -> dict:
    items = [c for c in checks if c["category"] == cat]
    deferred = [c for c in items if c["deferred"]]
    measurable = [c for c in items if c["score"] is not None]
    total_w = sum(c["weight"] for c in measurable)
    score = round(sum(c["score"] * c["weight"] for c in measurable) / total_w, 1) if total_w else None
    return {
        "category": cat, "score": score,
        # `n_total` counts only checks this config is actually TRYING to score, so the scoring spec's
        # "n of m checks measurable" reads as coverage of a real target. Deferred checks are
        # reported separately — folding them into m made `takeaway` claim "2 of 2 measurable"
        # while both of its checks were structurally broken, i.e. full confidence in a 0.0.
        "n_measurable": len(measurable), "n_total": len(items) - len(deferred),
        "n_deferred": len(deferred),
        "checks": items,
    }


def _checkpoint_rail(checkpoint_items: list[dict], checks: list[dict]) -> dict:
    """Per-P1-P10 composite score — the mean of whatever checks are anchored at that frame,
    weighted the same way categories are. Satisfies the existing UI contract
    (`MockScorecard.checkpoints: Record<string, CheckpointScore>`) without any player change."""
    rail = {}
    for item in checkpoint_items:
        p = item["p"]
        at_p = [c for c in checks if c["checkpoint"] == p and c["score"] is not None]
        if not at_p:
            continue
        w = sum(c["weight"] for c in at_p)
        rail[p] = {
            "p": p, "label": item["label"],
            "score": round(sum(c["score"] * c["weight"] for c in at_p) / w, 1),
            "n_measurable": len(at_p),
        }
    return rail


def _narrative(checks: list[dict]) -> dict:
    """Deterministic — never AI. Built directly from the weakest measured checks and their own
    directional `advice` (see `score_check`), not a canned pool, ranked by Leverage rather than
    raw score — the single highest-Leverage check is the one this swing most rewards fixing,
    not just the one that happened to measure worst. The AI-provider spec's real `AIProvider` narrative is a
    later, separate phase (see the plan's "Explicitly out of scope"); this dict's shape is
    stable so that swap changes nothing downstream.
    """
    measurable = [c for c in checks if c["score"] is not None]
    ranked = sorted(measurable, key=lambda c: c["leverage"], reverse=True)
    actionable = [c for c in ranked if c["advice"]]  # excludes checks already in-band

    findings = []
    for c in sorted([c for c in measurable if c["score"] < 70],
                    key=lambda c: c["weight"], reverse=True)[:4]:
        findings.append({"tone": "negative", "icon": "↓",
                         "title": c["label"], "detail": c["category"]})
    for c in sorted([c for c in measurable if c["score"] >= 80],
                    key=lambda c: c["weight"], reverse=True)[:4]:
        findings.append({"tone": "positive", "icon": "✓",
                         "title": c["label"], "detail": c["category"]})

    priorities = [
        {"key": c["id"], "checkpoint": c["checkpoint"], "label": c["label"],
         "score": c["score"], "leverage": c["leverage"], "cue": c["advice"]}
        for c in actionable[:3]
    ]

    if actionable:
        worst = actionable[0]
        primary = {
            "id": worst["id"], "checkpoint": worst["checkpoint"],
            "title": worst["advice"],
            "copy": worst["fix"],
            "moment": worst["category"],
            "score": worst["score"],
            "leverage": worst["leverage"],
        }
        drill = {
            "title": f"{worst['label']} drill",
            "copy": worst["fix"],
            "dose": "3 x 5",
            "doseNote": "Three sets of five slow rehearsals, then apply the feel to a few "
                        "full swings.",
        }
    else:
        primary = {"id": None, "checkpoint": None, "title": "Not enough measured this swing.",
                   "copy": "", "moment": "", "score": 0, "leverage": 0}
        drill = {"title": "", "copy": "", "dose": "", "doseNote": ""}

    return {"findings": findings, "priorities": priorities, "primary": primary, "drill": drill}


def compute(config: dict, checkpoint_items: list[dict], summary: dict, glossary: dict,
           tempo: dict, view: str, club_type: str | None = None) -> dict:
    """The full scorecard for one swing. `checkpoint_items` is `metrics.checkpoints`
    (`analysis.json.metrics.checkpoints`); `summary`/`glossary` are `metrics.summary` /
    `metrics.glossary`; `tempo` is the top-level `analysis.json.tempo` (not under `metrics`).
    """
    checkpoints_by_p = {c["p"]: c for c in checkpoint_items}
    checks = [
        score_check(c, checkpoints_by_p, summary, glossary, tempo, view, club_type)
        for c in config["checks"]
    ]

    categories = {cat: _category_result(cat, checks) for cat in config["categories"]}

    # Overall is weighted over the individual measured CHECKS, not an unweighted mean of the
    # seven category scores. The mean-of-categories form let a category carrying two checks
    # move the headline number as much as one carrying eight, so a single broken check in a
    # thin category (v1's `takeaway`, both of whose checks were unscoreable) swung the total by
    # ~14 points on its own. Weighting by check makes a category's influence proportional to
    # how much of the swing it actually measures, and it degrades cleanly as checks are
    # deferred or skipped rather than leaving a hole worth 1/7th of the score.
    scored = [c for c in checks if c["score"] is not None]
    total_w = sum(c["weight"] for c in scored)
    overall = round(sum(c["score"] * c["weight"] for c in scored) / total_w, 1) \
        if total_w else None

    checkpoints_rail = _checkpoint_rail(checkpoint_items, checks)
    narrative = _narrative(checks)

    return {
        "scoring_model_version": config["version"],
        "club_type": club_type,
        "view": view,
        "overall": overall,
        # How much of the config actually produced a number for this swing, split by WHY the
        # rest did not. Without this the headline score is unfalsifiable — v1 reported 37.5
        # with no way for a reader to tell that nine of its checks were abstaining-by-bug.
        "coverage": {
            "scored": len(scored),
            "skipped_this_swing": len([c for c in checks
                                       if c["score"] is None and not c["deferred"]]),
            "deferred_in_config": len([c for c in checks if c["deferred"]]),
            "total_checks": len(checks),
        },
        "band": score_band(overall) if overall is not None else None,
        "arc_shift": None,  # no deterministic basis for this yet — see COVERAGE.md
        "categories": categories,
        "checkpoints": checkpoints_rail,
        **narrative,
    }


def write_coach_report(out_dir: Path, config: dict, checkpoint_items: list[dict],
                       summary: dict, glossary: dict, tempo: dict, view: str,
                       club_type: str | None = None) -> dict:
    report = compute(config, checkpoint_items, summary, glossary, tempo, view, club_type)
    # Validated against packages/schema before it lands, the same as analysis.json. A scorecard
    # is what a golfer is shown and what `db/scores.ts` denormalizes onto the swing row; a
    # malformed one is a wrong number on a screen, not merely a bad file.
    contract.write_json("coach-report", report, out_dir / "coach_report.json", indent=2)
    return report
