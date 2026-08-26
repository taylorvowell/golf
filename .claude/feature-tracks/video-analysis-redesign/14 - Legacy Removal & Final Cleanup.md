# 14 - Legacy Removal & Final Cleanup

**Phase:** Cleanup
**Status:** not-started
**Estimated effort:** 2 sessions
**human-review-required:** true (deletions against Taylor's club-trace verdict; CURRENT-STATE
rewrite)

## Overview

**Objective:** the track's definition of done — "one coherent analysis architecture that
evolved from the existing system", not "old analysis plus a new system bolted beside it".
Every temporary mechanism from the removal table in `MATRIX-current-vs-target.md` §4 is
deleted or has a recorded decision to stay; the docs describe the system that exists.

**Current state at entry:** shadow flags promoted (07/09/10), render deferred (11), runtime
chosen (12), reliability finished (13) — plus whatever the removal table accumulated.

## Dependencies

- Steps 07–13 complete (each names this step as its cleanup owner).
- Taylor's club-trace winner verdict (open HANDOFF row) — gates the variants deletion.

## The deletion list (verify each against its removal condition)

1. **Frame-policy v0-dense default path** — rollout stable → dense stays only as a pinnable
   version for reproducing old artifacts.
2. **Classical club solve + VARIANTS/TRACE_MODES machinery** (27-variant artifacts),
   `addvariant.py`, `injectvariants.py` — after club v2 promotion AND Taylor's verdict.
3. **Old impact authority** — refine_events' snap demoted to fusion evidence (10 item 7
   done); hardcoded confidence floors gone.
4. **stdout stage scraping** (`jobs.ts STAGES` regexes) + pipeline print-protocol constraint
   — spawn driver consumes structured events (or spawn retires to burnin-only local use;
   decide, record). The 11-vs-16 stage vocabulary duality ends.
5. **Container-tag fps fallback** in ingest/guard — client version floor raised past the
   manifest ship (02's removal condition).
6. **`progressive_revisions_v2` partial writes** — DELETE if no client consumer shipped
   (11's rule), else keep and record.
7. **Dead code sweep** (whatever 06/09 didn't take): `events._settle` note-only usage,
   `ClubConfig.use_path_curve`, unreferenced weights (`sam2.1_s.pt`, `yolo11s*.pt`,
   `yolov8s-worldv2.pt`, `runs/clubhead_seg/`), `services/analyzer/web/player.html` +
   `scripts/serve.py`, dead exp_* scripts (keep only those the experiment record cites).
8. **isolation/club_only/framestamp queue-path 404s** — decide: add to the (now post-ready)
   render phase behind a flag, or remove the routes + registry names + player affordances.
   Record.
9. **Web stubs contradicting reality** — SwingWorkspace "New Swing"/"Delete swing" modals
   (claim no DB/upload exist); either wire or remove the affordances.
10. **`swing_views.analysis_version`** — confirmed dropped (03 did it; verify).
11. **SCHEMA_FEATURES** brought current through the final schema version.

## Documentation trueing (the rest of the step)

- **`docs/CURRENT-STATE.md` rewritten** against the finished system (the audit found it
  false on ~10 material points even before this track).
- `docs/decisions/` entries consolidated: frame policy, club v2, impact fusion, runtime
  choices, variants retirement — present tense, edited in place.
- `CLAUDE.md` pipeline/commands sections updated (stage list, new scripts, policy flags).
- `docs/METRICS.md`, `scoring_config/COVERAGE.md` regenerated.
- Auto-memory: green-box entry resolved per 09's outcome; stale entries corrected.
- Roadmap reconcile: `analysis-ground-truth` track RECONCILEd against step 04's deliverables
  (progress-tracker RECONCILE, evidence-gated).

## Quality Standards / Verification

- Repo-wide greps prove absence: `VARIANTS`, `TRACE_MODES`, `STAGES` regex table,
  `analysis_version`, the dead files.
- Full oracles green: analyzer pytest, golden CI, `pnpm --filter web exec tsc --noEmit &&
  pnpm --filter web lint`, mobile tests, schema drift/shape-lock.
- One queue e2e + one spawn (or its replacement) run clean.
- Every row of the MATRIX removal table shows DELETED or a decision entry explaining KEEP.

## Migration Considerations

Old artifacts (27-variant, v0-dense, pre-fusion) remain readable forever — deletions are of
PRODUCING code, never of reading paths; the clients' tolerance for absent variants/fields was
verified back in 01/09.

## Technical-Debt Impact

**Reduces** — this step exists to pay out the debt the migration deliberately carried.

## Rollback

Deletions land as reviewed commits after their gates; git revert per item.

## Cleanup

This IS the cleanup step. Anything found here that needs new work becomes a new step file
(15+), never a silent carry.
