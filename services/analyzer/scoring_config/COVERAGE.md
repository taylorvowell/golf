# scoring_config/v2.json coverage

`build_config.py` wires **38 checks** across all 7 scoring categories, generated from the rows
of `scoring_config/criteria.md` that the pipeline can actually measure today. This is a
deliberate first cut, not the full ~160 measurable rows — named here rather than silently
short of it, per CLAUDE.md's principle: name what's deferred, don't silently carry debt.

**Of those 38, only 28 are scored — 10 are `deferred` in the config and abstain on every
swing.** That distinction is the whole point of v2 and is explained below. `v1.json` stays on
disk, frozen, so reports stamped `v1` remain reproducible; it should not be used for new runs.

## What changed in v2, and why

v1 *ran* — it produced a `coach_report.json` with 33 scored checks per swing — but 10 of those
checks could not return a correct value for any swing, and all of them failed toward 0. The
symptom was that the `perfect` fixture scored **37.5 (Reset)**, below the amateur `swing1` at
45.0, with `takeaway` and `follow_through_balance` both reporting a confident **0.0**.

| | perfect | swing1 | swing2 |
|---|---|---|---|
| v1 overall | 37.5 Reset | 45.0 Building | 37.5 Reset |
| v2 overall | **78.9 Pure** | **65.4 Solid** | **54.2 Building** |
| checks scored | 21/38 | 23/38 | 22/38 |

The four defects:

1. **The rotation family (9 checks) was inverted and on the wrong scale.**
   `{shoulder,hip}_facing_est` is `arccos(width / this clip's widest projected width)` — degrees
   away from the widest projection, not degrees of turn. Down the line the shoulders start near
   edge-on and *widen* into the backswing, so `*_turn_from_address` is **negative** across the
   whole backswing (−41.1 / −41.8 / −36.7 against a `[75,105]` band). Fixing the sign is not
   sufficient: `arccos` is even so the estimate is V-shaped through square and cannot tell open
   from closed, and the projection under-reads true turn by roughly half (~41° recovered where
   the real figure is ~90°). Deferred until a turn estimate that is genuinely in degrees exists.
   **ROT-06 is included** even though it scored 100/100/94.5 — those were the V-shape landing
   in-band by luck, not correctness, which is exactly why coverage numbers can't be trusted as
   evidence of a working check.
2. **ANG-30 measured checkpoint detection, not the swing.** `shaft_from_vertical` at P2 is ~±90°
   *by definition* (P2 is where the shaft reaches parallel), so a `[−35,35]` band scored 0 on
   all three. True shaft plane isn't observable down the line — `metrics.py` reports
   `shaft_plane` as `"in-plane angle (lean not visible)"` for dtl. Deferred.
3. **TKA-01 was banded on the wrong quantity.** `lead_wrist_hinge` runs 13–35° at address and
   85–143° at P2; the band was `[150,180]`. **Fixed, not deferred** — it is now a
   `checkpoint_delta` against P1, which is what the check's own label ("near address value")
   always described. The band is authored from the coaching definition, the same editorial basis
   as every other band here, not fitted to the fixtures.
4. **Slow-motion clips scored 0 on absolute durations.** `perfect` is slow-motion footage
   (3.27s backswing) and SEQ-03/SEQ-04 scored it 0 — a fact about the camera, not the swing.
   **Fixed** with a one-sided backswing-duration test (`scoring.py::_is_slow_motion`).
   Deliberately *not* gated on `tempo.implausible`, which also fires for a genuinely slow
   golfer: swing2 is flagged implausible but its 750ms backswing is ordinary, so its slow
   downswing is a real fault and is still scored.

Two aggregation fixes came with it: `overall` is now weighted over the individual measured
checks rather than an unweighted mean of the 7 category scores (a 2-check category was moving
the headline as much as an 8-check one), and `n_total` excludes deferred checks so a category
can no longer advertise "2 of 2 measurable" while both are broken.

## Wired and scored in v2 (28)

SET-01, SET-05, SET-06, SET-10, ANG-06, ANG-07, ANG-08, BAL-03, BAL-04, TKA-01, BKS-01,
TOP-01, TOP-02, WRS-01, WRS-03, LOW-01, SEQ-02, SEQ-03, SEQ-04, DSW-01, DSW-04, FLT-10,
IMP-01, ANG-44, ANG-56, ANG-57, REL-03, REL-04.

(BAL-03/ANG-57 are driver-only and BAL-04 face-on-only, so they skip on all three current
fixtures; REL-03/REL-04 skip everywhere today because P9 emits no arm angles at all — see
"Blocked upstream" below. They are wired and correct, not deferred.)

## Deferred in v2 — authored but abstaining on every swing (10)

ROT-01, ROT-02, ROT-03, ROT-04, ROT-05, ROT-06, DSW-03, IMP-05, FIN-02 (the rotation family,
reason 1 above) and ANG-30 (reason 2). Each carries its full reason in the config, surfaced to
the UI as `skip_reason` with `deferred: true`. Un-defer one by deleting the `deferred=` argument
in `build_config.py` once its metric is trustworthy; nothing else needs to change.

All 38 validate against the real pipeline output (`scripts/validate_scoring_config.py`), i.e.
every `field`/`checkpoint` pair is a key `metrics.py` actually emits — not just a plausible name.
Note that validation proves a field **exists**, never that it means what the band assumes — that
is precisely the gap these 10 deferrals fell through in v1.

## Never wired at all, and why — grouped by what's blocking them, not by criteria.md category

**Needs new metrics.py geometry (bucket B, no shortcut available):**
SEQ-01/05/07/08/09/10/11, TRN-01/02/03 — the kinematic-sequence-order family (peak-velocity
timing of pelvis -> thorax -> arm -> club). This is the triage's own "standout" follow-up
(SEQ-01 alone carries weight 92) and deliberately not rushed here: it needs velocity/peak-timing
code over the per-frame series plus the club module's shaft-angle series threaded into
scoring input, which none of the wired checks above required. Also BKS-02/03/04/05 (plane/width/
connection/hip-load), TOP-03/04 (trend detection across the backswing), DSW-02 (composite
delivery position), REL-01/02 (release timing/closure rate), TKA-02/03, LOW-02/03/04,
HED-01/02/03, and the FLT-01/02/03/04/05/06/07/08/09 fault-flag family (FLT-10 alone is wired,
as a direct alias of DSW-04's already-computed `spine_change_at_impact`) — each is genuinely
buildable from data already in `analysis.json` per the triage, none are wired yet.

**Sign/orientation convention not verified against a real fixture:**
SET-03/04 (secondary axis tilt — FO-gated, and neither fixture is face-on), BAL-05/06 (foot
flare — the raw heel->toe angle's flare-direction convention hasn't been checked against a
visibly-flared stance), TOP-01/IMP-01's *direction* of bow-vs-cup (the two are wired with a
symmetric band around "straight" rather than a directional one — see the `fix` text on those
two entries in `build_config.py`). The club-tracking spec / CLAUDE.md's own standing rule — run
`checkclub.py`/`checkangles.py` before trusting a convention — applies here too; tightening
these needs a face-on fixture and a visual pass with `checkangles.py`, not just more code.

**Blocked upstream — wired, but nothing to read:**
REL-03/REL-04 read `lead_elbow_flex` at P9, and P9 emits no arm angles on any of the three
fixtures (`lead_arm_in_plane` is null there too), so both skip on every swing today. They are
correctly wired and will start scoring the moment P9 carries arm geometry — no config change
needed. Also ALN-01/02/03 (needs a target line — no alignment-stick detection or manual input exists),
SET-09/IMP-02/03 (need a ball-position reference — `DAT-18/19`'s address-frame-club-head proxy
is itself unbuilt).

**Out of reach from video alone** — rows needing AI judgment, a simulator/impact image, a
pressure plate, or that are simply not observable in a 2D clip, plus rows that are coaching
hints rather than measurements. Nothing in this phase changes that.

## Updating this file

Every time `build_config.py`'s `CHECKS` table changes, re-run it and
`scripts/validate_scoring_config.py`, and update the lists above so this file stays a correct
map of the config rather than drifting into aspirational documentation. Bump `VERSION` for a
material band/weight/deferral change and leave the previous `<version>.json` on disk — reports
store `scoring_model_version` and must stay reproducible.

To see the effect of a config change on the existing fixtures without re-running the CV
pipeline: `.venv/Scripts/python.exe scripts/rescore.py --dry-run`. Stage 8 is a pure function
of `analysis.json` + the config, so a full `burnin.py` re-run is only needed when `metrics.py`
gains a field — and re-running it needlessly risks overwriting the good club trace (CLAUDE.md).
