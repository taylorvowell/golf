Escalate a blocker on the current SwingSage build step.

Operates on the active track — the **spine** track (`spine: true` in `.claude/ROADMAP.json`) by default. For a specific track use `/feature <name> blocker`. Blockers are logged to that track's own `_STATUS.json` `blockers` array.

Invoke the `blocker-protocol` skill. It will:
1. Identify the blocker (what specifically can't be done)
2. Classify it into one of four categories:
   - **AUTONOMOUS-FIX** — handle directly (install a missing package, fix a lint/type error, address an obvious bug) and retry the step
   - **USER-ACTION-NEEDED** — log to `_STATUS.json`'s `blockers` array, surface the exact action the user needs to take, and stop
   - **ARCHITECTURAL-DECISION** — present 2-3 options with tradeoffs, do NOT decide autonomously, wait for the user
   - **EXTERNAL-DEPENDENCY** — log to `blockers`, pause until the user confirms the dependency is resolved
3. For non-autonomous classifications: mark the current step as `blocked` via `progress-tracker`, preserve the original error context, and surface a clear escalation message

Hard rules the skill enforces:
- Never invent architectural decisions just to "keep the build moving"
- Never fabricate credentials, environment variables, or secrets to unblock
- Never guess at design choices outside the project docs
- Always preserve the original error so the user understands the actual failure
- If `/skip` looks right, recommend it but require the user to invoke `/skip` themselves with a reason

Use this command when:
- A step's verification fails repeatedly and the cause isn't obvious
- An expected credential or environment variable is missing
- An external service is unauthorized or unreachable
- The step's Steps section requires a decision the project docs don't dictate
- Multiple consecutive autonomous repair attempts have failed
