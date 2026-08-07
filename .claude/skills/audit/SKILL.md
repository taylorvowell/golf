---
name: audit
description: Post-hoc architectural audit of SwingSage code against 13 axes (Next.js/TS correctness, frame-sync, CV pipeline correctness, the analysis.json contract, scoring-config correctness, test-suite integrity, structure, componentization, reuse, placement, tech debt, conventions, latest leverage). Two modes — `/audit <target>` — deep review writing a phased remediation plan to .claude/audits/; `/audit-task` — lightweight chat-only fresh-eyes review of work just done in this thread. Trigger on /audit, /audit-task, "audit/review X for best practices", "is X built right", "did I follow conventions", or a post-build sanity check. Findings-first — only executes fixes if the user opts in at the end. Not for runtime perf profiling or a security-only review.
---

# Audit

You are about to perform a serious, architectural audit of something the user has already built. Your job is to find the things that will hurt correctness, maintainability, or developer velocity — not to nitpick. Then you write up a phased remediation plan that another Claude (or you in a fresh session) can execute deterministically.

## Why this skill exists

The user invokes `/audit` *after* work is built. Early audits will be broad ("audit the analyzer pipeline"); later audits will be narrow ("audit the scoring check I just added"). In both cases the goal is the same:

> Catch architectural mistakes before they compound. Surface duplication, dead conventions, missed Next.js 16 primitives, and the specific ways this project's two halves — a Next.js player and a Python CV pipeline sharing one `analysis.json` contract — drift out of sync. Then write a plan precise enough that an AI coder reading it later, with no prior context, can execute it correctly.

Three failure modes to avoid:

1. **Nitpicking.** Surface-level lint findings are noise; the user has `tsc --noEmit` and ESLint gates already, and the analyzer has `pytest`. Only report things that affect architecture, correctness, or the contracts multiple parts of the system depend on.
2. **Writing for yourself.** The audit document must be self-contained. A future Claude reading just the `.md` files must be able to execute the plan. No "as I mentioned above" references to chat history.
3. **Bypassing the gate.** Even when running in auto/bypass mode, you MUST stop and ask the user which of the four options to take at the end. Never auto-execute fixes.

## The Workflow

This is the canonical sequence for one `/audit` invocation. Do not reorder. Do not skip the verification check at the end.

### 1. Parse the target

The slash argument is the target. Examples:
- `/audit scoring pipeline` → broad: `services/analyzer/swingsage/{metrics,scoring}.py`, `services/analyzer/scoring_config/**`
- `/audit ScoreGauge` → narrow: `apps/web/src/components/ui/kiosk.tsx`'s `ScoreGauge` export (+ its consumers in `views/`)
- `/audit swing player` → medium: `apps/web/src/components/{SwingWorkspace,SwingStage,OverlayMenu}.tsx`, `apps/web/src/lib/usePlayer.ts`
- `/audit recently changed files` → derive from `git diff --name-only main...HEAD`
- `/audit` (no arg) → ask the user what to audit

If the target is ambiguous (e.g. "audit the club tracking"), play it back: "Auditing `services/analyzer/swingsage/club.py` and its debug scripts (`checkclub.py`, `checktrace.py`, `clubdebug.py`). Anything else?" Wait for confirmation. Don't guess on broad targets — guessing wastes a lot of investigation tokens.

### 2. Detect scope size and plan investigation

Heuristics for scope:

- **Small** — 1–5 files, one component, one `swingsage/` module, or one tight feature. Read directly with `Read` / `Grep`. No subagents (briefing one costs more than reading inline).
- **Medium** — one domain (the player, one pipeline stage, one scoring axis), 5–30 files. Read inline. Optionally fire **one pre-scan subagent** for convention violations across the audit scope (see "Subagent patterns" below) — this parallelizes the mechanical grep work with your structural investigation.
- **Large** — multi-domain or whole subsystem (>30 files, or "the whole analyzer pipeline"). **Fan out parallel `Explore` subagents** — one per subdomain, plus the pre-scan and latest-leverage sweeps. The main agent stays in the architectural seat; subagents return short bulleted findings so you don't drown in code excerpts.

State your plan back to the user in one or two sentences before going deep: *"I'm going to audit `apps/web/src/components/{SwingWorkspace,SwingStage,OverlayMenu}.tsx` plus `lib/usePlayer.ts` — about 6 files. I'll consult `.claude/rules/nextjs.md` and `.claude/rules/tailwind-v4.md`, and the `docs/DECISIONS.md` entries that touch frame sync and trace rendering (D43, D46, D51). Going to do this inline (medium scope), with one pre-scan subagent for convention violations. Sound right?"* Wait briefly — if the user pushes back, adjust. If they don't respond, proceed.

### 3. Load relevant ground truth

Only load skills/docs actually relevant to the target. Don't preload everything — that's how you waste your context budget before you've even read the code.

**Always-relevant for SwingSage audits:**
- `apps/web/src/components/ui/kiosk.tsx` — this project's closest thing to a component registry, for any player/UI audit
- Root `CLAUDE.md` — the project's non-negotiable constraints and architecture-that-spans-files
- `.claude/rules/*.md` (`nextjs.md`, `tailwind-v4.md`, `typescript.md`, `testing.md`) — the mechanical conventions, each scoped by its `paths:` frontmatter to the files it governs
- `docs/DECISIONS.md` — but **grep it for the D-numbers relevant to the target**, don't read the whole append-only log end to end. Every entry has a `Status:` line (`ACTIVE`/`SUPERSEDED by Dxx`/`NEGATIVE RESULT`/`HISTORICAL`/`OPEN`) — roughly a quarter of entries no longer hold, so check it before citing one.

**Domain-match (load 1–3 maximum):**
- TS/Next.js client-server boundary questions → `.claude/rules/nextjs.md`, `.claude/rules/typescript.md`
- Styling, theme tokens → `.claude/rules/tailwind-v4.md`
- Pose/keypoints, angle math → `instructions/03-POSE-TRACKING.md`
- Club tracking, trace rendering → `instructions/04-CLUB-TRACKING.md`
- Event detection, metrics, scoring, coach narrative → `instructions/05-SWING-PHASES-AND-SCORING.md`, `services/analyzer/scoring_config/COVERAGE.md`
- `analysis.json` shape, frame sync, pipeline stage order → `instructions/02-ARCHITECTURE.md`
- Test suite shape (golden vs invariant vs hand-labeled) → `.claude/rules/testing.md`

**Web research:** Only go to `WebSearch` / `WebFetch` for things the local docs don't cover — e.g. "is there a newer MediaPipe Tasks API for this," "what's the current Next.js 16 pattern for X." Always cite the URL in the audit doc.

### 4. Investigate

Read the target. Look at structure, not just lines. Things worth checking on every audit (this is the working set — the formal axes are in `references/coverage-axes.md`):

- **Existence check:** does a similar card/panel shape already exist in `components/ui/kiosk.tsx`? If yes, the audit's recommendation is almost always "reuse or extend that shape, don't hand-build a new one."
- **RSC vs client:** is `'use client'` at the leaf (browser APIs, hooks, event handlers, canvas/video imperative control), or wrapping data-fetching/layout that could stay server-side?
- **Server/client boundary:** does anything import `lib/scoring.ts`, `db/*`, or another Postgres/`node:fs`-touching module from a `"use client"` file? (`lib/scoreDisplay.ts` vs `lib/scoring.ts` is the documented pattern — client-safe types split from the server I/O.)
- **`analysis.json` contract:** does a change touch keypoint order, confidence handling, or handedness without checking D25/D33/D47? Is the 49-entry append-only order (native 33 → derived 7 → measured 8 → derived-tail 1) preserved?
- **Scoring correctness:** does a new or changed check's threshold live in `scoring_config/<version>.json` (never hardcoded)? Has its raw value been verified, across all fixtures, to move in the direction the band assumes — or is this the D42 trap ("a check that scores well is not evidence it works")?
- **Pipeline stage ordering:** does a change reorder Phases 2→5 (club tracking needs pose's `grip_center`; event detection needs both wrist trajectories and club-head speed)? Does it run Stage 2b logic before the address hold and body height it depends on exist (D48)?
- **Frame sync:** does anything touch `lib/usePlayer.ts`, the CFR-60fps assumption, the `(frame + 0.5) / fps` seek offset, or the canvas draw order (`video → skeleton → club → trace → annotations`)?
- **Tests:** is a change presented as "tested" when only a golden snapshot covers it? Golden snapshots (`test_stages.py`) prove nothing *changed* — never that it's *right*. Only `test_hand_labeled.py` proves correctness, and it's currently skipped project-wide (no hand-labelled truth exists yet).
- **Naming:** PascalCase `.tsx` matching the component name, kebab-case non-component `.ts`, `[ComponentName]Props` above the component, Python module/function names following `swingsage/`'s existing snake_case conventions.
- **Decisions log:** does a spec deviation, interim shortcut, or threshold/contract change lack a corresponding `docs/DECISIONS.md` entry?

Use `references/coverage-axes.md` for the full 13-axis checklist. Treat it as a "did you remember to look here?" pass before drafting findings.

### 5. Synthesize findings

Each finding has six fields. Be strict — if you can't fill all six, it's not a finding worth reporting.

```
Finding ID: C1 / H2 / M3 / L4   (severity + sequence)
Axis: one of the 13 axes
Source of truth: which docs/DECISIONS.md entry / rules file / kiosk.tsx export / doc URL justifies this finding
Evidence: file:line citations
Why it matters: one sentence on the consequence if unfixed
Recommendation: what to do, at a level a Claude could execute
```

**Severity rubric:**
- **Critical (C):** breaks a hard rule from root `CLAUDE.md` (e.g., a face-angle degree fabricated from video, a `tailwind.config.js` reintroduced in a v4 project, `lib/scoring.ts` reachable from a client bundle, a scoring threshold hardcoded outside `scoring_config.json`, the 49-keypoint order broken) — or a scoring check wired without verifying its raw-value direction (the D42 failure mode, repeated).
- **High (H):** violates a `docs/DECISIONS.md` entry whose `Status:` is `ACTIVE` (or reintroduces something a `SUPERSEDED`/`NEGATIVE RESULT` entry already rejected), duplicates a shape already in `components/ui/kiosk.tsx`, re-runs `burnin.py` on a committed fixture without `--club-detector`, or presents a golden-snapshot pass as proof of correctness.
- **Medium (M):** suboptimal placement, missing test for a load-bearing pure function, a missed Next.js 16 leverage opportunity, a confidence/handedness slip that doesn't change scoring output but would under different inputs.
- **Low (L):** worth noting but won't hurt anything immediately — naming inconsistency, small duplication, a documentation gap.

**Effort tag** (separately): `Quick` (<30 min), `Moderate` (half-day), `Large` (multi-day).

If the audit produces fewer than 3 findings, that's fine — say so plainly and don't pad. A clean audit is a valid result.

### 6. Group findings into phases

This is the critical design decision for AI-executability. Group findings so each phase:
- Is **independently executable** — a Claude can finish phase 1 without needing phase 2 done.
- Has **clear preconditions and verification** — what state must be true before starting, and what commands prove it's done.
- Has a **reasonable scope** — ideally 30 minutes to half a day of execution. If a single phase would touch 20+ files, split it.
- Ordered by **dependency, not severity** — sometimes a Critical finding can't be fixed until a Medium finding's refactor lands first. Make that explicit.

If the audit only has 2–3 findings, you can use a single phase. Don't manufacture phases.

**Browser-verification awareness (auditor-decided per phase).** This project has no Vitest/Playwright suite yet (`.claude/rules/testing.md`) — `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` is the only automated web oracle, and (from `services/analyzer`) `.venv\Scripts\python.exe -m pytest tests` is the only automated Python oracle. For each phase, ask: does this phase change code load-bearing for a critical flow (upload → analyze → player, frame sync, scoring)? If yes:

1. Add an explicit **Manual check** task instead of a Playwright run — there's no spec to point at. Phrase it as something a human can literally do: "run `pnpm dev`, open a swing page, scrub the transport, confirm the skeleton overlay tracks with no visible drift."
2. If the phase touches `services/analyzer/swingsage/**`, the Verification section must run the full `pytest tests` suite AND state explicitly whether hand-labeled ground truth exists for the affected metric. As of this writing it doesn't, project-wide (`tests/fixtures.json:hand_labeled` is `null` for both fixtures) — so a passing test suite there is a **golden-snapshot** pass, not a correctness proof, and the phase doc must say so rather than imply otherwise.

If no — most phases touching only internal utilities, docs, or `scoring_config`/`REGISTRY`-equivalent files — typecheck + lint (or pytest, for analyzer-only phases) in Verification is sufficient. Don't invent a manual check for a mechanical rename that doesn't touch rendered output or scored numbers.

### 7. Confidence check

Before writing, ask yourself: do I actually understand this code well enough to recommend changes? If there's anything load-bearing where you're guessing — a scoring-config change you only half-verified against every fixture, an `analysis.json` contract change you're not fully sure stays backward-compatible with the player — surface it as an `Open Question` in the doc rather than recommending something you might be wrong about.

Confidence levels for the front-matter:
- **High** — I read the relevant files, cross-checked against `.claude/rules/*.md`/`docs/DECISIONS.md`, and I'd stake my reputation on these findings.
- **Medium** — solid on most findings; one or two have open questions documented.
- **Low** — investigated but several uncertainties; user should review before executing. (If you're at Low across the board, consider asking the user clarifying questions before writing the doc.)

### 8. Write the audit folder

Create `.claude/audits/<slug>-<YYYY-MM-DD>/` where `<slug>` is a kebab-case derivative of the target. Examples:
- `scoring-pipeline-2026-08-07/`
- `swing-player-2026-08-10/`
- `scoregauge-2026-08-14/`

If a folder for the same slug+date already exists, append `-2`, `-3`, etc. Never overwrite.

Files inside:

```
00-overview.md              # Entry doc — read this first
01-phase-1-<slug>.md        # First phase
02-phase-2-<slug>.md        # ...etc
_status.md                  # Phase tracking — updated as phases complete
```

Use the templates in `references/`:
- `references/audit-template.md` — for `00-overview.md`
- `references/phase-template.md` — for each phase doc
- `references/status-template.md` — for `_status.md`

The templates are designed so the resulting `.md` can be pasted into a fresh Claude conversation with "execute this plan" and it just works. Don't strip the AI-coder execution instructions; they're load-bearing for that use case.

### 9. Present the four options

Once the docs are written, **always** ask the user which way to go. Use `AskUserQuestion` so this survives auto/bypass mode. The four options:

1. **Execute and fix according to plan** — enter execution mode (see § Execution Mode below).
2. **Resolve later** — save the audit and end this turn. Print the path to the overview file so the user can come back to it.
3. **Ask a question on the plan** — the user has a question. Answer it. Don't change the plan unless they then ask you to. After answering, re-present the four options.
4. **Other** — the user wants to change something about the plan. Take their input, update the relevant `.md` file(s), then re-present the four options.

Phrase the question something like: *"Audit complete. Plan saved to `.claude/audits/<slug>-<date>/00-overview.md` with N phases. How do you want to proceed?"*

## Subagent patterns (when to fan out, when to stay inline)

Subagents save tokens when **input is large and output summary is small.** Reading 25 files to return "found 3 hardcoded thresholds at file:line" is a clear win. Reading 25 files where the main agent needs the full content to write recommendations is overhead.

Use `Explore` subagent type — read-only, optimized for "find X / where is Y," and much cheaper than `general-purpose`. Spawn them in **parallel** by issuing all `Agent` tool calls in a single message; don't serialize them. For the convention pre-scan specifically, prefer the `fresh-eyes-reviewer` custom agent (`.claude/agents/fresh-eyes-reviewer.md`) — its checklist and ranked output format are baked in; keep `Explore` for pure find/where sweeps.

Four named patterns. Mix and match by scope size.

### Pattern A — Pre-scan: convention violations (medium and large scope)

One subagent runs the mechanical convention sweeps in parallel with your structural investigation. Cheap (one `Explore` subagent, ~2-3k tokens for the whole run) and parallelizable, so the cost is hidden behind your reading.

Brief it with: "Search `<audit scope paths>` for these convention violations and return a bulleted list with file:line citations and one-line evidence per finding. Stop at 50 findings. Patterns to look for:
1. Any `'use client'` file importing `lib/scoring.ts`, `db/*`, or another module that touches Postgres/`node:fs`
2. `any` type annotations (not `: unknown`)
3. Default exports of components (anything not `page.tsx` / `layout.tsx`)
4. `../../../` relative imports instead of `@/*`
5. `.tsx` component files not in PascalCase, or a file name not matching its component
6. `Props` interfaces not named `[ComponentName]Props` or not defined above the component
7. Existence of any `tailwind.config.{js,ts}` file (emergency — should not exist in v4)
8. v3 Tailwind directives (`@tailwind base`, `@tailwind components`, `@tailwind utilities`) in CSS files
9. Hardcoded hex colors in component files (`#[0-9a-f]{3,6}`) outside `globals.css`'s `@theme` block
10. A new element with no explicit border color set (Tailwind v4's default border is `currentColor`)
11. Hand-built panel/card markup that duplicates a shape already exported from `apps/web/src/components/ui/kiosk.tsx`
12. A scoring threshold, band cutoff, or weight written as a literal number in `.py`/`.ts` instead of read from `scoring_config/<version>.json`
13. Confidence values compared against a threshold after `round()`/`.toFixed()` instead of truncation
14. Keypoint-index code that assumes a contiguous derived block instead of calling `skeleton.strip_derived()`, or that inserts/reorders entries in the 49-keypoint layout
15. A `left_*`/`right_*` (camera-relative) field used in a metric or label where a handedness-resolved `lead_*`/`trail_*` field is what the spec calls for

Return format: `<rule #>` — `<file:line>` — `<one-line evidence>`. No prose."

### Pattern B — Subdomain investigation (large scope only)

Fan out one `Explore` subagent per subdomain. For an analyzer pipeline audit:
- Agent 1: `services/analyzer/swingsage/{pose,skeleton}.py` (pose + Stage 3 post-processing)
- Agent 2: `services/analyzer/swingsage/{club,events}.py` (club tracking + event detection)
- Agent 3: `services/analyzer/swingsage/{metrics,scoring}.py` + `scoring_config/**`
- Agent 4: `apps/web/src/components/**`, `apps/web/src/lib/**` (the player)

Brief each one with: "Investigate `<paths>` against these architectural axes — report findings only, max 15 bullets, with file:line citations:
- Reuse vs. duplication: functions/components that share >60% structure with another in the same or sibling module
- Componentization: hand-built UI that should reuse a `components/ui/kiosk.tsx` shape; Python helpers duplicated across pipeline stages instead of shared in a common module
- Logical placement: components in `app/` route dirs instead of `components/`; pipeline logic in `scripts/` that belongs in `swingsage/` (or vice versa — debug scripts should stay thin wrappers over `swingsage/`, not reimplement it)
- Structural soundness: files >500 lines; circular imports; mixed concerns (a module doing I/O + geometry + scoring in one file)
- Boundary violations: client components importing server-only modules; a pipeline stage reaching past the stage boundary described in doc 02 (e.g. event detection reading club data that Stage 4 hasn't produced yet, violating the Phase 2→5 build order)

Return format: bulleted list, grouped by axis. Cite `components/ui/kiosk.tsx` exports or `docs/DECISIONS.md` D-numbers when relevant. No prose. No recommendations — just findings."

### Pattern C — Latest-leverage sweep (axis 13 — medium and large scope)

One `Explore` subagent scoped to "is there a newer way?" findings. Cheap and naturally a search-pattern task.

Brief it with: "Search `<audit scope paths>` for opportunities to leverage newer Next.js 16 / React 19 features. Return bulleted findings with file:line citations:
1. Manual data-fetching in `useEffect` that could be a Server Component or Server Action
2. Tab/view switching (e.g. between `OverviewView` / `CoachView` / `AdvancedView`) that could use the React View Transitions API instead of manual state-driven transitions
3. Any `unstable_cache` usage that could become `'use cache'` under Next.js 16 Cache Components (this project has no confirmed decision either way yet — flag the opportunity, don't push a migration)
4. Edge runtime usage on a route that doesn't need it
5. Manual streaming/Suspense patterns that could use newer App Router primitives

Skip AI-SDK/provider-routing findings entirely — doc 07's AI provider isn't built yet (scoring's coach narrative is deterministic, not AI-generated, as of this project's current state), so there is nothing to route or gateway.

Return format: `<finding type>` — `<file:line>` — `<one-line description>`. No prose."

### Pattern D — Decisions digest (any scope that plausibly intersects several D-numbers)

`docs/DECISIONS.md` is a single long append-only file, not a per-domain folder — so this pattern is "search it," not "read several files." One `Explore` subagent greps `docs/DECISIONS.md` for the D-numbers relevant to the audit scope (by keyword: "club", "scoring", "confidence", "keypoint", "handedness", "frame sync", etc.) and returns a one-line digest of each match: number, one-line decision, and its `Status:` line verbatim — reporting `Status:` is not optional, since roughly a quarter of entries are `SUPERSEDED`/`NEGATIVE RESULT`/`HISTORICAL` and citing one of those as current would be wrong. Saves the main agent from loading the whole file just to find three relevant entries.

Brief it with: "Grep `docs/DECISIONS.md` for entries matching `<keywords>`. For each match, return: `D<N>` — decides: `<one line>`. Status: `<verbatim Status: line>`. No prose."

### Anti-patterns — when NOT to spawn

- **Small audit (<5 files).** Just read them. Briefing overhead exceeds the gain.
- **Synthesis.** Connecting findings across axes, deciding the phase plan, writing recommendations — must happen in the main agent. Subagents lack the integrated picture.
- **Execution mode** (option 1). Sequential by design — each phase verifies before the next. Fanning out defeats the verification loop.
- **"Just do the whole audit"** as one big subagent prompt. You lose the architectural lens — the main agent's job is to weigh findings against each other, not to receive a pre-written report. Subagents return findings; the main agent decides what they mean.

## Execution Mode (option 1)

If the user picks "Execute and fix according to plan," **execute the entire plan autonomously, end-to-end, with aggressive self-resolution.** The user has explicitly said: "I can always go back and revert things if I don't like it. But as it goes, if there is a better way or things missed, by all means, fix it too automatically."

That means: don't stop for plan defects, scope creep, missed findings, or fixable bugs — adapt and continue. Stop only for things that are genuinely irreversible or that require human input no Claude can supply.

### The autonomous loop

For each phase in `_status.md` order, until all reach `complete`:

1. Read `_status.md`. Find the first phase with status `pending`.
2. **Pre-flight checkpoint.** If the overview marks this phase as `Touches > 5 files`, as a structural refactor, or as touching a shared contract (`analysis.json`, `scoring_config`, `lib/usePlayer.ts`), invoke `/checkpoint` first. This is the user's revert path — they will use it if they don't like the result, so always create it for those categories.
3. Open the phase's `.md` file. Check preconditions.
   - If preconditions are unmet but **you can fix them yourself** (run a missing install, recreate a missing file the prior phase should have made, regenerate a missing checkpoint), do so and continue.
   - Only escalate if preconditions genuinely require something only the user can supply (a credential, an approval).
4. Update `_status.md`: phase → `in-progress`, set `startedAt`.
5. Execute the phase's tasks in order. **Use best judgment within the audit's general subject area:**
   - If you find a **better way** to accomplish the task's goal than what the phase doc literally says, take it. Log the deviation in the `_status.md` event log.
   - If you discover a **related finding** the audit missed (within the audit's subject area), fix it inline and log it. Don't ignore improvements just because they weren't pre-planned.
   - If you find a **fixable bug** while executing (actual broken behavior, not just convention), fix it and log it.
   - **Stay within the audit's subject area.** Auditing scoring? Metrics, scoring config, and coach-report generation are in scope. Touching pose tracking or the player's canvas rendering the audit didn't cover is out of scope — note the observation in `_status.md` but don't fix it.
6. Run the phase's Verification commands. If any Verification step is a Manual check (e.g., "open the player and confirm X"), pause and ask — that's an inherent escalation.
7. **If verification passes:** update `_status.md` (phase → `complete`, `completedAt` set, deviations and extra fixes noted in the event log), invoke `/commit` for this phase, move directly to the next phase. No user chatter.
8. **If verification fails — up to 3 self-heal attempts allowed:**
   - Attempt 1: read the failure output, apply the obvious fix, re-run.
   - Attempt 2: try a different angle (first attempt fixed an import; this attempt also updates a fixture).
   - Attempt 3: broaden the fix to anything else clearly within the audit's subject area that the failure implicates.
   - If verification passes at any attempt, continue.
   - Only after 3 attempts AND when the remaining failure requires an architectural decision (a Plan A vs Plan B choice the audit didn't anticipate), escalate.
9. When all phases reach `complete`, append `audit closed — <YYYY-MM-DD HH:MM UTC>` to `_status.md`'s event log, update the `**Audit status:**` line, and give the user a **single end-of-execution summary** (format below).

### End-of-execution summary

Only this report, at the very end. Do not narrate per-phase during the run.

> **Audit executed — `<audit-slug>-<date>`**
>
> **Phases:** 3 of 3 complete.
> **Files changed:** 9 total (4 + 3 + 2 across phases).
> **Commits:** `<sha1>` Phase 1: move hardcoded rotation thresholds into scoring_config v3; `<sha2>` Phase 2: verify + wire ROT-04 raw-value direction; `<sha3>` Phase 3: conventions + DECISIONS.md entry.
> **Verification:** `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` ✓, `pytest tests` (phases 1–2) ✓.
> **Checkpoints:** `checkpoint-audit-<slug>-phase1-<ts>` before phase 1's scoring_config schema change.
> **In-flight deviations & extra fixes:**
> - Phase 1: also moved a second hardcoded weight found in `metrics.py:212` — wasn't in the plan but was clearly the same fix.
> - Phase 2: discovered ROT-07 had the same unverified-direction problem the audit didn't flag; verified it against all fixtures and fixed it in this phase.
> **Escalations during run:** none.
>
> Next steps: review diffs, run `pnpm db:backfill` if any fixture output changed, `/commit-and-audit` if the player UI surface changed.

The **In-flight deviations & extra fixes** section is load-bearing. It's how the user evaluates your judgment calls — they asked for autonomy, so they need to see what you did beyond the formal plan. Be specific and concise. Empty section = "no deviations, ran the plan as written."

### Escalation triggers — the short list

Stop and ask the user **only** for these. Everything else, adapt and continue.

1. **A Manual check in the phase's Verification section.** Cannot be done autonomously by definition (visual confirmation, UX-feel judgment, anything that needs a person to open the player).
2. **Anything touching shared / external / irreversible state without explicit pre-approval.** A DB migration, a force push, removing `analysis.json`'s published shape, changing `scoring_config`'s schema in a way that breaks old reports' `scoring_model_version`, modifying `pnpm-lock.yaml`, deleting files outside the audit scope, anything touching a real swing's data in Postgres.
3. **Missing credential or external dependency.** Don't fabricate values, don't skip auth steps, don't generate fake API keys.
4. **After 3 self-heal attempts, verification still fails AND the remaining problem requires an architectural decision** — not just more code. If you've tried 3 angles and the fourth would require the user to pick between Option A and Option B, escalate.

That's it. Four triggers, all genuinely outside Claude's authority or capability.

**Things that USED to be escalations and are now self-resolve:**

- Scope creep (more files than planned) → expand and continue, log it.
- Critical finding discovered mid-flight (within the audit's subject area) → fix it, log it.
- Plan defect (the recommendation as written wouldn't work) → adapt the approach to achieve the recommendation's goal, log the deviation.
- Fixable bug discovered → fix it, log it.
- Test failure due to brittleness or a phase-anticipated rename → update the test, continue.
- Preconditions you can repair yourself → repair them, continue.
- "Better way" observation → take the better way, log it.

### When you escalate (the rare case)

1. Update `_status.md`: current phase stays `in-progress`, capture the escalation reason in the event log.
2. Give the user a focused report: what phase, what triggered the stop, what you tried, what decision you need.
3. **Do not unilaterally roll back.** Stopping is enough. The user decides whether to roll back via the checkpoint, fix the plan, or proceed differently.
4. After the user responds, resume autonomous execution from where you paused.

### Hard rules during autonomous execution

- **Use `/commit` per phase**, not at the end. Per-phase commits give clean rollback granularity if the user wants to revert just one phase.
- **Use `/checkpoint` before any phase the overview marks as `Touches > 5 files` or a structural refactor.** No exceptions — this is the user's revert path and they're relying on it.
- **Stay within the audit's subject area** when applying in-flight fixes. A scoring audit can fix scoring-adjacent things; it cannot start refactoring the player.
- **Always log deviations and extra fixes in `_status.md`** event log. Vague entries aren't useful — say what was changed and why.
- **No per-phase chatter to the user.** Silence between phases is correct. The end-of-execution summary (with the deviations list) is the report.

## Task audit mode (`/audit-task`)

A lighter, in-session variant of the audit. Designed for the case where the user (or you) just finished a piece of work — a new component, a new API route, a new scoring check — and wants a fast sanity check that **the work used the existing primitives, followed conventions, and didn't duplicate something already in `components/ui/kiosk.tsx`**. Chat-only output. No `.claude/audits/` folder. No phase docs.

### When this mode triggers

- User types `/audit-task` (with or without arguments).
- User asks "audit what I just did" / "review the work I just made" / "did I follow conventions" / "self-review my recent edits."
- Trigger preemptively after you (or a sibling Claude in this thread) have shipped a non-trivial piece of new UI or backend work and the user signals they want a sanity check before committing.

If the user typed `/audit <target>` with an explicit target, that's full-audit mode — don't use this section.

### Scope derivation

Task audits don't take a typed target. The scope is derived from the current state of the working tree.

**Default scope:** uncommitted changes.

```bash
git status --porcelain                # what's modified / untracked / deleted
git diff HEAD --stat                  # line-level summary of changes in tracked files
git diff HEAD --name-only             # bare list of changed tracked files
```

Combine: changed tracked files + untracked new files (excluding `.gitignore`d patterns and the audit folder itself).

**Argument overrides:**
- `/audit-task last commit` — scope = `git diff HEAD~1 HEAD`
- `/audit-task last <N> commits` — scope = `git diff HEAD~<N> HEAD`
- `/audit-task <specific file or folder>` — scope = that path only, plus the uncommitted-changes filter
- `/audit-task --branch` — scope = `git diff main...HEAD` (everything on this branch)

**Empty scope is a valid result.** If `git status` is clean and no argument was passed, tell the user "no changes detected — nothing to audit" and stop. Don't invent things to audit.

**Self-audit folder must be excluded.** If the user's session created `.claude/audits/**` files, exclude those from the scope — auditing your own audit docs is noise.

### Fresh-eyes subagent review (mandatory in this mode)

When Claude has just made the changes itself, there's a cognitive risk: the auditing Claude has already rationalized its own choices and is unlikely to spot them as problems. To structurally avoid this, **always delegate the actual review to an `Explore` subagent** in task-audit mode — even for tiny scopes. The subagent reads the changed files fresh, with no memory of why each decision was made.

Spawn one `Explore` subagent (don't fan out unless the scope is unusually large — 8+ files). Brief it with:

> "Review the following changed files for adherence to SwingSage conventions. Read each file fresh. Also read `apps/web/src/components/ui/kiosk.tsx` (this project's card-shape vocabulary — the closest thing it has to a component registry) and whichever of `.claude/rules/{nextjs,tailwind-v4,typescript,testing}.md` govern the changed paths.
>
> Changed files: `<list>`
>
> For each file, check:
> 1. **Server/client boundary:** if the file imports `lib/scoring.ts`, `db/*`, or another Postgres/`node:fs`-touching module, is it a server component or server-only file — never a `'use client'` file?
> 2. **Card/panel reuse:** if the file renders a score, panel, or stat visual, does it reuse a shape from `components/ui/kiosk.tsx` (`KioskPanel`, `ScoreGauge`, `IndicatorCard`, `FindingBox`, `TipCard`, `MetricRow`, `StatTile`, `DataRow`, `QualityBar`, `NotBuilt`) rather than hand-building new markup?
> 3. **Tailwind v4 discipline:** no `tailwind.config.*`, no `@tailwind` directives, theme tokens (`--color-*`/`--spacing-*`/`--font-*`) used instead of hardcoded hex, explicit border color set on new elements.
> 4. **Domain placement + naming:** components in `components/[domain or ui]/`, not in `app/` route dirs. PascalCase `.tsx` matching the component name; kebab-case non-component `.ts`. Python changes follow `swingsage/`'s existing module conventions.
> 5. **RSC discipline:** `'use client'` at the leaf (browser APIs, hooks, event handlers, canvas/video imperative control only), not wrapping data-fetching or layout composition.
> 6. **Type safety:** no `any` — `unknown` and narrow. Data crossing a boundary (API bodies, `analysis.json`/`coach_report.json` reads, DB rows) typed explicitly at the read site.
> 7. **Export/props discipline:** named exports except `page.tsx`/`layout.tsx`. One component per file. Props interface named `[ComponentName]Props`, defined above the component.
> 8. **Import paths:** `@/*` alias, no `../../../`.
> 9. **`analysis.json` contract discipline** (only if the file reads/writes `analysis.json`, `coach_report.json`, or keypoint/metrics data): normalized 0–1 coordinates preserved; the 49-keypoint order untouched or correctly appended, never reordered; confidence truncated not rounded; handedness-resolved `lead_*`/`trail_*` fields used where the metric is handedness-sensitive, not raw camera-side `left_*`/`right_*`.
> 10. **Scoring discipline** (only if the file touches `scoring_config/*.json` or `swingsage/scoring.py`): no threshold hardcoded outside the versioned config; if a new check was added, was its raw value verified — across all fixtures — to move in the direction the band assumes, before being trusted?
> 11. **Decisions log:** does this diff contain a spec deviation, threshold change, or interim shortcut that `docs/DECISIONS.md` should record but doesn't yet?
> 12. **For new API routes specifically:** is external input validated defensively before use (no formal schema library is standardized in this project yet — don't invent a requirement that isn't real, but flag genuinely unvalidated input)? Is job/progress state written to the `jobs` Postgres table rather than held only in module memory?
>
> Return format — three groups:
>
> ✅ Followed: `<one-line bullet per practice that was correctly used, with file:line citation where applicable>`
> ⚠️ Issue: `<one-line bullet per partial/concerning finding, with file:line + one-line fix suggestion>`
> ❌ Violation: `<one-line bullet per hard violation, with file:line + one-line fix suggestion>`
>
> Then a one-line verdict: clean / mostly clean / needs cleanup / needs rework.
>
> No prose. No recap of what the files do — assume the reader knows."

### Output format

Render the chat report in this six-section structure. **Much shorter than full-audit close-out** — no audit folder, no phase index.

**1. Header line.** One sentence — scope + verdict from the subagent.

> Audited my recent work: **3 files changed (+126 / −18)** → verdict: **needs cleanup** (1 violation, 2 issues, 5 practices followed).

**2. What changed.** Bulleted list, one line per changed file, with the line-delta from `git diff --stat` and a one-clause description of what the change was.

> Changes in scope:
> - [`services/analyzer/swingsage/scoring.py`](services/analyzer/swingsage/scoring.py) (+38 / −4) — added a new `HIP-05` sway check
> - [`services/analyzer/scoring_config/v3.json`](services/analyzer/scoring_config/v3.json) (+9) — new `HIP-05` band, thresholds inline in the check for now
> - [`apps/web/src/lib/scoreDisplay.ts`](apps/web/src/lib/scoreDisplay.ts) (+6) — added `HIP-05` to the display glossary

**3. What was checked (the "why").** 3–5 bullets naming the specific conventions the subagent verified against, each citing the source rule/doc. Same shape as full-audit section 3, but trimmed to what was actually relevant to this scope.

> Checked against:
> - **Scoring thresholds live in `scoring_config.json`, never hardcoded (root `CLAUDE.md`):** any new check's band must be data, not a literal in `scoring.py`.
> - **"A check that scores well is not evidence it works" (the D42 incident, `docs/DECISIONS.md`):** a new check's raw value must be printed across every fixture and confirmed to move the direction the band assumes before it's trusted.
> - **Client/server boundary (`.claude/rules/nextjs.md`):** `lib/scoreDisplay.ts` is the client-safe half of the scoring split — it must stay free of `db/*`/Postgres imports.

**4. Findings (from the subagent).** Three short groups — followed / issues / violations. Use the subagent's own bullets. Cap at ~8 total findings; if there are more, summarize the long tail as "+N more — see full subagent output above."

> ✅ Followed:
> - `HIP-05`'s threshold added to `v3.json` alongside the other bands, not scattered elsewhere
> - `lib/scoreDisplay.ts` stayed free of any `db/*` or Postgres import
> - Named export, no `any`, `@/*` import paths used throughout
>
> ⚠️ Issues:
> - [`scoring.py:214`](services/analyzer/swingsage/scoring.py#L214) — `HIP-05`'s raw value is read straight from `metrics.hip_sway` with no comment on why the band's direction is correct; no evidence it was checked across all fixtures
> - [`scoring.py:220`](services/analyzer/swingsage/scoring.py#L220) — one of the two threshold numbers is still a literal (`0.12`) rather than pulled from `v3.json`, inconsistent with the rest of the check
>
> ❌ Violations:
> - No `docs/DECISIONS.md` entry for the new `HIP-05` check or its threshold choice — `CLAUDE.md` requires spec deviations and new scoring checks to be logged there; future readers (and future audits) have no record of why this band was chosen.

**5. Suggested fixes.** 3–5 bullets, each tagged `Quick` / `Moderate`. Tie each fix to the finding above. Skip phase numbers — task audits don't have phases.

> Suggested fixes:
> - Add a `docs/DECISIONS.md` entry for `HIP-05` — what it measures, why the threshold, what fixtures it was checked against [Quick]
> - Move the `0.12` literal at [`scoring.py:220`](services/analyzer/swingsage/scoring.py#L220) into `v3.json` alongside the other threshold [Quick]
> - Print `metrics.hip_sway`'s raw value across all fixtures and confirm the sign/direction the `HIP-05` band assumes actually holds before trusting the score [Moderate]

**6. Architectural note.** One sentence — either positive ("this work used the existing primitives correctly and is good to commit after the two nits") or negative ("this check hasn't been verified the way D42 requires — don't trust its score until that's done"). If the audit is clean, say so plainly.

> Net: the check is correctly wired into the config-driven scoring path except for one stray literal, but it has not yet cleared the bar D42 exists to enforce — verify the raw-value direction across fixtures before this check's score is trusted anywhere in the coach report.

**7. Closing question.** Three options via `AskUserQuestion`:

1. **Apply these fixes now** — make the changes inline and report when done.
2. **Skip — I'll handle them later** — end the turn, no changes.
3. **Promote to a full `/audit`** — escalate to the heavyweight mode, writing the `.claude/audits/` folder with phased plan. Use when the findings are bigger than a quick cleanup.

### When to promote to full audit

If any of these are true, recommend option 3 (promote) in your phrasing of the question rather than steering toward option 1:

- 3 or more **violations** (❌), not just issues.
- Findings touch multiple domains (analyzer scoring + player display + DB, etc.).
- A single finding requires changes in >5 files (e.g., "this threshold pattern is wrong in every check in this file, migrate all of them").
- The work just done duplicates a major existing check or component — the right fix is a consolidation, not a one-off cleanup.
- More than ~15 files in scope total.

In all of those, the task-audit chat report is still useful (the user sees the headline findings immediately), but the actual remediation needs the phased structure of a full audit.

### Hard rules in this mode

- **Chat-only.** Do not create `.claude/audits/<slug>-<date>/` in task-audit mode unless the user explicitly picks option 3.
- **Always fresh-eyes via subagent.** Never skip the subagent step, even on a one-file change. The cognitive separation is the whole reason this mode exists.
- **Don't manufacture findings.** A clean task audit ("all 8 checks followed, no issues, no violations") is a valid and useful result. Say "clean" and ask if the user wants to commit.
- **Don't suggest unrelated improvements.** Stay strictly within the scope of what changed. If you notice something concerning in an adjacent file that wasn't touched, note it as a one-line "scope-adjacent observation" at the bottom — don't expand the audit.
- **No naming the subagent's output verbatim if it's noisy.** Trim, group, and edit the subagent's findings into the six sections. The subagent gives you raw findings; you present a curated report.

## Important constraints

These are the things that, if violated, ruin the value of the skill:

- **The audit does not edit code.** It only writes `.md` files in `.claude/audits/`. Code edits happen only in execution mode, after the user explicitly opts in.
- **Citations are mandatory.** Every finding must point at a source of truth (a `docs/DECISIONS.md` D-number, a `.claude/rules/*.md` file, a `components/ui/kiosk.tsx` export, `scoring_config/COVERAGE.md`, or a Next.js/React doc URL). "Best practice" with no source is not a finding.
- **Tech debt introduced by the solve is mandatory.** Every audit doc has a "Tech debt introduced by this plan" section. If the answer is "none," say "None — recommendations are pure removal/consolidation, no new abstractions." Don't skip the section.
- **Don't manufacture findings.** A clean audit ("0 critical, 0 high, 2 medium, 1 low") is a valid and useful result. Padding undermines trust.
- **Don't recommend changes outside the audited scope.** If during a scoring audit you notice something broken in the player, note it as a "scope-adjacent observation" at the end of the overview, but don't draft phase work for it. Stay in scope.
- **Be honest about `docs/DECISIONS.md` Status lines.** Never cite a `SUPERSEDED`/`NEGATIVE RESULT`/`HISTORICAL` entry as if it's current guidance — check the `Status:` line every time.

## Output style for the user's final message

When you finish writing the audit and present the four options, give the user a structured summary in chat — not just a pointer. The doc has the full detail; this summary tells them at a glance what just happened and whether the plan is worth their time to read. Use this exact six-section structure.

### Structure

**1. Header line.** One sentence with the target, finding counts, phase count, and confidence.

> Audited `scoring pipeline` → **1 critical / 3 high / 2 medium / 1 low** across **2 phases**. Confidence: **high**.

**2. Files created.** Bulleted list of every `.md` written to the audit folder, each with a one-line description of its role.

> Files written to [`.claude/audits/<slug>-<date>/`](.claude/audits/<slug>-<date>/):
> - [`00-overview.md`](...) — Entry doc: TL;DR, findings by severity, strategy, phase index, AI-coder execution instructions
> - [`01-phase-1-<slug>.md`](...) — Phase 1 (`<title>`): one-line summary of what this phase changes
> - [`02-phase-2-<slug>.md`](...) — Phase 2 (`<title>`): one-line summary
> - [`_status.md`](...) — Phase tracker, updated as you execute

**3. Best practices applied (the "why").** 3–5 bullets explaining the frames the audit checked against. **Name the technology / convention by name** — not vague "best practices" language. Each bullet: practice → source of truth → what it meant for this specific audit. The user is technical; the specifics help.

> Frames applied:
> - **Scoring thresholds live in `scoring_config.json`, never hardcoded (root `CLAUDE.md`):** used to find two rotation checks reading a threshold as a Python literal instead of the versioned config.
> - **"A check that scores well is not evidence it works" (the D42 incident, `docs/DECISIONS.md`):** used to catch a third check whose raw value has never been printed across all fixtures — it could be the same silent-zero failure mode v1's rotation checks hit.
> - **Client/server boundary (`.claude/rules/nextjs.md`):** `lib/scoring.ts` (server, Postgres I/O) vs `lib/scoreDisplay.ts` (client-safe) — used to confirm no new code crossed that line.
> - **49-keypoint append-only order (`docs/DECISIONS.md` D25, D47):** used to confirm the new metric didn't reorder or insert into the keypoint array.

**4. Coverage table.** A markdown table — one row per axis. **This is the findings view AND the proposal view combined.** Don't write a parallel bullet list of findings or a separate "what I'm proposing" section — the table carries all of it. The `00-overview.md` doc has the long-form per-finding detail (evidence, citations, recommendations); the chat table is the curated view.

Columns: `#`, `Axis`, `Status`, `What it found`, `Fix`.

The Status column is an independent emoji that conveys severity/impact at a glance. The What it found column describes the finding (what's currently wrong or noteworthy). The Fix column describes what will be done about it (the action, not the finding).

### Status emoji legend

| Emoji | Status | When to use |
|-------|--------|-------------|
| ✅ | Perfect | Axis fully clean — code already follows the best practice. No changes needed. |
| ✨ | Polish | Small fix, low priority — cosmetic / nice-to-have. Safe to skip without architectural cost. |
| ⚡ | Quick win | Small fix with outsized impact — one-line or single-file change that pays off disproportionately. |
| 🔧 | Cleanup | Moderate fix, standard effort — real improvement but not transformative. |
| 🔥 | Big win | Major improvement / high impact — consolidations, deduplications, correctness fixes that move the codebase forward. |
| 🚨 | Critical | Hard rule violation — must fix. Breaks a root `CLAUDE.md` constraint, an `ACTIVE` decision, or a load-bearing contract. |
| — | N/A | Axis not applicable to this audit's scope. |

Each axis row carries the **highest-severity status** among its findings. If axis 12 has both a hardcoded threshold (🚨) and a naming nit (✨), the row shows 🚨.

### Passed-check rows ("colspan" treatment)

When a check passes (status `✅`), there's nothing to "fix" — both the What it found and Fix columns become noise if they say `—` twice. Instead, **merge the description into a single visual cell**: put the best-practice descriptor in the What it found column, naming the specific practice that's being followed, and use `—` in the Fix column to signal "no action needed." This reads as a praise row: the audit confirms what's right.

Same treatment for N/A rows (status `—`): put a one-line reason in the What it found column (`"Not applicable: <reason>"`), `—` in Fix.

### Example

> | # | Axis | Status | What it found | Fix |
> |---|------|--------|---------------|-----|
> | 1 | Next.js 16 / TS correctness | ✅ | `'use client'` kept at the leaf; no `any`; named exports throughout; `@/*` imports only. Already follows `.claude/rules/nextjs.md` + `typescript.md`. | — |
> | 2 | Frame-sync & player correctness | — | Not applicable — this audit's scope was scoring only, no player files touched. | — |
> | 3 | Python CV pipeline correctness | ✅ | `scoring.py` reads `metrics.hip_sway` through the documented `metrics.sides`-resolved accessor, not a raw side field; pipeline stage order untouched. | — |
> | 4 | `analysis.json` contract integrity | ✅ | No keypoint reordering; confidence handling unchanged. | — |
> | 5 | Scoring-config correctness | 🚨 | Two rotation checks (`ROT-04`, `ROT-07`) read a threshold as a Python literal instead of `scoring_config/v3.json`; `ROT-07`'s raw value has never been printed across fixtures to confirm its band's direction is correct — exactly the D42 failure mode. | Move both literals into `v3.json`. Print `ROT-07`'s raw value at the checkpoint across all fixtures before trusting its band; if the direction is inverted, fix the comparison, not the score. |
> | 6 | Test suite integrity | 🔧 | The scoring test coverage is entirely golden-snapshot (`test_stages.py`) — no hand-labeled truth exists for rotation metrics, so a green run here is not proof `ROT-04`/`ROT-07` are correct. | Note this explicitly in the phase doc rather than presenting the golden-snapshot pass as sufficient verification. |
> | 7 | Structural soundness & scalability | ✅ | `scoring.py` stays under 500 lines; no circular imports; stage dependency order (club after pose, events after club) untouched. | — |
> | 8 | Componentization / modularization | — | Not applicable — no UI changed in this audit. | — |
> | 9 | Reuse vs duplication | ✅ | New checks reuse the existing `Check` dataclass and `evaluate()` dispatch — no forked scoring loop. | — |
> | 10 | Logical placement | ✅ | New checks live in `scoring.py` next to their siblings; config lives in `scoring_config/v3.json`, not inline. | — |
> | 11 | Tech debt invoked | ✅ | Recommendations are pure config migration + verification — no new abstractions, dependencies, or transitional states. | — |
> | 12 | Conventions, naming & `docs/DECISIONS.md` | 🚨 | No `docs/DECISIONS.md` entry exists for `ROT-04`/`ROT-07`'s addition or thresholds — root `CLAUDE.md` requires scoring changes to be logged. | Add one D-number entry covering both checks: what they measure, chosen thresholds, fixtures checked against. |
> | 13 | Latest Next.js/React leverage & additional suggestions | — | None outside the above — this audit's scope had no player-facing code. | — |

### Cell-writing rules

- **Be descriptive — 1–3 sentences per cell is fine.** Thin 6-word cells don't give the user enough to triage without opening the doc.
- **"What it found" describes what's there** (the finding or, for ✅ rows, what's already correct). **"Fix" describes what will be done** (the action, in active voice, naming the file/component if relevant).
- **For ✅ rows:** "What it found" carries the best-practice descriptor, Fix is `—`. Together they read as a praise row.
- **For — (N/A) rows:** "What it found" carries the one-line reason, Fix is `—`.
- **One status per row** — the highest-severity finding for that axis sets the emoji.
- **If many findings under one axis** (4+ in axis 12, say): the cells consolidate. List the two or three most representative findings in "What it found," append `+N more — see overview`, and describe the unifying fix in "Fix."
- **Always show all 13 rows** even when many are ✅ or —. The empty rows ARE the message ("axes 2, 8, 13 weren't applicable here").

**5. Plain-English summary (explain-like-I'm-5).** Right after the table, a short bulleted list that translates the action items into plain language — no jargon, or jargon explained in the same breath. One bullet per fix worth doing (skip the ✅ and — rows). Each bullet says **what's wrong and what we'll do about it, in one friendly sentence.**

Rules for these bullets:
- **No unexplained jargon.** "the check's threshold is hardcoded" becomes "one of the scoring rules has its cutoff number typed directly into the code instead of the settings file where all the others live." If a technical term is unavoidable, explain it inline.
- **Pair the problem and the fix.** "Right now X happens, which is bad because Y — so we'll do Z."
- **Keep it to one sentence per item.** If it needs two, the item is probably two items.
- **Order by impact** — the 🔥/🚨 big items first, the ✨ polish last.
- **Skip the clean axes.** Nobody needs "and the player was already fine" in the ELI5 — the table already shows the ✅s.

> In plain English:
> - **Two of the new rotation scoring rules have their cutoff numbers typed directly into the code** instead of living in the settings file with every other rule — that means changing a threshold later means editing code, not config. We'll move both into the settings file.
> - **One of those rules has never actually been checked against real swings** to prove it scores in the right direction — this project got burned by exactly this once before (nine checks silently scored zero on every swing). We'll print its numbers across every test swing before trusting it.
> - **Nobody wrote down why these two new rules exist or what thresholds were chosen**, so a future person (or AI) has no record to check against. We'll add one entry to the project's decision log.

**6. Phases at a glance.** A tiny table — one row per phase — so the user sees the shape of the work without opening any phase doc. Three columns: `Phase`, `Name`, `What it does`. The "What it does" cell is a **fragment, not a sentence** — the shortest possible plain-language gist (3–7 words).

> | Phase | Name | What it does |
> |-------|------|--------------|
> | 1 | Move thresholds into config | pull hardcoded numbers into v3.json |
> | 2 | Verify + document | check raw-value direction, log the decision |

If the audit produced a single phase, still show the table — one row. Don't skip it; the user uses this to gauge effort and sequencing at a glance.

**7. Architectural win.** One closing sentence on what the system gains when the plan lands. Be concrete.

> When done: both new rotation checks become config-driven and D42-verified like the rest of the scorecard, and the decision log has a record future audits can trust instead of re-deriving.

**8. Then immediately the four-option `AskUserQuestion`.** No extra prose between the architectural-win line and the question.

### Constraints on the summary

- **Don't recap each finding in detail.** The `00-overview.md` is the source of truth — bullets here are summaries, max one line each.
- **Cite by name in the best-practices section.** "The D42 incident" beats "scoring best practice." "`lib/scoring.ts` vs `lib/scoreDisplay.ts`" beats "use the right boundary." Specificity is the value.
- **Always pair findings → fixes by phase number** in section 5 where relevant. That's the link that makes the summary useful without opening files.
- **Don't celebrate.** No "Great audit!" / emojis / exclamation. The user wants facts, not enthusiasm.
- **If the audit is clean** (few findings, mostly low-severity), shrink the sections rather than padding. Never manufacture wins.
- **If a section is genuinely empty**, say so plainly: "No structural wins from this plan — only convention cleanup."

## Reference files

Load these only when you need them. They're verbose by design — they exist so the SKILL.md stays short.

- `references/coverage-axes.md` — Full 13-axis checklist with what to look for under each axis. Load this before drafting findings, the first time per session.
- `references/audit-template.md` — Template for `00-overview.md`. Load when writing the doc.
- `references/phase-template.md` — Template for each phase doc. Load when writing phase docs.
- `references/status-template.md` — Template for `_status.md`. Load when initializing the status file.

If a future audit's domain isn't covered by an existing rule/doc, that's a signal to suggest creating one as a Low-severity recommendation — but only if the gap is real and recurring.
