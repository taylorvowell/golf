Show the SwingSage macro build roadmap across all tracks.

Invoke the `roadmap` skill. It will:
1. Read `.claude/ROADMAP.json` (declarations only — the macro index of all tracks). If this project has no tracks yet, `.claude/ROADMAP.json` won't exist yet — the skill reports "no tracks yet" rather than erroring.
2. Derive a live status rollup by reading each track's `statusFile` (its own `_STATUS.json`)
3. Run four cross-track consistency checks: spine uniqueness, dependency satisfaction, ownership collision, lifecycle-vs-derived drift
4. Regenerate `.claude/ROADMAP.md` (the human-readable rollup)
5. Report the table + any check failures + a recommended next track to advance

Read-only on declarations: it NEVER writes progress into `ROADMAP.json`. Each track's own `_STATUS.json` is the sole authority for that track's progress; the roadmap derives, never duplicates. The only file it writes is `ROADMAP.md`.

This is the MACRO view (spans all tracks). For a single track's detail use `/feature <name> status`. To advance the spine track use `/build`; to advance any track use `/feature <name>`. To add a new track, see the `roadmap` skill's "Adding a track" section.
