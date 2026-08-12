---
name: blocker-protocol
description: Classifies and routes blockers encountered during the SwingSage autonomous build. When a step can't complete on its own — verification fails repeatedly, a credential is missing, an external service is unauthorized, a strategic design choice is ambiguous, or multiple attempts have failed — this skill picks one of four classifications (AUTONOMOUS-FIX, USER-ACTION-NEEDED, ARCHITECTURAL-DECISION, EXTERNAL-DEPENDENCY) and handles each appropriately. Tactical design choices constrained by existing conventions (file placement, which existing pattern, naming in an established domain) are NOT blockers — decide on best practices, record the pick, continue; only strategic choices (new vendor/dependency, money/security/PII, cross-system ownership, back-compat breaks) classify as ARCHITECTURAL-DECISION. Use this skill when the user types /blocker, when build-orchestrator hits something it can't resolve on the current step, after two consecutive verification failures on the same command, when a step file references a credential or service that isn't reachable, or when a step's Steps section says "decide whether to X or Y" with no obvious right answer. Never fabricate credentials to bypass missing-secret blockers; never invent strategic decisions to "keep going"; always preserve the original error context so the user can act on what's actually wrong.
---

# Blocker Protocol

You are the classifier. When the build can't move forward, the orchestrator hands the situation off to you. You pick one of four classifications, then either resolve the blocker autonomously (if it's safely fixable) or log it, surface it to the user, and stop.

The single most important thing this skill does is *refuse to guess*. Most of the value here is in not papering over real ambiguity. When a step says "wire up the production AI provider" and the project docs don't specify which, you do not pick one. You escalate with options. When `ROBOFLOW_API_KEY` is missing, you do not generate a placeholder. You ask.

## Why this skill exists

Two failure modes the orchestrator falls into without this skill:

1. **Loop-forever on autonomous fixes.** The orchestrator hits a type error, fixes it, hits another, fixes it, hits the same one again. Without a classifier that escalates after repeated attempts, this never terminates. Blocker-protocol caps the attempts and escalates.
2. **Silent compromise.** The orchestrator hits a missing credential and "helpfully" generates a stub. Or it hits an ambiguous *strategic* choice and "helpfully" picks one. Both lead to a build that *looks* complete but is wrong in ways that surface much later — a fabricated face-angle number, a scoring check that scores well by luck (see CLAUDE.md's "standing trap" note), a config value nobody actually chose. Blocker-protocol refuses, full stop. (Tactical choices inside existing conventions are the opposite case — see the tactical filter under ARCHITECTURAL-DECISION.)

The point of this skill is correct escalation, not heroic recovery.

## The Four Classifications

Pick exactly one per blocker. If two seem to apply, the lower-autonomy one wins (USER-ACTION over AUTONOMOUS, ARCHITECTURAL over USER-ACTION). When in doubt, escalate up — never down.

### AUTONOMOUS-FIX

The blocker is something you can resolve right now with code or shell commands, where the fix is unambiguous and contained.

**Includes:**
- Missing npm/pnpm package → `pnpm add <pkg> --filter web` (or the right workspace).
- Type error from a renamed/missing import → fix the import path.
- Lint error from a known rule (unused var, missing semicolon if the project required them, etc.) → apply the fix.
- Obvious code bug (typo in variable name, wrong return type) → fix.
- Generated file out of date (e.g. `apps/web/src/db/schema.ts` changed but `pnpm db:generate` wasn't re-run, so the migration is stale) → re-run the generator.
- Missing directory the step expected to exist → `mkdir` it if the step explicitly intended to create it.

**Excludes:**
- Anything requiring a design choice (which package to add, where to put a file, which pattern to use).
- Anything touching credentials, env vars, or secrets.
- Anything that requires modifying a step file's Steps or Verification.
- Fixes that require changing CLAUDE.md, `.claude/ai-instructions/PROJECT_MAIN.md`, or `docs/decisions/`.

**Attempt cap:** Two attempts. If the same command fails twice with the same root cause after AUTONOMOUS-FIX intervention, reclassify — usually to ARCHITECTURAL-DECISION (the "obvious" fix isn't, and there's a real ambiguity hiding) or USER-ACTION-NEEDED.

### USER-ACTION-NEEDED

The blocker requires something only the user can provide: a credential, a configuration value, access to an account, a file you can't generate.

**Includes:**
- Missing env var (`ROBOFLOW_API_KEY` for the club-dataset fetch, `ANTHROPIC_API_KEY` if the step is wiring `AnthropicAPIProvider`, `DATABASE_URL` for a Drizzle command). Surface the exact var, where the user can get it, and which file to put it in.
- Local infra not running (`docker compose up -d` wasn't run, so Postgres on `:5433` refuses connections; Docker Desktop itself isn't running).
- Account/dashboard access required (need to log into Railway to check a production deploy or env var, per CLAUDE.md's D38 prod-Postgres note).
- A file the user is supposed to provide (a new fixture clip for `fixtures/`, hand-labelled event timestamps for `tests/fixtures.json:hand_labeled`, a GPU-bearing machine's availability for a training run). Don't fabricate the file's contents.
- A `human-review-required: true` flag on a step where the artifact is ready but the user hasn't reviewed.

**Hard rule:** NEVER fabricate credentials. Never set a placeholder like `ANTHROPIC_API_KEY=PLEASE_FILL_IN` and proceed. Never generate fake-looking values. Stop, log, surface.

**Handling:** Log via `progress-tracker` LOG BLOCKER with classification `USER-ACTION-NEEDED`. Surface to user with the escalation message format below. Stop.

### ARCHITECTURAL-DECISION (strategic only)

The blocker is a STRATEGIC choice the project docs don't cover, and picking wrong has lasting consequences beyond the code itself.

**The tactical filter — apply it FIRST. Most in-step design choices are not blockers.** A choice is **tactical** when existing conventions, `docs/decisions/`, CLAUDE.md, or an established pattern in the repo constrain it to one best-practices answer: where a file lives, which existing pattern or primitive to apply, naming inside an established domain, a schema detail that follows conventions already in use. Decide it autonomously — pick the correct option per the project's Non-Negotiable Constraints, record the pick (the step's `_PROGRESS.md` note; a new `docs/decisions/` entry if it's durable enough to matter later), and keep the run moving. Do not stop, do not ask.

**Strategic (escalate) includes:**
- A new dependency, vendor, or model swap (a different pose model, a different club detector architecture, a new hosting provider).
- Anything touching money, security, or PII (how long uploaded swing video is retained, whether a new field stores anything identifying).
- Cross-system ownership or a rule the CLAUDE.md constraints don't already settle (most ownership questions here ARE already settled — e.g. "CV lives in Python, not Node" is non-negotiable, not architectural; reread before escalating).
- Whether to break `analysis.json`'s schema for already-stored artifacts, whether to bump `scoring_model_version`, whether to migrate historic swings vs. leave old reports as-is.
- Which AI provider serves production traffic (`ClaudeCodeProvider` vs `AnthropicAPIProvider`, the AI-provider spec) if a step reaches that decision without the docs already having settled it.
- Anything the `/architect` skill would own, or a domain the user has explicitly flagged for review.

**Hard rule (strategic only):** Do NOT pick. Even if you have a strong opinion, even if "industry standard" suggests one answer, this is the user's call.

**Handling:** Present 2-3 options with tradeoffs. Use `AskUserQuestion` for clean disambiguation. Log the blocker as `ARCHITECTURAL-DECISION`. Stop.

The exception: if `.claude/ai-instructions/PROJECT_MAIN.md`, or a CLAUDE.md file, *does* speak to this decision and you missed it, that's not architectural — it's just a documented requirement you need to follow. Reread the relevant doc before escalating.

### EXTERNAL-DEPENDENCY

The blocker is something controlled by a person or service outside the build, and we're waiting on them.

**Includes:**
- Waiting on a teammate to supply more fixture clips (doc 08 Phase 0 wants ≥10; only 2 exist today) or hand-labelled event timestamps.
- Waiting on GPU availability on the training machine for a club-detector retrain (D21b's ~2h10m run).
- Waiting on a Railway deployment to finish provisioning.
- Waiting on a code review or sign-off from a stakeholder.

**Hard rule:** Don't retry in a tight loop. Don't poll an external service unless the step explicitly says to. Log, pause, and surface what you're waiting on so the user knows what to chase.

**Handling:** Log via LOG BLOCKER with `classification: EXTERNAL-DEPENDENCY`. Surface to user with the escalation message format. Stop. The user will trigger a retry when the dependency is resolved.

## Classification Decision Tree

Run through these in order. The first one that's `yes` wins.

```
1. Is the fix unambiguous code/shell action AND
   it doesn't touch credentials/env/secrets AND
   it doesn't require a design choice?
   → AUTONOMOUS-FIX

2. Is the missing piece something only the user can provide
   (credential, account access, file content, permission)?
   → USER-ACTION-NEEDED

3. Is the decision a design choice the project docs don't cover?
   → Tactical (existing conventions/patterns constrain it to one
     best-practices answer)? Decide, record, continue — NOT a blocker.
   → Strategic (new dependency/vendor, money/security/PII, cross-system
     ownership, back-compat)? ARCHITECTURAL-DECISION

4. Are we waiting on a person or external system outside our control?
   → EXTERNAL-DEPENDENCY

5. None of the above?
   → Reread the situation. You probably missed a classification. If still
     none fits, USER-ACTION-NEEDED is the safe default — surface to user.
```

## Examples — Quick Reference

| Situation | Classification | Action |
|-----------|---------------|--------|
| `Cannot find module 'drizzle-orm'` after fresh pnpm install | AUTONOMOUS-FIX | `pnpm install` from the repo root |
| `error TS2322` on a line you didn't touch | AUTONOMOUS-FIX (1st attempt) | Inspect, fix the narrow type issue |
| Same `error TS2322` on 2nd attempt | Reclassify → ARCHITECTURAL or USER-ACTION | Surface — the "obvious" fix isn't |
| `ROBOFLOW_API_KEY is not set` | USER-ACTION-NEEDED | Surface: get from Roboflow account, add to `services/analyzer/.env` |
| `pnpm db:migrate` fails: connection refused on `localhost:5433` | USER-ACTION-NEEDED | Surface: start Docker Desktop, then `docker compose up -d` from repo root |
| Step says "wire the production AI provider", docs silent on which | ARCHITECTURAL-DECISION | Present 2-3 options, ask user (new-vendor-shaped) |
| Step says "decide the scoring_model_version bump policy" | ARCHITECTURAL-DECISION (often + human-review-required) | Draft 2 options, escalate |
| New helper placed — `lib/` vs colocated with the component | Tactical — not a blocker | Follow existing conventions, note in `_PROGRESS.md`, continue |
| New overlay's naming within the existing `lib/overlays.ts` catalogue | Tactical — not a blocker | Match the established naming, continue |
| Step depends on a live-capture upload flow | Not a blocker — a documented rule | CLAUDE.md is explicit: uploads only, never live capture. Follow the doc, don't ask. |
| `Only 2 of the 10 fixtures doc 08 Phase 0 wants exist` | EXTERNAL-DEPENDENCY | Log, pause, name what you're waiting on (more clips / a teammate) |
| `Club-detector retrain needs the GPU, another job owns it` | EXTERNAL-DEPENDENCY | Log with expected duration, recommend retry when free |
| Verification fails 3 times with different errors each time | Reclassify → ARCHITECTURAL or USER-ACTION | The step isn't safely fixable in pieces |

## Hard Rules

- **Never make strategic decisions to "unblock."** Even if you have to stop the build for two days, that is correct. A wrong strategic choice costs more than a paused build.
- **Never credential-stuff.** Don't generate fake secrets, placeholder API keys, or "test" values the user didn't authorize. Don't put `<YOUR_KEY_HERE>` into a file and proceed as if it's real.
- **Never guess at STRATEGIC choices.** If a new-vendor / money / security / ownership / back-compat choice isn't covered by the docs, escalate — don't pick. Tactical choices inside existing conventions are the opposite: decide them, record them, keep moving — stopping the build to ask where a helper file goes is exactly the friction the tactical filter removes.
- **Always preserve the original error context.** When you log a blocker, include the actual error message, exit code, and last ~30 lines of output. The user needs raw evidence, not your summary of it.
- **Cap AUTONOMOUS-FIX at two attempts per root cause.** If the same root cause appears a third time, reclassify and escalate.
- **Never silently downgrade severity.** If you classify as USER-ACTION-NEEDED, don't quietly retry as AUTONOMOUS-FIX. Once classified non-autonomous, stop.

## Writing a Blocker Description

When you LOG BLOCKER (via `progress-tracker`), the `description` and `requiredAction` fields are what the user actually reads. Good ones tell the user exactly what's wrong and exactly what to do.

### Good vs. Bad

**Bad description:** "Step 07 failed."
**Good description:** "Step 07 (Postgres Migration) failed at `pnpm db:migrate`: connection refused on `localhost:5433`. Likely Docker Desktop isn't running, or `docker compose up -d` wasn't run first from the repo root."

**Bad requiredAction:** "Fix the DB."
**Good requiredAction:** "Start Docker Desktop, then from the repo root run `docker compose up -d` (starts Postgres on `:5433`, not `:5432` — see `docker-compose.yml`). Then from `apps/web` run `pnpm db:migrate`. Then run `/build` to retry step 07."

The good version:
- Names the exact thing missing.
- Names the exact place to find/fix it.
- Names the exact command to run.
- Mentions any non-obvious gotcha (the `:5433` port).
- Tells the user what to do next.

## Escalation Message Format

When you stop and surface to the user, use this shape:

```
## Blocker on Step NN — {Step Title}

**Classification:** {USER-ACTION-NEEDED | ARCHITECTURAL-DECISION | EXTERNAL-DEPENDENCY}

**What happened:**
{1-3 sentences describing the situation in plain language.}

**Error context:**
\`\`\`
{Raw error output, exit code, command that failed — last ~30 lines.}
\`\`\`

**What I need from you:**
{Exact action the user must take. For ARCHITECTURAL-DECISION: 2-3 options below.}

**Options:** (only for ARCHITECTURAL-DECISION)
1. **{Option A name}** — {tradeoff: cost, complexity, lock-in, time}
2. **{Option B name}** — {tradeoff}
3. **{Option C name}** — {tradeoff}

**Step status:** marked `blocked` in `_STATUS.json`. Will not advance until resolved.
**To retry:** run `/build` after taking the action above.
```

For ARCHITECTURAL-DECISION, present the options via `AskUserQuestion` *in addition* to the prose escalation. The prose explains the context; the question is how the user picks.

## When To Recommend /skip

`/skip` is for steps that genuinely don't apply. It's not a "do this later" shortcut. Recommend it only when:

- The step's domain doesn't apply to this project (e.g., a step assumes a capability CLAUDE.md explicitly rules out, like live capture instead of uploads).
- The step's prerequisite was satisfied by a prior alternative path and the work is already done.
- The user has explicitly said this feature is out of scope for the current cycle.

Recommend it **with** an explanation, never silently:

> "Step 12 (Live Capture Preview) depends on real-time camera access, but CLAUDE.md is explicit: uploads only, never live capture — this is a non-negotiable constraint, not an open question. Recommend `/skip --reason=\"live capture is out of scope per CLAUDE.md's non-negotiable constraints\"`. Confirm to skip, or tell me what I'm missing."

Wait for confirmation. Never skip on the skill's own initiative.

## Interaction With Sibling Skills

- **`progress-tracker` LOG BLOCKER** — call this whenever you classify as USER-ACTION-NEEDED, ARCHITECTURAL-DECISION, or EXTERNAL-DEPENDENCY. Don't try to write `_STATUS.json` directly — let progress-tracker handle the atomic write and the status transition.
- **`step-verifier`** — if a blocker is "verification keeps failing," check that step-verifier's failure report is what you're classifying against. Don't classify based on partial output.
- **`build-orchestrator`** — the orchestrator hands off to you and waits for your classification + recommendation. Return control by either (a) completing the AUTONOMOUS-FIX and signaling "retry this step's current command" or (b) signaling "blocked, do not advance, surfaced to user."
- **`checkpoint`** — if you're about to attempt an AUTONOMOUS-FIX that might make things worse (a code edit before a verification fail repeated), recommend a checkpoint first. The user can roll back if the fix is wrong.

## Edge Cases

### Repeated AUTONOMOUS-FIX failures on different root causes

If a step fails three times with three different root causes (type error, then lint error, then missing dep), that's not a clean AUTONOMOUS-FIX situation — the step itself is fragile or the environment is unhealthy. Reclassify to ARCHITECTURAL-DECISION ("step NN as-written assumes X, but the actual environment shows Y; how do you want to proceed?") or recommend `/reset-step`.

### A blocker that's USER-ACTION-NEEDED but the user is unreachable

Log it. Don't loop. Don't proceed. The build can sit blocked indefinitely — that's a safe state. The user will come back to it.

### A blocker classified as EXTERNAL-DEPENDENCY but the dependency clears later

The orchestrator handles the retry. When the user runs `/build` again, the orchestrator sees step is `blocked`, asks you to re-evaluate. You re-run the failed command. If it passes, transition step back to `in-progress` (via progress-tracker), clear the blocker, continue. If it still fails, log a fresh blocker (with the *current* error context, not the stale one).

### Ambiguous between USER-ACTION-NEEDED and EXTERNAL-DEPENDENCY

Example: "The GPU training machine hasn't picked up the new dataset yet." This could be USER-ACTION (the user needs to kick off the run) or EXTERNAL (the run is mid-flight and just slow). When ambiguous, pick the one that requires the user to act sooner — usually USER-ACTION. Better to ask the user "has the run started?" than to assume it has and wait for progress that's never going to happen.

### A blocker that's also a security concern

If the blocker is "the step is trying to log a secret value" or "the step would commit `.env`/`.env.local`" or "the step is about to expose a DB connection string in client code" — classify as USER-ACTION-NEEDED and stop immediately. Do not attempt an AUTONOMOUS-FIX on security-shaped blockers, even if the fix is mechanically simple. Make the user see and confirm.

## When NOT to Use This Skill

- **Routine verification failures the orchestrator can re-run.** A single typecheck failure on a step's Verification doesn't need this skill — the orchestrator reports the failure, the user reads it, fixes it, runs `/build` again. Blocker-protocol kicks in only after repeated failures or when the situation is structurally unrecoverable autonomously.
- **Normal step execution that has clear next steps.** If a step file's Steps section says "add the config value, then wire the loader, then run the check," that's just work — not a blocker.
- **General error handling in application or pipeline code.** This skill is for build-orchestration blockers, not application-level or analyzer-pipeline errors that the build is about to fix.
