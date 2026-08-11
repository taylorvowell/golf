# 02 - Mobile Client Spike and Workspace

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

Prove step 01's mobile client choice on real hardware before anything is built on it, and land
the resulting workspace so `apps/mobile/` exists as a first-class member of the monorepo.

The spike exists because §2.3 makes ≥60 fps capture non-negotiable and §2.2 says performance
beats code-sharing purity. Those two together mean the framework decision is only valid if it
is measured. A choice that reads well and drops frames on mid-range Android is a choice that
has to be discovered now, not in the `in-app-capture` track.

## Dependencies

- Step 01 complete (the client decision exists and is recorded).

## Architectural Context

- `PROJECT_MAIN.md` §2.2, §2.3, §13 (player responsiveness), §40 (device compatibility).
- `docs/ARCHITECTURE.md` from step 01.
- The existing player's frame-sync rules in `docs/CURRENT-STATE.md` §6 are the acceptance bar
  for playback: the mobile client must be able to land on an exact frame and hold an overlay on
  it during scrubbing. The rules survive the port even though the components may not.

## Files & Areas Touched

- `apps/mobile/` — the client workspace
- `pnpm-workspace.yaml` — register the new package
- `packages/` — any code genuinely shared between web and mobile (types first; rendering logic
  only if the spike shows it transfers)
- `docs/DECISIONS.md` — amend or confirm step 01's client entry with the measured result

## Steps

1. Build a throwaway spike on the chosen framework that does exactly three things on a real
   device: record at 60 fps and report the *actual* achieved rate; play a recorded clip back
   with frame-accurate seek; draw a moving overlay locked to the video during scrub.
   **The third is the one that decides this.** Step 01's research found confirmed paths for
   capture (VisionCamera, 30–240 fps) and for exact seek (zero-tolerance seek on iOS,
   decode-and-skip from a sync point on Android, bounded by this pipeline's GOP of 10). It did
   **not** confirm an Android equivalent of iOS's `AVPlayerItemVideoOutput` + `CADisplayLink`
   per-frame callback. If the overlay cannot be locked to the *presented* frame on Android, the
   product's #1 perceived-quality feature does not survive the port — so prove that first, on
   Android, before spending time on the other two.
2. Measure on at least one iPhone and one mid-range Android — not a flagship. Record achieved
   capture fps, dropped frames during overlay playback, and seek accuracy.

   **Run Android first, and do not wait on iOS to start.**

   **The feasibility question is now closed (D19)** — this spike measures, it does not decide.
   Both platforms expose a real per-frame callback: Media3's
   `VideoFrameMetadataListener.onVideoFrameAboutToBeRendered()` on Android (presentation time in
   µs plus the intended display wallclock in ns) and `AVPlayerItemVideoOutput` + `CADisplayLink`
   on iOS. Neither is surfaced by `expo-video`, so a small Expo native module is the deliverable
   that makes probe 1 measurable at all — build it before trying to measure drift.

   Two things `expo-video` gives for free and should be used rather than reinvented:
   `SeekTolerance` already defaults to zero on both platforms, and Android's
   `ScrubbingModeOptions` (`scrubbingModeEnabled`, `useDecodeOnlyFlag`,
   `allowSkippingMediaCodecFlush`) is purpose-built for rapid seeking while dragging.

   Also settle `surfaceType` here: Android's default `surfaceView` is faster and lower-power, but
   Expo's docs flag z-ordering problems with overlapping views, and `textureView` composites
   conventionally. Which one an overlay-on-video layout needs is a measurement, and it may trade
   power for correctness.

   iOS is needed to *complete* this step, not to begin it — a borrowed or second-hand device, or
   a cloud device farm for the measurement pass. The iOS simulator cannot exercise camera
   capture and is not a substitute. See `docs/RUNBOOK.md` §6.
3. If the spike fails the bar, say so and return to step 01's decision rather than proceeding.
   That is a legitimate outcome of this step, not a failure of it.
4. Scaffold `apps/mobile/` properly: TypeScript strict, the lint/format setup the repo already
   uses, and a build that runs from the repo root like the other workspaces.
5. Register the workspace in `pnpm-workspace.yaml` and confirm `pnpm i` from the root resolves
   it.
6. Create `packages/` as a workspace location. Do **not** hand-write shared contract types here
   — step 07 generates them from JSON Schema, and a hand-written set now becomes the duplicate
   that step deletes. Share only genuinely non-contract utilities.
7. **Establish the client test strategy, and make it real in this step.** `apps/web` currently
   has zero tests and mobile is starting from nothing, while the analyzer has 80. That
   imbalance quietly reads as "the project is well tested". Set up the unit and
   component-testing harness for both clients, plus at least one end-to-end path, and wire them
   into the same oracle commands every later step runs. A strategy documented but not executed
   here will not happen later.
8. Amend the step 01 decision entry with the measured numbers.

## Quality Standards

- The measured capture rate, dropped-frame count and seek accuracy are written down as numbers,
  per device. "It felt smooth" is not a result.
- `apps/mobile` builds and typechecks from the repo root with no per-directory ceremony.
- Client tests run from the same commands as everything else, and CI can run them headless.
- No feature code. This step ends with an app that launches, proves the three capabilities, and
  has a working test harness.

## Verification

```
pnpm i
pnpm --filter mobile exec tsc --noEmit
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter web test && pnpm --filter mobile test
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
```

Manual: the spike runs on a physical iPhone and a physical mid-range Android, and the three
measurements are recorded in `docs/DECISIONS.md`.

## Definition of Done

- [ ] Spike results recorded per device, as numbers, in `docs/DECISIONS.md`.
- [ ] `apps/mobile/` exists, typechecks, and builds from the repo root.
- [ ] `pnpm-workspace.yaml` includes it and a clean `pnpm i` succeeds.
- [ ] `packages/` exists as a workspace location (contract types come in step 07).
- [ ] Both clients have a working test harness with at least one real test and one E2E path,
      runnable headless.
- [ ] Existing oracles still pass.

## Notes

If the chosen framework needs a native module to hit 60 fps capture, that is an expected
outcome under §2.2, not a reason to switch — but it must be recorded, because it changes the
build and release story for every later mobile track.

---

## Note appended 2026-08-11 — the available Android is a flagship

The device on hand is a **Samsung Galaxy S25+** (Android 15 / One UI 7). Step 2 of the `Steps`
section above asks for a **mid-range** Android and explicitly says "not a flagship". That
instruction is not satisfied by this device, and the `Steps` section is deliberately left
unedited rather than relaxed to match what is available.

**This makes the S25+ result asymmetric, and it should be read that way:**

- A **failure** on the S25+ is decisive. If the overlay cannot be locked to the presented frame on
  a Snapdragon 8 Elite, it will not hold anywhere, D5 reopens, and no further device is needed.
  This is the cheapest available way to invalidate the framework choice, which is why the S25+ run
  should happen first regardless.
- A **pass** on the S25+ does **not** close this step. A flagship has the thermal and compute
  headroom to absorb precisely the dropped frames a mid-range device would expose, and §40 states
  the compatibility goal in terms of ordinary devices. Recording a flagship pass as "probe 1
  answered" would be the same class of error as the coverage percentages that overstated club
  quality three times.

**Therefore:** record S25+ numbers as flagship data, clearly labelled with the device, and keep
"mid-range Android measured" as outstanding alongside "iOS measured". The Definition of Done is
unchanged; this note only records that one of its devices is not yet available, in the same way
the iPhone is not.

A mid-range device is a smaller ask than the iPhone — it does not need to be new, and a
borrowed or second-hand mid-tier Android from the last three years is sufficient.
