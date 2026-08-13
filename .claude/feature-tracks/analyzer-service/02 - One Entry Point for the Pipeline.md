# 02 - One Entry Point for the Pipeline

**Phase:** Platform Foundation
**Status:** not-started

## Overview

The worker this track exists to build cannot be written yet, because the analyzer has no
callable entry point. The full pipeline composition — stage ordering, the seven club-variant
re-runs, event refinement, the `analysis.json` doc assembly, `OutputLock`, `SCHEMA_VERSION` —
lives inside `scripts/burnin.py:main()`, one ~830-line function behind ~40 CLI flags. The only
programmatic invocation in the product is `apps/web/src/lib/jobs.ts` spawning that script as a
child process and regex-scraping its stdout for progress.

This step extracts the composition into `swingsage/pipeline.py` with a typed request and a
structured progress callback, and makes `burnin.py` a thin CLI over it. It is deliberately
**host-agnostic**: the worker host is an OPEN handoff decision (Taylor's, money), and nothing
here depends on it. Every later step of this track — the service loop, QStash delivery, retry
handling, progress reporting that isn't stdout regexes — imports what this step creates.

## Dependencies

- In-track: step 01 (complete). The pose-device work (`pose_device()`, `SWINGSAGE_POSE_DEVICE`)
  is untouched by this step.
- Cross-track: none. Explicitly does NOT need the worker-host decision.

## Architectural Context

- **The extraction is a move, not a redesign.** Behavior, defaults, artifact contents and the
  stdout lines must be identical afterwards. In particular the club detector stays
  explicit-only (never defaulted from disk) — that is a recorded decision, not an oversight.
- **The stdout protocol is a compatibility surface.** `jobs.ts` (STAGES table) parses stage
  transitions and per-frame progress from printed lines. The cheapest correct move: the
  `print()` calls move with the code and keep emitting exactly what they emit today; the new
  structured callback is *additive*, for future in-process consumers.
- **`analysis.json` is rewritten wholesale by every run** — doc assembly moving into the
  library must not change a single key. `contract.write_json` (schema-validated, atomic
  `os.replace`) remains the only writer.
- **`OutputLock` belongs to the pipeline, not the CLI** — it protects the out dir from
  concurrent runs regardless of caller, and the future worker needs it more than the CLI does.
- **CPU pose is the determinism baseline** (D53: CUDA is not bit-identical). Fidelity
  comparisons in Verification force `SWINGSAGE_POSE_DEVICE=cpu`.

## Files & Areas Touched

- `services/analyzer/swingsage/pipeline.py` — new: `AnalysisRequest`, `PipelineEvent`,
  `run(request, on_event=None) -> PipelineResult`.
- `services/analyzer/scripts/burnin.py` — shrinks to: argv parsing → `AnalysisRequest` →
  `pipeline.run()` → exit code. Debug-only renders that merely consume pipeline outputs may
  stay CLI-side.
- `services/analyzer/tests/` — new unit coverage for request construction / event emission;
  existing suite must stay green untouched (no golden re-freeze in this step).
- Nothing under `apps/web/` changes in this step (`jobs.ts` keeps working unmodified — that is
  the point of the stdout-fidelity constraint).

## Steps

1. Grep for anything else importing or spawning `burnin.py` (`rescore.py`, `resegment.py`,
   tests, docs) so no caller is orphaned by the move.
2. Define `AnalysisRequest` (frozen dataclass): source path, out dir, view, handedness,
   club-detector weights path (optional, no default), club type, scoring-config version, the
   stage toggles (`no_stage3`, `no_club`, `no_scoring`, `no_silhouette`), and the tuning knobs
   `main()` actually threads into stages. Flags that only affect CLI-side debug rendering stay
   out of it.
3. Define `PipelineEvent` (stage started / stage progress / stage done / warning, with stage
   id, label, and frame counts where applicable) and `PipelineResult` (out dir, artifact
   paths written, schema version, per-stage timings, warnings).
4. Move the composition from `main()` into `pipeline.run()`: normalization, timing sidecar,
   pose (MediaPipe + RTMPose), post-process, provisional + definitive events, club track +
   variants + refine, checkpoints, metrics, silhouette, doc assembly, `contract.write_json`,
   scoring, burn-in render, contact sheet. `OutputLock` moves in. Existing `print()` lines
   move with their code verbatim; add `on_event` calls at the same boundaries.
5. Rewrite `burnin.py:main()` as the thin CLI: parse the same ~40 flags, build the request,
   call `run()`, map failures to the same exit codes and messages.
6. Add focused tests: `AnalysisRequest` round-trips the CLI flags it covers; `run()` emits a
   sane event sequence on a stub/short input if cheaply testable — do not build a heavy
   fixture harness for this.
7. Run the fidelity comparison in Verification (CPU, one fixture, before/after artifact
   diff) and the stdout-line check against the `jobs.ts` regex expectations.

## Quality Standards

- No behavior change: same flags, same defaults, same artifacts, same stdout, same exit codes.
- No new dependencies.
- Type hints on the new public surface; docstrings that state the stdout-compatibility
  constraint so it survives the next refactor.
- The two standing traps stay true and stated: club detector never defaults; CLI runs never
  touch Postgres.

## Verification

All from `services/analyzer/`, venv interpreter.

```
# 1. Suite green, no golden re-freeze
.venv\Scripts\python.exe -m pytest tests

# 2. Fidelity: pre-refactor CPU baseline vs post-refactor CPU run of the SAME fixture
#    (baseline generated on the pre-refactor code into out-baseline/, run in background,
#     ~6 min each; volatile keys like timings/timestamps excluded by the compare script)
$env:SWINGSAGE_POSE_DEVICE='cpu'
.venv\Scripts\python.exe scripts/burnin.py fixtures/<clip> --out <scratch>/after --view dtl --handedness right --club-detector runs/clubhead/weights/best.pt
.venv\Scripts\python.exe scripts/compare_analysis.py <scratch>/before/analysis.json <scratch>/after/analysis.json

# 3. stdout contract: the stage lines jobs.ts regex-parses appear unchanged in the run log
#    (grep the captured stdout for each STAGES pattern from apps/web/src/lib/jobs.ts)
```

A pass is: pytest green; compare script reports zero substantive differences; every `jobs.ts`
stage pattern matches the captured stdout.

## Definition of Done

- `swingsage/pipeline.py` exists with `AnalysisRequest` / `run()` / events, and `burnin.py` is
  a CLI shell over it.
- All three verification gates pass.
- `docs/decisions/analysis-and-ai.md` gains/updates one present-tense entry: the pipeline's
  programmatic entry point and the stdout-compatibility rule.
- `docs/CURRENT-STATE.md` §12's "how analysis runs" sentence updated if it names `burnin.py`
  as the orchestration owner.

## Notes

- The stdout-scrape protocol is debt this track retires later (the worker will consume events
  in-process and write job state to Postgres directly); this step only refuses to break it.
- Requirements pinning / venv reproducibility is deliberately NOT in this step — it is the
  natural step 03 alongside the service container skeleton, per the requirements-dev.txt
  header's own admission that a rebuild is manual today.
