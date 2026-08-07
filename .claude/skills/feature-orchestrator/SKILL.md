---
name: feature-orchestrator
description: Advance an isolated feature build track (under .claude/feature-tracks/<name>/) by one step. Identical state machine to build-orchestrator but parameterized on the feature directory. Use this skill when the user types `/feature <name>` or asks to advance a tracked feature (e.g. `/feature upload-flow`). Each feature track has its own _STATUS.json + _PROGRESS.md + numbered step files. Hard rules from build-orchestrator apply unchanged - never skip Verification, never advance two steps, atomic _STATUS.json + _PROGRESS.md writes, drift detection on the previous step before starting the next. Resolve <name> to .claude/feature-tracks/<name>/ as the featureRoot.
---

# Feature Orchestrator

You are running an isolated build track in `.claude/feature-tracks/<feature>/`. Every track —
including whichever one is the current spine — uses the same state machine and discipline,
parameterized on the track directory. The macro index of all tracks is `.claude/ROADMAP.json`
(rendered by `/roadmap`); `/build` runs whichever track is marked `spine: true` there (resolved
dynamically — never assume which one, and there may be no spine track declared yet), and
`/feature <name>` runs any track by id.

This skill is the general track runner. `build-orchestrator` is the same machine pre-pointed
at the spine track; this one takes the track name as a parameter. Tracks need atomicity +
verification gates + drift detection while keeping fully independent state — no track's
progress is coupled to another's. The step-file template and shared conventions live at
`.claude/ai-instructions/00 - README.md`.

## When this skill triggers

- User types `/feature <name>` (e.g. `/feature upload-flow`)
- User asks "advance the <name> feature track" / "what's next on <name>" / "verify the current step of <name>"
- User asks to set up a new feature track

## Run cadence — run until a stop-condition (identical to build-orchestrator)

A `/feature <name>` invocation is a **run**: it advances the track step-by-step and keeps
going until a **stop-condition** — verification fails and `/heal` can't converge, the next
step is `human-review-required` (stop *before* executing it), a blocker is classified, drift
that `/heal` can't fix is detected (start-of-run only), or the track ends. It does NOT stop
after one step.

- **Commit once per run, not per step.** Accumulate completed steps; make a single `/commit`
  when the run stops (covering every step that completed — including the steps that completed
  before a mid-run failure). `_STATUS.json` + `_PROGRESS.md` still advance atomically per step;
  only the git commit is batched.
- **Escape hatches:** `/feature <name> once` (advance exactly one step), `/feature <name> to
  NN` (run through step `NN`). A bare `/feature <name>` runs until a stop-condition.
- **Drift check runs once** (start of run); skip it on the 2nd-and-later steps — you verified
  the prior step seconds ago.
- **Track end stops the run** — run the completion sweep, report done, never auto-jump to
  another track.

## The per-step cycle (identical to build-orchestrator, parameterized)

**Validate `<name>` first:** confirm it's a declared track in `.claude/ROADMAP.json` (a
`tracks[].id`). If not, STOP with an actionable error ("no track `<name>` — run `/roadmap` to
list tracks; did you mean `<closest>`?") rather than failing later at file-read. Then resolve
`<name>` to `featureRoot = .claude/feature-tracks/<name>/` and run the canonical sequence:

1. **Read `<featureRoot>/_STATUS.json`** — source of truth for current position. (If it's
   missing for a declared-but-unscaffolded track, treat as a fresh scaffold: `currentStep
   "01"`, all `not-started`.)
2. **Identify current step** via `currentStep`. Fall back to first `not-started` step if
   missing.
3. **Verify previous step still passes** — extract its Verification section, run each
   command. Drift → heal-first (same as build-orchestrator): AUTONOMOUS-FIX-class → `/heal`
   with the previous step's Verification as the oracle, converges → note it and continue;
   otherwise stop, do not advance.
4. **Load current numbered file** from `<featureRoot>/`. **Author-on-first-run:** if the
   current-step file doesn't exist yet (lazy-step-files — a `planned`/new track whose
   `_STATUS.json` declares the step but no `NN - *.md` was written), author it first — ground
   it with an `Explore` fan-out (per Delegation defaults), then write it from the track's
   `ROADMAP.json` `goal` + `_PROGRESS.md` intent using the 8-section template
   (`.claude/ai-instructions/00 - README.md`), scoped to the single next step, then continue —
   do NOT error. Read `Dependencies`; confirm each is `complete` in this feature's
   `_STATUS.json` (not the spine's). Cross-track `dependsOn` (in ROADMAP.json) — an unmet
   `"blocking": false` entry is warn-and-continue (log it in the run report; it's a soft
   sequencing note, not a prerequisite); an unmet blocking dependency (`true` or unspecified)
   is warn-and-ask.
5. **Check `human-review-required: true`** in frontmatter or body. Note for
   stop-before-complete.
6. **Set current step `in-progress`** in `<featureRoot>/_STATUS.json`. Set `startedAt`
   (ISO-8601 UTC). Atomic write.
7. **Execute the step's `Steps` section** sequentially. Load sub-skills only when the step's
   domain demands them.
8. **Run `Verification`** section. Exit code 0 + clean output = pass. >60s timeout = fail.
9. **On pass + no human review** — set `complete`, clear `startedAt`, set `completedAt`,
   advance `currentStep`. Append entry to top of `<featureRoot>/_PROGRESS.md`. Add the step to
   the run's completed-set. **Do NOT commit yet** — **continue the run**: loop back to step 1
   for the next step (re-read `_STATUS.json` fresh; skip the drift check). Keep going until a
   stop-condition — unless `once` (stop after this step) or `to NN` (stop after `NN`). When the
   run stops, make **one** `/commit` referencing the feature + step range (e.g.
   `feat(upload-flow): steps upload-flow/01–03 …`).
10. **On pass + human review** — keep `in-progress`. Surface artifacts for review. Wait for
    approval; on approval do step 9's status/progress update, then **end the run** (commit the
    completed steps, stop — don't auto-continue past a checkpoint). An autonomous run halts
    *before* a human-review step anyway; this branch is for `once`/post-stop execution.
11. **On fail — bounded self-heal before stopping.** Classify via `blocker-protocol`. If
    **AUTONOMOUS-FIX** (type/lint error, failing test from an obvious bug, clear convention
    fix), invoke **`/heal`** scoped to this step's diff, using the step's `## Verification` as
    the oracle (fresh-eyes check + bounded 3-attempt loop, never cheats to green). If `/heal`
    **converges**, proceed as a normal pass (advance + `_PROGRESS.md`, continue the run),
    noting the self-heal + `.claude/heal-log.md`. If `/heal` **can't converge** (3 attempts /
    oscillation / one of the 4 escalation triggers) OR the failure is not AUTONOMOUS-FIX: keep
    `in-progress`, set `blocked` per `blocker-protocol`, report command + exit code + what heal
    tried, then **commit any steps that completed earlier in the run** and Stop. Never advance
    the step from inside `/heal` — that stays the orchestrator's atomic job.

## Track-completion advisory sweep

When the step just completed was the **last** in this track (no `not-started`/`in-progress`
steps remain in `<featureRoot>/_STATUS.json`), run a one-time advisory sweep on the track's
full diff before reporting the track done (never per step):

1. **`/checkpoint`** (revert path — the sweep may auto-apply fixes).
2. **`/knip --changed`** + a **fresh-eyes 13-axis review** (the `/audit` reviewer subagent)
   over the track's changed files.
3. **Auto-apply the safe/deterministic subset** under `/heal`'s 4-condition guardrail;
   `/commit` it; log to `.claude/heal-log.md`.
4. **Surface subjective/irreversible findings** in the report — don't auto-apply. If findings
   exceed `/heal`'s inline threshold, point at a `/audit` instead.

## Hard rules

- Never skip Verification.
- Advance steps strictly sequentially — each fully verified and its state written atomically
  before the next begins — but **keep going until a stop-condition**; don't stop after one
  step. The loop is sequential and per-step atomic; only the git **commit** is batched (one per
  run). `once` caps the run at one step; `to NN` caps it at step `NN`.
- Always update `_STATUS.json` + `_PROGRESS.md` together. Atomic. Both files must reflect a
  successful step before moving to the next.
- If `human-review-required`, STOP before marking complete.
- Strategic decisions inside a step (new dependency/vendor, money/security/PII, cross-system
  ownership, back-compat) are blockers — escalate via blocker-protocol if installed, surface
  inline if not. Do not pick. Tactical choices constrained by existing conventions are NOT
  blockers — decide on best practices, record in `_PROGRESS.md`, continue (blocker-protocol's
  tactical filter).
- Each track's `_STATUS.json` is INDEPENDENT of every other track's. They never share state —
  one track advancing never pauses or mutates another. Cross-track dependencies are declared
  in `.claude/ROADMAP.json` (`dependsOn`): soft (`blocking: false`) warns and continues, hard
  warns and asks — never a hard block. Macro rollup is DERIVED by the `roadmap` skill, never
  duplicated into any track.

## Status JSON shape (identical to build-orchestrator)

```json
{
  "schemaVersion": 1,
  "featureName": "upload-flow",
  "currentStep": "01",
  "phase": "Foundations",
  "lastUpdated": "2026-08-07T00:00:00Z",
  "steps": {
    "01": { "status": "not-started" }
  },
  "blockers": [],
  "skipped": []
}
```

Valid `status` values: `not-started` | `in-progress` | `complete` | `skipped` | `blocked`.

Allowed transitions: identical to build-orchestrator.

## Progress log entry format

When a step completes, prepend to `<featureRoot>/_PROGRESS.md`:

```
## NN - {Step Title}
**Completed:** YYYY-MM-DD HH:MM UTC
**Phase:** {phase}
**Summary:** {1-2 sentences — concrete, not generic}
**Notes:** {anything worth remembering, or "None"}

---
```

## Sub-commands

- `/feature <name>` → run from the current step until a stop-condition (canonical)
- `/feature <name> once` → advance exactly one step, then stop
- `/feature <name> to NN` → run through step `NN` (inclusive), then stop
- `/feature <name> status` → read-only summary of position
- `/feature <name> verify` → re-run the current step's Verification (drift check without
  advancing)
- `/feature <name> reset` → reset current step to `not-started` (destructive — confirm with
  user first)
- `/feature <name> skip --reason="..."` → mark current step skipped (requires explicit reason)
- `/feature <name> blocker` → invoke blocker-protocol against the current step

## Drift and self-healing

Same rules as build-orchestrator:

- If previous step's Verification fails now → drift. Heal-first: AUTONOMOUS-FIX-class →
  `/heal` (previous step's Verification as oracle), converges → note in the run report and
  continue. Otherwise surface to user, do not advance.
- If `_STATUS.json` is malformed → recover from `_PROGRESS.md` last entry. Ask user to
  spot-check.
- If `_STATUS.json` missing entirely → treat as fresh feature scaffold (currentStep "01", all
  not-started). Tell user.

## Token efficiency

- Read `_STATUS.json` once per invocation.
- Read only the current step's file. Do not pre-load adjacent steps.
- Read the previous step's file only to extract Verification.
- Skip sub-skills that don't match the step's domain.

## Available feature tracks

**Discover tracks dynamically — never trust a hardcoded list here (it goes stale).** The
authoritative set is the `tracks[]` array in `.claude/ROADMAP.json`; each declared track has a
directory under `.claude/feature-tracks/<id>/` with (eventually) a `_STATUS.json` +
`_PROGRESS.md` + step files. To see the current set and their status, run `/roadmap`. Which
track is the spine is also read from `ROADMAP.json` (`spine: true`) — `/build` targets it,
everything else runs via `/feature <name>`.

**Lazy scaffolding:** a `planned` track may have a `_STATUS.json` declaring `currentStep "01"`
but no authored `01 - *.md` yet. The first `/feature <name>` that reaches it **authors the
current step file on the fly** (step 4 above) from the track's `ROADMAP.json` `goal` — that is
the "scaffolded on first run" behavior. To add a track manually: `mkdir` the directory under
`.claude/feature-tracks/<id>/`, drop a `_STATUS.json` + `_PROGRESS.md`, add a `ROADMAP.json`
entry, run `/roadmap` — no code changes to this skill. If that procedure grows enough steps to
be worth writing down, capture it at `docs/runbooks/add-a-track.md`.

## What success looks like (one run)

1. Read `<featureRoot>/_STATUS.json`. Drift-check the last completed step **once**; green.
2. **Each step in turn:** read its file; deps complete, no human-review → set `in-progress`,
   execute Steps, run Verification, pass → mark `complete`, advance `currentStep`, append
   `_PROGRESS.md`, add to completed-set. Loop to the next step (skip the drift check now).
3. The run continues until a stop-condition — say step `NN` is `human-review-required` → stop
   *before* it.
4. **One `/commit`** covering all steps completed this run.
5. Report: which steps completed (a concrete sentence each), why it stopped, what's next.

Lean, gated, **per-step atomic, one commit per run**. Same shape as build-orchestrator. `once`
collapses it to a single step.

## Delegation defaults (subagents)

Same as build-orchestrator: implementation stays in THIS session (track context + prompt-cache
economics). Delegate side work — `docs-researcher` before coding against an external library,
an `Explore` fan-out (1–3 agents) before authoring a lazy step file, `fresh-eyes-reviewer` for
the end-of-track review, `ops-investigator` for read-only infra triage, a Workflow only on
explicit user opt-in for wide sweeps. Parallel file-mutating agents get `isolation: worktree`.
