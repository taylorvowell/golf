Run the bounded self-healing loop using the `heal` skill.

Invoke the `heal` skill immediately. The argument (everything after `/heal`) optionally narrows scope; an empty argument means "the current uncommitted changes."

Examples of valid invocations:
- `/heal` — heal the current uncommitted diff (default)
- `/heal apps/web/src/components/OverlayMenu.tsx` — heal only changes under that path
- `/heal services/analyzer/swingsage/scoring.py` — heal only changes under that path
- `/heal last commit` — heal the diff of the last commit
- `/heal --branch` — heal everything on this branch vs main

Do not start fixing or grepping before invoking the skill — it owns scope detection, the fresh-eyes review, the bounded fix loop, the guardrail, and the telemetry log.

The skill:

1. **Checks with fresh eyes.** A separate subagent reviews the changed files (it didn't write them), so the loop isn't grading its own homework.
2. **Heals against an objective oracle.** It only auto-fixes failures the deterministic oracle proves — `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web lint` for web changes, `.venv\Scripts\python.exe -m pytest tests` (from `services/analyzer`) for analyzer changes — in a bounded 3-attempt loop with escalating angles, plus the **safe-judgment-auto** tier (a judgment fix is applied only if the oracle still passes after it, it's in-scope, reversible, and touches no shared/irreversible state).
3. **Never cheats to green.** It will not edit a test/Verification/golden snapshot, add `@ts-ignore`/`eslint-disable`, weaken a rule, or delete a failing test to pass.
4. **Escalates instead of guessing** on the 4 triggers (manual check / shared-irreversible state / missing credential / post-3-attempts architectural decision), and **promotes to `/audit`** (if configured in this project) when findings are too big to heal inline.
5. **Logs every run** to `.claude/heal-log.md` so recurring mistakes can become new lint rules or a `docs/decisions/` entry.

It is invoked ad-hoc by you and automatically by the build orchestrators on a step-verification failure. Code changes are checkpointed and committed per converged unit; nothing irreversible happens without escalation.
