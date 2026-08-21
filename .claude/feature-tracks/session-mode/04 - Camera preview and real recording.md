# 04 - Camera preview and real recording

**Phase:** Session Mode — Wiring
**Status:** not-started
**Estimated effort:** 1-2 sessions (native work)

## Overview

Replace the stubbed `CameraStage` with a real Camera2 preview and make Record produce an
actual video file: preview + record share one constrained session in an extended
`modules/high-speed-camera`, the FPS pill shows the probed truth, and Stop hands a local
file to the post-swing screen where `FrameClockView` plays it.

## Dependencies

- Step 03 complete (Taylor's UX sign-off).

## Architectural Context

- **The recording path is direct Camera2, nothing else** (D37–D39, mobile-client register):
  vision-camera silently delivers 60 when asked for 120/240; CameraX refuses on empty
  `CamcorderProfile`. `modules/high-speed-camera` already holds the working session code —
  including the *deprecated* `createConstrainedHighSpeedCaptureSession` overload that must
  not be "fixed" (the modern one silently fails on the S25+).
- The module is record-to-file only today, with **no preview surface**. This step adds one:
  a `HighSpeedCameraView` (SurfaceView) whose surface joins the constrained session's
  target list, so preview and record share the device. Do NOT add `expo-camera` — two
  stacks on one camera device.
- **≥60 fps and never silently degrade:** probe capabilities at runtime
  (`camera2Capabilities()` exists), request 60 as the session-mode default, and surface the
  true achieved rate on the FPS pill. If a device cannot meet 60, say so on screen — record at
  its truth, never fake it.
- Local Expo module gotchas (register): declare every property above the `init` block that
  uses it; keep media3 pinning intact in frame-clock; `apps/mobile/android/` is prebuild
  output — config in `app.json`, then `npx expo prebuild -p android --clean`.
- Native change = new dev client on emulator and device (HANDOFF row for the device
  install if Taylor's phone is needed; emulator is yours).
- The emulator's camera is a synthetic feed and proves layout/flow only — **no fps, frame
  or reliability claim from the emulator, ever.** Real capture numbers are an S25+ HANDOFF
  device pass, closed on automated oracles with the device reading as a named shortfall if
  pending.

## Files & Areas Touched

- `modules/high-speed-camera/` — `HighSpeedCameraView` (Kotlin view + TS wrapper), session
  rework so preview runs continuously and record attaches/detaches, start/stop record API
  returning the file path + achieved fps, permission check surface.
- `apps/mobile/src/features/session/CameraStage.tsx` — the seam fills in: preview view,
  permission request flow (denied → readable state with a settings door), probed-fps → pill.
- `apps/mobile/src/features/session/sessionState.ts` — recording holds the resulting file
  URI + achieved fps per swing.
- `apps/mobile/src/features/session/PostSwingScreen.tsx` — plays the local `file://` clip
  via `FrameClockView` (no artifact yet → plain scrub, which step 02 already renders).
- `apps/mobile/app.json` — only if a config change is genuinely needed (CAMERA permission
  already declared; RECORD_AUDIO likely needed for video-with-audio — decide and log).

## Steps

1. Extend the Kotlin module: preview surface + shared constrained session; expose
   `startPreview(fps)`, `startRecord()`, `stopRecord() → { path, achievedFps }`,
   `stopPreview()`; lifecycle-safe (screen blur/background stops cleanly — release the
   camera in every teardown path).
2. TS wrapper + types; wire `CameraStage`: request permission on mount (denied state is a
   real screen state, not an alert), start preview, feed the pill from the probe.
3. Countdown → `startRecord()` at zero; recording treatment binds to the module's actual
   recording state, not the tap; Stop → `stopRecord()` → session state holds the swing's
   file + fps → navigate to post-swing.
4. Post-swing plays the local file. Verify seek math: fps comes from the recording's
   achieved rate (D40 arithmetic: `frame / fps` on Android).
5. Rapid re-record: returning to capture keeps the preview warm (the §9.5 one-tap loop —
   no session teardown between swings unless backgrounded).
6. Prebuild + build the dev client; install on the emulator; run the flow.

## Quality Standards

- The camera is released in every teardown path (unmount, background, navigation away) —
  leaked Camera2 sessions brick the camera until app kill.
- No fps value on screen that was not probed or measured. 60 requested ≠ 60 shown.
- All recording state transitions come from module callbacks, never assumed from UI taps.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile test`
- Emulator: record → file exists → plays on post-swing → record again (flow only).
- Named shortfall until the S25+ pass: real fps, frame-lock and recording reliability are
  device readings (HANDOFF row).

## Definition of Done

- [ ] Oracles pass; dev client builds after prebuild
- [ ] Live preview on the capture screen with permission flow
- [ ] Record produces a real file; achieved fps shown honestly
- [ ] Post-swing plays the just-recorded clip via FrameClockView
- [ ] Camera released on every exit path (verified by re-entering repeatedly)
- [ ] S25+ device pass filed as a HANDOFF row (named shortfall until done)

## Notes

Audio capture (RECORD_AUDIO) is wanted eventually for impact-sound ideas (icebox) and
ambience; decide whether to include the permission now (one prebuild) and log the call in
`docs/decisions/`.

**Added by step-03 iteration (2026-08-18):** the capture UI now carries camera controls this
step must bind — front/back **flip** (`state.facing`), **zoom** (`state.zoom`; replace the
stub 0.5/1/2 stops with the device's probed zoom range), and the **DTL/Front view toggle**
(`state.view`, stamped per swing and threaded to the analyzer's `--view` when the pipeline
wires up in step 06). Camera choices are reducer-gated to idle; the native session should
apply them on preview restart, not mid-recording.

**Superseded in part by the capture spec package (2026-08-20):**
`.claude/golf_swing_capture_spec/` is now the governing contract for this subsystem (decision
logged in `docs/decisions/mobile-client.md`, "The record chain is take → review → trim").
Two changes to this step as written: (1) a recording never becomes a swing directly — a
finalized take enters review (`SwingReview`, fixed six-second window seeded by post-hoc audio
detection) and only Save mints the swing, so "Stop → post-swing plays the file" gained a
review stage in between; (2) the FPS pill was already withdrawn by Taylor in step 03 —
honest-rate surfacing is a failure message, never a standing readout. Recording requests the
240 ceiling with a 23 s hard cap and a 17 s warning tone (`captureConstants.ts`). Shipped
2026-08-20 across commits `38b7854`, `66a3479`, and the record-chain wiring; the S25+ device
pass (real fps, frame-lock, reliability) is the named shortfall on the HANDOFF register.
