---
name: progress-tracker
description: Atomically maintains a build track's _STATUS.json + _PROGRESS.md (tracks live at .claude/feature-tracks/<id>/; the spine track resolves via .claude/ROADMAP.json). Six operations — READ, UPDATE STEP STATUS, APPEND PROGRESS, LOG BLOCKER, RESET STEP, RECONCILE (evidence-gated adopt-already-shipped). Use for /status, /skip, /reset-step, orchestrator hand-offs, and ANY read or write of any track's _STATUS.json or _PROGRESS.md — ad-hoc edits corrupt the system; validate JSON before every write. Cross-track rollup is the roadmap skill, not this one.
---

# Progress Tracker

You own writes to a track's two state files. The caller hands you the track root `<trackRoot>` — a directory under `.claude/feature-tracks/<id>/` (the spine track is resolved from the `spine: true` entry in `.claude/ROADMAP.json`):

- `<trackRoot>/_STATUS.json` — machine-readable track state
- `<trackRoot>/_PROGRESS.md` — human-readable completion log

Other skills call you to read or mutate these (`build-orchestrator` for the spine track, `feature-orchestrator` for any named track). Your job is to make every mutation correct, atomic, and lossless. Get this wrong and the track forgets where it is.

> Macro progress **across all tracks** is NOT your concern — that is the `roadmap` skill, which *derives* the rollup from each track's `_STATUS.json` and never duplicates it. You only ever touch one track's files per call.

## Why this skill exists separately from build-orchestrator

Two reasons. First, the rules for *how* to mutate state are non-trivial enough to warrant their own attention surface — JSON validation, atomic write, state-machine guards, history preservation. Mixing them into the orchestrator's prose dilutes both. Second, several flows touch these files outside the orchestrator: `/status` (read-only), `/skip` (mark skipped), `/reset-step` (revert to not-started), and direct blocker logging. Putting that logic here keeps it consistent across entry points.

## The Six Operations

Every interaction with progress state goes through one of these. Pick the one that matches the caller's intent — don't invent new operations.

### 1. READ

**When:** `/status` is invoked, or any caller asks "what's the current step?", "how many steps are done?", "are there active blockers?"

**Inputs:** none.

**Outputs:**
- `currentStep` — the step number string (e.g., `"04"`)
- `phase` — the current phase name
- `completedCount` — number of steps with `status: "complete"`
- `inProgressCount` — usually 0 or 1
- `blockedCount` — `blockers.length`
- `skippedCount` — `skipped.length`
- `lastUpdated` — ISO timestamp from the file
- `nextStepTitle` — read just the first line of the file matching `currentStep` to get the title (optional, only if caller asked for it)

**How:** Read `_STATUS.json` with the `Read` tool. Parse. Compute counts. Return — do NOT write anything back. READ never mutates `lastUpdated`.

### 2. UPDATE STEP STATUS

**When:** a step's `status` field needs to change. Used by build-orchestrator at each transition.

**Inputs:**
- `stepId` — string like `"04"` (zero-padded)
- `newStatus` — one of `not-started | in-progress | complete | skipped | blocked`
- Optional: `reason` (for `skipped`), `completedAt` (for `complete`, defaults to now)

**Behavior:**
- Read `_STATUS.json` fresh.
- Validate the transition against the state machine (see "State Machine" below). If invalid, refuse and tell the caller why.
- Mutate `steps[stepId].status`, add/update timestamps appropriately, update top-level `lastUpdated`.
- If `newStatus === "complete"`, advance top-level `currentStep` to the next numbered step that is not yet complete or skipped.
- If `newStatus === "complete"` and the next step is in a new phase, update top-level `phase`.
- Validate the resulting object is still valid JSON.
- Write the whole file back with the `Write` tool (never `Edit`).

This operation does NOT touch `_PROGRESS.md`. Pair it with APPEND TO PROGRESS when the caller wants to advance.

### 3. APPEND TO PROGRESS

**When:** a step transitions to `complete` or `skipped` and we want a log entry.

**Inputs:**
- `stepId` — `"04"`
- `stepTitle` — e.g., `"Scoring Config v3 Migration"` (read from the step file's first heading)
- `phase` — current phase
- `summary` — 1-2 sentences, concrete, what was actually done
- `notes` — optional, anything worth remembering

**Behavior:**
- Read `_PROGRESS.md`.
- Compose the new entry using the format in "Progress Entry Format" below.
- Insert it **after the file's header block** and **above all existing entries**. Newest at top, always.
- Write the whole file back.

Newest-at-top is non-negotiable. The user reads the file top-down and expects "what just happened" at the top.

### 4. LOG BLOCKER

**When:** a step cannot proceed and a blocker has been classified (typically by `blocker-protocol`).

**Inputs:**
- `stepId`
- `classification` — `AUTONOMOUS-FIX | USER-ACTION-NEEDED | ARCHITECTURAL-DECISION | EXTERNAL-DEPENDENCY`
- `description` — what specifically is blocked
- `requiredAction` — the exact thing needed to unblock (the user reads this and acts on it)

**Behavior:**
- Read `_STATUS.json` fresh.
- Append a blocker object to `blockers[]` with the inputs above plus `loggedAt` timestamp.
- UPDATE STEP STATUS on `stepId` to `blocked` (validate the transition first; only `in-progress` → `blocked` is allowed).
- Add `blockedAt` timestamp to the step.
- Write back.

This combines a status change and a blocker append. They are part of the same logical operation; do not split them across two writes.

### 5. RESET STEP

**When:** the user invokes `/reset-step` (typically after a partial failure they want to retry from scratch).

**Inputs:**
- `stepId`

**Behavior:**
- Read `_STATUS.json` fresh.
- Set `steps[stepId].status` to `not-started`.
- Remove `startedAt`, `completedAt`, `blockedAt`, `skippedAt`, `skipReason` from that step.
- If the step had a matching entry in `blockers[]`, remove it.
- Set `currentStep` to this `stepId` (we're returning to it).
- Write back.

RESET does NOT touch `_PROGRESS.md`. The completion history is preserved — if the step was previously logged as complete, the entry stays. If the user wants the log corrected, they edit `_PROGRESS.md` by hand or add a corrective entry.

### 6. RECONCILE (adopt already-shipped work)

**When:** a code-as-gold audit (or any verification-against-reality) finds a step's work is **already shipped/done outside the normal orchestrator flow** — so the live status `not-started`/`in-progress` understates reality, and you need to mark it `complete` (or `skipped`/superseded) without re-running it from scratch. This is the **only** sanctioned path for `not-started → complete`; it exists so reconciliations don't get forced into a script that bypasses this skill.

**Inputs:**
- `stepId`
- `targetStatus` — `complete` (the usual case) or `skipped` (for work that was built-then-removed/superseded).
- `evidence` — **REQUIRED**: concrete proof the work is done — file paths that implement it (e.g. `services/analyzer/swingsage/scoring.py`, `apps/web/src/lib/scoring.ts`), and/or a commit reference. A RECONCILE with no evidence is refused. The evidence string is the *verification record* that replaces a live re-run.

**Behavior:**
- Read `_STATUS.json` fresh.
- Refuse if `evidence` is empty/vague ("it's done" is not evidence — require paths or a commit ref).
- Set `steps[stepId].status` to `targetStatus`; set `completedAt` (for `complete`) or `skippedAt` + `skipReason` (for `skipped`); write the `evidence` into the step's `note` field prefixed `RECONCILE <date>:`.
- For `skipped`, also append to `skipped[]`.
- Advance `currentStep` to the next step that is not `complete`/`skipped` (same rule as UPDATE STEP STATUS); update `phase` if it crosses a boundary; bump `lastUpdated`.
- Validate JSON; write the whole file.
- **Pair with APPEND TO PROGRESS** — log a `**Reconciled:**` entry (see format) citing the evidence, so the human log shows *why* this jumped to complete without a normal run.

**This is gated, not a backdoor.** It records evidence as the verification artifact; it does not skip verification silently. If you can't cite concrete proof, use the normal `not-started → in-progress → complete` flow instead.

## State Machine

These are the only allowed transitions. Reject any other transition and tell the caller why.

```
not-started ──► in-progress    (work has begun)
in-progress ──► complete       (verification passed)
in-progress ──► blocked        (blocker logged)
in-progress ──► not-started    (only via RESET STEP — explicit user action)
not-started ──► skipped        (only via /skip with a reason)
in-progress ──► skipped        (only via /skip with a reason)
blocked     ──► in-progress    (blocker cleared, retry)
blocked     ──► not-started    (only via RESET STEP)
```

Disallowed (these are signs something is wrong — refuse and surface to user):

- `complete` → anything (a complete step doesn't go backward without RESET)
- `skipped` → anything (a skipped step doesn't un-skip without RESET)
- `not-started` → `complete` (you cannot complete what was never started; this would skip verification) — **except via the RECONCILE operation**, which requires concrete code-evidence as the verification record (the sanctioned adopt-already-shipped path).
- `not-started` → `blocked` (you cannot block what was never started)

If a caller asks for a disallowed transition, refuse. Example response: `"Cannot transition step 04 from 'complete' to 'in-progress' directly. Use RESET STEP first to revert to 'not-started', then UPDATE STEP STATUS to 'in-progress'."`

**On multiple `in-progress`:** the orchestrators key on `currentStep` (singular), so two steps sitting at `in-progress` is tolerated (a reconciliation may leave two genuinely-partial steps). UPDATE STEP STATUS has no guard against it by design — don't "fix" it by reverting one unless asked.

## Hard Rules

These are correctness rules — violating them corrupts the build.

- **Always read `_STATUS.json` fresh** before mutating. Never rely on a copy from earlier in the conversation. The file may have been changed by another process, an `/skip` invocation, or a previous turn.
- **Always validate JSON before writing.** Build the in-memory object, then re-serialize and re-parse it as a sanity check. If parsing fails, abort and tell the caller — do NOT write malformed JSON.
- **Always use `Write`, never `Edit`, for `_STATUS.json`.** Whole-file atomic writes only. `Edit` against JSON is risky — a bad regex match can produce invalid JSON without warning.
- **Always pair STATUS and PROGRESS writes when advancing.** If UPDATE STEP STATUS sets a step to `complete`, the caller should immediately call APPEND TO PROGRESS. Do the JSON write first, then the markdown append. If the markdown append fails, surface the inconsistency to the user but leave the authoritative state (JSON) correct.
- **Never delete from `_PROGRESS.md`.** It is append-only-at-top. If history needs correction, add a new entry below the bad one with a `**Correction:**` line. Do not rewrite the past.
- **Never lose existing fields.** If `_STATUS.json` has extra fields you don't recognize (someone added something, or schemaVersion has rolled forward), preserve them — read into a generic object, mutate only what you're explicitly changing, write back. Do not strip unknown keys.

## Progress Entry Format

Exactly this shape. Don't improvise.

```markdown
## NN - {Step Title}
**Completed:** YYYY-MM-DD HH:MM UTC
**Phase:** {phase}
**Summary:** {1-2 sentences about what was actually done — concrete, not generic}
**Notes:** {anything worth remembering, or "None"}

---
```

The trailing `---` is a visual separator between entries. Keep it.

For skipped steps, use `**Skipped:**` instead of `**Completed:**` and add a `**Reason:**` line:

```markdown
## NN - {Step Title}
**Skipped:** YYYY-MM-DD HH:MM UTC
**Phase:** {phase}
**Reason:** {why this step was skipped}
**Notes:** {anything worth remembering, or "None"}

---
```

For a RECONCILE (adopt-already-shipped), use `**Reconciled:**` and a `**Evidence:**` line so the log shows why it jumped to complete without a normal run:

```markdown
## NN - {Step Title}
**Reconciled:** YYYY-MM-DD HH:MM UTC  →  complete | skipped
**Phase:** {phase}
**Evidence:** {file paths that implement it + commit ref — the verification record}
**Notes:** {anything worth remembering, or "None"}

---
```

Summary quality matters. "Did step 4" tells future-you nothing. "Wired Stage 8's scoring_config v3 loader into swingsage/scoring.py; validate_scoring_config.py and pytest tests both pass" tells future-you what changed in the world.

## Atomic Write Pattern

For `_STATUS.json`:

1. `Read` the file.
2. `JSON.parse` mentally — confirm it parses. If it doesn't, refuse the write and surface the corruption (don't try to "fix" it inline).
3. Apply your mutation in the in-memory object.
4. Bump `lastUpdated` to the current ISO-8601 UTC timestamp.
5. Re-serialize with 2-space indent (match existing formatting).
6. Re-parse the serialized string as a final sanity check.
7. `Write` the whole file.

For `_PROGRESS.md`:

1. `Read` the file.
2. Locate the boundary between the header block (everything from `# SwingSage Build Progress` through the first `---`) and the entries.
3. Construct the new entry text.
4. Build the new file content: header + new entry + (existing entries).
5. `Write` the whole file.

## Timestamps

ISO-8601 UTC everywhere: `YYYY-MM-DDTHH:MM:SSZ` for `_STATUS.json`, `YYYY-MM-DD HH:MM UTC` for `_PROGRESS.md`.

PowerShell: `(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")`
Bash: `date -u +"%Y-%m-%dT%H:%M:%SZ"`

If you need a timestamp and can't run a command (e.g., responding inline), use the date from the session's `currentDate` for the date portion and a sensible wall-clock time. Precision-to-the-second is nice but not required for correctness.

## Field Glossary (Quick Reference)

| Field | Meaning |
|-------|---------|
| `schemaVersion` | File format version. Currently `1`. Preserve unknown values. |
| `currentStep` | Zero-padded step number. The next step the orchestrator should work on. |
| `phase` | Human-readable phase (e.g., `"Scoring & Coach Report"`). |
| `lastUpdated` | ISO-8601 UTC. Bumped on every mutation. |
| `steps."NN".status` | `not-started \| in-progress \| complete \| skipped \| blocked` |
| `steps."NN".startedAt` | When work began. Present on `in-progress`+. |
| `steps."NN".completedAt` | When verification passed. Present on `complete`. |
| `steps."NN".blockedAt` | When blocker was logged. Present on `blocked`. |
| `steps."NN".skippedAt` | When step was skipped. Present on `skipped`. |
| `steps."NN".skipReason` | Free-text reason. Present on `skipped`. |
| `blockers[]` | Array of `{step, classification, description, requiredAction, loggedAt}`. |
| `skipped[]` | Array of `{step, reason, skippedAt}`. |
| `featureName` | Track id (kebab-case, matches the dir). Present in every real file. |
| `completedAt` (top-level) | ISO-8601 UTC set when the whole track is done (all steps `complete`/`skipped`); `null` otherwise. Cleared if the track reopens. |
| `steps."NN".note` | Free-text per-step narrative (what the step did, or a RECONCILE/correction record). Optional; preserve it. |

**Track-specific annotation fields (allowed; the machinery preserves but does NOT act on them):** `partial` (a `complete` step with env-gated remainder), `pendingEnvActions` (array of ops that need a live environment — e.g. "requires Docker Desktop running", "requires a GPU"), `notCommitted` (code done but not committed), `humanReview` (a free-text approval record — distinct from the step-file `human-review-required: true` frontmatter, which IS the gate the orchestrator enforces). Use them sparingly and document their meaning in the step `note`. **Do NOT put a `spine` field in `_STATUS.json`** — `.claude/ROADMAP.json` is the *sole* authority for which track is the spine; a duplicate here is a second source of truth that drifts.

## When NOT to Use This Skill

- **Reading step file contents.** That's not state — it's instruction data. Read step files with the `Read` tool directly.
- **Modifying the step files themselves.** Numbered files in a track directory are source-of-truth instructions, not state. If a step file needs editing, do it directly with `Edit` or `Write`.
- **Other markdown logs.** This skill is specific to `_STATUS.json` and `_PROGRESS.md`. Other progress logs (`docs/decisions/`, `docs/icebox/` entries) have their own conventions.
