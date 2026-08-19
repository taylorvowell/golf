# coach-surface — Progress

## 2026-08-19 — Track created

Created at Taylor's direction (same session): rethink the Coach page as the **AI coach**
surface, rename the human role to **Instructor**, build the guided **stance analysis** as the
first AI coaching act, and bring Progress to `.claude/SAMPLE-progress-page.html` exactly.
UI-first with stubs — no wiring — mirroring session-mode's step 01–03 shape; step 05 is
Taylor's explicit sign-off gate before any wiring.

Grounding gathered before the design was written:
- "Ordered by impact" already has a shipped engine — the disclosed Leverage Score
  (`scoring.py::_leverage`, severity+impact+ease over `criteria.md`'s causal weights) and
  per-check `leverage_breakdown` in every coach report. The UI stubs name that model.
- The Coach-surface IA memo (`.claude/architecture/coach-and-focus-2026-08-14.md`) and
  PROJECT_MAIN §16 remain the spec for what the page becomes when the engines land.
- No stance-analysis feature was previously spec'd anywhere; DESIGN §3 (Taylor's sequence,
  2026-08-19) is the founding spec.

## 2026-08-19 — Steps 01–04 built (same session as track creation)

All four UI steps landed as stubs, typecheck + full mobile suite green (371 passed).

- **01 Coach page** — `CoachScreen` rebuilt on the hero+sheet scaffold: persona hero, Top tip
  (+ top drill line + "See it on your swing" to the newest scored swing — the one real door),
  stance-analysis card, four leverage-ranked focus areas (`features/coach/coachStubs.ts`, all
  `placeholder: true`; the featured area renders its overlay on a `StanceStage` banner — the
  screen-grab slot's stand-in), four matched drills. Tab label stays "Coach" — it now means
  the AI.
- **02 Instructor presence** — `features/instructor/useInstructor.ts` (persisted debug flag,
  `useStarred` shape) replaces `useConnectedCoach`; `InstructorDebug` registers the DebugOverlay
  toggle app-wide; `InstructorBubble` (56px face disc + aqua dot) floats over the Coach tab;
  `Instructor` + `InstructorChat` placeholder routes; ProfileScreen renamed and made
  one-state-at-a-time (connected card XOR directory door, both routing to the new pages).
  Terminology + PROJECT_MAIN note + decisions entries recorded.
- **03 Stance analysis** — `stanceScript.ts` (7 standardized beats, DTL→face-on, narration
  stubs with the hang-loose `alt`), `design/system/StanceStage.tsx` (pose art + animated
  draw-on annotations, figure-space coordinates), `StanceAnalysisScreen` (auto-advance,
  play/pause/skip, beat dots, pinned dark), home highlight card w/ persisted dismissal
  (`useStanceIntro`; walking the analysis marks it seen).
- **04 Progress to the pinned sample** — placeholder seam now carries the sample's exact
  content (titles, copy, 68→79/64→74/71→82 bars, +9/+6/+11 deltas, coach note, hero
  description, confidence chip). Three tests re-pinned to the amended contract with dated
  comments; real aggregates still never fabricate (low-data/empty behaviour unchanged).

Named shortfalls, deliberate: stance-stage annotation anchors are eyeballed against the pose
art (tuned at step 05, computed from keypoints when wired); the voice track is narration text
(D57 seam); Coach content is canned at one swap point pending priority-engine/drill-library.

Step 05 (Taylor's sign-off walk) is OPEN — row added to docs/HANDOFF.md.

## 2026-08-19 — Step 05 iteration round 1 (Taylor)

Two corrections, both applied; typecheck + 371 tests green.

- **Home highlight is dismiss-button-only.** Walking the analysis no longer hides the card —
  only its X does (`useStanceIntro` reworked around a `dismissed` flag;
  `dismissStanceIntro`/`resetStanceIntro`). The card is the standing door back in.
- **The walkthrough runs on the golfer's ACTUAL photo, personalized.** The newest scored
  swing's `frame?checkpoint=P1` grab sits under the ink for every beat the artifact's view
  covers — the image never changes, only the overlays. Anchors come from the swing's own
  artifact (`features/coach/stanceAnchors.ts`): name-resolved keypoints (waist = belt-buckle
  dot, shoulder/wrist mids, knees, nose) and the detected shaft (head/butt), all behind the
  inclusive `conf >= MIN_CONF` gate; a beat whose anchors abstain falls back to the scripted
  pose art, as do face-on beats until a face-on artifact exists. `StanceStage` gained the
  photo background + stage-space mapping (stage cut to the frame's aspect via `fitBox`, so
  normalized artifact coordinates map linearly).
- Debug (per the new forceable-states rule): DEBUG → Coach — "Reset stance intro" action and
  a "Stance: pose art" toggle to force the fallback.

## 2026-08-19 — Step 05 iteration round 2 (Taylor)

- **Every coach statement now shows its form thumbnail.** New design-system form-art library
  (`design/system/formArt.ts`): the five mockup stick figures + `formFigureFor(hint)`, a
  keyword/check-id mapping from the coach's own vocabulary ("SET-01 Spine forward bend at
  address" → the posture figure) so the same topic is the same picture on every surface.
  Applied to the home focus hero (title + cue now sit beside the topic's thumb inside the
  performance card), the home focus rail cards, the Coach page's top tip, and each drill row.
  Progress's viewModel now imports the shared figures instead of owning copies.
- **Circling marker motion.** Stance-stage circles now draw as a telestrator-style ring — 1¼
  turns with a hand wobble, pen-on via dash offset — and the shaft-line beat circles the
  belt-buckle meeting point AFTER its lines land (script + personalized paths both).

Typecheck + 371 tests green.

## 2026-08-19 — Step 05 iteration rounds 3–5 (Taylor, live on the photo path)

- **Verdicts got honest and got a voice.** Correct readings pop a springy check badge (disc +
  checkmark, overshoot pop, holds ~1.3s, fades); NEGATIVE readings turn the highlight ink red
  (`tone: "bad"`) and pop nothing. The shaft-line beat is now a REAL geometric check: the
  dotted line extends the club's OWN direction past the butt to the body's front-edge plane,
  the landing point is ringed, and it is judged against the belt buckle with a tight
  tolerance (0.2 × torso length, `BELT_TOLERANCE`) — the previous draw-to-the-buckle version
  could not fail, and Taylor caught it passing a miss. A fail swaps the narration to the
  hang-loose adjust line (`PersonalizedBeat.verdict` → screen).
- **Optimal references.** Semi-translucent white ghost lines fade in as comparisons: the
  spine beat draws the SET-01 band midpoint (40° from vertical, aspect-true, hinged at the
  golfer's own hips); the arm beat draws plumb vertical from their shoulder.
- **Belt buckle** moved to the body's FRONT edge at belt height — lower and ball-side of the
  waist centre (keypoint approximation, silhouette-based when wired).
- **The frame is the stationary one**: `address_span`'s end (the last quasi-static frame
  before any backswing), fetched as an exact `frame?f=` grab — P1's event frame was showing
  motion.
- **Open/loading choreography**: opening shows "Loading analysis…" with NO golfer outline;
  once the artifact + frame resolve the content fades in, holds 2s on the bare photo, then
  the first beat draws. Marker circles draw with a circling telestrator motion (1¼ wobbled
  turns), and the stagger slowed to 900ms per mark with the beat clock sized to true draw
  time — voiceover pacing.
- Every coach-voiced surface (home hero + rail, Coach tip + drills) now carries a form
  thumbnail from the shared `formArt.ts` topic mapping.

Typecheck + 371 tests green after each round.

## 2026-08-19 — Step 05 iteration round 6 (Taylor)

- The spine beat's OPTIMAL ghost now wears its degrees ("40°" at the line's end, faded-in
  reference styling); the golfer's own line deliberately never carries a number — the 40° is
  the config band's midpoint, not a measurement of them. Narration says it too.
- The content below the image (narration, dots, transport) now appears the moment "Loading
  analysis…" ends, inside the fade-in — only the annotations hold the 2s photo pause.

Typecheck + 371 tests green.

## 2026-08-19 — Step 05 iteration round 7 (Taylor)

- The walk only shows what was actually filmed: without a front-view artifact the face-on
  beats drop out entirely (no pose-art stand-ins), and the wrap beat — riding the last real
  view so it ends on the golfer's own photo — closes with the upload invitation
  (`WRAP_NO_FRONT_NARRATION`: "Upload a front-view swing and your coach will walk the front
  positions too…"). The full seven-beat script now only plays in the no-artifact / forced-art
  preview, where everything is openly a stand-in.

Typecheck + 371 tests green.

## 2026-08-19 — Step 06 built + step 05 rounds 8–9 (Taylor)

**Step 06 — Deep swing analysis (new, built this session).** The real swing video on the real
frame-exact transport (`useFramePlayer` + `FrameClockView`, D40 seek rule intact), playing at
0.4× with the COACH driving: auto-pause landing exactly on each of five artifact checkpoints
(P2 shaft-parallel with a parallel-to-ground ghost off the golfer's own grip, P4 top with the
hands-to-bicep depth line, P5 transition separation, P7 impact shaft + ball, P10 finish),
personalized ink from `anchorsAt` at each paused frame, then rolling on. The golfer controls
the ANALYSIS, never the video: analysis pause/resume, back-a-moment (replays the approach),
and a moment bar that scrubs the coaching timeline. `StanceStage` gained `overlayOnly` (bare
ink over the live player). Second guided-session card on Coach, above the stance card. Program
resolves against the artifact's own checkpoints — missing checkpoint, dropped moment. No
verdicts here yet (no real geometric checks; noted in the step file).

**Step 05 rounds (stance walkthrough):**
- Round 8 — the reveal is gated on the photo's actual PAINT (expo-image `onLoad`), with the
  content mounted hidden under the loading overlay so the bytes download meanwhile; image and
  info slide in together (the 3-second stagger Taylor kept seeing was the frame route's
  server-side render time racing a source-resolved reveal).
- Round 9 — fail-path choreography on the belt-buckle beat: the red ring around the bad
  landing is TRANSIENT (draws, holds ~300ms, fades before the next mark), the correction is
  an obvious full-strength dotted green line from the butt of the club to the buckle, drawn
  last and on top, and corrected items are never circled.

Typecheck + 371 tests green.

## 2026-08-19 — Step 05 round 10 (Taylor)

- Belt-buckle miss now finishes with the corrected CLUB drawn: after the dotted
  butt-to-buckle line, a solid green shaft path pens from the buckle back down to the club
  head (the old path's start) — where the club should lean, on the golfer's own frame.

## 2026-08-19 — Step 05 rounds 11–12 (Taylor)

- Round 11 — the deep-swing-analysis highlight card joined the HOMEPAGE pair (deep on top of
  posture; `useDeepIntro`, same X-only dismissal; DEBUG action now resets both cards).
- Round 12 — the CLUB HEAD is the shaft's anchor point at address: the head end snaps to the
  ball detection when the club solve disagrees with it by >5% of the frame (at address the
  head IS at the ball, and the ball is the pipeline's strongest anchor), and when the solve
  abstained entirely the club line is synthesized ball→grip (wrist mid) so the beat still
  personalizes, anchored on the head. Address-only rule (`anchorsAt(..., atAddress)`).

## 2026-08-19 — Step 06 iteration (Taylor)

- Playback between pauses is now REAL TIME (1×) — fast the way a swing looks; the pauses are
  where the coaching happens.
- New computed moment: **hands crossing the bicep line** — scanned frame-by-frame between P2
  and P4 on the golfer's own pose track for the first frame the wrist mid rises past the
  trail upper arm's mid-height. Carries the deep analysis's first REAL check: horizontal
  offset of the hands from the bicep line, tolerance 0.6 × upper-arm length
  (`HANDS_BICEP_TOLERANCE`) — pass pops the check, a miss turns the ink red and the
  narration flags hands extending too far backward. Moments now support `resolveFrame`
  (computed frames beyond the P-system) and verdict-bearing marks.

## 2026-08-19 — Step 05/06 loading-screen styling (Taylor)

- New `CoachLoader` (design system): the coach glyph centred in a soft tile with a looping
  shine sweep, orbited by a spinning 300° gradient arc (aqua head fading through cobalt to
  nothing — the swing-path comet), over a faint full track. Native-driver loops, linear spin.
- New `GlowBackdrop` (design system): the hero cards' corner glows detached — subtle aqua
  top-right + cobalt bottom-left radial washes — behind both analysis loading screens.
- Both replace the bare ActivityIndicator on the stance and deep analysis loaders.

## 2026-08-19 — Step 06 iterations continued (Taylor)

- **Loading styling**: `CoachLoader` (coach glyph + shine sweep + spinning swing-path
  gradient arc) and `GlowBackdrop` (the hero corner glows, subtle) on both analysis loaders.
- **Subject control**: one `useSubjectSwing()` store drives the golfer used by BOTH analyses
  (default: the after-swing compare's reference golfer, else own newest scored); DEBUG →
  "Coach subject" cycles every ready swing / resets to default. Not persisted by design.
- **Mid-downswing separation moment** (P6, shaft parallel down): draws the shoulder line and
  hip line (stretched 1.6× for visibility) and carries a real RATE check — mean angular
  speed of each line over ±5 frames in pixel space, unwrapped across ±π; hips must be at
  least as fast as shoulders (`SEPARATION_RATIO`). Pass: green hips + check pop; fail: red
  hip line + "shoulders keeping pace" narration; too few conf-gated samples: observe only.
- **Finish trail-foot check** (inside the P10 moment) — annotated ONLY when wrong: heel rise
  over foot length must reach `FINISH_FOOT_LIFT` (≈24°) or the trail heel is planted — red
  circle on the foot, dashed heel-up guide, and the flat-footed narration. Correct feet get
  no ink at all.
- **P6 rods**: the hip/shoulder comparison now draws the overlay's orientation-rod treatment
  — bars extended half a span past each joint with ball caps and a dark underlay (a coloured
  bar vanishes into a matching shirt), re-inked in verdict tones (`kind: "rod"` in
  StanceStage; length scales with the pair's span, the foreshortening read).

## 2026-08-19 — Steps 05/06, plane finale + two new checks (Taylor)

- **Plane-of-travel finale (deep analysis)** — "very important": after the last moment the
  swing ping-pongs FAST between takeaway and impact (seek-driven on the scrub fast-path, 6
  frames per 40ms tick — media3 can't play backward, but it can land 25 seeks a second)
  while two straight plane lines hold over it, both anchored at the BALL: one through the
  club head halfway up (P1→P4 frame-midpoint), one through the head halfway down (P4→P7),
  each the nearest real club detection within 8 frames. Downswing at-or-below the backswing
  line (±3°, `PLANE_TOLERANCE_RAD`) → green + check; above → red dashed + the over-the-top
  narration. No heads at the midpoints → the phase skips (only show what we have). Rests at
  impact, then done.
- **Stance: knee-bend beat** right after the back angle — straight-leg ghost wearing the
  optimal ("20°"), the golfer's thigh+shin drawn over it, real flex check (interior knee
  angle on the camera-near leg, pass window 10–35°, `KNEE_FLEX_MIN/MAX_DEG`); fail = red leg
  + soften/no-squat narration. The back-angle beat gave up its old knee tick-mark.
- **Deep P4: lead-arm-straight check** — the lead elbow's interior angle; bend past 25°
  (`ARM_BEND_MAX_DEG`) draws the lead arm red with the elbow circled and the
  radius-of-the-swing narration; straight arm draws green with the check pop.

## 2026-08-19 — Plane finale refinements (Taylor, rounds continued)

- **Two-stage finale**: the ping-pong loop runs CLEAN for ~4s (no ink — lines over a fast
  loop distract), then the video pauses at the top and the plane lines draw over the still
  frame, finishing with a BIG circling ring around the tops of both lines — the drop into
  the shallower delivery.
- **Order fixed**: the plane interlude now plays BETWEEN impact and the finish moment (it
  was landing after the finish, and its copy back-to-back with the done copy read as the
  info showing twice). After the hold it seeks back to impact and rolls on to the finish;
  replay resets the interlude.
- **Averaged plane math**: each plane is now the MEAN ball→club-head elevation across every
  below-shoulder head detection in its phase (P1→P4 up, P4→P7 down) — frames with the head
  above the shoulders are excluded from BOTH averages, per Taylor (up there the angle
  describes the wrap around the body, not the plane). Needs ≥3 samples per phase or the
  finale skips. Lines draw from the ball at the averaged angles; the pass check pops beside
  the drop ring.
- **Plane math re-fixed** after the averaged version read "very very wrong": the polluted
  average was sweeping in near-ball frames whose ball→head angle is pure detection noise.
  Now: mean over the MID-TRAVEL BAND only (head 35–80% of the way from ball height to
  shoulder height, above-shoulder still excluded), falling back to the single head nearest
  halfway (the original calculation) when the band is thin.
- **Plane lines now come from the club-head TRACE** (Taylor: "take how we calculate it but
  draw a line instead of a curve"): each phase's line is a straight PCA fit through the
  analyzer's own `club.trace.backswing` / `.downswing` points — the same curated path the
  product draws as the curve — with above-shoulder points excluded (mean mid-shoulder
  height over P1–P7 as the cut). Lines draw across their own points' extent, stretched 15%
  past each end; verdict compares the fitted elevations (±3° tolerance); needs ≥4
  below-shoulder points per phase or the finale skips. Replaces both ball-anchored
  estimates.
- **Finish rotation check**: the hip and shoulder EXTENSION RODS return at P10 — both must
  read at least FLAT toward the target (≤18° from horizontal, `FINISH_ROT_FLAT_DEG`;
  more-rotated passes too). An under-rotated rod draws red with the keep-turning narration.
  The finish now carries two checks (rotation + trail foot), so moments gained a `say`
  narration override that names the fault(s) that actually failed — both, one, or the clean
  pass line. The old spine "post" line gave way to the rods.
- **Plane construction, Taylor's spec**: line from the BALL to the club head AT WAIST HEIGHT
  per phase — waist level from the address waist keypoint; when no detection lands exactly on
  it, the two straddling frames are split down the middle (nearest-head fallback within 12%
  of frame height when detections are sparse). Replaces the trace PCA fit.
- **Plane in the navigation**: the swing-plane step is now a block in the moment bar (slotted
  after impact) and the transport gained a NEXT control — prev/next skip through moments AND
  the plane step, the same skip-between shape as the posture walkthrough. Jumping to the
  plane lands on the held lines directly.
- **FOUND the doubled title/description**: an earlier patch's anchor (`phase === "done" ? (`)
  matched twice and injected the plane talk block INTO THE TRANSPORT ROW as a second copy —
  during the plane step the pause control was also hijacked. Transport ternary restored;
  single talk block remains. Renamed the step "Swing plane" ("Swing plane — over the top" on
  fail).
- **Plane sampling moved to the TRACE**: the waist-crossing now walks the analyzer's curated
  trace points (`club.trace.backswing/.downswing` — the very path the player draws) in path
  order instead of raw per-frame head detections, whose stray heads kept throwing the line.
  Taylor's ball→waist construction unchanged on top.
