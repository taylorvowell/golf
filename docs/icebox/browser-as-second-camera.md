# Browser as the second camera

**Status:** deferred — cut by Taylor, 2026-08-18
**Relates to:** `.claude/feature-tracks/dual-device-spike/DESIGN-dual-device.md`, `PROJECT_MAIN.md` §12

## The idea

As a golfer at a range with a friend who does not have SwingSage, I want to use their phone as
the second camera without them installing anything — so the dual-angle capture works with
whoever happens to be standing there.

The host shows a QR that points at an HTTPS join page. Their browser gets camera access,
connects to the host over WebRTC, records locally with `MediaRecorder`, and uploads its clip to
the same swing. No install, no account.

## Why it was cut

It is technically viable — this was researched in full, not assumed away — but the failure modes
are reliability, not quality:

1. **A browser tab does not survive a phone call, a lock screen, or an app switch.** The capture
   dies mid-session with no recovery. A native app survives all three. This is the deciding
   reason; Wake Lock reduces it but does not fix it.
2. **iOS Safari exposes no zoom capability at all** — `zoom` is absent from
   `getCapabilities()` and the constraint is silently ignored. The only workaround is discrete
   lens selection (0.5x / 1x / 2x), and SwingSage has already rejected stepped zoom for its own
   capture screen.
3. **In-tab upload dies with the tab.** The clip is gone if the helper closes it or walks away.
4. **iOS Safari does not reliably honour a 60 fps constraint** (WebKit 210186). Android Chrome
   generally does; iPhone helpers would be 30 fps second angles.

## What it would cost to revive

Less than it looks, if the dual-device protocol stays transport-neutral:

- The join token, the data-channel message set, the audio-correlation alignment and the upload
  contract are identical to the native path. A `transport` field on `hello` is the only protocol
  difference.
- The new work is a `/join/[token]` route in `apps/web` (`getUserMedia`, `MediaRecorder`,
  capability probe, Wake Lock, in-tab upload) plus iOS lens enumeration.
- **The QR must already be an HTTPS link** rather than a custom scheme, which the native design
  requires anyway.

## The prerequisite that has not moved

`getUserMedia` only works in a secure context, so the join page must be **hosted over HTTPS** —
a LAN URL served from the host phone will not work. Pairing therefore needs a data connection on
both devices, even though the media stays peer-to-peer over the local network afterwards.

## What is lost by not having it

The dual-angle differentiator only fires when both people have installed SwingSage and signed
in. At a range, the buddy who will not install anything is a common case.
