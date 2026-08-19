# Step 06 — Deep swing analysis UI

## Goal

The "deep swing analysis" (Taylor, 2026-08-19): the golfer's real swing video plays in slow
motion and the COACH drives it — auto-pausing at the artifact's checkpoints (shaft parallel
back, the top, the transition split-second, impact, finish), annotating the paused frame from
the golfer's own keypoints/club, then rolling on. The golfer never controls the video; they
control the ANALYSIS — pause/resume it, step back a moment, and scrub across the moment bar
(which scrubs the coaching timeline, never raw video time). Entered from a second
guided-session card on the Coach page, stacked above the stance card.

## Steps

1. `features/coach/deepScript.ts` — the moment program (checkpoint, narration, personalized
   mark builders via the shared `anchorsAt`).
2. `DeepAnalysisScreen` on the real frame-exact transport (`useFramePlayer` +
   `FrameClockView`): slow-motion roll → exact-frame pause at each moment → annotate (the
   stance stage's ink in `overlayOnly` mode) → roll on; moment bar + back-a-moment +
   analysis pause; replay; loading gate with slide-in reveal; honest empty state.
3. Coach page: the deep-analysis card above the stance-analysis card.
4. Route `DeepAnalysis`, pinned dark.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green.
- Manual (step 05's walk covers it): the session rolls and pauses at the five moments on the
  S25+ with ink landing on the body; the moment bar jumps the analysis; back-a-moment
  replays. Frame-exactness of the pauses is a device reading (the emulator cannot measure).

## Notes

- Most moments are stick-figure-position + transition-timing driven, per Taylor; a per-frame
  AI read may later feed the free-observation lines — the geometry never comes from AI.
- No verdicts/check-pops here yet: none of these moments carries a real geometric check yet.
  The stance walk's shaft-line rule is the pattern when they gain one.
- "This functionality will be reduced for other things as well" — the choreography
  (play→pause→annotate over the artifact's own frames) is deliberately a reusable shape:
  script + program resolver + ink stage.
