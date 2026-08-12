# 01 - Frame-Exact Playback and Transport

**Phase:** Core Golfer Experience
**Status:** not-started
**Estimated effort:** 1–2 days

## Overview

Play a swing on the phone and land on an exact frame, every time. **No overlays in this step** —
this is Gate 2 of the project's verification strategy, isolated on purpose: pose and sync are two
unrelated causes of "the stick figure looks wrong", and debugging both at once is miserable.

The deliverable is a video surface plus a transport (play/pause, frame step, scrub) whose reported
frame and actual presented frame agree, with a visible frame-sync panel proving it. Overlays go on
top of a proven clock in step 02.

## Dependencies

- `mobile-app-shell` step 01 — navigation and the swing detail route. **Met.**
- `platform-foundation` steps 07 and 09 — the versioned API and media addressing. **Met.**
- Ten analysed swings served over `/api/v1/swings/:id/video`. **Met** (`verify:media`).

## Architectural Context

- `PROJECT_MAIN.md` §13 (swing video player), §2.3 (≥60fps, never silently degrade).
- **Frame sync is the #1 perceived-quality feature.** Overlay drift during scrubbing is what users
  notice. Clips are normalized to CFR 60fps precisely so `frame = round(t * fps)` is exact.
- **D40 is the load-bearing finding and it contradicts the web player.** On Android, media3
  resolves a seek **FORWARD** to the next sync point, so the web player's "seek to the midpoint of
  the frame" rule (`(frame + 0.5) / fps`) is wrong here. Seeking was measured **100% frame-exact
  once the target became `frame / fps`**. Port the rule, not the arithmetic.
- `modules/frame-clock` exists from the step 02 spike and is this track's reason for being kept: a
  per-frame presented-frame callback, which no higher-level API exposes. It currently has **no
  consumer** — this step is the consumer.
- `expo-video` is already a dependency and already a plugin in `app.json`.
- **`scrubbing is unmeasured`** — `measure_overlay.py` was deleted with the spike harness (D44) and
  `CURRENT-STATE.md` §11b records the gap as this track's to close. Closing it is part of this step,
  not a follow-up.

## Files & Areas Touched

- `apps/mobile/src/features/player/` — new: the video surface, the frame clock hook, the transport
- `apps/mobile/src/screens/SwingDetailScreen.tsx` — gains the player above the metadata it shows now
- `apps/mobile/modules/frame-clock/` — wired to a consumer for the first time

## Steps

1. Render `normalized.mp4` through `expo-video` in the swing detail screen, sourced via
   `api.mediaSource()` so the request carries the session — **the same trap D48 caught on
   thumbnails applies here**, and a video that silently 404s looks identical to one that is missing.
2. Derive the current frame from playback time, and seek by `frame / fps` (**not** the web
   player's midpoint rule — D40).
3. Wire `modules/frame-clock` so the *presented* frame is observable, not merely the requested one.
4. Transport: play/pause, ±1 frame, ±10 frames, and a scrub bar. Frame step must be exact at rest
   and while paused mid-scrub.
5. A frame-sync panel, on by default in development: requested frame vs presented frame vs
   `currentTime * fps`, and a drift counter. This is the step's own oracle.
6. Measure scrubbing — the gap D44 left open — and record the number in `_PROGRESS.md` and
   `CURRENT-STATE.md` §11b rather than closing the item silently.

## Quality Standards

- Never fake a frame rate. If the source is 30fps, report 30 (§2.3).
- The video request goes through `api.mediaSource()`; no screen builds a URL by hand.
- No overlay drawing in this step — if a skeleton appears, the step has grown.
- A swing whose `frameCount` or `fps` is missing degrades to a plain video with the transport
  disabled and says why; it must not render a transport that lies.

## Verification

```
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile test
```

Plus, on the S25+: scrub a real fixture and confirm the frame-sync panel shows requested ==
presented across at least 200 seeks, and that ±1 frame moves exactly one frame at both ends of the
clip. `pnpm --filter web verify:media <email>` must still pass — the player must not have needed a
server change.

## Definition of Done

- [ ] A swing plays on the phone from `/api/v1/swings/:id/video`.
- [ ] Seeking is frame-exact, using `frame / fps` (D40), proven by the sync panel on-device.
- [ ] Frame step and scrub behave exactly at both ends of the clip.
- [ ] `modules/frame-clock` has a real consumer.
- [ ] Scrubbing is measured and the number is written down.
- [ ] Oracles pass.

## Notes

Overlays are step 02, the scorecard and findings are step 03, and dual-view is step 04. Ending
here — a proven clock with nothing drawn on it — is what makes a later overlay bug diagnosable as
an overlay bug.
