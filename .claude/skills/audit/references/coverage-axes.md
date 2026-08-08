# Coverage Axes

The 13 axes every audit must consider. Use this as a "did I look here?" pass before drafting findings — not every axis will produce findings for every audit, and that's fine.

For each axis, the entries below describe **what to look for** (the bad patterns) and **the source of truth** (where the finding's citation will come from). Cite the source of truth on every finding.

---

## 1. Next.js 16 / TypeScript correctness

**What to look for:**
- `'use client'` higher in the tree than necessary (should be at the leaf — event handler, browser API, hook, or the player's canvas/video imperative control).
- Data fetching in `useEffect` that belongs server-side.
- A server-only module (`lib/scoring.ts`, `db/*` — anything touching Postgres or `node:fs`) imported, directly or transitively, from a `"use client"` file. The documented split is `lib/scoreDisplay.ts` (client-safe types + `scoreColor`/`scoreBand`) vs `lib/scoring.ts` (server, reads `coach_report.json` off disk) — treat any new file that blurs this line as a likely Critical finding.
- Job/progress state read from anywhere other than the `jobs` Postgres table, except the documented in-process map that mirrors only the actively-running job in that process.
- Default exports on components (only allowed for `page.tsx` and `layout.tsx`).
- `any` anywhere (forbidden — use `unknown` and narrow).
- `Props` interface not named `[ComponentName]Props` or not defined above the component.
- `../../../` imports instead of the `@/*` path alias.
- File name not matching the component (PascalCase `.tsx`), or a non-component module not in kebab-case.
- Use of the `pages/` directory (forbidden — App Router only, `src/app`).

**Source of truth:** `.claude/rules/nextjs.md`, `.claude/rules/typescript.md`, root `CLAUDE.md`.

---

## 2. Frame-sync & player correctness

Root `CLAUDE.md` calls frame sync "the #1 perceived-quality feature" — overlay drift during scrubbing is the thing users notice first. This axis is specific to this project in a way generic Next.js perf checklists aren't.

**What to look for:**
- Anything that assumes VFR (variable frame rate) instead of the CFR-60fps normalization contract (`ffmpeg -vsync cfr -r 60` / `-fps_mode cfr`), or computes `frame` from `currentTime` without `round(currentTime * fps)`.
- A seek that doesn't use the `(frame + 0.5) / fps` offset to dodge boundary rounding.
- Playback logic that doesn't prefer `requestVideoFrameCallback` with a rAF fallback.
- A change to the canvas draw order — must stay `video → skeleton → club → trace → annotations`.
- A change to `lib/usePlayer.ts` that isn't treated as touching the frame-sync contract root `CLAUDE.md` calls "nothing here is negotiable."
- A change to `playback_window` that doesn't preserve the `address − 1s … finish + 1s` pin (`docs/DECISIONS.md` D51), or doesn't publish `playback_pad` for clips too short to fill it.
- Standard web-vitals concerns where they do apply: large client-side imports that should be `dynamic()`, images without dimensions, anything that would blow LCP/CLS budgets on the swing list or player pages.

**Source of truth:** root `CLAUDE.md` ("Frame sync is the #1 perceived-quality feature," "Verification strategy — why the harness is shaped this way"), `apps/web/src/lib/usePlayer.ts`, `docs/DECISIONS.md` D43, D46, D51.

---

## 3. Python CV pipeline correctness

**What to look for:**
- A change that reorders `normalize → frames → pose → pose-post → club → events → metrics → ai-review → coach`, or specifically reorders Phases 2→5 (club tracking needs pose's `grip_center`; event detection needs both wrist trajectories and club-head speed) — root `CLAUDE.md` says explicitly: do not reorder.
- Stage 2b (silhouette) logic that runs before the address hold and body height it depends on exist — it's numbered where its data is produced (the Stage 2 MediaPipe pass), not where it actually runs (D48).
- `burnin.py` invoked on a committed fixture without `--club-detector runs/clubhead/weights/best.pt` — silently regenerates the weaker classical-only club trace and overwrites the better one already on disk.
- Code that treats the drawn club **trace** and the per-frame club **detection** as the same product — they fail differently (D43); a straight chord across an undetected gap is intentional, not a bug to "fix" with interpolation (that was tried and is a documented negative result).
- Trace-smoothing logic added to the pipeline (Python) instead of kept as a render-time choice (`lib/traceSmoothing.ts`, D46) — smoothing belongs in the player, not baked into stored data.
- New CV code that doesn't route through the debug pages the club-tracking spec calls non-negotiable before trusting club output (`clubdebug.py`, `checkclub.py`, `checktrace.py`) — a PR/finding that claims "club tracking improved" with no debug-page evidence is a red flag, not a pass.
- Confidence numbers compared or reported without accounting for D26 (pre-2026-08-04 confidence was clamped to 1.00 by a SimCC-peak clamp, not the model's opinion — old and new confidence figures are not comparable).

**Source of truth:** root `CLAUDE.md` ("The 9-stage pipeline," "Verification strategy"), `docs/DECISIONS.md` D26, D43, D46, D48, D49, D50.

---

## 4. `analysis.json` contract integrity

**What to look for:**
- The 49-keypoint order (native 33 → derived 7 → measured 8 → derived-tail 1) reordered, or something inserted between the derived and measured blocks — indices 0–39 must keep their meaning (D25); `waist` sits after measured, not beside its siblings, for the same reason (D47).
- Hand-written keypoint slicing instead of `skeleton.strip_derived()` — the two derived blocks are not contiguous and a hand slice gets it wrong silently.
- A scoring check or UI element built on `waist` as if it were a measurement — it's a rendering midpoint of `spine_mid`/`mid_hip` with no information the shoulders/hips don't already carry (D47); building a check on it repeats the D42 failure mode with a new signal.
- Coordinates that aren't normalized 0–1 (x right, y down), or client-side computation beyond coordinate scaling — `analysis.json` must be renderable with no more than that.
- Confidence values rounded instead of truncated before a threshold comparison, or a client that doesn't re-apply the same `MIN_CONF` gate the analyzer used (D33) — a value rounding up onto the threshold makes the client include a point the analyzer dropped.
- A metric or label using a camera-relative `left_*`/`right_*` keypoint or field where a handedness-resolved `lead_*`/`trail_*` one (per `metrics.sides`) is what the spec requires — lead = closest to the target, not "facing the camera," and it inverts for a left-handed golfer.
- A new 2D joint angle that doesn't account for projection sensitivity, or reads the elbows without `lead|trail_arm_in_plane` (D31).
- `interp: true` values not rendered dashed at reduced opacity by the client, or `interp` computed inconsistently between analyzer and player.

**Source of truth:** root `CLAUDE.md` ("The 9-stage pipeline" → `analysis.json` bullets), `docs/DECISIONS.md` D25, D26, D31, D33, D42, D47.

---

## 5. Scoring-config correctness

**This project has a documented incident that makes this axis non-optional.** v1 shipped nine rotation checks reading `*_turn_from_address`, a quantity that DECREASES as a down-the-line golfer turns — so they scored 0 on every swing and dragged `perfect` below an amateur swing. One of them scored 100/100/94.5 and looked healthy; that was luck, not correctness. **A check that scores well is not evidence the check works.**

**What to look for:**
- A threshold, band cutoff, or weight written as a literal in `.py`/`.ts` instead of read from `scoring_config/<version>.json`.
- A new or changed check with no evidence its raw value was printed at the checkpoint, across every fixture, and confirmed to move in the direction the band assumes.
- A coach report or scoring change that doesn't record `scoring_model_version`, so old reports stop being reproducible against the config version that produced them.
- A check wired into `scoring.py` for a metric `scoring_config/COVERAGE.md` marks `deferred` (abstaining because the underlying metric isn't trustworthy) — being turned "on" without first resolving why it was deferred.
- `validate_scoring_config.py`'s pass being treated as proof a check is correct — it only proves the field *exists* in `metrics.py`'s output, never that it *means* what the band assumes.

**Source of truth:** root `CLAUDE.md` ("Scoring's standing trap"), `docs/DECISIONS.md` (the D42 entry), `services/analyzer/scoring_config/COVERAGE.md`.

---

## 6. Test suite integrity

**What to look for:**
- A golden-snapshot pass (`test_stages.py`) presented as proof of correctness. It proves nothing *changed* — a snapshot taken while Address was 48 frames early would have locked that in too.
- A contract-invariant test (`test_invariants.py`) treated as needing a golden file, or skipped when a new fixture is added — invariants (49 keypoints append-only, normalized coordinates, truncated confidence, strict event ordering, `playback_window` containing the swing, tempo self-consistency) should hold regardless of fixture count.
- A hand-labeled test (`test_hand_labeled.py`) claimed as passing when `tests/fixtures.json:hand_labeled` is still `null` — these currently **skip**, not pass; a skip is not a pass, and presenting it as one is the same trap as axis 5's, applied to tests.
- `--update-golden` run without documenting *why* the new numbers are more correct — golden snapshots are updated deliberately, never blindly.
- A load-bearing pure function (in either `swingsage/` or `apps/web/src/lib/`) with no test coverage, where "load-bearing" means: multiple consumers depend on its output, or it's the kind of thing that silently drifts (angle geometry, confidence gating, scoring math).
- Frozen test input (`tests/data/*.input.json.gz`) not regenerated after a genuine pose/club inference change — the suite would then be testing against stale ground truth without anyone deciding that was intentional.

**Don't flag:**
- Missing Vitest/Playwright coverage — this project doesn't have that test runner installed yet (`.claude/rules/testing.md`); recommending "add a Vitest test" here is a Low-severity/latest-leverage suggestion at most, not a violation, unless the user is already mid-setup for one.

**Source of truth:** `.claude/rules/testing.md`, root `CLAUDE.md` ("Three kinds of check, and the distinction matters").

---

## 7. Structural soundness & scalability

**What to look for:**
- Files that mix concerns (a `swingsage/` module doing I/O + geometry + scoring in one file; a component doing data-fetching + UI + business logic).
- Files way over a reasonable size (>500 lines is a yellow flag, >1000 is a red flag, but it depends).
- Circular imports.
- Tight coupling between unrelated pipeline stages (e.g. `club.py` reaching into `scoring.py` internals).
- Broken layering: e.g. a debug script (`scripts/*.py`) reimplementing logic instead of calling into `swingsage/`.
- N+1 Postgres queries, sequential `await`s that could be batched, in-memory filtering that won't scale past a handful of swings once real usage grows.
- Patterns that assume the current 2-fixture reality permanently, where doc 08 Phase 0 wants ≥10 — code that would silently misbehave once fixture count or swing volume grows (e.g., anything that assumes exactly two named fixtures rather than iterating a directory).

**Source of truth:** root `CLAUDE.md` ("Working Practices — Fixtures gate everything"), general software architecture principles (cite the principle, not just "vibes").

---

## 8. Componentization / modularization

**What to look for:**
- Hand-built panel/card markup that duplicates a shape already exported from `apps/web/src/components/ui/kiosk.tsx` (`KioskPanel`, `ScoreGauge`, `IndicatorCard`, `FindingBox`, `TipCard`, `MetricRow`, `StatTile`, `DataRow`, `QualityBar`, `NotBuilt`).
- New visual variations built as a forked component instead of a prop/variant on an existing `kiosk.tsx` shape.
- Domain logic embedded inside a UI component that belongs in `lib/` (e.g. score-banding math inlined in a view component instead of using `lib/scoreDisplay.ts`).
- A new angle or metric added to a view without a matching entry in `metrics.angle_fields` — the burn-in table and the player's table both render from that one catalogue; adding an angle anywhere else means the two silently diverge.
- Components with enough boolean props (`isOpen`, `isLoading`, `isError`...) that they're begging to be split.

**Source of truth:** `apps/web/src/components/ui/kiosk.tsx` (and its own doc comment describing what each shape is for), root `CLAUDE.md` ("`metrics.angle_fields` is the one angle catalogue").

---

## 9. Reuse vs. duplication

**This is the highest-value axis.** Always check this first.

**What to look for:**
- Two components or two `swingsage/` functions that do 80% the same thing.
- Multiple implementations of the same hook / utility / type on either side of the stack.
- A new scoring check that duplicates an existing check's math with a different threshold, instead of being a variant/config entry on the existing one.
- Identical fetch/transform logic in multiple API routes or DB helpers.
- A new component built when `kiosk.tsx` already had a shape that would have worked with a prop.

**How to find it:** `grep` `kiosk.tsx` and `scoring.py` for keywords matching the new thing's responsibility. Read the existing implementation — does it already generalize, or could it with a small change?

**Source of truth:** `apps/web/src/components/ui/kiosk.tsx`, `services/analyzer/swingsage/scoring.py`, `docs/DECISIONS.md`.

---

## 10. Logical placement

**What to look for:**
- Components in `app/` route directories (should be `components/[domain or ui]/`).
- Server-only helpers (Postgres/`node:fs`) placed where a client component could plausibly import them by mistake, instead of clearly server-scoped (`db/*`, `lib/scoring.ts`).
- Client-safe display logic mixed into a server file instead of split out the way `lib/scoreDisplay.ts` is split from `lib/scoring.ts`.
- A `swingsage/` pipeline module doing work that belongs in a `scripts/*.py` debug tool, or vice versa — debug scripts should stay thin wrappers over `swingsage/`, not reimplement it.
- Types defined inline that are reused across three or more files and would be clearer centralized.

**Cross-reference: naming.** Placement and naming are paired concerns — see axis 12.

**Source of truth:** `.claude/rules/nextjs.md`, root `CLAUDE.md` (repo layout table), `services/analyzer/swingsage/` module boundaries as they exist today.

---

## 11. Tech debt invoked by the solve

**This is the rare and mandatory axis.** Every audit must include this section even if empty.

**What to look for in your own recommendations:**
- Does a recommended refactor introduce a new abstraction the codebase doesn't have yet? That's debt unless it's clearly load-bearing.
- Does merging two checks/components into one introduce a confusing discriminated-union API? Note the cost.
- Does moving code require a new module boundary that other callers now have to know about? That has reach implications.
- Does the recommendation depend on a library upgrade or new dependency? Call out the install + maintenance cost.
- Does it create a "transitional" state where some callers use the new pattern and others don't? Plan the cleanup or accept the debt explicitly.

**Source of truth:** your own honesty. If you find no debt, say so plainly in the doc.

---

## 12. Conventions, naming & `docs/DECISIONS.md` discipline

**Mechanical conventions:**
- `any` anywhere in TypeScript (forbidden — use `unknown` and narrow).
- Default exports outside `page.tsx`/`layout.tsx`.
- File name not matching component name; `.tsx` component files not PascalCase; non-component `.ts` modules not kebab-case.
- `Props` interface not named `[ComponentName]Props` or not defined above the component.
- `../../../` imports instead of `@/*`.
- `tailwind.config.{js,ts}` exists (EMERGENCY — v4 is CSS-first).
- v3 directives like `@tailwind base;` instead of `@import "tailwindcss"`.
- Color tokens not prefixed with `--color-*`, spacing not `--spacing-*`, fonts not `--font-*`. Hardcoded hex colors instead of theme tokens.
- Border colors not set explicitly (v4 default is `currentColor`).

**Naming consistency & clarity.** Bad names compound as the codebase grows — a future developer (human or AI) wastes minutes per file figuring out what each thing does. Check both mechanical consistency and semantic clarity:
- **Sibling naming pattern.** Glance at the other files in the same folder/module. A pattern break (verb-first where siblings are noun-first, etc.) is worth flagging.
- **File casing.** PascalCase for `.tsx` component files, kebab-case for non-component TS modules; Python follows `swingsage/`'s existing snake_case module/function conventions.
- **Name accurately describes the thing.** A component or check whose name doesn't match what it actually renders/measures is a smell — e.g. a `hip_sway` metric that's actually measuring shoulder tilt.
- **No vestigial qualifiers.** `NewScoreGauge.tsx`, `ScoreGaugeV2.tsx` — the qualifier outlives the "new"-ness. Rename and delete the old, or flag why both need to exist.
- **No abbreviation tax.** Expand unclear abbreviations; the cost of a longer name is paid once at writing, the cost of an unclear one is paid every time someone reads it.

**`docs/DECISIONS.md` discipline (this project-specific — treat it as seriously as the mechanical items):**
- A spec deviation, interim shortcut, or threshold/contract change made with no corresponding entry.
- An entry, if one exists, missing a `Status:` line, or a finding elsewhere in the audit citing an entry without checking its `Status:` (roughly a quarter of entries are `SUPERSEDED`/`NEGATIVE RESULT`/`HISTORICAL` — citing one as current guidance is itself a finding-worthy mistake).
- A new entry that renumbers or edits a prior one instead of appending — the log is append-only; 18 entries are cited by number from source comments, so renumbering breaks those silently.

**Source of truth:** `.claude/rules/typescript.md`, `.claude/rules/tailwind-v4.md`, root `CLAUDE.md`, `docs/DECISIONS.md` (its own "How to read DECISIONS.md" section).

---

## 13. Latest Next.js / React leverage & additional suggestions

**Leverage opportunities (not violations — apply with restraint):**
- Manual `useEffect` data fetching that could be a Server Component or Server Action.
- Tab/view switching (`OverviewView` / `CoachView` / `AdvancedView`) that could use the React View Transitions API instead of manual state-driven transitions.
- `unstable_cache` usage that could become `'use cache'` under Next.js 16 Cache Components — this project has no recorded decision either way; flag the opportunity, don't push a migration.
- Edge runtime used where it isn't needed.

**Skip entirely:** AI-SDK/provider-routing findings, BotID, or anything assuming an AI provider is wired up — the AI-provider spec's `AIProvider` abstraction isn't built yet (scoring's coach narrative is deterministic today, not AI-generated). There is nothing to route or gateway yet; recommending one is inventing infrastructure that doesn't exist.

**Additional architectural suggestions (catch-all).** Use sparingly. Examples of what belongs here:
- "This `swingsage/` module is growing fast — consider splitting `metrics.py`'s angle geometry out from its scoring-facing accessors."
- "Three different debug scripts duplicate the same frame-loading boilerplate; consider a shared helper."
- "There's no typed contract for what a view component expects from `coach_report.json` beyond `Scorecard`; would benefit from tightening."

**Source of truth:** your judgment, but always include "why this matters" — if it's just "I'd prefer it this way," cut it.

---

## Severity calibration cheatsheet

When in doubt:

- It violates a hard rule in root `CLAUDE.md` → **Critical**.
- It breaks the `analysis.json` contract, hardcodes a scoring threshold, or repeats the D42 failure mode → **Critical**.
- It violates an `ACTIVE` `docs/DECISIONS.md` entry or duplicates a `kiosk.tsx` shape → **High**.
- It misses a Next.js 16 leverage opportunity but the current code works → **Medium** (or Low if obscure).
- It's a documentation/naming/location nit → **Low**.

When in doubt about effort:

- One file, mechanical change → **Quick**.
- Multiple files, but well-bounded → **Moderate**.
- Touches >5 files, requires migrating callers or re-running the analyzer over fixtures → **Large**.

---

## Anti-patterns: things that are not findings

Don't include:

- "Could use a different Tailwind utility" (lint-level, not architectural).
- "Variable name could be clearer" (unless the unclear name is in a public API/contract).
- "Could add a comment here" (unless the function has genuinely non-obvious behavior — root `CLAUDE.md` is explicit that trivial comments and documenting framework behavior aren't wanted).
- "I'd organize this slightly differently" (without a concrete `why`).
- Recommending a state-management library, ORM, or test framework this project deliberately hasn't adopted, with no evidence the user is already moving that direction.
- Anything you'd hesitate to defend if challenged. Trust your hesitation.
