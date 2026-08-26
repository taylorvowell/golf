# 00 - Current-State Audit & Reconciliation

**Phase:** Audit & Reconciliation
**Status:** complete
**Estimated effort:** 1 session (done 2026-08-26)

## Overview

**Objective:** reconcile the v2 planning package (written without codebase access) with the
repository as it actually is, before any implementation. Produce the durable artifacts every
later step reads.

**Current state → produced:** four parallel code audits (mobile pre-upload; server
ingest/jobs/worker; playback/frame-identity/corrections; analyzer internals), the
current-state system map, the current-vs-target compatibility matrix (50 rows), the conflict
analysis (12 conflicts, each with a resolution), and the migration architecture with removal
conditions for every temporary mechanism.

## Deliverables (all in this directory)

- `AUDIT-current-state.md` — planning-package digest, system map, per-area findings, KEEP
  list, confirmed divergences.
- `AUDIT-analyzer.md` — the analyzer deep audit (stage order, decode economics, provenance
  chain, club internals, worker surface, test state).
- `MATRIX-current-vs-target.md` — the matrix, conflicts C1–C12, target architecture, removal
  table.

## Key reconciliation rulings (binding on later steps)

1. **One frame identity** (C1): normalized-CFR-at-native-rate index stays the public frame id;
   `source_timing` upgraded, never a second namespace.
2. **One artifact family** (C3): progressive revisions are partial writes of `analysis.json`'s
   schema, additive.
3. **No new orchestration** (C4): jobs/QStash/Modal stay; stdout scraper is legacy with a
   removal condition.
4. **Plan item rejected** (matrix #19): manifest-driven client seeking — both platforms
   measure 100%-exact with current rules; churn without benefit.
5. **Plan already satisfied** (matrix #1, #2, #3, #33, #48, #49): user-mark isolation,
   audio-first path, lossless remux, honest gaps, schema contract, honest progress — KEEP.
6. **Live bugs found by the audit that the plan didn't know about**, folded into steps 01–03:
   INTERP-scored-as-measured, import ATTACK-detector bug, slow-mo import fps lie, variants
   default-on in production, no capture-path admission control, green-box rule fictional,
   corrections fps ambiguity.

## Verification

- The three artifact files exist and are internally consistent (matrix rows cite audit
  sections; step files cite matrix rows). Manual review — no code touched in this step.

## Definition of Done

- [x] Four audits complete and persisted
- [x] Matrix classifies every significant plan recommendation
- [x] Every conflict has a resolution; every temporary mechanism has a removal condition
- [x] Track registered in `.claude/ROADMAP.json`

## Notes

`docs/CURRENT-STATE.md` is materially stale (no-upload-flow, CFR-60, 13 variants, 80 tests,
no-deployment all false). Its rewrite is deliberately step 14, after the migration lands —
rewriting it mid-migration would go stale twice.
