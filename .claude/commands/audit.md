Perform a post-hoc architectural audit using the `audit` skill.

Invoke the `audit` skill immediately. The argument (everything after `/audit`) is the target to audit. If the argument is empty, ask the user what to audit.

Examples of valid invocations:
- `/audit scoring pipeline` — broad, multi-file (`services/analyzer/swingsage/{metrics,scoring}.py`, `scoring_config/**`)
- `/audit swing player` — single domain (`SwingWorkspace`, `SwingStage`, `OverlayMenu`, `lib/usePlayer.ts`)
- `/audit ScoreGauge` — single component (`components/ui/kiosk.tsx`'s `ScoreGauge` + its consumers)
- `/audit recently changed files` — derive from git diff

Do not start grepping or reading files before invoking the skill — the skill has its own scope-detection step that decides whether to fan out subagents or read inline. Going in cold wastes context.

The skill writes its output to `.claude/audits/<slug>-<YYYY-MM-DD>/` and ends by presenting four options (Execute / Resolve later / Ask question / Other). Code edits only happen if the user picks Execute.

**Companion command:** if the user instead wants a lightweight in-session review of work they just did in this thread (uncommitted changes only, chat-only output, no audit folder), they should use `/audit-task`. Don't conflate the two: `/audit` is for reviewing *existing* code on disk against the 13 axes with a phased remediation plan; `/audit-task` is for reviewing *recent in-session changes* with a quick "did I follow conventions" sanity check.
