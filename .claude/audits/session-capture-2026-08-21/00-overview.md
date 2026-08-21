# Audit — session-mode capture (2026-08-21)

**Target:** `apps/mobile/src/features/session/`, `apps/mobile/modules/high-speed-camera/`,
`apps/mobile/scripts/dev-device.mjs` — commits `907fa32..a4e60e0` (28 files, +1810/−737).
**Status:** **EXECUTED** — every finding below was fixed in the same session, on Taylor's
instruction ("fix all that is recommended automatically and then commit").
**Confidence:** High for the native and JS findings (four independent reviewers, each claim
carrying a file:line and a failure scenario; the two most severe were reproduced or verified
by hand before fixing). Medium for spec-conformance, where several items are judgement calls
about deliberate deviations rather than defects.

## Why this audit was worth running

The audited work was written across one long session, most of it under debugging pressure
while chasing a camera that would not record. That is exactly the condition under which
correct-looking code accumulates real defects, and it did: **four criticals in the native
module alone**, a **data-loss path** in the JS, and a dev-loop "fix" from earlier the same day
that **had never once worked**.

Two findings could not have come from reading code, and are the argument for auditing against
the running system rather than the source:

- **1.8 GB of cache on the phone** (measured via `adb`: 14 stranded takes, 192 filmstrip
  JPEGs, 20 files from a months-old spike). Nothing in the code deletes any of it.
- **`spawnDetachedMetro()` never ran.** A reviewer reproduced the exact `spawn` shape and
  proved the quoted redirect silently fails on Windows; the Metro that was running had been
  started by hand. The "fix" committed that morning was inert.

## Findings by severity

| Sev | Finding | Consequence if unfixed |
|---|---|---|
| **C** | Hardware BACK during a take unmounts the camera view, which finalises the MP4 natively with no path in JS, and leaves the reducer in `recording` forever | The golfer's only copy of that swing is lost, AND Record never works again until app kill |
| **C** | `closeCamera()` runs on MAIN and mutates recorder/session state the camera thread owns; `MediaRecorder` is not thread-safe | Stop racing a screen-off = double `stop()`/`release()` on one native recorder — exception, or a double-free in mediaserver |
| **C** | `generation` was a non-atomic `++` from two threads | A lost increment lets a superseded `onOpened` assign `device` after teardown nulled it — camera held until process death |
| **C** | Two code paths could both call `openCamera()` on a background→foreground return | The second quits the thread the first registered its callback on; that device's `onOpened` is never delivered and nobody closes it — camera bricked until app kill |
| **C** | `setZoom` was guarded on `recording`, which is false for the whole session-configure window | A zoom tick during configure re-arms the preview, the device never idles, and session creation blocks ~11 s — the exact wedge the day was spent removing |
| **H** | `spawnDetachedMetro()`'s quoted redirect never executed (empirically verified) | Every cold start burns the full 120 s timeout, then points at a log file that was never created |
| **H** | The `startRecording` promise could never settle if the camera thread was quit mid-configure | JS awaits forever; the screen sits on "Recording…" with no way out |
| **H** | `MediaRecorder` leaked whenever a setter or `prepare()` threw, and that rung aborted the ladder instead of advancing | A handful exhausts mediaserver's recorder slots — every later take fails device-wide |
| **H** | A superseded device's late `onError` called `failRecording` unconditionally | Tears down a recorder that is mid-swing on the *current* generation — a lost swing |
| **H** | `s.close()` on a late-configuring session, in the two places the file's own comments forbid it | Blocks the camera thread ~11 s while a take runs — Stop does nothing for eleven seconds |
| **H** | `thumbnails()`' `runCatching{}.onFailure{ … return@onFailure }` returned from the *lambda* | A failed write still shipped a path to a zero-byte JPEG and recycled the bitmap twice |
| **H** | Nothing ever deleted takes or filmstrips | Measured 1.8 GB on a real phone |
| **H** | A `take-ready` arriving after the flow moved on was dropped and the file forgotten | A real recording, unreachable, left in the cache forever |
| **H** | `LocalClipPlayer` had no `AppState` handling | The decoder keeps running behind the home button — violates a standing rule the report player already keeps |
| **H** | The decisions register contradicted the shipped code on five points; `CURRENT-STATE.md` still said **"No capture of any kind"** | Every future session starts from a false model of the feature |
| **M** | Countdown and warning tone were timed from the JS mode change, not the recorder's start | The ladder's configure time is unaccounted, so "Stopping in 0" arrives early and sticks |
| **M** | The "Processing" overlay had no timeout and covered the dock | A wedged stop leaves an un-dismissable overlay over a dead Stop button |
| **M** | Mirror refs written in the render body, read from a native `BackHandler` callback | The precise failure the house rule names |
| **M** | The scrub track was a `PanResponder` with no accessibility affordance | The screen's only precision input is unreachable without sight |
| **M** | Audio decode loop had no deadline; `MediaCodec` leaked on a configure throw | A truncated MP4 wedges the module's queue for every later call |
| **M** | Dead code: `sessionDisplayName`, the removed held-countdown styles, a stale `styles.pressed` | — |
| **M** | Nine capture tunables lived outside the file that claims to be their single home | — |
| **M** | Four hand-written pressed treatments at four different scales; `CONTROL_EDGE` in a feature folder | — |
| **L** | `MAX_BITRATE` unreachable; `durationMs` under-reports by encoder spin-up; `Camera2HighSpeed` reachable only from an API no JS calls | — |

## What was NOT changed, and why

- **`Camera2HighSpeed.kt` / `camera2Capabilities`** — dead by call-graph, kept deliberately.
  It is the capability probe that answers "what can this device actually do", and the next
  device that fails to record is the moment it earns its place. Its stale doc comment (which
  claimed it was the runtime probe) was corrected instead.
- **Spec deviations** (mark-the-strike instead of a sliding window, no loop, confirm instead
  of Undo, no candidate ticks) — these are Taylor's product decisions, not defects. They were
  **documented** in `docs/decisions/mobile-client.md`, which is what the audit found missing.
- **The `useSeekSurface` / `useFramePlayer` consolidations** (R6, R7) — real duplication, but
  the shared hooks are built around absolute-position seeking and a bounded playback window;
  the review screen wants relative dragging on a paused frame. Forcing them together now
  would bend two working things around a third. Left as a named observation for the step-07
  sweep rather than done badly under audit pressure.
- **`BusyOverlay` consolidation** (R5) — four overlays share a shape, and one of them is this
  session's. Worth doing, but it touches three files outside the audit's scope.

## Verification

- `pnpm --filter mobile typecheck` — clean
- `pnpm --filter mobile test` — **416 passed** (up from 411; five new tests pin the reducer
  branches the audit found unexercised, including the mid-session countdown-stop rule and the
  zoom-range re-default)
- `:app:compileDebugKotlin` — BUILD SUCCESSFUL
- Installed on the S25+

**Not verified, and it matters:** the native fixes are concurrency and lifecycle corrections.
They compile and the happy path still records, but the races they close (screen-off during a
take, background→foreground mid-configure, a device error arriving one generation late) are
not covered by any automated test in this repo and were not reproduced on the device. They are
argued from the code and the Android contracts, not measured. The outdoor pass is where they
get their real exercise.
