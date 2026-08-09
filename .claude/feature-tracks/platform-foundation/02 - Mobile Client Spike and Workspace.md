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
   **Device availability is a known gap: there is an Android phone on hand and no iPhone.**
   Resolve that before this step rather than during it — a borrowed or second-hand device, or a
   cloud device farm for the measurement pass. The iOS simulator cannot exercise camera capture
   and therefore cannot answer this step's question; do not treat it as a substitute. See
   `docs/RUNBOOK.md` §6.
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
