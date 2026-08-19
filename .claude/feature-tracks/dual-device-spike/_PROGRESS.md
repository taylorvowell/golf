# dual-device-spike — Progress

Append-only log. Spec: `DESIGN-dual-device.md`. Product requirement: `PROJECT_MAIN.md` §12.

## 00 - Track scaffolded from Taylor's design session
**Date:** 2026-08-18
**Summary:** Taylor specified the dual-device shape in conversation and it is now written down
in `DESIGN-dual-device.md`: **one host, one slave**. The host phone owns the swing, the trigger
and the remote controls; the second phone is a camera with no record button and no swing of its
own. Both devices are signed in; ownership always follows the host's account. Joining is a QR
plus a 6-character code, entered through an in-app scanner — App Links are a later convenience
behind two existing `BLOCKED` HANDOFF rows. Transport is Supabase Realtime for signaling (no new
vendor) and WebRTC for the data channel and a low-res preview. Each device records locally at
full quality; the WebRTC stream is never the recording.

Sync is deliberately two layers: an NTP-style clock offset that *triggers* both devices, and an
audio cross-correlation in the analyzer that *aligns* them, stored as `view_offset_ms` on the
swing. Conflating those two is the mistake the track is structured to avoid — step 02 delivers
the trigger and explicitly claims no alignment; step 03 measures the alignment and is the reason
the track exists.

**Explicitly cut by Taylor (2026-08-18):** the browser-as-second-camera path (researched in full
— an HTTPS join page with `getUserMedia` and `MediaRecorder` is viable, but a browser tab does
not survive a phone call or a lock screen, iOS Safari exposes no zoom capability, in-tab upload
dies with the tab, and iOS Safari will not reliably hold 60 fps), and the role flip.

**Notes:** Step 01 is the only step runnable emulator-to-phone, because nothing in it is timed.
Steps 02 and 03 need **two physical Android devices** — now an `OPEN` row in `docs/HANDOFF.md`.
Step 02 also needs `session-mode` step 04 (real Camera2 recording) complete.
