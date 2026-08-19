# 02 - Coordinated trigger and the shared clock

**Phase:** Dual-Device Spike
**Status:** not-started
**Estimated effort:** 1 session

## Overview

One tap on the host produces two video files. The host estimates the clock offset over the
data channel, schedules a start instant, and both devices record and stop together. This step
delivers the *trigger*; it deliberately does **not** claim frame alignment — that is step 03,
and conflating the two is the mistake this track exists to avoid.

## Dependencies

- Step 01 complete (data channel up, `hello` exchanged).
- `session-mode` step 04 complete — the Camera2 record path must exist to be triggered.

## Architectural Context

- `DESIGN-dual-device.md` — sync is two layers, and this step is only the first. The clock gets
  both devices *rolling*; it does not align *frames*.
- **NTP-style offset estimation:** many round trips over the data channel, keep the sample with
  the minimum RTT, `offset = ((t1 - t0) + (t2 - t3)) / 2`. Averaging every sample is wrong — a
  single delayed packet poisons the mean, which is why the minimum-RTT sample wins.
- **Monotonic clocks only.** Wall-clock time can step under NTP correction mid-session; the
  offset must be computed against a monotonic source on both ends.
- The existing recording delay (`sessionState`'s 0/3/5/10 s) is the golfer-facing mechanism for
  walking to the ball — the scheduled start rides on top of it, it does not replace it.
- **The camera device has no record control** (Taylor, 2026-08-18). It shows what it is doing
  and nothing more.
- §2.3: both devices report their **achieved** fps in `state`. If they differ, that is a fact
  to surface later, never something to average away.

## Files & Areas Touched

- `spikes/dual-device/clock.ts` — offset estimator, pure and unit-testable.
- `spikes/dual-device/` — trigger sequencing on top of step 01's reducer.
- `apps/mobile/src/features/spike/DualDeviceSpikeScreen.tsx` — a record button on the host, a
  read-only state readout on the camera device, and both file paths listed after stop.
- `apps/mobile/modules/high-speed-camera/` — only if a "start at instant T" entry point is
  genuinely needed beyond the existing start/stop.

## Steps

1. Implement the offset estimator: N round trips (start with 20), discard until the RTT
   distribution settles, keep the minimum-RTT sample, expose the offset **with its estimated
   uncertainty**. An offset without an error bar is not a measurement.
2. Re-estimate periodically while paired — phone clocks drift, and a pairing may sit idle
   between swings.
3. Host sends `arm`, then `start_at` in host-monotonic terms; the camera device converts and
   schedules. Both surface a shared countdown so a golfer walking to the ball sees the same
   number on both screens.
4. Both record via the existing high-speed module; both stop on the host's `stop`.
5. Record, per trial: requested start instant, each device's actual first-frame timestamp, each
   device's achieved fps, and the offset estimate in force. Write them to a JSON line per trial
   in the spike's own output directory — step 03 reads this.
6. Handle the camera device failing to start: the host records anyway and says so (§12.6). The
   host **never** blocks on the camera device.

## Quality Standards

- The offset estimator is pure and unit-tested against synthetic samples, including an
  adversarial case where one round trip is delayed by 10x the median.
- Nothing in the trigger path uses wall-clock time.
- Trial data is machine-readable (one JSON object per line), because step 03 parses it.
- A camera-device failure is a rendered state on the host, never a silent no-op.

## Verification

- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- Two devices: one tap yields two files. Force-stop the camera device mid-countdown — the host
  still produces its own file and shows why the second is missing.
- **This step's device pass needs two real phones** (`HANDOFF`). The emulator has no real
  camera timing and must not be quoted for any number here.

## Definition of Done

- [ ] `pnpm --filter mobile exec tsc --noEmit` exits 0
- [ ] `pnpm --filter mobile test` passes, including the delayed-round-trip estimator test
- [ ] One host tap produces two video files, one per device
- [ ] Each trial appends a machine-readable record with both first-frame timestamps and both
      achieved fps values
- [ ] Killing the camera device mid-countdown leaves the host recording, with a stated reason

## Notes

The number this step produces — start-instant delta — is **not** the answer to §12.5. It is
the baseline that step 03 compares its corrected alignment against, and the comparison is what
proves whether the audio-correlation layer is doing real work.
