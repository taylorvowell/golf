---
name: step-verifier
description: Runs the Verification section of a SwingSage build step file (from whichever track directory the caller is on — a track under .claude/feature-tracks/<id>/; the spine track resolves via .claude/ROADMAP.json) and reports pass/fail with structured details. Use this skill when the user types /verify, when build-orchestrator or feature-orchestrator needs to confirm the current step is actually done before marking complete, or when checking that a previously-completed step still passes (drift detection before advancing). Also use it whenever you're about to mark a step complete and haven't yet run its Verification commands — never trust "it looks like it worked" without running the explicit checks the step file defines. Every command in the Verification section runs sequentially; a single failure or >60s timeout fails the step. Manual checks are automated first where this project has the tooling; otherwise only genuinely subjective judgment asks the user, and it never guesses.
---

# Step Verifier

You run the Verification section of a numbered build step and produce a structured report the build-orchestrator can act on. Every command in the section runs. Anything that returns non-zero, hangs past 60s, or contradicts an explicit expected-output comment is a failure.

## Why this skill exists

Without explicit verification, "done" becomes vibes. A step file's Verification section is the contract for completion — the author wrote `pnpm --filter web exec tsc --noEmit` because they know that's the thing that catches the silent regression. If you skip it (or "spot-check" by looking at the diff), you'll mark things complete that aren't, and the failure surfaces three steps later with no obvious cause.

This skill exists to make verification mechanical: extract the commands, run all of them, report results in a shape the orchestrator can consume.

## Workflow

1. **Read the specified step file.** Caller passes the track root `<trackRoot>` and the step id (e.g., `"04"` or `"R8"`); resolve to `<trackRoot>/<id> - <title>.md` via a `Glob` on `<trackRoot>/<id> - *.md` if you don't have the exact title. (For the spine track, resolve `<trackRoot>` from the `spine: true` entry in `.claude/ROADMAP.json`. Step-id schemes vary across tracks — `NN`/`NNa` on most, but a track is free to use another scheme (e.g. `RN`) if that fits its work better — so match on the literal id, don't assume numeric form.)
2. **Extract the Verification section.** Find the `## Verification` heading. Capture everything from that heading until the next `## ` heading or end of file.
3. **Classify each item in the section** as either:
   - **Command** — appears inside a fenced code block (```bash, ```sh, ```powershell, or unfenced ```). One command per line.
   - **Manual check** — appears as prose or a bullet outside a code block. Anything like "Open localhost:3000 and confirm the page renders" or "Verify the scoring bands render correctly in the Advanced tab."
4. **Run each command sequentially.** Use the `Bash` tool (which handles both Bash and POSIX-friendly invocations of pnpm/git/node fine) or `PowerShell` for shell-specific PS commands. See "Shell Choice" below.
5. **Capture exit code, stdout, stderr, and duration** for each command.
6. **For each command's result, compare against any expected-output comment.** The step file conventions put expectations in trailing comments: `pnpm --filter web exec tsc --noEmit   # Should exit 0, no type errors`. If output contradicts the expectation, that's a fail even if exit code is 0.
7. **For each manual check, automate first if this project has the tooling.** This project has no browser-automation/e2e command installed yet (no Playwright, no vitest) — see "Manual Checks" below for what that means in practice. Objectively checkable-without-a-browser items (a route returns 2xx, a file exists, JSON parses, a script's stdout contains an expected marker) can usually be automated with `curl`/`Bash` directly. Genuinely subjective or visual judgment (does the overlay look right, does the scorecard read cleanly) asks the user via `AskUserQuestion`. Never infer the answer from the diff.
8. **Compose the structured report** (format below). Hand it back to the caller.

## Hard Rules

- **Never skip a command.** Every line inside a Verification code block runs. If a command is failing repeatedly, that's a finding — not a reason to omit it.
- **Never mark a step verified if any command failed.** Even one fail means the whole step is fail. The orchestrator depends on this guarantee.
- **Treat >60s as fail.** Pass `timeout: 60000` to `Bash`. If the command was going to pass quickly under normal conditions and is now hanging, that's a regression worth catching. (Exception: a step file may explicitly document a longer-running command, e.g. a `burnin.py` re-run over a fixture — respect an explicit timeout override in the step file, otherwise 60s is the default.)
- **Never assume a manual check.** Automate it when it's objectively checkable with tooling this project actually has; ask the user only for subjective judgment or genuinely browser-only checks. If neither resolves it, report the step as PENDING (manual checks unresolved) — not pass, not fail.
- **Preserve original error context.** Capture the last ~30 lines of stderr/stdout for any failure and include them in the report. The user needs to see the actual error to diagnose.
- **Report in the structured format below.** The orchestrator reads the report to decide whether to advance. Improvising the format breaks that.

## Extracting the Verification Section

Step files follow the template each track scaffolds its steps from. Verification looks like one of these shapes:

### Shape A — single fenced block

```markdown
## Verification
\`\`\`bash
pnpm --filter web exec tsc --noEmit    # Should exit 0
pnpm --filter web lint                 # Should exit 0
git status                             # Should show clean working tree
\`\`\`
```

Extract: three commands. No manual checks.

### Shape B — fenced block + manual prose

```markdown
## Verification
\`\`\`bash
pnpm dev &
sleep 5
curl http://127.0.0.1:3000
\`\`\`

Manually:
- Open http://127.0.0.1:3000 in a browser. Confirm the page renders without console errors.
- Open a swing page and confirm the new overlay toggle appears in the OverlayMenu.
```

Extract: three commands AND two manual checks (the two bullets after "Manually:").

### Shape C — multiple fenced blocks

```markdown
## Verification

Run these checks:

\`\`\`bash
pnpm --filter web exec tsc --noEmit
\`\`\`

Then:

\`\`\`bash
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
\`\`\`
```

Extract: two commands across two blocks. Run in document order.

### What counts as a manual check

A bullet or numbered item outside a code block that asks a human to look at something. Heuristics:

- Starts with a verb like "Open", "Verify", "Confirm", "Check that", "Look at"
- References a UI ("the page", "the player", "the overlay menu")
- References subjective state ("looks right", "feels responsive", "no errors visible")

If you're not sure whether something is a manual check or just prose, ask the user.

## Shell Choice

This project's environment is PowerShell-primary with Bash also available. For verification commands:

- `pnpm`, `git`, `node`, `npm`, `npx` — work in both shells. Use Bash (faster, more predictable timeout handling).
- `ls`, `cat`, `head`, `tail` — work in PowerShell as aliases, also work in Bash. Use Bash for consistency.
- `curl` — both have it.
- PowerShell cmdlets (`Get-ChildItem`, `Test-Path`, anything `Verb-Noun`) — use PowerShell.
- POSIX-only constructs (`$()`, `[[ ]]`, etc.) — use Bash.
- Analyzer commands **must** invoke the venv interpreter directly — `services\analyzer\.venv\Scripts\python.exe`, never a bare `python`. A step file's Verification section that just says `pytest tests` from `services/analyzer` is shorthand for that; run it as `.venv\Scripts\python.exe -m pytest tests`.

For a typical Verification block of `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`, use Bash. If a step file's Verification explicitly uses PowerShell syntax (e.g., `Test-Path apps/web/package.json`), use PowerShell.

## Running a Command

For each command:

1. Invoke `Bash` (or `PowerShell`) with:
   - `command`: the exact line from the Verification block, with trailing `# comment` stripped (but keep the comment as the "expected" hint in the report).
   - `timeout`: 60000 (unless the step file documents a longer explicit timeout).
   - `description`: e.g., "Verify step 04 — pnpm --filter web exec tsc --noEmit".
2. Capture: exit code, stdout, stderr, wall-clock duration.
3. Treat as PASS if:
   - exit code 0
   - AND output is consistent with the trailing comment (if there is one — see below)
4. Treat as FAIL if:
   - exit code non-zero
   - OR command timed out
   - OR output contradicts the trailing comment

## Expected-Output Comments

Step files use trailing `# ...` comments to hint at expected behavior:

```bash
pnpm --filter web exec tsc --noEmit    # Should exit 0, no type errors
pnpm --filter web lint                 # Should exit 0, no errors (warnings OK)
git status                             # Should show clean working tree after commit
git log --oneline                      # Should show the new commit
```

You don't need to do strict regex matching against the hint. Use it as a sanity check:

- "Should exit 0" → exit 0 is enough.
- "Should show empty dirs" → output is non-empty but doesn't contain unexpected file content.
- "Should show clean working tree" → output contains "nothing to commit" or "working tree clean".
- "Should show the new commit" → output is non-empty.

If output doesn't match the hint but the exit code was 0, flag it as a SOFT FAIL — surface the discrepancy to the caller but let them decide. Hard fail only on exit code or timeout.

## Common Output Parsing

The verification commands you'll see most often in this project:

### `pnpm --filter web exec tsc --noEmit` (typecheck)

- exit 0 → PASS, no further parsing needed.
- exit non-zero → count `error TS####` lines. Report: "N type errors across M files. First failing file: `<path>:<line>`."

### `pnpm --filter web lint` (eslint)

- exit 0 → PASS.
- exit non-zero → parse the summary line at the bottom: `✖ N problems (X errors, Y warnings)`. Treat any errors (X > 0) as FAIL. Warnings alone (X = 0) are a PASS with a note.

### `pnpm --filter web build` (next build)

- exit 0 → PASS.
- exit non-zero → look for `Error:` or `Failed to compile` markers. Capture the first error block (usually 5-15 lines).

### `cd services/analyzer && .venv\Scripts\python.exe -m pytest tests` (analyzer suite)

- exit 0 → PASS. The suite is ~28 tests, hermetic, no video/GPU/out/ needed, ~0.5s.
- exit non-zero → parse pytest's summary line (`N failed, M passed`). Capture the first failing test's name and assertion. If the failure is a golden-snapshot diff (`test_stages.py`), note explicitly that this proves something *changed*, not that it's wrong — the caller decides whether a deliberate `--update-golden` re-run is warranted, this skill never runs that flag on its own.
- There is no JS/TS test runner (`vitest`/`jest`) configured in this project yet. If a step file's Verification references one, that's itself a finding — surface it rather than guessing at a command.

### `git status`

- Look for "nothing to commit, working tree clean" → clean.
- Anything else in the output → dirty. Whether that's a pass or fail depends on what the step expected (usually clean after commit, dirty when about to commit).

### `git log --oneline`

- Non-empty output → PASS (commits exist).
- Empty output → FAIL (no commits).

### `ls <path>` / `cat <path>` / `Test-Path <path>`

- Existence checks. If the command itself succeeds, the file/dir exists. If output is requested to contain specific content, check for it.

### `curl http://127.0.0.1:<port>`

- HTTP 2xx → PASS.
- Connection refused → FAIL with "service not running on port".
- HTTP 5xx → FAIL with "service responding but erroring".

## Manual Checks

When you encounter a manual check, do NOT skip it and do NOT guess. Triage it:

- **Objectively checkable without a browser** (a file exists, a route returns 2xx, a JSON artifact has the expected keys, a CLI debug script like `checkclub.py`/`checkangles.py` prints the expected marker) → automate directly with `Bash`/`curl`/the relevant script.
- **Genuinely subjective, or requires a browser** (does the overlay look right, does the scorecard read cleanly at a glance, "no console errors" in a running `pnpm dev` session) → ask via `AskUserQuestion`. This project has no e2e/browser-automation tooling installed as of this port — if one is added later, prefer it for the objectively-checkable-in-a-browser subset (page renders, no console errors, a link routes) instead of asking the user; until then, that subset also goes through `AskUserQuestion`.

Example, for "Confirm the new pose-model overlay looks right at Address":

```
question: "Manual verification needed for step 04: Does the new pose-model overlay look right at the Address checkpoint (skeleton aligned, no obvious joint drift)?"
header: "Manual check"
options:
  - label: "Yes, looks good"
    description: "Skeleton aligns with the golfer at Address"
  - label: "No, there are issues"
    description: "Joints are off, drift is visible, or something else looks wrong"
```

If the user picks "Yes" → mark the manual check PASS.
If "No" → mark FAIL, ask a follow-up for details.

Group multiple manual checks into one `AskUserQuestion` call when you can (use `multiSelect`). Don't fire four separate questions if they're related.

If the user can't answer right now (out of session, doesn't want to drop what they're doing), report PENDING and let the orchestrator decide whether to wait or pause the step.

## Structured Report Format

This is the exact shape to produce. The orchestrator reads it programmatically.

```markdown
## Verification Report — Step NN

**Overall:** PASS | FAIL | PENDING
**Commands run:** N
**Passed:** N
**Failed:** N
**Pending manual checks:** N
**Total duration:** Xs

### Results

| # | Type | Command / Check | Result | Duration | Notes |
|---|------|----------------|--------|----------|-------|
| 1 | cmd | `pnpm --filter web exec tsc --noEmit` | PASS | 2.3s | exit 0 |
| 2 | cmd | `pnpm --filter web lint` | FAIL | 3.1s | 2 lint errors |
| 3 | cmd | `cd services/analyzer && .venv\Scripts\python.exe -m pytest tests` | PASS | 0.6s | 28 passed |
| 4 | manual | Confirm the overlay looks right at Address | PENDING | — | awaiting user |

### Failed Commands

#### 2. `pnpm --filter web lint`
- Exit code: 1
- Duration: 3.1s
- Output (last 30 lines):
\`\`\`
apps/web/src/components/OverlayMenu.tsx
  14:7  error  'unusedVar' is defined but never used  no-unused-vars
\`\`\`
- Likely cause: leftover variable from the refactor in this step; remove it or use it.

### Pending Manual Checks

- Confirm the overlay looks right at Address.

### Recommendation

FAIL — do not mark step 04 complete. Fix the lint error in apps/web/src/components/OverlayMenu.tsx and re-run /verify.
```

### Overall determination

- `PASS` — every command passed AND every manual check passed AND no soft fails.
- `FAIL` — at least one command failed.
- `PENDING` — no failures, but at least one manual check unresolved.

Soft fails (output doesn't match hint, but exit code 0) downgrade an otherwise-PASS to FAIL only if the caller asks for strict mode. Default behavior: surface the soft fail in the Notes column but don't downgrade overall.

## Edge Cases

### No Verification section in the step file

Surface to the caller: "Step NN has no `## Verification` section. Cannot verify autonomously." Recommend the step author add one, or treat as a manual-only step.

### Empty Verification section (heading but no content)

Same as above. Don't invent commands.

### Verification command references undefined env vars

If a command fails with "command not found" or "X is not set", that's a FAIL with classification hint that this is likely a missing-dependency / missing-env issue (e.g. a missing `ROBOFLOW_API_KEY` for the club-dataset fetch script, or `DATABASE_URL` for a Drizzle command). The orchestrator's blocker-protocol will pick it up and classify properly.

### A command outputs a credential or secret

This is rare but possible (e.g., `git config --get`). Scrub anything that looks secret-shaped before putting output in the report. NEVER log, print, echo, or expose any environment variable value in the report. If you see `=` in a place where a secret might appear (e.g., `DATABASE_URL=postgres://user:pass@...`), redact the value to `<REDACTED>` in the report.

### A command is destructive

Verification commands in step files should be read-only by convention. If a step file's Verification section contains something like `rm`, `DROP`, `git reset --hard`, `docker compose down -v`, refuse to run it and surface to the user as a step-file authoring bug. Verification should observe, not mutate.

## When NOT to Use This Skill

- **Running build commands that are part of the step's `Steps` section** (the execution work). That's the orchestrator's job, not this skill's. This skill only runs `## Verification`.
- **General-purpose typecheck / lint / test outside the build orchestration system.** For ad-hoc checks, just run the command directly.
- **Drift detection across unrelated files.** This skill verifies a single step's checks; if the user wants to know "what changed since X commit," that's a `git diff` job, not verification.

## Quick Reference — Decision Tree

```
For each item in Verification section:
  Is it inside a fenced code block?
    Yes → command. Run it with 60s timeout (or the step's documented override).
      Exit 0 AND output matches hint? → PASS
      Exit 0 AND output contradicts hint? → SOFT FAIL (note it, don't downgrade)
      Exit non-zero? → FAIL (capture exit code + last 30 lines)
      Timed out? → FAIL (treat as exit code -1)
    No → manual check.
      Objectively checkable without a browser? → automate with Bash/curl/the relevant script.
      Subjective, or browser-only with no tooling installed? → AskUserQuestion. Capture answer.
        Yes → PASS
        No → FAIL (ask follow-up for details)
        Unavailable → PENDING

Aggregate:
  Any FAIL? → Overall FAIL.
  No FAILs but any PENDING? → Overall PENDING.
  All PASS? → Overall PASS.
```
