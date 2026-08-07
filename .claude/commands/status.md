Show the current status of a single SwingSage build track.

By default this reports the **spine** track (the `spine: true` track in `.claude/ROADMAP.json`). To check a specific track use `/feature <name> status`. For the MACRO picture across ALL tracks, use `/roadmap` instead.

Invoke the `progress-tracker` skill in READ mode against the resolved track's `_STATUS.json` and report:
- `currentStep` — the step the track is on
- `phase` — the current phase name
- Completed count — how many of the track's steps are `complete`
- Skipped count — how many are `skipped` (with reasons)
- Active blocker count — entries in the `blockers` array
- The title of the next step to be executed

Read-only. Does not mutate `_STATUS.json` or `_PROGRESS.md`.

Format the output as a concise summary the user can scan in one glance. If there are active blockers, surface them prominently — those need attention before `/build` can advance.
