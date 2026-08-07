Mark the current SwingSage build step as skipped.

Usage: `/skip --reason="<why this step is genuinely not applicable>"`

A reason is REQUIRED. Refuse to proceed if `--reason` is missing or empty — skips without context are invisible and become impossible to audit later.

Operates on the active track — the **spine** track (`spine: true` in `.claude/ROADMAP.json`) by default. To skip a step on a specific track, use `/feature <name> skip --reason="..."`.

Invoke the `progress-tracker` skill in SKIP mode with the provided reason. It will:
1. Read the active track's `_STATUS.json` and identify `currentStep`
2. Set that step's `status` to `skipped` and record `skippedAt` (ISO-8601 UTC) and `reason`
3. Append the step to the top-level `skipped` array with `{step, reason, skippedAt}`
4. Append a `_PROGRESS.md` entry noting the skip and the reason
5. Advance `currentStep` to the next numbered step
6. Update `lastUpdated`

When to use:
- A step is genuinely not applicable to this project (e.g., a feature the user has decided to drop)
- A step is being deferred to a later phase by explicit user decision
- Never use to escape verification failures — those are blockers, use `/blocker` instead

After skipping, the orchestrator will treat the skipped step as satisfied for dependency purposes. Be confident in the skip — reversing it later requires `/reset-step`.
