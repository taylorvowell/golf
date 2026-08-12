# 02 - Overlays on the Proven Clock

**Phase:** Core Golfer Experience
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

Draw the swing on top of the video: skeleton, club, trace and angles, locked to the frame that is
actually on the glass. Step 01 delivered the clock and nothing else precisely so that anything
wrong here is an **overlay** bug rather than a sync bug — that split is the whole reason the player
shipped once with a black rectangle and no stick figure.

The rendering **rules** port from the web player. The components do not. `SwingStage.tsx` is ~480
lines of `CanvasRenderingContext2D`, and mobile has already decided (D23, D36) that the overlay is
**plain rotated React Native `View`s**, not a canvas and not Skia — 49 keypoints reached 99.2%
frame-lock that way and removing React from the paint path scored no better.

## Dependencies

- **Step 01** — the frame-exact surface, transport and sync panel. **Met.**
- `platform-foundation` step 07 — `@swingsage/schema/contract` generates `Analysis`. **Met.**
- `GET /api/v1/swings/:id/analysis` already exists and is already exercised by
  `apps/mobile/src/platform/api.test.ts`. **Met** — no server change belongs in this step.

## Architectural Context

- `PROJECT_MAIN.md` §14 (swing overlays), §15.3 (confidence and uncertainty).
- **The client renders the artifact; it never recomputes it.** Angle labels come from
  `metrics.series[frame][field]`, never from geometry the renderer re-derives. Smoothing is
  render-time only and never touches `analysis.json`.
- **Confidence has two bars, and collapsing them is a real bug in both directions.** The stick
  figure draws anything with `conf > 0`; anything that reads as a *measurement* — angles,
  orientation rods — is held to `MIN_CONF = 0.35`. One bar either deletes the skeleton or
  fabricates measurements.
- **Keypoint order is not hard-coded on the client.** It arrives as `pose.keypoint_names` with
  every artifact and the index map is built from it. Do not write `49` or a literal index anywhere.
- **`waist` (index 48) is a rendering point.** Never build anything that reads as a measurement on
  it.
- **Confidence is truncated, not rounded** — re-apply the same `MIN_CONF` gate the analyzer used,
  or a value rounding *up* onto the threshold makes the client draw a point the analyzer dropped.
- **The trace never interpolates a gap.** A frame step `> BRIDGE_STEP` (3) ends the run and the gap
  is a straight chord. Curving it would dress a gap up as data. Endpoints are exact — approximating
  filters blend back to the true source points at both ends.
- **Handedness threads through everything.** Lead = the side nearest the target, set by handedness,
  never "the side facing the camera". There is **no left-handed fixture**, so this path cannot be
  confirmed against real footage in this step — say so rather than implying it was checked.
- **Optional blocks are the norm, not the exception.** D41's tightening found ~96 places in the web
  player that assumed a block an older artifact may not carry. `club`, `metrics`, `checkpoints`,
  `posture`, `playback_window`, `playback_pad`, `phases`, `tempo`, `face` are all nullable. A native
  client **cannot be force-updated**, so an artifact older than the build is permanent reality here
  in a way it never was on web. Optional-chain everything; `missingCapabilities(a)` already returns
  human-readable strings for what cannot be rendered.

### What ports as-is, and what has to be re-expressed

Verified against the web tree — copy the first column rather than rewriting it.

| Portable, pure logic | Note |
|---|---|
| `lib/playbackWindow.ts` | 64 lines, no imports beyond the type. Bring `playbackWindow.test.ts` with it. |
| `lib/traceSmoothing.ts` | 519 lines of array math in **video-pixel space, not canvas pixels** — which is exactly what makes it platform-independent. Bring `traceSmoothing.test.ts`. |
| `lib/skeleton.ts` | Constants only: `BONES` (28 `[a, b, side]` tuples), `SIDE_COLOR`, `TRACE_COLOR`, `HIDE_JOINT`. |
| `lib/overlays.ts` | The toggle table and `OVERLAY_GROUPS`' `needs` capability gating. The menu *renderer* is web; the table is not. |
| `angleOverlay.ts`'s `MIN_CONF`, `resolve()`, `rays()` | Geometry, not painting. `rays()` returns `{origin, u, v, uDashed, vDashed, guide}` — a clean seam to draw from. |
| `SwingStage`'s memos | `idx`, `spans`, `orientHold`, `tracePath` are pure functions of the artifact. Extract as plain functions, not hooks. `orientHold` is a **one-pass forward walk over the whole clip** with hysteresis so scrubbing backwards gives the same bar on the same frame — not a running filter fed by the playhead. |

| Must be re-expressed | Why |
|---|---|
| The whole `draw` body | `CanvasRenderingContext2D` has no RN equivalent under the plain-`View` decision. |
| Text labels and chips | `measureText` is renderer-specific; RN `Text` measures itself. |
| The crop transform | CSS percentages on web; a transform on the media view here. |

**Deliberately out of scope:** the silhouette, isolation and butt line. The silhouette scrim depends
on `Path2D` + even-odd fill to put its holes back, which plain `View`s cannot express — the
analyzer stores rings with no outer/hole distinction precisely because even-odd handles it. Naming
that as deferred is the point; it is not a gap that gets discovered later.

### The one open question this step must answer with a number

D23 measured **49 keypoints as rotated `View`s** at 99.2% frame-lock. It did **not** measure a
**club trace**, which is a polyline of a hundred-plus segments and therefore a hundred-plus more
views. If plain `View`s cannot carry the trace at 60fps, that is the moment to reconsider Skia —
**with a measurement**, because D36 rejected it on cost, not on merit. Do not pre-emptively adopt
Skia, and do not quietly ship a stuttering trace. Measure, then decide, then record.

## Files & Areas Touched

- `apps/mobile/src/features/player/overlay/` — new: the layers, one file each
- `apps/mobile/src/features/player/useAnalysis.ts` — new: fetch + cache `analysis.json`
- `apps/mobile/src/features/player/SwingPlayer.tsx` — gains the overlay above the video surface
- `apps/mobile/src/features/player/useFramePlayer.ts` — bound the transport by `playbackWindow`
- `packages/schema` — untouched. If a shape seems missing, it is on the artifact, not the contract.

## Steps

1. **Fetch the artifact.** `useAnalysis(swingId)` against `GET /api/v1/swings/:id/analysis` through
   `api.request<Analysis>()`. A 404 is "not analysed", not an error — the player must still play.
   Model the state as a discriminated union, matching `useSwings`.
2. **Bound the transport by `playbackWindow(analysis)`**, the deferral step 01 named. Seeking,
   stepping, the scrub bar and the end-of-playback wrap all clamp to `[from, to]`; the file bound
   stays only for anything that needs frames outside it. Swings with no artifact keep the file
   bound.
3. **The paint seam.** Subscribe to the presented frame and draw **in the same step it arrives**,
   before React state lands — the rule that survives from `onPresentedFrame`. Call
   `markOverlayCommitted(frame)` immediately after committing, which is what makes
   `overlayDriftFrames` in the sync panel a real number rather than a hope.
4. **Skeleton** — 28 bones as rotated views, joints as dots, `conf > 0`, `HIDE_JOINT` for hand
   landmarks (their connecting bone still draws). Per D22 mobile **omits the pinky→index knuckle
   line** and reads the hands as wrist angle; the web player keeps it, and that divergence is
   deliberate.
5. **Club** — shaft, butt disc, head ring, gated on `club` being present and `trace_enabled`.
6. **Trace** — `buildTracePath` + `cutAt` ported verbatim, `savgol` default, phase colours, gaps as
   straight chords. **Measure the frame-lock cost here** and record it.
7. **Angles** — `rays()` for geometry, label from `metrics.series`. Abstain — draw nothing — when
   the field is absent, `geom` is null, a keypoint is below `MIN_CONF`, or a ray is degenerate.
8. **Toggles** — `DEFAULT_TOGGLES` ships skeleton + trace on. Groups whose `needs` capability the
   artifact lacks are hidden, not shown disabled.
9. **Extend the sync panel** with overlay drift, so Gate 3 has a readout on the same screen the
   step is judged on.

## Quality Standards

- No overlay draws a point the analyzer dropped. Re-apply `MIN_CONF` with the same truncation.
- A missing block hides its layer; it never renders an empty one or a zero.
- No literal keypoint index and no literal `49` anywhere in the client.
- The overlay never writes to `analysis.json`, and smoothing never leaves the renderer.
- Frame-lock must not regress below step 01's measured baseline once the overlay is on.

## Verification

```
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile test
```

Plus, on the S25+ (RUNBOOK §11 for the loop):

1. The skeleton sits on the golfer at Address, Top and Impact — compare against the analyzer's own
   `overlay.mp4` for the same fixture at the same frame. **This is Gate 3**: the canvas overlay must
   match the Gate 1 burn-in. A disagreement is a port bug, because Gate 1 drew frame N's pose onto
   frame N's pixels in the process that computed them.
2. Scrub hard: the overlay stays on the picture, and the sync panel's overlay-drift figure is
   reported with the trace both on and off.
3. Open a swing with `club: null` — the club and trace layers are absent and nothing looks broken.

## Definition of Done

- [ ] `analysis.json` is fetched, cached, and a 404 still plays the video.
- [ ] Skeleton, club, trace and angles draw, locked to the presented frame.
- [ ] `markOverlayCommitted` is called and overlay drift is on screen.
- [ ] Every layer abstains rather than fabricating; a null block hides its layer.
- [ ] The transport is bounded by `playbackWindow`.
- [ ] The trace's frame-lock cost is measured and written down, and the Skia question is answered
      with that number rather than by assumption.
- [ ] Gate 3 checked against the burn-in on at least two fixtures.
- [ ] Oracles pass.

## Notes

The scorecard, findings and priorities are step 03. Dual-view is step 04. Silhouette, isolation and
butt line are deferred out of this track's step 02 and need a home before launch — file them rather
than letting them evaporate.

---

### Appended 2026-08-12 during execution — Gate 3 got a harness, and it immediately earned its keep

The `Steps` above are unchanged; this records two things they could not have anticipated.

**1. Gate 3's geometry half does not need the phone, and should not wait for it.**
`scripts/checkoverlay.ts` imports the very modules the phone runs — `keypointIndex`, `BONES`,
`buildTrace`, `cutAt`, `orientationHold`, `resolveAngle`, `simplify`, `dashSegments` — and lays
their output over the analyzer's own `overlay.mp4` as a magenta hairline. Gate 1 drew frame N's pose
onto frame N's pixels in the process that computed them, so a disagreement is a client port bug and
nothing else. Verified on all ten fixtures at Address, Top and Impact. RUNBOOK §12a.

**On its first real run it found a bug no test would have:** the port was drawing
`analysis.club` (the conservative classical `primary` solve) while the web player draws the variant
`defaultClubVar` selects. Same swing, visibly different line, nothing red anywhere. `selectedClub`
now applies that choice once, and the shaft, head, trace and club-anchored angles all read it.

**2. What is left is genuinely device-only, and it is the step's own open question.**
The view count is measured — 59–61 for the skeleton, **peak 461 at impact on `pro_3`, 400 of them
trace**, against the ~77 D23's 99.2% frame-lock figure was taken at. Whether the lock holds at 461
is not inferable from that number, and D23 rejected Skia on cost rather than on merit, so reversing
it needs the measurement rather than an argument. Reading it is one screen: Overlay drift with the
trace on and with it off (RUNBOOK §12b). The step stays open on exactly that.

**Also deliberately not built, and now filed rather than evaporated:** the silhouette, the isolation
scrim, the butt line and fit-to-golfer crop. `docs/PRODUCT-COVERAGE.md` §14 is downgraded from ✅ to
🟡 to say so, since the phone is the primary product.
