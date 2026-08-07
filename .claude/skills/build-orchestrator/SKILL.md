---
name: build-orchestrator
description: Advances SwingSage's build's SPINE track, running step-by-step until a stop-condition. The build is organized as independent tracks under a single ROADMAP index (.claude/ROADMAP.json); /build resolves the track marked spine:true and runs it. Reads that track's _STATUS.json, verifies the previous step still passes, executes the current step's Steps section, runs Verification, and only then advances. Use this skill whenever the user types /build, "build the next step", "continue building", "run the next step", or "what's next" in the context of the SwingSage spine build. Also use it preemptively when the user references the spine track's _STATUS.json or build progress. For ANY non-spine track use feature-orchestrator (/feature <name>); for the macro picture across all tracks use the roadmap skill (/roadmap). This skill MUST be the entry point for spine step execution; never execute a numbered step file directly without going through this orchestrator, or status tracking, verification, and atomicity guarantees will be lost.
---

# Build Orchestrator

You are running a long, deterministic, multi-session build plan, organized as independent
**tracks**. `/build` operates on the **spine track** — the one marked `spine: true` in
`.claude/ROADMAP.json`. Resolve it first: read `.claude/ROADMAP.json`, find the single track
with `spine: true` and `lifecycle: active`, and use its `statusFile`'s directory as
`<trackRoot>`. **Resolve this dynamically every run — never hardcode which track is the spine;
the flag is movable and `.claude/ROADMAP.json` is the sole authority** (do NOT trust any
`spine` field inside a track's `_STATUS.json` — it shouldn't exist there). If `.claude/ROADMAP.json`
doesn't exist yet, or no track is marked `spine: true`, STOP and tell the user there's no spine
track to build yet — point them at `/architect` or `/feature` to set one up. That track has
numbered step files and a `_STATUS.json` tracking which step is current. Your job is to advance
it **one verified step at a time, continuing automatically to the next step until you hit a
stop-condition** (see "Run cadence" below) — every step still individually gated by
verification. (Mechanically identical to `feature-orchestrator`, which does the same for any
named track — `spine: true` just marks which track `/build` defaults to. The flag is movable:
set it on whichever track is the current top priority.)

The step-file template and shared conventions live at `.claude/ai-instructions/00 - README.md`.
The macro index of every track is `.claude/ROADMAP.json`, rendered by `/roadmap`.

The reason this skill exists is that ad-hoc execution loses guarantees the user is relying on:

- **Atomicity** — `_STATUS.json` and `_PROGRESS.md` must move together. Half-updates create a
  system the user can no longer trust to tell them where they are.
- **Verification before advance** — every step has a Verification section that must pass
  before the step is marked complete. If you skip it, broken state silently compounds across
  steps.
- **Drift detection** — previous steps' verifications must *still* pass before starting a new
  one. If something rotted (lost env var, deleted file, broken install), advancing without
  noticing buries the regression under new work.

Treat the workflow below as a state machine, not a checklist. Each transition must be earned.

## Run cadence — run until a stop-condition

A `/build` invocation is a **run**: it advances the spine track step-by-step and keeps going
until it hits a **stop-condition**. It does NOT stop after one step. The per-step cycle (the 11
numbered steps below) executes once per step; loop it.

**Stop-conditions (halt the run, report, and stop the moment any one is true):**

1. **Verification fails** and `/heal` can't converge (the step is left `in-progress`/`blocked`
   — see step 11).
2. **The next step is `human-review-required: true`** — stop *before* executing it and surface
   for approval (a run never auto-runs a human-review step).
3. **A blocker** is classified USER-ACTION-NEEDED / ARCHITECTURAL-DECISION /
   EXTERNAL-DEPENDENCY (step blocked, surfaced).
4. **Drift** the start-of-run check finds that `/heal` can't fix (see step 3 —
   autonomous-fix-class drift heals in place and the run continues).
5. **Track end** — no `not-started` step remains. Run the track-completion advisory sweep,
   report the track done, and **stop — never auto-advance into another track.**

**Escape hatches (override the default):**
- `/build once` — advance **exactly one** step, then stop (the old per-invocation behavior).
- `/build to NN` — run **through** step `NN` (inclusive), then stop even if more steps remain.
- A bare `/build` runs until a stop-condition.

**Commit cadence: one commit per run, not per step.** Do NOT `/commit` after each step.
Accumulate the run's completed steps and make a **single** commit when the run stops (success,
partial, or at a stop-condition) — covering every step that completed this run, so no verified
work is ever left uncommitted. `_STATUS.json` + `_PROGRESS.md` still advance atomically **per
step** (state integrity is per-step); only the git commit is batched (rollback granularity
becomes per-run — `/checkpoint` before risky steps if you want finer revert points within a
run).

## The Per-Step Cycle

This is the canonical sequence for a single step. Do not reorder. Do not skip. Repeat it for
each step of the run until a stop-condition fires.

1. **Resolve the spine track** from `.claude/ROADMAP.json` (the single track with `spine:
   true` and `lifecycle: active`); its `statusFile`'s directory is `<trackRoot>`. Then **read
   `<trackRoot>/_STATUS.json`** — that is the only place the spine's current position is
   authoritative. If zero or more than one track is `spine: true` active, STOP and tell the
   user to run `/roadmap` and pick one — `/build` has no unambiguous target.
2. **Identify the current step** — use the `currentStep` field. If it's missing or null, fall
   back to the first step whose `status` is `not-started`.
3. **Verify the previous step still passes (first step of the run only).** Read the previous
   step's numbered file (in `<trackRoot>`), extract its Verification section, run each command.
   If anything fails, this is *drift* — treat it like any mid-run verification failure:
   classify via `blocker-protocol`; if AUTONOMOUS-FIX-class, run `/heal` scoped to the drift
   with the previous step's Verification as the oracle — converges → note the self-heal in the
   run report and continue; can't converge or not autonomous-fix-class → surface to the user
   and do NOT advance (see "Drift and Self-Healing" below). **On the 2nd-and-later steps of a
   multi-step run, skip this** — the "previous step" is one you completed and verified seconds
   ago in this same run, so re-running it is wasted work. Go straight to step 4.
4. **Load the current numbered file** from `<trackRoot>` (e.g., `01 - Upload Endpoint.md`).
   **Author-on-first-run:** if the current-step file does NOT exist (a freshly-added or
   `planned` track whose `_STATUS.json` declares the step but no `NN - *.md` was written yet —
   the "lazy step files" policy), do not error — **author it first**: fan out 1–3 `Explore`
   agents to ground it in the actual codebase (similar features, the touched area's
   architecture, extension points) and read the key files they cite; then, from the track's
   `goal` in `.claude/ROADMAP.json` + this track's `_PROGRESS.md` intent, write
   `<trackRoot>/<currentStep> - <Title>.md` following the 8-section template
   (`.claude/ai-instructions/00 - README.md`: Overview / Dependencies / Architectural Context /
   Files & Areas Touched / Steps / Quality Standards / Verification / Definition of Done /
   Notes), scoped to the single next step. Then continue. (This is the "scaffolded on first
   run" behavior.) Once loaded, read its `Dependencies` section. For each in-track dependency,
   confirm the matching step in `<trackRoot>/_STATUS.json` is `complete`. Then check
   **cross-track** dependencies: read this track's `dependsOn` array in `.claude/ROADMAP.json`
   and read those tracks' `statusFile`s. An unmet `"blocking": false` entry is
   **warn-and-continue** — log the warning in the run report and keep going (it's a soft
   sequencing note, not a prerequisite). An unmet **blocking** dependency (`true` or
   unspecified) is **warn-and-ask** ("this track depends on `<X>` which isn't complete —
   proceed anyway?") — still not a hard block, since working out of order is legitimate. If an
   *in-track* dependency is not complete, stop and tell the user — do not improvise around
   missing prerequisites.
5. **Check for `human-review-required: true`** in the file's frontmatter or body. If present,
   note it — you'll stop for approval at the end before marking complete.
6. **Set the current step status to `in-progress`** in `_STATUS.json`. Also set `startedAt` to
   the current ISO-8601 UTC timestamp. Write the file atomically (read whole, modify in memory,
   write whole back — see `references/status-json-examples.md`).
7. **Execute the step's `Steps` section sequentially.** These are concrete actions, not just
   suggestions. If a step needs a sub-skill (e.g., a component pattern, a CV pipeline stage, a
   Drizzle migration), load that skill *only if relevant* — see "Token Efficiency" below.
8. **Run the step's `Verification` section.** Run every command. Capture exit codes and
   output. Treat any non-zero exit, timeout (>60s), or unexpected output as a failure.
9. **If `Verification` passes AND no human-review flag:**
   - Update `_STATUS.json`: set step `status` to `complete`, `completedAt` to ISO-8601 UTC,
     clear `startedAt`, advance `currentStep` to the next numbered step (e.g., `"04"` →
     `"05"`), update `lastUpdated`, update `phase` if the next step's phase differs.
   - Append a new entry to the **top** of `_PROGRESS.md` using the format in "Progress Log
     Entry Format" below.
   - **Do NOT commit yet** — the commit is batched to the end of the run (see "Run cadence").
     Add this step to the run's completed-set.
   - **Continue the run:** loop back to step 2 for the next step (re-read `_STATUS.json` fresh;
     skip the step-3 drift check on this and later iterations). Keep going until a
     stop-condition fires — unless `/build once` (stop now, after this one step) or `/build to
     NN` (stop once `NN` is done).
   - **When the run stops,** make **one** `/commit` covering every step completed this run
     (message lists the step range, e.g. `feat(club-detector): steps 04–06 …`), then tell the
     user: which steps completed (one concrete sentence each, brief), and why the run stopped +
     what's next.
10. **If `Verification` passes BUT `human-review-required: true`:** (reached only when this
    step is executed under `/build once` or after a run stopped in front of it — an autonomous
    run halts *before* a human-review step per stop-condition #2, it does not auto-execute
    one.)
    - Keep step `status` as `in-progress`.
    - Surface the artifacts produced (file list, screenshots, URLs, anything reviewable) and
      the specific decisions the user needs to approve.
    - Wait for explicit approval. Only after approval, do step 9's status/progress update for
      this step — but then **end the run** (commit the completed steps, stop). Human-review
      steps are deliberate checkpoints; don't auto-continue past one. The user runs `/build`
      again to proceed.
11. **If `Verification` fails — attempt a bounded self-heal before stopping:**
    - **Classify the failure** (via `blocker-protocol`). If it is **AUTONOMOUS-FIX** (type
      error, lint error, failing test from an obvious bug, a clear convention fix), invoke
      **`/heal`** scoped to this step's diff, using this step's `## Verification` as the
      oracle. `/heal` runs its fresh-eyes check + bounded 3-attempt loop under its guardrail
      and **never cheats to green**.
      - **If `/heal` converges** (Verification now passes): proceed to step 9 (advance
        `currentStep` + append `_PROGRESS.md` + `/commit`) exactly as a normal pass. Note in
        the progress entry that the step self-healed, and reference `.claude/heal-log.md`.
      - **If `/heal` cannot converge** (3 attempts / oscillation / one of the 4 escalation
        triggers): keep the step `in-progress`, set it `blocked` per `blocker-protocol`, report
        what failed + what heal tried, and stop.
    - If the failure is **not** AUTONOMOUS-FIX (USER-ACTION-NEEDED / ARCHITECTURAL-DECISION /
      EXTERNAL-DEPENDENCY): do **not** heal — keep `in-progress`, classify + set `blocked`,
      report (format in "Failure Reporting"), and stop.
    - **In every stop case:** for the *failed* step, do not advance `currentStep`, do not
      append a completion entry, do not include its partial work. **But still make the run's
      single `/commit` for the steps that DID complete earlier in this run** (the
      completed-set) — they're verified and must not be left uncommitted. If the failed step
      was the first of the run (nothing completed yet), there's nothing to commit. Atomicity is
      preserved — `/heal` only ever heals the diff; advancing a step stays the orchestrator's
      per-step atomic job.

## Track-completion advisory sweep

When the step you just completed in step 9 was the **last** step of the track (no
`not-started` or `in-progress` steps remain in `_STATUS.json`), run a one-time advisory sweep
on the track's full diff **before** reporting the track done. This is the per-track quality
pass — it never runs per step (per-step knip/audit would fail on pre-existing debt unrelated to
the step and is too costly).

1. **`/checkpoint`** first — the sweep may auto-apply fixes; this is the revert path.
2. **Run `/knip --changed`** + a **fresh-eyes 13-axis review** (the `/audit` reviewer subagent)
   over the track's changed files.
3. **Auto-apply the safe/deterministic subset** under `/heal`'s 4-condition guardrail (oracle
   still green after each fix, in-scope, reversible, no shared/irreversible state) — e.g. a
   dead export knip flags, a clear convention fix. `/commit` it; log to `.claude/heal-log.md`.
4. **Surface everything subjective/irreversible** (architectural consolidations, judgment
   calls, anything that would promote to a full `/audit`) in the report — do NOT auto-apply.

If the sweep's findings exceed `/heal`'s inline threshold (≥3 violations / multi-domain / >5-file
fix / major duplication), don't apply — point the user at a `/audit` for the phased plan.

## Hard Rules

These are not style preferences. Violating them corrupts the build state.

- **Never skip the Verification step.** Not even if "the work obviously succeeded." The whole
  point of the Verification section is to catch the cases where it *looks* right but isn't.
- **Never advance to the next step without an explicit verification pass.** A pass means every
  command returned exit code 0 (or the step's own success criteria, when explicitly defined).
- **Advance steps strictly sequentially, but keep going until a stop-condition.** A run
  advances one step at a time — each step fully verified and its `_STATUS.json` +
  `_PROGRESS.md` written atomically *before* the next step begins — and continues to the next
  step automatically until a stop-condition fires (verification fail `/heal` can't fix, a
  `human-review-required` next step, a blocker, drift, or track end). Never run two steps' work
  concurrently or batch their *state* writes; the loop is sequential and per-step atomic. Only
  the **git commit** is batched (one per run). `/build once` caps the run at one step; `/build
  to NN` caps it at step `NN`.
- **Always update `_STATUS.json` atomically.** Read the whole file, parse, modify the
  in-memory object, serialize, write the whole file back. Never patch in place. Never write
  partial JSON.
- **Always update `_STATUS.json` and `_PROGRESS.md` together.** If you successfully verify a
  step, both files must reflect that before you respond to the user. If either write fails,
  treat the step as still in-progress.
- **If `human-review-required: true`, STOP before marking complete** and surface for approval.
  The user has explicitly said this kind of step needs eyes on it (e.g. a scoring-config
  threshold change that affects real swing scores, a change to the `analysis.json` contract, a
  production deploy).
- **Never make STRATEGIC decisions to unblock yourself.** A new dependency/vendor, anything
  touching money/security/PII, cross-system ownership, or a back-compat break not covered by
  the plan is a blocker — escalate (see "Blockers" below). Don't pick. Tactical choices
  constrained by existing conventions (file placement, which existing pattern, naming in an
  established domain) are NOT blockers — decide on best practices, record the pick in
  `_PROGRESS.md`, keep the run moving (blocker-protocol's tactical filter).

## Token Efficiency

A track folder holds a handful of numbered files plus `_STATUS.json`/`_PROGRESS.md`. Don't
read all of it.

- Read `.claude/ROADMAP.json` to resolve the spine track (it's small), then
  `<trackRoot>/_STATUS.json` first (also small).
- Read **only the current step's numbered file**. Do not pre-load adjacent steps "for
  context."
- Read the previous step's file *only* to run its Verification commands. You don't need the
  whole file — extract the Verification section and run it.
- Reference the relevant `instructions/NN-*.md` spec doc or `docs/STATUS.md` **only when the
  step file explicitly says to**. Don't open it speculatively.
- Skip loading skills that don't apply. Match the skill to the step's domain instead of loading
  everything — check the skills list for one whose description matches (e.g. a
  components/UI skill for `apps/web/src/components/`, a styling/Tailwind skill, a
  CV-pipeline/analyzer skill for `services/analyzer/swingsage/`, a database/Drizzle skill for
  schema or migration work, a deploy skill for Railway/Vercel steps). If nothing matches, don't
  load anything extra.
- The step-file template/scaffolding doc at `.claude/ai-instructions/00 - README.md` and the
  macro index `.claude/ROADMAP.json` are already familiar — don't re-read them unless the user
  asks about the system itself.

## Reading and Writing `_STATUS.json`

This file is the source of truth. Treat it carefully.

The minimum operations you need are in `references/status-json-examples.md`. Load that
reference file the first time you need to mutate `_STATUS.json` in a session, then keep the
patterns in mind for subsequent mutations.

At a glance, the shape is:

```json
{
  "schemaVersion": 1,
  "currentStep": "04",
  "phase": "Upload Flow",
  "lastUpdated": "2026-08-07T14:30:00Z",
  "steps": {
    "01": { "status": "complete", "completedAt": "2026-08-06T10:00:00Z" },
    "04": { "status": "in-progress", "startedAt": "2026-08-07T14:00:00Z" }
  },
  "blockers": [],
  "skipped": []
}
```

Valid `status` values: `not-started` | `in-progress` | `complete` | `skipped` | `blocked`.

Allowed transitions:
- `not-started` → `in-progress` (when starting work)
- `in-progress` → `complete` (verification passed and any human review approved)
- `in-progress` → `blocked` (blocker-protocol classified as USER-ACTION-NEEDED,
  ARCHITECTURAL-DECISION, or EXTERNAL-DEPENDENCY)
- `in-progress` → `not-started` (only via explicit /reset-step)
- `not-started` → `skipped` (only via explicit /skip with reason)

Any other transition is a bug **in normal step execution**. Two deliberate exceptions, both
owned by `progress-tracker`, not by a raw `/build`:
- **RECONCILE (adopt-shipped):** `not-started → complete` is normally forbidden (it would
  skip verification), but a code-as-gold audit can find a step is *already shipped*. Use
  `progress-tracker`'s **RECONCILE** operation, which records the code-evidence (file paths /
  audit ref) as the verification record. Never silently mark complete without that evidence.
- **`/reset-step` / `/skip`:** the explicit user-driven reverts above.

**Multiple `in-progress` steps are tolerated.** `currentStep` (singular) is the execution
driver — `/build` always works the step `currentStep` names, regardless of how many steps sit
at `in-progress`. A reconciliation may legitimately leave two steps `in-progress` (both
genuinely partial). Within a run you advance one step at a time (always the one `currentStep`
names), iterating to the next until a stop-condition.

## Progress Log Entry Format

When you complete a step, prepend an entry to `_PROGRESS.md`. The file is append-only-at-top —
never delete prior entries.

```
## NN - {Step Title}
**Completed:** YYYY-MM-DD HH:MM UTC
**Phase:** {phase}
**Summary:** {1-2 sentences about what was actually done — concrete, not generic}
**Notes:** {anything worth remembering for future work, or "None"}

---
```

Good summary: "Added `POST /api/swings` upload route with multipart handling and a job row
insert. Typecheck and lint pass."

Bad summary: "Did step 4." (Tells future-you nothing.)

## Verification Command Patterns

Verification sections in step files use shell commands. This project is on Windows +
PowerShell first, with the Bash tool also available for POSIX scripts. Most web-side
verification is `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`, plus any
scoped tests once a JS/TS test runner exists (none does yet — don't assert one). Most
analyzer-side verification, run from `services/analyzer`, is `.venv\Scripts\python.exe -m
pytest tests`. A step touching only one side only needs that side's oracle — don't run both
if only one applies.

When running:

- Capture exit code. Non-zero = fail.
- Capture stdout and stderr.
- A timeout >60s is a fail (the user should not wait forever for a hung command).
- For commands that print structured output (`tsc`, `eslint --format json`, `pytest -v`),
  parse and report which checks failed, not just "exit 1."

If a verification step is a manual check, automate it first: objectively browser-checkable
("Open localhost:3000 and confirm the page renders") → `/e2e` or the `run` skill with the check
as the success criterion. Ask the user only for genuinely subjective judgment. Never assume.

## Failure Reporting

When verification fails, report in this shape so the user can act:

```
Step NN verification FAILED.

Command: <the exact command that failed>
Exit code: <number>
Output (last 30 lines):
<captured output>

Likely cause: <your best diagnosis, one or two sentences>

Status: Step NN remains in-progress. Not advancing.
Next: <what you recommend — investigate, re-run, escalate via /blocker>
```

Don't bury the failed command in prose. The user needs to see the actual command and output to
triage.

## Drift and Self-Healing

Drift = previous steps were marked complete in `_STATUS.json`, but their verification commands
no longer pass. This happens when something gets deleted, an env var disappears, a dependency
gets unsynced, etc.

When you detect drift in step 3 of the workflow:

1. **Try to heal it first.** Classify via `blocker-protocol`; if AUTONOMOUS-FIX-class
   (type/lint error, obvious regression), run `/heal` scoped to the drift with the previous
   step's Verification as the oracle. Converges → note the self-heal in the run report and
   continue the run — no user stop.
2. If `/heal` can't converge or the failure isn't autonomous-fix-class: do **not** advance.
   The previous step is not actually complete anymore. Surface the drift clearly: "Step NN was
   marked complete on YYYY-MM-DD but its verification is now failing. Command `X` returned exit
   code Y."
3. Then ask the user: "Investigate the regression, or proceed anyway (mark step NN back to
   in-progress)?" Do not pick for them.

Self-healing cases the orchestrator can handle without asking:

- **Malformed `_STATUS.json`:** If JSON.parse fails, recover by reading `_PROGRESS.md` — the
  last entry tells you which step most recently completed. Reconstruct `_STATUS.json` from the
  progress log, mark that step `complete` and the next as `currentStep`. Tell the user what you
  did and ask them to spot-check.
- **`_STATUS.json` missing entirely:** Treat as a fresh start (`currentStep: "01"`, all steps
  `not-started`). Tell the user before doing this — they may have moved or renamed it.
- **Files missing that previous steps should have created:** Mark the step that was supposed
  to create them as `blocked` with a description ("Step NN claims complete but
  `apps/web/src/app/api/swings/route.ts` is missing"). Do not delete the step's `complete`
  status without user confirmation — the file may have been moved.

## Dependencies and Sub-Skills

This skill coordinates the other build orchestration skills when they exist:

- **`progress-tracker`** — atomic `_STATUS.json` / `_PROGRESS.md` mutations. If installed,
  prefer it for writes. If not installed, follow the patterns in
  `references/status-json-examples.md` directly.
- **`step-verifier`** — runs the Verification section of a step file. If installed, delegate
  verification to it. If not, run the commands inline as described in "Verification Command
  Patterns."
- **`blocker-protocol`** — classifies and escalates blockers. If installed, invoke it whenever
  you hit something you can't autonomously resolve. If not installed, surface to the user with
  the same classification (AUTONOMOUS-FIX / USER-ACTION-NEEDED / ARCHITECTURAL-DECISION /
  EXTERNAL-DEPENDENCY) and stop.
- **`checkpoint`** — creates git tags before risky steps. If installed, invoke it before any
  step that touches >5 files or runs a database migration. If not, skip — the per-step
  `/commit` at the end is sufficient for most steps.
- **`/commit`** — used at the very end of a successful run to create the git commit. This is a
  slash command, not a skill, and is always available.

Be tolerant of the sibling skills being absent. The orchestrator is the load-bearing piece; the
others optimize, but the build can advance without them.

## Blockers — Quick Reference

If the `blocker-protocol` skill exists, delegate to it. Otherwise classify inline:

- **AUTONOMOUS-FIX** — missing dependency, lint error, type error, obvious code bug. Fix it and
  retry.
- **USER-ACTION-NEEDED** — missing credential, env var, account access (e.g.
  `ROBOFLOW_API_KEY`). Surface the exact thing you need; do NOT fabricate values, do NOT
  generate fake keys.
- **ARCHITECTURAL-DECISION** — a STRATEGIC choice the plan doesn't cover (new dependency/
  vendor, money/security/PII, cross-system ownership, back-compat). Present 2-3 options with
  tradeoffs and ask. Do not pick. (Tactical choices inside existing conventions are not
  blockers — decide, record, continue.)
- **EXTERNAL-DEPENDENCY** — waiting on a person or an external service/handoff. Log to
  `_STATUS.json` `blockers` array and pause.

In all but AUTONOMOUS-FIX, set the step status to `blocked` and stop.

## What Success Looks Like (One Run)

A `/build` run, happy path:

1. Read `_STATUS.json`. Drift-check the last completed step **once**; it passes.
2. **Step 04:** read its file; deps `complete`, no human-review → set `in-progress`, do the
   work, Verification passes → mark `complete`, advance `currentStep`, append `_PROGRESS.md`,
   add to the run's completed-set. Loop.
3. **Step 05:** (skip the drift check now) read its file, do the work, Verification passes →
   complete, advance, log. Loop.
4. **Step 06:** work, Verification passes → complete, advance, log. Loop.
5. **Step 07 is `human-review-required`** → stop-condition #2: stop *before* executing it.
6. **One `/commit`** covering steps 04–06.
7. Tell the user: steps 04–06 done (a concrete sentence each) and that the run stopped because
   07 needs review — run `/build` again (or `/build once`) to execute it.

That's the target shape: run as far as it cleanly can, then stop loudly at the first real
boundary. Lean, gated, **per-step atomic, one commit per run**. `/build once` collapses this to
a single step; a verification failure or blocker mid-run stops the run early (committing
whatever completed before it).

## What Failure Looks Like (One Pass)

Step verification fails on `pnpm --filter web exec tsc --noEmit`:

1. You report: command, exit code, last 30 lines of output, likely cause.
2. `_STATUS.json` still shows the step as `in-progress`. `_PROGRESS.md` is unchanged. No git
   commit was made.
3. You stop. You do not start the next step. You do not "guess and check" by editing files
   speculatively.
4. The user investigates or asks you to investigate specifically.

This is the correct shape of a failure. Loud, scoped, reversible.

## Delegation defaults (subagents)

Keep implementation in THIS session — a step's code changes need the track's full context, and
the long-session prompt cache rewards one deep session. Delegate the context-heavy side work:

- **Before coding against an external library** → spawn the `docs-researcher` agent (grounds
  the API in current docs; the stack — MediaPipe, torch/ultralytics, Next.js, Drizzle — moves
  faster than training data).
- **Authoring a lazy step file** → fan out 1–3 `Explore` agents first (similar features,
  touched-area architecture, extension points) and read the key files they cite — grounded
  steps hit fewer mid-step blockers.
- **End-of-track review / any fresh-eyes pass** → the `fresh-eyes-reviewer` agent (same one
  /heal and /audit-task use).
- **Infra symptoms mid-step** (Railway deploy failing, service down) → the `ops-investigator`
  agent gathers evidence read-only; act on its findings here.
- **Wide sweeps** (repo-wide migration, auditing every pipeline stage) → a Workflow, only on
  explicit user opt-in ("use a workflow" / ultracode).
- Parallel file-mutating agents get `isolation: worktree`; never let two agents edit the same
  files unisolated.

## References

- `references/status-json-examples.md` — concrete read/update patterns for `_STATUS.json` and
  `_PROGRESS.md`, including the atomic-update sequence and a worked example of advancing from
  step 04 → 05.

Load that reference file the first time you need to mutate state in a session. You can answer
most user questions about the system without it.
