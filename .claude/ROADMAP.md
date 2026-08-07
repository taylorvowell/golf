# SwingSage Roadmap — generated 2026-08-07

> Macro source of truth. Declarations live in `.claude/ROADMAP.json`; this rollup is DERIVED by `/roadmap`
> (`node scripts/roadmap/derive.mjs`). Do not hand-edit the table — re-run the script. Single-track detail:
> `/feature <name> status`.

## Arc

Club Tracking R&D

## Tracks

| Track | Phase | Goal | Progress | Current | Lifecycle | Blocked on |
|-------|-------|------|----------|---------|-----------|------------|
| club-tracking-test | Club Tracking R&D | Club-head tracking evaluation (31 trackers) — COMPLETE. Shipped: legacy traj… | 18/19 (100%, 1 in-prog) | complete | complete | — |

## Consistency

- ❌ spine: 0 active spine tracks (none) — /build has no unambiguous target
- ✅ dependency: none
- ✅ ownership overlap: none
- ✅ lifecycle/derived: none

## Recommended next

Spine: **(no active spine — set spine:true on one track)** (`/build`). Then the other unblocked active/planned tracks per phase order. Externally-blocked
tracks wait on their `unblockTrigger`.
