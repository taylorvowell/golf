Run the `audit` skill in task-audit mode — a lightweight, in-session review of work just done in this thread.

Invoke the `audit` skill immediately and follow its "Task audit mode" section. Scope defaults to uncommitted changes (`git status` + `git diff HEAD`). Output is chat-only — no `.claude/audits/` folder is created in this mode.

Argument forms:
- `/audit-task` — scope = uncommitted changes in the working tree (default)
- `/audit-task last commit` — scope = the most recent commit
- `/audit-task last <N> commits` — scope = last N commits
- `/audit-task <path>` — scope = that file or folder, filtered by uncommitted changes
- `/audit-task --branch` — scope = everything on this branch (`git diff main...HEAD`)

Mandatory in this mode: delegate the actual review to a fresh `Explore` subagent so the audit is not biased by the cognitive context of having just made the changes. The subagent reads each changed file fresh, plus `apps/web/src/components/ui/kiosk.tsx` (this project's card-shape vocabulary — the closest thing it has to a component registry) and the relevant `.claude/rules/*.md` files, then returns ✅ followed / ⚠️ issues / ❌ violations.

If the scope is empty (no changes detected and no argument), say so plainly and stop — don't invent things to audit.

If findings are large (3+ violations, multiple domains, or >15 files), end the report by recommending the user promote to a full `/audit` instead of trying to clean up inline.
