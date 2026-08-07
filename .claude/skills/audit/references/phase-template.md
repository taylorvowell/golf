# Phase Document Template

This template produces each `NN-phase-N-<slug>.md` file in an audit folder. One file per phase. The file is designed so a fresh Claude can execute it without needing the surrounding chat context.

Copy the structure below into each phase file, replacing `<bracketed>` placeholders.

---

```markdown
# Phase <N>: <Phase Title>

| Field          | Value                              |
|----------------|-------------------------------------|
| Audit          | <audit-slug-YYYY-MM-DD>            |
| Phase          | <N> of <total>                     |
| Resolves       | C1, H2, M3                         |
| Effort         | Quick / Moderate / Large           |
| Touches        | <N> files                          |
| Dependencies   | Phase <N-1> complete, or "None"    |
| Status         | Pending                            |
| Checkpoint     | Required / Not required            |

## Goal

<One paragraph. What is this phase accomplishing? What does the codebase look like before vs. after?>

## Findings resolved by this phase

For each finding ID listed above, restate the recommendation here so the executor doesn't have to jump back to the overview:

- **C1 — <short title>:** <recommendation, verbatim from overview>
- **H2 — <short title>:** <recommendation, verbatim from overview>

## Preconditions

Run each check before starting. If any fails, STOP and report to the user.

```bash
# Example checks. Replace with phase-specific ones.
test -f services/analyzer/scoring_config/v3.json
git status --porcelain | wc -l    # expect 0 — working tree should be clean
```

Also confirm:
- Previous phase status in `_status.md` is `complete` (if this phase has a dependency).
- No uncommitted changes in the audit's scope (working tree clean for the touched files).

## Tasks

Numbered, ordered, atomic. Each task has: file path, change description, and (if non-obvious) a code sketch or before/after.

### Task 1 — <verb-noun: "Move ROT-04's threshold into scoring_config/v3.json">

**File:** [services/analyzer/swingsage/scoring.py](services/analyzer/swingsage/scoring.py)

**Change:** Replace the literal `0.12` used by `ROT-04`'s comparison with a read from the loaded config object, matching the pattern every other check in the file already uses.

**Sketch:**

```python
# Before
def check_rot_04(metrics: Metrics) -> CheckResult:
    threshold = 0.12  # hardcoded
    return evaluate(metrics.hip_turn_from_address, threshold, direction="above")

# After
def check_rot_04(metrics: Metrics, config: ScoringConfig) -> CheckResult:
    threshold = config.thresholds["ROT-04"]
    return evaluate(metrics.hip_turn_from_address, threshold, direction="above")
```

**Why this task is here:** Resolves C1 — every other check in `scoring.py` reads its threshold from `scoring_config/<version>.json`; `ROT-04` was the one left hardcoded when it was added, which means changing its threshold today requires a code change instead of a config change, and it never got a `scoring_model_version` bump when its number last changed.

### Task 2 — <verb-noun>

**File:** ...

**Change:** ...

### Task 3 — Verify the raw-value direction across all fixtures

**Files:**
- [services/analyzer/scripts/checkangles.py](services/analyzer/scripts/checkangles.py) or an ad-hoc print added temporarily to `scoring.py`

**Change:** Print `metrics.hip_turn_from_address`'s raw value at the checkpoint for every fixture in `out/`. Confirm the value moves in the direction `ROT-04`'s band assumes (increases as the check should score higher). If it's inverted — this is exactly the failure mode `docs/DECISIONS.md`'s D42 entry documents for v1's rotation checks — fix the comparison direction, not the score.

### Task 4 — Add a `docs/DECISIONS.md` entry

**File:** [docs/DECISIONS.md](docs/DECISIONS.md)

**Change:** Append a new D-number entry (never renumber or insert) documenting: what `ROT-04` measures, why `0.12`, which fixtures its direction was verified against, and its `Status: ACTIVE`.

## Verification

Run each command. **Pass** = all return exit 0 and (where checked) the expected output. **Fail** = any non-zero exit, unexpected output, or timeout >60s.

```bash
# Analyzer changes: from services/analyzer, hermetic, no video/GPU/out/ needed
.venv\Scripts\python.exe -m pytest tests

# Web changes (only if apps/web files were touched in this phase)
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint

# The hardcoded literal is actually gone
! grep -q "0.12" services/analyzer/swingsage/scoring.py

# docs/DECISIONS.md has a new entry for this check
grep -q "ROT-04" docs/DECISIONS.md
```

Note what a passing `pytest tests` run does and doesn't prove: it confirms the deterministic stages still produce the same golden-snapshot output and that the contract invariants (49-keypoint order, truncated confidence, etc.) still hold. It does **not** prove `ROT-04`'s band is correct — that's what Task 3's fixture check is for, and hand-labeled ground truth doesn't exist yet to prove it beyond that. If this phase's Goal implies "the check is now correct," Verification must show the fixture-direction check's output, not just a green pytest run.

### Manual check (only when this phase changes user-facing player/UI behavior)

This project has no Vitest/Playwright suite (`.claude/rules/testing.md`) — there is no automated way to verify rendered output or interaction behavior. If this phase changes something a user would see or feel (a new score visual, a change to the transport, an overlay), add an explicit Manual check instead of assuming typecheck+lint is sufficient:

> **Manual check:** Run `pnpm dev`, open a swing page, and confirm `<specific thing to look at>` renders/behaves as expected. This is an Escalation Trigger per the overview's Execution Instructions — execution pauses for user confirmation before this phase is marked complete.

Use Manual checks sparingly — only for phases that actually touch rendered/interactive output. A phase that only moves a threshold into config, or only adds a `docs/DECISIONS.md` entry, needs no Manual check; typecheck/lint/pytest alone is sufficient Verification for those.

## Completion criteria

This phase is complete when:

- All Verification commands return exit 0.
- Any manual checks have been confirmed by the user.
- `_status.md` shows phase `<N>` status as `complete` with `completedAt` set.
- A git commit covering this phase has been created via `/commit`.

## Rollback

If this phase needs to be rolled back after partial execution:

- **If a `checkpoint` was created** (the table at the top says `Checkpoint: Required`): use `/rollback` to restore. Then update `_status.md` to set this phase back to `pending` and clear `startedAt`/`completedAt`.
- **If no checkpoint exists:** `git reset --hard HEAD~1` undoes the last commit but only after confirmation from the user. Never do this without asking.

## Notes for the AI coder

<Use this section only if there's something non-obvious about executing this phase. Examples:>
- "Task 3 must happen after Task 1 — if you swap them, you're checking the direction of a value that's still gated behind the old hardcoded threshold."
- "If `pytest tests` fails after Task 1, the most likely cause is a test that asserted the old literal directly — check `tests/test_invariants.py` for a stale expected value before assuming the config load is broken."
- "Re-running `burnin.py` to regenerate fixture output for Task 3 requires `--club-detector runs/clubhead/weights/best.pt` — omitting it silently regenerates the weaker trace and would invalidate this phase's fixture check."

If there's nothing tricky, omit this section.
```

---

## Notes on filling out the phase template

**Tasks are atomic.** Each task should be either fully done or not started — never partially done. If you can't make a task atomic, split it.

**File paths everywhere.** Every task names the file(s) it touches. The executor should never have to grep around to figure out what to change.

**Code sketches when the change is non-obvious.** For "rename X to Y" tasks, a description is enough. For "read this threshold from config instead of a literal," include a code block so the executor doesn't have to invent the structure.

**Verification commands are real.** Don't put `# pseudo-verification` — the executor will literally run these. If you can't write a verification command, the phase isn't well-bounded enough; rethink the phase boundary.

**Be explicit about what a green test run does and doesn't prove.** This project's own test suite makes a hard distinction between golden-snapshot (proves nothing changed), contract-invariant (holds regardless of fixture count), and hand-labeled (proves correctness, currently unfilled) checks. A phase doc that lets the executor believe "tests pass" means "the number is now correct" is misleading — say explicitly which kind of proof each Verification step provides.

**Manual checks are flagged explicitly.** The phase doc should never silently rely on the executor "checking the page renders." Either it's a command, or it's an explicit `Manual check:` callout that pauses for user confirmation.

**Rollback is not optional.** Every phase has a rollback strategy. The `checkpoint` flag in the header table determines whether `/rollback` is the strategy or whether `git reset` is.

**Phase docs are independent.** Don't say "see phase 1 for context" — restate what's needed. A future Claude might pick up at phase 3 in a fresh session.
