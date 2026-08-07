Revert the current SwingSage build step back to `not-started`.

Operates on the active track — the **spine** track (`spine: true` in `.claude/ROADMAP.json`) by default. For a specific track use `/feature <name> reset`.

Invoke the `progress-tracker` skill in RESET STEP mode on the step indicated by the active track's `_STATUS.json` `currentStep`. It will:
1. Read the active track's `_STATUS.json` fresh
2. Set the current step's `status` to `not-started`
3. Clear `startedAt`, `completedAt`, `skippedAt`, and any error/blocker metadata on that step
4. Leave `currentStep` pointing at the same step (so `/build` will retry it)
5. Append a `_PROGRESS.md` entry noting the reset
6. Update `lastUpdated`

When to use:
- An intermediate verification failure left the step in a bad `in-progress` state and you want a clean retry
- A `blocked` step has had its underlying blocker resolved and is ready to start fresh
- You want to re-execute a step from scratch without rolling back code (for that, use `/rollback`)

This command does NOT touch git history or working-tree state. It only resets the status entry. If files from the in-progress step are still on disk and need to be undone, use `/rollback` to a prior checkpoint or revert manually.

The build-orchestrator's `/build` will pick up the reset step as the next to execute.
