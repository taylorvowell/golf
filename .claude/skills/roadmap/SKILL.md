---
name: roadmap
description: Render the SwingSage macro build roadmap by deriving a live status rollup from every track's _STATUS.json, running cross-track consistency checks, and regenerating .claude/ROADMAP.md. Use this skill when the user types `/roadmap`, asks "what's the state of the build", "show the roadmap", "what tracks are active/blocked", "what's next across the whole build", or whenever you need the macro picture spanning multiple tracks (a single track's progress is /status or /feature <name> status instead). Read-only — it NEVER writes progress into ROADMAP.json; ROADMAP.json holds declarations only and each track's own _STATUS.json is the sole authority for that track's progress.
---

# Roadmap

You produce the SwingSage macro build picture. The build is organized as independent **tracks**, each a
self-contained mini-build (its own `_STATUS.json` + `_PROGRESS.md` + numbered step files, run via
`/feature <name>`). `.claude/ROADMAP.json` is the macro index that ties them together.

**The anti-drift invariant:** `ROADMAP.json` stores DECLARATIONS only (goal, spine, phase, statusFile,
dependsOn, owns, lifecycle, unblockTrigger). Progress is **derived** — you compute it fresh from each
track's `statusFile` every time. You NEVER write step status into `ROADMAP.json`, and you NEVER trust a
status value cached there (there are none). This is what stops the roadmap from drifting away from reality.

This project currently has **no tracks yet** — `.claude/ROADMAP.json` doesn't exist until the first track is
scaffolded (typically by `/architect` or `/feature`). That's an expected, normal state: report "no tracks
yet" rather than treating a missing file as an error. See "Adding a track" below for how the first (or any
new) track gets created.

## When this skill triggers

- User types `/roadmap`
- "show the roadmap", "what's the macro state", "which tracks are active/blocked/done", "what's next overall"
- Any question that spans multiple tracks rather than one. (Single track → `/feature <name> status`.)

## Procedure

**Preferred path — run the derivation script.** `node scripts/roadmap/derive.mjs` performs the entire derivation
below deterministically: it reads `.claude/ROADMAP.json` + every `statusFile`, computes each rollup, runs the four
consistency checks (honoring `dependsOn.blocking`), regenerates `.claude/ROADMAP.md`, and prints the check results.
It also handles a missing or empty `ROADMAP.json` gracefully — see "No tracks yet", below. Run it, read its output,
and relay the table + checks + a one-line "recommended next" to the user. Hand-deriving (the steps below) is the
fallback when the script can't run — the script and these steps must stay in lockstep, so if you change one, change
the other. The script is the single source of derivation logic; do not silently diverge.

1. **Read `.claude/ROADMAP.json`.** It is the only declaration source. If it doesn't exist, or exists with an
   empty `tracks` array, see "No tracks yet" below and stop there — don't run the checks against nothing.
2. **For each track**, read its `statusFile`:
   - If the file is **missing** → the track is not yet scaffolded. Report it with its `lifecycle` from the
     roadmap (usually `planned`/`blocked`) and `0/0 (—)` progress. Do not error.
   - If present → parse the `steps` map and compute the rollup (below).
3. **Compute each track's rollup** from its `steps` map. Be scheme-agnostic — DO NOT assume `currentStep + 1`
   numbering; just tally the `steps` object's values:
   - `total` = count of step entries.
   - `complete` / `inProgress` / `blocked` / `skipped` = counts by `status`.
   - `currentStep` = the `currentStep` field verbatim.
   - **Sentinel handling:** if `currentStep` is the literal string `"complete"`, treat the track as 100%
     regardless of the steps tally.
   - **Mixed step-id schemes** are fine (one track might use `NN`/`NNa`, another `R1..R10`) because you read
     the map, not arithmetic. New tracks SHOULD use zero-padded `NN` unless there's a good reason not to.
   - `pct` = round(100 × complete / total), or `100` for the `"complete"` sentinel, or `—` when total is 0.
4. **Run the four consistency checks** (these are the whole point — no single track can do them):
   1. **Spine uniqueness** — exactly one track with `spine:true` AND `lifecycle:active`. Zero or >1 → **ERROR**
      (e.g. "no active spine — `/build` has no target; set spine:true on one track or use `/feature <name>`").
   2. **Dependency satisfaction** — for any track with started/complete steps, check each `dependsOn` entry.
      A `dependsOn` entry is `{ track, reason, blocking? }`. **`blocking` defaults to `true` (a hard
      prerequisite); `"blocking": false` marks a SOFT sequencing preference** (e.g. "instrument the scoring
      config version before migrating it" — the work *can* proceed in parallel, you just prefer the order).
      Only an unmet **hard** dep whose dependent has started work → **WARN-AND-ASK** ("track X has work
      started but depends on Y which is not complete — confirm this is intended"). An unmet **soft** dep
      renders as a sequencing note, not a warning. NEVER hard-block either way; the user legitimately works
      out of order.
   3. **Ownership collision** — for every pair of `lifecycle:active` tracks, flag intersecting `owns` globs
      (e.g. two tracks both claiming `apps/web/src/lib/scoring.ts`). Suppress any intersection that falls
      under the top-level `shared[]` allowlist. Output as an advisory.
   4. **Lifecycle vs derived** — if a track's `lifecycle` is `complete` but its statusFile shows incomplete
      steps (or `lifecycle:active`/`planned` but statusFile shows 100%) → **WARN**. This is the check that
      catches drift between the macro index and reality.
5. **Regenerate `.claude/ROADMAP.md`** (template below). This is the ONLY file you write. Overwrite it whole.
6. **Report to the user**: the rendered table + any check failures, plus a one-line "recommended next" (the
   highest-priority unblocked track per phase order / sequencing).

## No tracks yet

If `.claude/ROADMAP.json` is missing, or present with an empty `tracks` array, this is a fresh project state,
not an error:

- Don't run the four consistency checks (there's nothing to check).
- Still write `.claude/ROADMAP.md`, with a short "no tracks yet" body instead of a table.
- Report to the user: "No tracks yet. Use `/architect` (if available) or scaffold one directly — see
  'Adding a track' below — then re-run `/roadmap`."

## ROADMAP.md template (regenerate whole, never hand-edited)

```markdown
# SwingSage Roadmap — generated <YYYY-MM-DD>

> Macro source of truth. Declarations live in `.claude/ROADMAP.json`; this rollup is DERIVED by `/roadmap`
> (`node scripts/roadmap/derive.mjs`). Do not hand-edit the table — re-run the script. Single-track detail:
> `/feature <name> status`.

## Arc
<phases in `order`, joined by " → ">

## Tracks
| Track | Phase | Goal | Progress | Current | Lifecycle | Blocked on |
|-------|-------|------|----------|---------|-----------|------------|
| <spine-track> (spine) | Pipeline | … | 1/2 (50%) | 02 | active | — |
| … | | | | | | |

## Consistency
- ✅ spine: exactly one active (<resolved-spine-track>)
- ⚠ dependency: <any warnings, else "none">
- ⚠ ownership overlap: <any advisories, else "none">
- ⚠ lifecycle/derived mismatch: <any, else "none">

## Recommended next
<one line: the top unblocked track to advance, with why>
```

When there are no tracks yet, the body is instead just:

```markdown
# SwingSage Roadmap — generated <YYYY-MM-DD>

No tracks yet. Scaffold the first one (see the roadmap skill's "Adding a track" section) and re-run
`node scripts/roadmap/derive.mjs`.
```

## Adding a track

There's no `docs/runbooks/` entry for this yet, so the procedure lives here. A "track" is a self-contained
mini-build: its own directory, its own state files, its own numbered step files. To add one:

1. **Pick a track id** — kebab-case, short, descriptive (e.g. `scoring-v3`, `club-detector-retrain`,
   `overlay-menu-rework`). This becomes the directory name.
2. **Scaffold `.claude/feature-tracks/<id>/`** with:
   - `_STATUS.json` — start with `schemaVersion: 1`, `featureName: "<id>"`, `currentStep: "01"`,
     `phase: "<first phase name>"`, an empty `steps` object (or a `"01"` entry at `not-started` if the first
     step is already scoped), empty `blockers`/`skipped` arrays, `lastUpdated` set to now, `completedAt: null`.
   - `_PROGRESS.md` — a header block (`# SwingSage Build Progress — <id>`) followed by a `---` separator and
     no entries yet.
   - Numbered step files (`01 - <title>.md`, `02 - ...`, etc.) — each with at least a `## Steps` and a
     `## Verification` section per the shapes `step-verifier` expects. Mark `human-review-required: true` in
     frontmatter on any step whose output needs a human look before it's trusted.
3. **Add a `tracks[]` entry to `.claude/ROADMAP.json`** (create the file if this is the very first track):
   ```json
   {
     "id": "<id>",
     "goal": "<one-line goal>",
     "phase": "<phase id>",
     "statusFile": ".claude/feature-tracks/<id>/_STATUS.json",
     "spine": false,
     "lifecycle": "planned",
     "owns": ["<glob(s) of what this track is expected to touch>"],
     "dependsOn": []
   }
   ```
   If this track should be the one `/build` advances by default, set `"spine": true` and `"lifecycle": "active"`
   — but only one track may hold `spine:true` with `lifecycle:active` at a time (the spine-uniqueness check
   enforces this). `phases[]` (with an `order` and a `label`) must exist in `ROADMAP.json` too if this is the
   first track to reference a given phase id.
4. **Run `/roadmap`** to confirm: it should pick up the new track, show `0/N (0%)` progress, and raise no
   consistency errors. If the spine check now fails (zero or multiple active spines), fix the `spine`/`lifecycle`
   fields before proceeding.

If this procedure gets used often enough to be worth codifying further, promote it to
`docs/runbooks/add-a-track.md` and point future readers there — but don't create that file speculatively.

## Hard rules

- **Read-only on declarations.** Never write to `ROADMAP.json`. The only file you write is `ROADMAP.md`.
- **Derive, never duplicate.** Compute progress from each `statusFile` every run. Do not cache or copy it.
- **Missing statusFile is normal** for `planned`/`blocked` net-new tracks — report, don't error.
- **A missing or empty `ROADMAP.json` is normal** for a project with no tracks yet — report "no tracks yet",
  don't error and don't run the consistency checks against nothing.
- **Checks warn, they don't block.** Only spine-uniqueness is an ERROR (because `/build` needs a target);
  the rest surface loudly and let the user decide.

## Relationship to the other skills

- `/build` → `build-orchestrator` advances the `spine:true` active track (resolved via this roadmap).
- `/feature <name>` → `feature-orchestrator` advances any track by id.
- `progress-tracker` / `step-verifier` / `checkpoint` / `blocker-protocol` operate on whichever track's files
  the orchestrator hands them. None of them own the macro picture — this skill does.
- To add a track: see "Adding a track" above.
