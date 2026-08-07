# SwingSage Build Instructions — README

> This is the **step-file template / scaffolding reference** shared by every build track.
> The build is organized as independent **tracks**, each a self-contained mini-build living
> under `.claude/feature-tracks/<name>/`, indexed by `.claude/ROADMAP.json` (rendered by
> `/roadmap`). One track may be marked `spine: true` — that's the one `/build` targets,
> resolved dynamically from `ROADMAP.json` (there may be none yet). Any track, spine or not,
> runs via `/feature <name>`. Use this README for the **Step File Structure**, **Status
> Tracking**, **Self-Healing**, and **Blocker** conventions below — they are shared by every
> track. To add a track, either scaffold it by hand (`mkdir` the directory, drop a
> `_STATUS.json` + `_PROGRESS.md`, add a `ROADMAP.json` entry) or let the first `/feature
> <name>`/`/build` run author the first step file lazily from the track's `goal`. If that
> procedure grows enough steps to be worth writing down, capture it at
> `docs/runbooks/add-a-track.md`.

> This file documents the conventions an instruction system that Claude Code follows
> autonomously is built on.

## What This Is

A numbered sequence of work sessions per track, each with clear scope, verification, and
self-healing properties. This system is designed for **Claude Code to execute autonomously**
with status tracking, prerequisite verification, and blocker escalation — across the web app
(`apps/web`, Next.js/TypeScript) and the analyzer (`services/analyzer`, Python/CV pipeline).

## How To Use

**Starting work on the spine track:**
```
/build
```

**Starting or advancing any other track:**
```
/feature <name>
```

Both trigger the matching orchestrator skill, which reads the track's `_STATUS.json`, opens
the current numbered file (authoring it first if it doesn't exist yet), executes its steps,
verifies, and reports — running until a stop-condition, not just one step.

**Checking status:**
```
/roadmap
```
Shows every track, which is the spine, and each track's current step.

**Skipping a step (rare):**
```
/feature <name> skip --reason="why"
```
Marks the step as skipped with reason logged. Only use when a step is genuinely not
applicable.

**Resetting current step:**
```
/feature <name> reset
```
Marks current step back to not-started. Useful when an intermediate verification fails and
rollback is needed.

## File Conventions

| File | Purpose |
|------|---------|
| `00 - README.md` | This file. System documentation. |
| `_STATUS.json` | Machine-readable progress state. Updated atomically. |
| `_PROGRESS.md` | Human-readable progress log. Append-only. |
| `NN - Title.md` | Step files. Numbered sequentially. |

## Step File Structure

Every numbered file follows this exact template:

```markdown
# NN - Title

**Phase:** [phase name]
**Status:** not-started | in-progress | complete | skipped | blocked
**Estimated effort:** [hours or days]

## Overview
What this step accomplishes and why.

## Dependencies
- Step XX must be complete
- Step YY must be complete

## Architectural Context
Key decisions. References to the relevant `instructions/NN-*.md` spec doc(s) and/or
`docs/DECISIONS.md` entries.

## Files & Areas Touched
Specific paths that will be created or modified.

## Steps
Concrete actions, ordered. Not code, but specific enough for execution.

## Quality Standards
What "good" looks like. Prefer **machine-checkable** standards over prose — if a
standard can be a lint rule, a type, or a test assertion, state it as the command
that proves it (the `step-verifier` and `/heal` can then enforce it objectively).

## Verification
Commands and checks that prove completion. **Always include the objective oracle**
for the touched workspace so `/heal` can self-heal a failure. For web work:
`pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`. For analyzer work
(from `services/analyzer`): `.venv\Scripts\python.exe -m pytest tests`. A step that
touches only one side only needs that side's oracle — don't run both if only one applies.
A non-zero exit / `tsc` error / ESLint **error** / failing test is a fail; ESLint
warnings are surfaced, not blocking. Manual checks ("open localhost…") are listed
as prose and confirmed with the user — they can't be auto-verified.

## Definition of Done
Checklist of completion criteria, each phrased as a **runnable assertion** where
possible rather than a subjective "looks right". The closer the DoD is to executable,
the more the build self-heals and self-verifies.

## Notes
Anything else.
```

## Status Tracking

`_STATUS.json` shape:

```json
{
  "schemaVersion": 1,
  "currentStep": "04",
  "phase": "Upload Flow",
  "lastUpdated": "2026-08-07T14:30:00Z",
  "steps": {
    "01": { "status": "complete", "completedAt": "2026-08-06T10:00:00Z" },
    "02": { "status": "complete", "completedAt": "2026-08-06T11:30:00Z" },
    "03": { "status": "complete", "completedAt": "2026-08-06T13:00:00Z" },
    "04": { "status": "in-progress", "startedAt": "2026-08-07T14:00:00Z" },
    "05": { "status": "not-started" }
  },
  "blockers": [],
  "skipped": []
}
```

`_PROGRESS.md` is append-only — each completed step adds an entry with timestamp, summary,
and any notes worth keeping.

## Self-Healing Protocol

Before executing any step, the orchestrator:

1. **Checks status file integrity** — JSON valid, all keys present
2. **Verifies prerequisites** — runs verification commands from the previous step
3. **Confirms files exist** — anything the previous step was supposed to create
4. **Flags drift** — if anything is inconsistent, tries `/heal` first, then escalates to
   the user before proceeding if `/heal` can't converge

After executing any step, the orchestrator:

1. **Runs verification commands** specified in the step file
2. **Confirms definition of done** — every checkbox addressed
3. **Updates status atomically** — `_STATUS.json` and `_PROGRESS.md` together
4. **Commits to git** — using `/commit` (batched once per run, not once per step)

If verification fails and `/heal` can't converge, the step stays `in-progress`. The
orchestrator reports what failed and stops. It does NOT advance to the next step.

## Blocker Protocol

When Claude Code hits a blocker it cannot resolve autonomously:

1. Marks current step status as `blocked`
2. Adds entry to `blockers` array in `_STATUS.json` with description and what's needed
3. Stops work and reports to user
4. Does not attempt workarounds that compromise architectural decisions

Resolvable blockers (Claude Code handles autonomously):
- Missing npm/pip packages → install them
- Type errors → fix them
- Lint errors → fix them
- Test failures from obvious bugs → fix them

Non-resolvable blockers (escalate to user):
- Missing credentials or environment variables (e.g. `ROBOFLOW_API_KEY`)
- Strategic decisions outside the plan (new dependency/vendor, money/security/PII,
  cross-system ownership, back-compat — tactical choices inside existing conventions are
  decided autonomously and recorded, per blocker-protocol's tactical filter)
- External service authentication required
- Verification failures that suggest design issues
- Conflicts with existing data

## Token Efficiency Principles

1. **Numbered files are scoped tightly** — only the current step's content loads
2. **Skills load contextually** — only relevant skills load per task
3. **Verification uses commands** — `pnpm --filter web exec tsc --noEmit` /
   `pytest tests` return clean pass/fail
4. **Status is JSON** — fast parse, no full-file read needed
5. **No mass file reads** — orchestrator opens only what's needed
6. **Deep context lives in `instructions/` and `docs/`** — referenced, not repeated

## Modifying The Plan

If a step needs adjustment:

1. **Edit the numbered file directly** — versioned in git, change tracked
2. **Update `_STATUS.json`** if the change affects dependencies
3. **Add a note to `_PROGRESS.md`** explaining the change
4. **Don't renumber** — adding insertions is fine (e.g., `15a - Subtask.md`), renumbering
   breaks all references

## When To Use Human Review

Some steps explicitly require human review before completion — for example:
- A `scoring_config.json` threshold change that affects real swing scores
- A change to the `analysis.json` contract (doc 02's backend/player interface)
- A production deployment

These steps have a `human-review-required: true` flag in the file. The orchestrator surfaces
them, presents the artifacts, and waits for explicit approval before marking complete.

## Important References

- `instructions/` — the numbered spec docs (00 README through 08 ROADMAP); source of truth
  for the domain
- `docs/STATUS.md` — current handoff state
- `docs/DECISIONS.md` — append-only decisions log (never renumbered, never deleted)
- `CLAUDE.md` — always-loaded rules
- `.claude/skills/` — loaded contextually per task
