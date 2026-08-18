# Guided drills — where the drill analysis mode, check specs, artifacts, and rep data live

**Date:** 2026-08-17 · **Mode:** integrate-with-stack (D59's product shape is accepted; this
call places it in the architecture) · **Status:** ACCEPTED 2026-08-17 → folded into the D59
register entry · **Spec:** PROJECT_MAIN §18.1–18.4 · **Decision:** D59 (this doc refines its
system design)

## The question

D59 committed guided drills (camera-verified drill execution, pose-only, launch scope). Where
does each piece live so this is a first-class citizen of the existing architecture rather than
a bolt-on: the analyzer's drill mode, the per-drill check specs, the per-attempt artifact, and
the rep/verdict data the coach roll-ups read?

## Internal grounding (what constrained the answer)

- Pipeline today (CURRENT-STATE §3): stages 0 normalize → 0b source timing → 2 pose
  (MediaPipe localiser → RTMW 133-kp) → 3 post-process → 5 events → 4 club (+YOLO11s) →
  5b checkpoints → 6 metrics → 8 scoring. Stage 8 is a pure function of `analysis.json` +
  versioned `scoring_config/`, re-runnable via `rescore.py`.
- Contract discipline (platform-data): `packages/schema` JSON Schema is the one contract,
  TypeScript generated, analyzer validates before writing, evolution additive-only with
  `shape-lock.json` (526 locked nodes on `analysis.json`).
- Data discipline: swings are uuid-identified rows owning views; storage keys derived from
  identity (`u/<userId>/s/<swingId>/…`), never stored; RLS via `withUser()` is the
  authorization boundary; sessions organize but never own.
- Job seam: `apps/web/src/lib/jobs.ts` parses analyzer stage lines; analyzer-service track
  will promote this to a queue-driven worker (host undecided, D18 HANDOFF open).
- D56: practice motion is quarantined from every durable swing metric. D58: deterministic
  engines own facts; AI rewrites prose only.

## Verdict (five placements)

1. **The drill mode is a second pipeline *profile* inside `services/analyzer/swingsage/` —
   never a second service and never a fork.** It reuses stages 0/0b/2/3 byte-identical
   (normalize, timing, pose, post-process) and replaces the swing-specific tail with three
   drill stages, mirroring the swing pipeline's shape:
   - **D5 rep segmentation** (`drills/segment.py`) — the drill analogue of `events.py`:
     finds the judged window. v1 `hold` (stable-window detection over smoothed keypoints);
     v2 `trigger` (per-drill kinematic event, e.g. peak hand speed).
   - **D6 drill metrics** (`drills/metrics.py`) — reuses the existing angle catalogue +
     `geom` drawing machinery on the checkpoint window; handedness-resolved lead/trail
     exactly as swing metrics.
   - **D8 drill verdicts** (`drills/verdict.py`) — a **pure function of the drill artifact +
     the drill spec**, exactly the Stage 8 property: `redrill.py` re-runs verdicts over
     stored pose when a spec changes, no re-inference.
   Club, face, checkpoints, silhouette, scoring never run. No YOLO load → **no GPU in the
   drill profile**; drill jobs are CPU-only and cheap.

2. **Check specs are versioned engineering config in the repo — `drill_config/v1.json`
   beside `scoring_config/` — never admin-authored DB content.** The DB drill row (content:
   name, demo video, cues, finding mappings — admin-managed per §31.2) carries a nullable
   `check_id` referencing a spec in the shipped config version. Guided = the reference
   resolves; plain = null. Split rationale: a check spec encodes geometry semantics that
   must be fixture-validated before trust (the nine-rotation-checks trap) — that is
   engineering work with versioning and validation tooling, not editorial content. Admin
   can activate/deactivate drills; admin cannot author geometry.

3. **Two new artifacts, mirroring the swing pair, in `packages/schema` from day one:**
   - `drill_analysis.json` — normalized-coordinate keypoints in the same 49-point block
     conventions (truncated confidence, `MIN_CONF` discipline), plus the rep array:
     `reps: [{window, checkpoint_frame, …}]`. **Rep-array-shaped from day one** even though
     v1 records one rep per clip — multi-rep recordings become additive, not a reshape.
   - `drill_report.json` — per-rep check results `{id, measured, band, verdict
     hit|adjust|cannot_evaluate, confidence, correction_key, geom}` + `drill_spec_version`.
     Drawing geometry included so clients only render (measured line + target band in
     normalized coords over the checkpoint frame).
   `analysis.json` is **not touched** — it stays swing-only; its shape-lock and every
   existing consumer remain oblivious to drills.

4. **Rep/verdict data lives in new tables — `drill_attempts` (+ per-rep verdict rows) —
   never in `swings`. Quarantine is structural, not a WHERE clause.** D56's rule ("practice
   never touches durable swing metrics") is enforced by schema: no query over `swings` can
   accidentally include drill motion because drill motion was never a swing. Same identity
   discipline: uuid attempts, storage keys derived (`u/<userId>/d/<attemptId>/…` — a new
   prefix class in `lib/media/keys.ts`), same RLS/`withUser()` boundary, coach read access
   through the existing relationship boundary. Coach roll-ups ("70% hitting the position")
   are deterministic aggregates over these rows, DB-owned like D55 goal evidence — never
   computed client-side from artifacts.

5. **Drill jobs ride the same job seam with a `kind: swing | drill` discriminator — and get
   a fast lane.** Same queue, same retry/dead-letter design the analyzer-service track is
   building; the worker-host decision (D18, open HANDOFF) carries drills for free. Because
   the drill profile is short-clip + CPU-only, the worker's fair-queuing design should give
   drill jobs a **priority class**: the §18.2 loop's UX is "verdict in seconds", and a drill
   rep must not queue behind a 300-frame swing club-tracking job.

## Road not taken

- **Extend `analysis.json` with optional drill fields** — loses: shape-lock churn on every
  drill change, swing invariants (8 events, club, checkpoints) become conditionals in every
  consumer, and re-analysis semantics blur. Two small honest contracts beat one lying one.
- **A separate drill service** — nothing gains: same pose stack, same storage, same queue.
  Two deploys, two model caches, one more seam to version. Loses on maintainability at
  solo-team scale.
- **Drill reps as `swings` rows with a type flag** — quarantine by WHERE clause; one
  forgotten filter leaks practice motion into trends/best-swing/goal evidence. The failure
  D56 exists to prevent, reintroduced structurally. Lose.
- **Admin-authored check specs in the DB** — unvalidatable geometry authored outside the
  fixture/validation tooling; the rotation-check trap at content scale. Lose.
- **On-device pose for a live mirror** — already rejected in D59; violates CV-in-Python and
  the hosted-worker property.

## Gaps found and solved in this design

- **Wrong-execution fixtures are mandatory.** A drill check must *fail bad reps*, not just
  pass good ones — a band tuned only on correct demos is the "check that scores well"
  trap. The fixture ask is therefore pairs: each guided drill filmed done right AND done
  characteristically wrong, both views where the spec allows either. (HANDOFF row when the
  track starts.)
- **View gating surfaces before recording, not after.** The spec's `required_view` is
  readable by the client from drill content metadata, so "film this face-on" appears at
  drill selection — the D55 gotcha (a goal that can never progress from the golfer's usual
  view must say so at assignment) applied to drills.
- **Reproducibility:** every `drill_report.json` stores `drill_spec_version`; `redrill.py`
  re-verdicts old attempts pure-functionally, exactly like `rescore.py`.
- **Multi-rep future:** rep-array artifact shape from day one (above).
- **Verification tooling exists from day one:** `scripts/checkdrill.py` (the drill analogue
  of `checkangles.py` — every band's raw value printed across drill fixtures, the drawn
  judgment over the real frame) is part of the first build step, per the standing
  build-the-debug-view-first rule.
- **Latency:** no-GPU short-clip profile + a priority class in the worker keeps the
  "seconds" promise credible without new infrastructure.

## Ownership summary

| Piece | Lives | Owning track |
|---|---|---|
| Drill pipeline profile (D5/D6/D8), `redrill.py`, `checkdrill.py` | `services/analyzer/swingsage/drills/` | `drill-library` |
| Check specs | `services/analyzer/drill_config/v<N>.json` | `drill-library` (engineering-authored) |
| Drill content (video, cues, mappings, active flag) | Postgres via admin surface | `drill-library` content + `admin-surface` UI |
| `drill_analysis.json` / `drill_report.json` schemas | `packages/schema` (additive) | `platform-foundation` conventions, authored by `drill-library` |
| `drill_attempts` + verdict rows, coach roll-ups | Postgres, RLS via `withUser()` | `drill-library` |
| Storage keys `u/<userId>/d/<attemptId>/…` | `lib/media/keys.ts` new prefix class | `drill-library` |
| Job `kind` discriminator + drill priority class | `lib/jobs.ts` / worker design | `analyzer-service` |
| "Check my form" loop UI | `apps/mobile/src/features/drills` | `drill-library` (session integration: `practice-loop`) |

## Path forward

Just a decision for now — it lands as the design brief the `drill-library` track's step
files are authored against (that track is planned, behind `priority-engine` and
`admin-surface`; nothing builds today). One cross-track note to carry: the
`analyzer-service` worker design should include the job-`kind` discriminator and priority
classes so drills don't force a queue redesign later.

## Open threads

- Whether drill clips normalize to CFR 60 like swings (uniformity) or accept 30 (cheaper,
  frame-exact scrub matters less) — defer to the track; default is reuse-unchanged.
- Trigger-drill event detection design (v2) — deliberately unspecified until hold drills
  prove the loop.

**Accepted 2026-08-17.** The five placements are folded into the D59 register entry in
`docs/decisions/analysis-and-ai.md`; the job-kind + drill-priority requirement is written
into the `analyzer-service` track goal; this doc is a specRef of the `drill-library` track so
step authoring reads it; the wrong-execution fixture-pair requirement is named in that
track's goal so it becomes a HANDOFF row when the track starts.
