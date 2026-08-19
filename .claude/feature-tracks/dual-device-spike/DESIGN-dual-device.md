# DESIGN — Dual-Device Capture

> **Specified by Taylor 2026-08-18.** Two phones film one swing from two angles. This file is
> the retained design for BOTH `dual-device-spike` (measure whether it works) and
> `dual-device-capture` (build it). The product requirement is `PROJECT_MAIN.md` §12; the
> standing rules are `docs/decisions/`. Where they disagree, they win.
>
> Nothing here is built. The register (`docs/decisions/`) describes what we *do* — this file
> describes what we have *decided to build*, and entries move there as they land.

## The shape, in one line

**One host, one slave.** The host phone owns the swing, owns the trigger, and controls the
second camera remotely. The second phone is a camera and nothing else.

## Roles

| | Host | Camera device |
|---|---|---|
| Owns the swing record | yes, always | never |
| Record / stop control | yes | **none** |
| Chooses each device's angle | yes, both | no |
| Zoom, flip | yes, both | its own only, until the host overrides |
| Can leave | ends the pairing | yes, any time |

**Ownership rule:** the swing belongs to the host's account, regardless of which account is
signed in on the camera device. That device's user is a helper, not a participant — no copy
lands in their history, and no relationship is created.

**No role flip** (Taylor, 2026-08-18). The camera device is a slave for the whole session; if
the other golfer wants their own swings, they run their own session with their own host.

## Both devices are signed in

Taylor's call (2026-08-18): the second device downloads the app and signs in. It holds a real
account, not an anonymous capability token. The cost is that a first-ever pairing takes a few
minutes rather than seconds — but it is **one-time per person**, and every session after is a
scan. The sheet copy says so rather than pretending otherwise.

## Joining

The host shows a **QR code and a 6-character code**. Three ways in, one destination:

1. **In-app scanner** — the camera device taps *Join a session* and scans the QR. Needs no
   deep-link infrastructure, and is therefore the path that gets built first.
2. **Typed code** — the same screen accepts the 6 characters. This is not a nicety: it is the
   fallback for a fresh install, where deferred deep links are unreliable on both platforms.
3. **System camera on the QR** — the convenience path. Needs Android App Links / iOS Universal
   Links, which need the `com.swingsage.spike` to `com.swingsage.app` rename and Apple
   enrolment (both already `BLOCKED` rows in `docs/HANDOFF.md`). It drops in later and changes
   nothing else about the flow.

The QR encodes an **HTTPS link**, never `swingsage://` — a custom scheme shows "cannot open
page" on a phone without the app, and system cameras will not route it.

## Transport

- **Signaling: Supabase Realtime broadcast**, channel named by the join code. Supabase is
  already the auth and data vendor, so this adds no vendor and no new service to operate.
- **Data + preview: WebRTC** (`react-native-webrtc`). Once signaling completes, ICE host
  candidates usually connect the two phones directly over the same Wi-Fi; the cloud leaves the
  media path.
- **TURN is the one line item with a price.** Two phones on cellular with no shared network
  need a relay. Before paying for one: prompt for the same Wi-Fi, or have the host raise a
  hotspot. Whether TURN is needed at all is a **measurement the spike takes**, not a guess.

## The data channel is the whole protocol

Versioned message set, in the shared schema package (`packages/schema`) so both ends compile
against one definition:

| Message | Direction | Purpose |
|---|---|---|
| `hello` | camera to host | capabilities: max fps, zoom range, resolutions, battery, free storage |
| `assign` | host to camera | which angle this device films (`dtl` or `face_on`) |
| `configure` | host to camera | zoom ratio, facing |
| `clock` ping/pong | both | offset estimation |
| `arm` / `start_at` / `stop` | host to camera | the trigger |
| `state` | camera to host | idle / armed / recording / uploading / error, plus achieved fps |
| `bye` | both | deliberate teardown |

**Capability negotiation is not optional even though both ends are the app.** A mid-range
Android will not do what the S25+ does, and §2.3 forbids degrading silently — the host renders
the camera device's controls from its reported capabilities and shows its true achieved fps,
exactly as the single-device capture screen already does. The zoom control reuses the
probed-range slider already built (`docs/decisions/mobile-client.md`).

## Recording and sync — the part that decides whether this works

**Each device records locally, at full quality, to its own file.** The WebRTC stream is a
*preview* only — low resolution, for framing and remote zoom on the host. Recording the WebRTC
stream instead would hand the analyzer an adaptive-bitrate, frame-dropping, variable-rate clip:
the exact opposite of what the pipeline needs.

Sync is **two layers, and only the second one produces frame accuracy**:

1. **Trigger** — NTP-style offset estimation over the data channel (many round trips, keep the
   minimum-RTT sample). The host schedules "start at T"; the camera device converts to its own
   clock. This gets both devices rolling within a few milliseconds. **It is not the alignment.**
2. **Alignment** — both devices record audio. The analyzer cross-correlates the two audio tracks
   and stores a `view_offset_ms` on the swing. The ball strike is a large unambiguous transient
   present in both recordings; a pre-roll chirp from the host is the fallback when the strike is
   unusable. This is the established technique, and the multi-camera literature is consistent
   that clock sync alone leaves camera *phase* unaligned.

Both clips normalize to CFR 60 in the existing ffmpeg stage, so the stored offset becomes a
plain frame delta at playback. §12.5's requirement — scrub both views together — is met by one
number on the swing, not by trusting two clocks.

## Failure is a first-class state (§12.6)

The camera device disconnecting, dying, filling its storage, or failing to upload **never**
costs the host its video. The swing degrades to single-angle, is analyzed normally, and the
host is told what happened in one line. The host recording never waits on the camera device.

## Rejected, with reasons

- **A browser as the second camera** (QR to a web page, `getUserMedia`). Technically viable and
  investigated in detail: an HTTPS-hosted join page, WebRTC to the host, `MediaRecorder`
  locally. Cut by Taylor (2026-08-18), and the reasons rank in this order — a browser tab does
  not survive a phone call, a lock screen or an app switch, so the capture is unreliable in a
  way a native app is not; iOS Safari exposes no zoom capability at all (lens stops only);
  in-tab upload dies with the tab; and iOS Safari does not reliably honour a 60 fps constraint.
  Filed in `docs/icebox/`.
- **Role flip** — either phone owning the next swing. Cut by Taylor, 2026-08-18.
- **Recording the WebRTC stream on the host.** Adaptive bitrate and dropped frames make it
  unusable as analyzer input.
- **Aligning frames from the clock alone.** Millisecond clock agreement does not align camera
  phase; the audio correlation is what makes the number true.

## Build order

- **`dual-device-spike`** (this track, 4 steps) — a throwaway harness under `__DEV__`. Its only
  deliverables are a **measured alignment error in frames** and a decision entry. If the number
  fails, the product design changes before anything is built around it.
- **`dual-device-capture`** — the real feature: the Sync sheet on the capture screen (right
  rail, beside the DTL/Front toggle, since it is fundamentally about angles), camera-device UI,
  swing association, dual-view playback, partial-capture recovery. Its step files are authored
  from what the spike learns, not guessed now.
