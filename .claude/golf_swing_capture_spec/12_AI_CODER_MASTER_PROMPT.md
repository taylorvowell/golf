# 12. AI Coder Master Prompt

Copy this prompt into the coding/planning agent after providing the full specification folder.

---

You are planning and implementing the mobile capture subsystem for a golf swing analysis product.

Read **all Markdown files in this specification folder before proposing code**. Treat `00_README.md` as the decision summary and the other files as detailed contracts.

## Your job

Produce an implementation plan for a React Native iOS + Android application that:

1. records golf swings locally at the highest useful high-speed FPS supported by each phone
2. separates recording FPS from detector FPS
3. supports 120/240 FPS where hardware permits
4. detects candidate golf impact using audio
5. verifies that the golfer on camera was swinging using lightweight movement and, only if necessary, pose/temporal analysis
6. records 3 seconds after a confident impact and auto-stops
7. warns at 17 seconds if no shot is detected
8. uses 20 seconds as the impact-detection cutoff but still preserves 3 seconds after a late impact
9. immediately opens a review page that loops a fixed 6-second range, 3 seconds before and after predicted impact
10. provides a large thumbnail filmstrip
11. lets the user move the fixed six-second range left/right
12. always allows manual correction
13. has large Delete and Save actions
14. does not physically trim the source until Save
15. performs trim/export natively
16. queues upload persistently
17. uploads directly to private object storage via signed/resumable mechanism
18. processes asynchronously on the backend
19. never deletes the only viable source before safety conditions are met
20. records telemetry linking detector prediction to user correction

## Non-negotiable architecture rule

Do **not** attempt to run pose/ML at 120/240 FPS.

High-speed recording, preview, and detection are separate pipelines:

- recording: highest useful device-supported FPS
- preview: whatever the high-speed camera session permits, often around normal display cadence
- visual detector: target roughly 10-30 FPS
- audio detector: continuous
- full high-FPS frame analysis: after capture/server-side

## Android requirement

High-speed CameraX/camera2 sessions are constrained. Do not assume an ImageAnalysis pipeline can coexist with every 120/240 FPS configuration.

Implement capability tiers and a fallback where:

- high-speed video records normally
- audio candidate is captured live
- visual verification is done after recording by decoding a few low-resolution frames around the candidate

Do not reduce the entire product to 60 FPS solely because a given high-speed mode cannot run live frame analysis.

## Native boundary

Do not put these operations on the React Native JS thread:

- high-FPS camera encode/decode
- per-sample audio DSP
- FFmpeg/media export
- thumbnail extraction
- heavy pose inference
- background video upload

Use native modules/libraries with thin JS contracts.

## First response required from you

Before writing implementation code:

1. summarize the architecture you inferred
2. identify any conflicts between the current codebase and this spec
3. enumerate the relevant existing files/modules in the repository
4. propose the smallest safe sequence of implementation phases
5. identify platform-specific native work
6. identify third-party dependencies and explain why each is needed
7. identify risky assumptions that need a hardware prototype
8. propose data contracts/types
9. propose tests and telemetry
10. then implement only the first approved/appropriate phase

When there is a conflict, prioritize:
1. preventing loss of a user's swing
2. recording quality/stability
3. UX responsiveness
4. detector precision
5. infrastructure optimization

Do not over-engineer V1.

The intended MVP detector progression is:

```text
audio onset
 -> impact candidate
 -> cheap motion ownership
 -> review
```

Only add continuous pose, ball detection, or a temporal deep model if measured data demonstrates the simpler approach is insufficient.

## Expected output structure

- Current-state repository assessment
- Proposed target architecture
- File/module changes
- State machine
- Native iOS plan
- Native Android plan
- Shared React Native plan
- Backend changes
- Test plan
- Rollout/feature flags
- Risks
- Implementation sequence

Use the detailed specification files for constants, UX behavior, API shape, failure handling, and telemetry.
