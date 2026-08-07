# SwingSage Roadmap — generated 2026-08-07

> Macro source of truth. Declarations live in `.claude/ROADMAP.json`; this rollup is DERIVED by `/roadmap`
> (`node scripts/roadmap/derive.mjs`). Do not hand-edit the table — re-run the script. Single-track detail:
> `/feature <name> status`.

## Arc

Club Tracking R&D

## Tracks

| Track | Phase | Goal | Progress | Current | Lifecycle | Blocked on |
|-------|-------|------|----------|---------|-----------|------------|
| **club-tracking-test** (spine) | Club Tracking R&D | Implement and evaluate the 12 club-head tracking tests from docs/SwingSage_C… | 0/20 (0%) | 01 | active | — |

## Consistency

- ✅ spine: exactly one active (club-tracking-test)
- ✅ dependency: none
- ✅ ownership overlap: none
- ✅ lifecycle/derived: none

## Recommended next

Spine: **club-tracking-test 01** (`/build`). Then the other unblocked active/planned tracks per phase order. Externally-blocked
tracks wait on their `unblockTrigger`.
