Gate a commit behind the `audit` skill's task-audit mode, then commit.

This project has no CI pipeline and no Lighthouse/Vercel-preview workflow to trigger — there is nothing to fire and wait on. What this command preserves from that idea is the actual mechanism worth keeping: **run an audit around a commit so convention drift and load-bearing mistakes (a broken `analysis.json` contract, a scoring threshold that snuck in hardcoded, a client bundle that just pulled in Postgres) get caught before they land in history, not after.**

The argument (everything after `/commit-and-audit`) becomes the commit subject. If omitted, ask the user for one.

Steps:

1. **Determine scope.** Run `git status --porcelain`, `git diff HEAD --stat`, `git diff HEAD --name-only`. If the working tree is clean, tell the user there's nothing to commit and stop.

2. **Run `/audit-task` over that scope** (invoke the `audit` skill's task-audit mode directly — don't ask the user to type the command separately). This is mandatory, not optional, even for a one-file change: it delegates to a fresh `Explore` subagent per the skill's own rule, so the review isn't biased by having just written the diff.

3. **Evaluate the verdict:**
   - **Clean or only ⚠️ issues below the promote-to-full-audit thresholds:** proceed to step 4.
   - **3+ ❌ violations, or a violation that breaks a hard rule from `CLAUDE.md`** (e.g. a fabricated face-angle number, a hardcoded scoring threshold, a keypoint-order break, a server-only import leaking into a client bundle): **stop before committing.** Report the violations and ask whether to fix them now, commit anyway (rare — only if the user overrides explicitly), or abandon the commit. Don't silently commit code that fails its own audit gate.

4. **Run the relevant verification gate** for whichever side changed, as a second, mechanical check independent of the audit's judgment calls:
   - Web changes (`apps/web/**`): `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
   - Analyzer changes (`services/analyzer/**`): from `services/analyzer`, `.venv\Scripts\python.exe -m pytest tests`
   - Both sides changed: run both. Neither changed (docs/config only): skip this step.
   - A failure here is a hard stop — report it and don't commit broken code, regardless of what the audit said.

5. **Commit.** Stage the specific files that were in scope (never `git add -A`/`git add .` blindly — this project's `.claude/hooks/guard-secret-exposure.mjs` and `guard-protected-paths.mjs` run on every Edit/Write/Bash anyway, but staging deliberately is still the right default). Write the commit message from what actually changed, not a generic label. If the diff includes a spec deviation, an interim shortcut, or anything `docs/decisions/` should record and the diff doesn't already include that entry, flag it to the user before committing rather than after.

6. **Report.** One short summary: commit SHA + subject, audit verdict (clean / N issues fixed / N issues accepted as-is), verification gate result. No further action (no push, no PR) unless the user asks — this command's job is the commit, not a release.

Constraints:
- Don't weaken or skip the audit to "make the commit go through." If the audit is right, fix the code; if the audit is wrong, that's a finding about the audit worth telling the user, not a reason to bypass it silently.
- Don't push or open a PR as part of this command — that's a separate, explicit ask.
- If the user wants the heavier `/audit` (phased remediation plan in `.claude/audits/`) instead of the lightweight task-audit gate, tell them to run that first and come back to `/commit-and-audit` once it's clean — this command only runs the lightweight mode.
