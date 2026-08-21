# 07. Mobile Implementation Notes

## 1. Target Architecture

React Native is suitable for product/UI orchestration, but the high-speed camera/media path should use native-capable libraries/modules.

Keep these workloads off the JS thread:

- high-FPS recording
- frame timestamps
- real-time audio processing
- media trimming/export
- video decoding
- thumbnail extraction
- heavy pose inference
- background upload

React Native owns:

- screen/state orchestration
- UI
- selection interaction
- navigation
- product telemetry
- high-level capture commands

---

## 2. Suggested Module Boundaries

```text
JS / React Native
|
+-- CaptureController
|    +-- NativeCameraModule / VisionCamera
|
+-- EdgeDetector
|    +-- NativeAudioDetector
|    +-- NativeMotion/PoseModule
|
+-- ReviewPlayer
|
+-- MediaExporter
|    +-- Android Media3
|    +-- iOS AVFoundation
|
+-- UploadQueue
     +-- Android WorkManager/native network
     +-- iOS background URLSession/native network
```

Exact library choices can change. Preserve interfaces.

---

## 3. Capture State Reducer

Recommended explicit states:

```ts
type CaptureState =
  | { type: 'ready' }
  | { type: 'countdown'; remaining: number }
  | { type: 'recording'; startedAt: number }
  | { type: 'impact_detected'; impactTime: number }
  | { type: 'post_roll'; stopAt: number }
  | { type: 'finalizing' }
  | { type: 'review'; sourceUri: string }
  | { type: 'exporting' }
  | { type: 'saved'; swingId: string }
  | { type: 'error'; code: string }
```

Avoid a screen implemented as many unrelated booleans.

---

## 4. Capability Service

On screen initialization, compute:

```ts
type DeviceCaptureProfile = {
  preferred: VideoMode
  fallbacks: VideoMode[]
  liveVisualDetection: boolean
  audioDetection: boolean
  localPostCaptureVerification: boolean
}
```

Cache known-good selections by device/app version but revalidate after significant OS/app changes.

---

## 5. Capability Tiers

### Tier A
- high-speed 240 FPS
- preview
- live audio
- live low-rate visual verification

### Tier B
- 120 FPS
- preview
- live audio
- live low-rate visual verification

### Tier C
- maximum high-speed mode
- preview + live audio
- visual verification deferred until after recording due camera constraints

### Tier D
- 60 FPS fallback
- full detection available

The app UX should remain almost identical across tiers.

---

## 6. Android

Use modern CameraX high-speed support where practical.

Current Android high-speed sessions:

- are at least 120 FPS
- commonly support 120/240 FPS depending hardware
- have constraints on concurrent use cases
- typically do not run preview at the full high-speed recording rate

Therefore:

- query `Recorder.getHighSpeedVideoCapabilities`
- use supported configurations only
- do not assume ImageAnalysis can coexist in every high-speed session
- keep Tier C post-capture verification fallback

For export:
- Media3 Transformer

For reliable background upload:
- WorkManager or a native upload layer appropriate to desired guarantees

---

## 7. iOS

Use AVFoundation format discovery/configuration.

Requirements:

- choose format supporting target FPS
- configure active frame duration/range appropriately
- keep capture work on native queues
- discard/drop analysis frames when analysis falls behind instead of blocking video capture
- use AVFoundation export APIs for trim
- use native/background networking for resilient uploads

---

## 8. VisionCamera

VisionCamera can be a useful React Native camera abstraction if its high-speed support and native frame-processing behavior meet device needs.

Important design rule:

> Never make successful recording dependent on the frame processor keeping up with every high-FPS frame.

Throttle visual detection to a target cadence.

Conceptual example:

```ts
const DETECTOR_FPS = 15

// Pseudocode only
frameProcessor(frame) {
  runAtTargetFps(DETECTOR_FPS, () => {
    lightweightMotionOrPose(frame)
  })
}
```

If a device/configuration cannot provide a compatible analysis output while high-speed recording, use the native fallback described elsewhere.

---

## 9. Audio Detector Threading

Audio processing should run in native code or an efficient native-compatible module.

Keep:

- timestamped onset candidates
- known app-tone suppression intervals
- a small ring of features/windows
- no large PCM retention unless required

Communicate only compact candidate events to JS:

```ts
{
  timeMs: 12432,
  onsetScore: 0.97,
  impactScore: 0.94
}
```

---

## 10. Motion History

Maintain a small rolling feature history rather than raw full-resolution frames.

Example:

```ts
type MotionSample = {
  tMs: number
  bodyMotion: number
  leftWristSpeed?: number
  rightWristSpeed?: number
  shoulderFeature?: number
}
```

This allows an audio event at `t0` to query movement in the preceding 1-2 seconds without storing raw AI frames.

---

## 11. Review Player

Requirements:

- local file playback
- autoplay
- repeat a bounded time range
- seek accurately enough for UX
- 1x / 0.5x / 0.25x
- filmstrip playhead
- smooth timeline drag

Do not physically edit while dragging.

---

## 12. Filmstrip

Generate thumbnail times based on source duration and UI width.

Example:

```ts
const thumbnailCount = 16
for (let i = 0; i < thumbnailCount; i++) {
  const t = duration * i / (thumbnailCount - 1)
  requestThumbnail(source, t, { width: 120 })
}
```

Use native extraction.

Cache only for review lifecycle unless useful later.

---

## 13. Export Queue

Media export should have persistent state.

If user backgrounds the app during export:

- continue if platform permits
- otherwise resume/retry safely
- never lose selection metadata

Store a local job:

```ts
{
  id,
  swingId,
  sourceUri,
  startMs,
  endMs,
  outputUri,
  state
}
```

---

## 14. Upload Queue

Persist upload jobs.

```ts
type UploadJob = {
  swingId: string
  assetId: string
  localUri: string
  sizeBytes: number
  strategy: 'put' | 'multipart'
  state: 'queued' | 'uploading' | 'failed' | 'uploaded'
  retries: number
}
```

The queue must survive app restarts.

---

## 15. Permissions

Need at least:

- camera
- microphone

Provide:
- pre-permission explanation only when useful
- clear denied-permission recovery
- Settings deep-link where supported

If audio is optional after detection research, microphone still remains required for the recommended detector unless user chooses a degraded visual-only mode.

---

## 16. App Lifecycle

Test:

- screen lock
- app background
- notification shade/control center
- incoming call
- audio interruption
- camera interruption
- low storage
- low power mode
- thermal state
- Bluetooth audio route changes
- headphones connected

Capture should fail explicitly rather than produce a misleading "saved" state.

---

## 17. Logging

Each capture should log compact structured events:

```text
capture_ready
record_tapped
countdown_started
recording_started
impact_candidate
impact_confirmed
warning_17s
recording_stopped
review_opened
selection_adjusted
save_tapped
export_completed
upload_completed
analysis_ready
```

Attach:
- captureAttemptId
- swingId when available
- device profile
- detector version
- durations
- error codes

Avoid logging raw user audio/video.

---

## 18. Do Not Put These on JS Thread

- decode 240 FPS video
- loop through all frames
- FFmpeg operation
- per-audio-sample DSP
- model inference that blocks rendering
- file copying of large videos

JS coordinates. Native media stack executes.

---

## 19. External References

- CameraX high-speed configuration: https://developer.android.com/reference/androidx/camera/video/HighSpeedVideoSessionConfig
- CameraX architecture: https://developer.android.com/media/camera/camerax/architecture
- Android Media3 Transformer: https://developer.android.com/media/media3/transformer
- VisionCamera repository/docs: https://github.com/mrousavy/react-native-vision-camera
- Apple AVFoundation: https://developer.apple.com/av-foundation/
