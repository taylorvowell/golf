# 03 - The Swing, Explained

**Phase:** Core Golfer Experience
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

Steps 01 and 02 built a player that is frame-exact and draws the swing on the glass. Neither of
them tells the golfer **what was wrong with it**. This step closes that: the findings, the
per-check evidence behind the score, the checkpoint scores, and — the part only this track can
build — **tapping a finding seeks the player to the frame it is about**.

That last one is not a nicety. `CLAUDE.md`'s product constraint is *"a score alone is a product
failure — what was detected, why it matters, how important it is, what to work on first"*, and
the honest completion of that sentence on a video player is **"…and here is the frame where you
can see it."** A finding that names `top` and cannot take you to the top is a paragraph, not an
analysis.

**This step is mostly filling a gap that already has a shape.** `AnalysisPanel.tsx` and
`useReport.ts` were built in step 02's slipstream and already render the headline: overall, band,
coverage, the primary fix, the drill, priorities 2–5 and the seven categories with meters. Three
whole blocks of `CoachReport` are fetched and then **never rendered anywhere in the product** —
not on mobile and not on web:

| Block | Status today |
|---|---|
| `findings[]` — `{tone, icon, title, detail}` | Rendered **nowhere**. No web reference exists to port. |
| `checkpoints{}` — `{p, label, score, n_measurable}` | Rendered nowhere. |
| `categories[].checks[]` — the per-check evidence | Web-only (`CriteriaBreakdown.tsx`, 91 lines); no mobile equivalent |

## Dependencies

- **Step 01** — the frame-exact surface and transport. `player.actions.seekTo` is the seam this
  step's tap-to-frame hangs on. **Met.**
- **Step 02** — `useReport`, `AnalysisPanel`, and the `DeckSheet` panel architecture in
  `SwingPlayer.tsx` (`Panel = "overlays" | "metrics" | "analysis" | "compare" | null`). **Met.**
- `GET /api/v1/swings/:id/report` already exists and is already exercised. **Met** — no server
  change belongs in this step.

## Architectural Context

- `PROJECT_MAIN.md` §15 (swing analysis), §15.3 (confidence and uncertainty), §16 (priority
  coaching).
- **The two "not scored" reasons mean opposite things and must never merge.** `skip_reason` on a
  check is *something about this clip* — wrong club, wrong view, confidence too low. `deferred:
  true` is *the config refusing to score a metric it does not trust yet* — our gap, not the
  golfer's. `AnalysisPanel` already keeps them apart at the coverage line; the per-check rows must
  keep them apart with the same words, or the panel contradicts its own headline.
- **Nothing in this step is AI.** Every word comes from the versioned `scoring_config` through
  `coach_report.json`. This is what a golfer gets with **zero** model calls, which is exactly why
  AI can stay an enhancement and never a hard dependency.
- **The client renders the artifact; it never recomputes it.** No re-deriving a score, a band or a
  leverage number on the phone. `describeCheck` formats a value that arrived; it does not compute
  one.
- **`scoring_model_version` is already on screen and stays.** An old report must stay readable and
  self-describing.
- **Checkpoint → frame is a lookup, not a guess.** `CheckResult.checkpoint` and
  `Priority.checkpoint` carry an event name; `EVENT_ORDER` in `@swingsage/schema/contract` is the
  eight GolfDB events and `analysis.events[name].frame` is the frame. A checkpoint that does not
  resolve to an event, or an artifact with no `events`, **disables the tap** — it never falls back
  to a nearby frame or frame 0.
- **The 60 Hz hot-path rules apply even here.** `.claude/rules/react-native.md`: the panel content
  is hoisted into a `useMemo`'d element inside a parent that re-renders every frame, which is why
  `analysisContent` already exists in `SwingPlayer.tsx`. Adding a seek callback to it must not
  churn that memo per frame — the callback comes from `actions`, which is ref-backed and stable.

### What ports, and what is new

| Portable | Note |
|---|---|
| `apps/web/src/lib/scoreDisplay.ts` | 58 lines, pure, zero I/O. `describeCheck`, `CATEGORY_LABELS`, `CATEGORY_ORDER`, `scoreBand`. Its `scoreColor` is a **web** ramp — mobile uses Deck tokens, so take the first four and leave that one. |
| `CriteriaBreakdown.tsx`'s *structure* | Category → checks, `n_measurable/n_total · n_deferred not scored yet`, `describeCheck` on the value. The kiosk primitives themselves are web. |

| New | Why |
|---|---|
| The findings list | Nothing renders `findings[]` anywhere in the product today. |
| Checkpoint scores | Same. |
| Tap-to-frame | The web player has no equivalent — its scorecard and its stage are different screens. |

## Files & Areas Touched

- `apps/mobile/src/features/player/scoreDisplay.ts` — new: the ported pure helpers + their test
- `apps/mobile/src/features/player/checkpointFrames.ts` — new: checkpoint name → frame, and the
  "no honest answer" case
- `apps/mobile/src/features/player/AnalysisPanel.tsx` — gains findings, checkpoints, per-check
  disclosure and the seek callback
- `apps/mobile/src/features/player/SwingPlayer.tsx` — passes `onSeekToFrame` into the memoized
  panel content; closes the panel on a seek
- `packages/schema` — **untouched.** If a shape seems missing it is on the artifact, not the
  contract.

## Steps

1. **Port the display helpers.** `scoreDisplay.ts` → `features/player/scoreDisplay.ts`, dropping
   `scoreColor` (web ramp; Deck owns colour here). Bring a test that pins `describeCheck`'s output
   for a band check, a categorical check, a `deg`→`°` unit and a null value.
2. **Checkpoint → frame.** `checkpointFrameFor(analysis, checkpoint)` returns `number | null`.
   Null when: `checkpoint` is null, it is not in `EVENT_ORDER`, `analysis.events` is absent, or the
   event carries no numeric frame. **Null must be indistinguishable from "no tap offered"** in the
   UI — never a disabled-looking control that does nothing.
3. **Findings.** Render `findings[]` with its `tone` split — positive findings read as confirmation
   and negative ones as work, and they are visually distinct. `icon` is a string from the config;
   treat an unrecognised one as no icon rather than a broken glyph.
4. **Checkpoint scores.** `checkpoints{}` as a compact row of the eight events with their scores
   and `n_measurable`. A checkpoint with nothing measurable renders as abstained, not as zero.
5. **Per-check disclosure.** Each category row in `AnalysisPanel` expands to its `checks[]`:
   `label`, `describeCheck(check)` for the measured value against its target, `advice` when the
   check carries one, and the **two distinct** unscored states. Collapsed by default — the panel
   opens as a summary, not a spreadsheet.
6. **Tap to the frame.** A finding, a priority and a check that resolve to a frame become
   tappable: seek the player there and close the panel so the picture is what you land on. Give
   every one of them a real accessibility label naming the destination ("Impact, frame 143"), per
   the standing rule that every interactive control carries role, label and state.
7. **Wire it in `SwingPlayer`.** `onSeekToFrame` into `analysisContent`'s memo — verify the memo's
   dependency list does not now include anything that changes per frame.

## Quality Standards

- No score, band or leverage is ever recomputed on the phone.
- "Not measured on this clip" and "not scored yet in this config" never collapse into one string.
- A checkpoint that does not resolve to a frame offers no tap at all.
- Every tappable row has role, label and state; 48 pt targets via `hitSlop` where the drawn row is
  smaller.
- No hand-mixed rgba beside a Deck token that nearly matches.
- The panel's memo boundary still takes primitives and stable callbacks — no per-frame churn.

## Verification

```
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile test
```

Plus, on the S25+:

1. Open a scored swing → **ANALYSIS**. Findings, checkpoint scores and the category rows are all
   present, and the headline still reads as it did.
2. Expand a category. Every check shows either a value against its target, or one of the two
   distinct unscored reasons — never a bare zero.
3. Tap a finding that names a checkpoint. The panel closes and the picture is on that frame;
   confirm against the frame counter.
4. Open a swing with no `coach_report.json`. The panel says so and the video still plays.

## Definition of Done

- [ ] `findings[]`, `checkpoints{}` and `categories[].checks[]` all render.
- [ ] The two unscored reasons stay distinct everywhere they appear.
- [ ] Tapping a finding/priority/check with a resolvable checkpoint seeks the player to that frame.
- [ ] An unresolvable checkpoint offers no tap.
- [ ] `scoreDisplay` helpers are ported with tests; nothing is recomputed on the client.
- [ ] Oracles pass.

## Notes

Dual-view is step 04. The silhouette, isolation scrim and butt line remain deferred from step 02
and still need a home before launch.

**Carried in from step 02, unmeasured:** overlay drift with the club-head trace on versus off was
declined (D51), so the Skia question is open. If this step's panels ever make the picture stutter,
that unmeasured number is the first suspect — RUNBOOK §12b.

---

### Appended during execution — two things this file got wrong before the data was read

The `Steps` above are unchanged. Both of these were caught by printing the real artifacts rather
than by a failing test, which is the point.

**1. The checkpoint key is a P-code, not a GolfDB event name.** Architectural Context above says
`EVENT_ORDER` and `analysis.events`. That is **wrong**. `CheckResult.checkpoint` and
`Priority.checkpoint` carry `"P1"`…`"P10"`, and the resolvable source is `analysis.checkpoints`
(an array of `{p, label, frame, …}`). The two are indistinguishable in the type — both
`string | null` — and the events route would have compiled, looked right, and silently failed on
**P6 and P9**, the two positions the eight events do not cover. Verified across all ten fixtures:
every one carries all ten P-codes with a frame, and **all 33–34 checkpoint references per report
resolve, with zero unresolved**. `checkpointFrames.test.ts` pins P6/P9 specifically.

**2. `Finding.detail` is a category slug, not prose.** It carries `"downswing_plane"`, so rendering
it raw would put an identifier in front of a golfer. It goes through `categoryLabel()`. Confirmed
across all ten fixtures: every `detail` is one of the seven known category slugs, and every report
carries exactly 8 findings.

**And one real bug the fixtures caught:** the config's positive-tone icon is **`✓`**, not `↑`. The
icon allow-list was built on that guess, which blanked the mark on every positive finding — nothing
threw, the row just quietly lost its glyph. The distinct icons across all ten fixtures are `↓` and
`✓`, and the test now pins both.
