# 04 - Two Swings, One Scrub

**Phase:** Core Golfer Experience
**Estimated effort:** 2–3 days

## Overview

Step 03 gave the swing an explanation. This one puts a second swing next to it and **scrubs both to
the same place in the golf swing at once** — the thing a golfer actually does with a comparison.

`ComparePanel` already exists and already compares the parts that survive being compared: score,
tempo and phase durations, in seconds because two clips need not share a frame rate. What is
missing is the picture. Its own prop comment says the reference is *"held by the player so the
picture can show it too"* — and the picture never shows it. `reference` currently drives a chip and
a numbers table, nothing else.

**The hard part is not the second video, it is what "the same place" means.** Two swings filmed on
two days at two distances have normalized coordinates that mean different things and frame counts
that mean nothing to each other. Frame 143 of one swing has no relationship to frame 143 of the
other. The only shared vocabulary the two clips have is the swing itself — address, top, impact —
which is exactly what the analyzer already detects and stores.

## Dependencies

- **Step 01** — `modules/frame-clock`, the frame-exact surface. **Met.**
- **Step 03** — `checkpointFrames.ts` established `analysis.checkpoints` (P1–P10) as the anchor
  vocabulary and verified all ten fixtures carry all ten positions with frames. **Met** — this step
  reuses that finding rather than re-deriving it.
- `ComparePanel`, `useAnalysis` and the reference-picking flow. **Met.**

## Architectural Context

- `PROJECT_MAIN.md` §19 (swing comparison), §12.5 (synchronized playback).
- **Align on positions, never on frames or time.** Map through the **P-codes both artifacts
  carry**: find the segment the current frame falls in (say P4→P5), take the fraction across it,
  and land at the same fraction of the reference's own P4→P5. Differing frame rates and differing
  lengths both fall out of this for free, because the mapping is position-to-position and never
  touches absolute time.
- **A reference with no analysis cannot be aligned, and must say so** rather than scrubbing to
  something arbitrary. `ComparePanel` already sets this precedent for phase timing — the same
  swing, the same wording.
- **Never draw one golfer's overlay over another's picture.** The panel's existing comment is the
  rule: two swings' normalized coordinates are not comparable, so a trace from one laid on the
  other is a fabricated measurement. Each pane wears **its own** overlay or none.
- **Two `FrameClockView`s are structurally safe** — every piece of the module's state is a
  per-instance field (`@Volatile private var` inside the view class); there are no singletons and
  no companion-object state. **The open risk is cost, not correctness:** two ExoPlayer instances
  decoding at once, each with an overlay above it. D50 warned against two decoders on *one clip*;
  this is two decoders on two clips, which is different but not free.
- **The second pane is a follower, not a peer.** One clock leads — the swing being studied — and
  the reference is driven from it. Two independent clocks would drift and there would be no
  correct answer about which one is right.
- The 60 Hz hot-path rules in `.claude/rules/react-native.md` apply to the follower too: the
  mapping is a pure function of two artifacts, so the **anchor tables are memoized per artifact**
  and the per-frame path is one segment lookup and a lerp.

## Files & Areas Touched

- `apps/mobile/src/features/player/align.ts` — new: the position mapping and its anchors
- `apps/mobile/src/features/player/ReferencePane.tsx` — new: the second surface
- `apps/mobile/src/features/player/SwingPlayer.tsx` — lays out the second pane, drives it
- `apps/mobile/src/features/player/ComparePanel.tsx` — unchanged numerics; may gain the sync notice
- `packages/schema` — untouched.

## Steps

1. **The anchor table.** `anchorsOf(analysis)` → the P-codes with frames, in strictly increasing
   frame order. Reject (return null) a non-monotonic or single-anchor table: two anchors is the
   minimum that defines a segment.
2. **The mapping.** `alignFrame(from, to, frame)` → the reference frame, or null when either side
   has no usable anchors. Inside the swing, piecewise-linear between shared P-codes. **Outside
   `[first, last]`, clamp** — before address and after finish there is no corresponding position,
   and extrapolating invents one.
3. **Only shared anchors count.** If one artifact has P1–P10 and the other is missing P3, the
   mapping uses the intersection. A position one side never detected cannot anchor anything.
4. **The pane.** A second `FrameClockView` showing the reference, seeked to the mapped frame,
   never playing on its own clock. Muted, and it does not fight the transport.
5. **Drive it from the leader.** The mapped frame is computed from the leader's frame and pushed
   as a seek. Reuse step 01's Android rule — `frame / fps`, resolved inside the native module, not
   recomputed here.
6. **Say when it cannot sync.** Reference with no analysis, or no shared anchors: show the pane
   still (the video is real) with an explicit notice that it is not aligned, or offer no pane at
   all — but never a silently-unaligned pair, which looks exactly like a working one.
7. **Measure the cost.** Two decoders and two overlays: the frame-sync panel's existing readouts
   are the oracle. **This is a device measurement and belongs to Taylor's next pass**, not to a
   guess from here.

## Quality Standards

- No overlay from one swing is ever drawn on the other's picture.
- An unalignable pair is stated as unalignable; never silently misaligned.
- The mapping is a pure function with no React in it, memoized per artifact.
- The follower never runs its own clock.
- Alignment never extrapolates outside the detected swing.

## Verification

```
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile test
```

`align.ts` carries tests over **real fixture anchor tables** — `swing1` (P1@150…P10@243, 60fps) and
`pro_3` (P1@210…P10@1477), which differ in length by a factor of five and are exactly the case a
frame-based or time-based alignment gets wrong.

Plus, on the S25+ **when Taylor runs it** (never driven from here):

1. Pick a reference swing; both pictures appear.
2. Scrub the leader — the reference tracks it through the swing, and both are at the top at the
   same moment.
3. Read the frame-sync panel with the second pane up: the leader's own frame-lock must not
   regress.

## Definition of Done

- [ ] `alignFrame` maps position-to-position, clamps outside the swing, and uses only shared anchors.
- [ ] Tests cover the real `swing1` ↔ `pro_3` anchor tables, both directions.
- [ ] The reference pane renders and follows the leader.
- [ ] An unalignable reference is stated, never silently misaligned.
- [ ] Neither pane wears the other's overlay.
- [ ] Oracles pass.

## Notes

**Not this step:** two views of the *same* swing (dtl + face_on). That is §12.5's dual-*device*
playback and it belongs to `dual-device-capture` — and it cannot be built or tested here anyway:
**all ten swings in the database carry exactly one view, `dtl`**, and there is no face-on footage
anywhere in the project. Building a second-angle path against no second angle would be untested
code pretending to be a feature.

The device cost measurement (step 7 above) is Taylor's, like D51's before it. Do not infer it.
