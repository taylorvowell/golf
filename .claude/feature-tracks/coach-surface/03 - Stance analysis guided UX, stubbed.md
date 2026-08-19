# Step 03 — Stance analysis guided UX, stubbed

## Goal

The guided stance analysis experience as a scripted, staged UI: a stage showing the stance
(DTL first, face-on second), overlays drawn on → held → cleared per beat, with the AI voice
track stubbed as on-screen narration. The standardized sequence from DESIGN §3. Plus the home
page highlight card, shown until dismissed.

## Steps

1. `apps/mobile/src/features/coach/stanceScript.ts` — the standardized beat list (view, what
   to draw, narration text, timing), DTL beats 1–4 then face-on beats.
2. A design-system stage component that draws the pose art (`CAPTURE_POSES`) with animated
   annotation overlays (shaft line to belt buckle, spine/knee angle marks, arm drape lines,
   wrist circle, shoulder-lean line) — SVG stays inside `src/design/system/`.
3. `StanceAnalysisScreen` (stack route, fixed dark): stage + narration card + beat progress +
   play/pause + skip/back; auto-advance through the script; view switch between DTL and
   face-on mid-sequence.
4. Home highlight card: "Your stance analysis is ready" — dominant placement until dismissed;
   dismissal persisted (AsyncStorage, `useStarred` shape).
5. Door from the Coach page (step 01's stance card) and from the home highlight.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green.
- Manual (step 05): sequence plays through both views with draw/clear rhythm; dismiss on home
  survives an app restart.
