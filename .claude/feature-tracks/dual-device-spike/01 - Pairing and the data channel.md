# 01 - Pairing and the data channel

**Phase:** Dual-Device Spike
**Status:** not-started
**Estimated effort:** 1-2 sessions

## Overview

Two signed-in phones, one join code, one live WebRTC data channel — each end rendering the
other's `hello`. Nothing is recorded and nothing is stored; this step proves the two devices
can find each other and hold a connection at a driving range, which every later step assumes.

Throwaway by design: the whole harness is a `__DEV__`-only screen, not the session UI.

## Dependencies

- `session-mode` step 04 complete (real Camera2 recording exists on one device). Steps 02–03
  cannot record without it; **step 01 alone does not need it** and can run first.
- Both devices signed in — `platform-foundation` auth is already shipped.

## Architectural Context

- Design: `DESIGN-dual-device.md` (this directory). Product requirement: `PROJECT_MAIN.md`
  §12.1–§12.2.
- **Signaling is Supabase Realtime broadcast**, channel named by the join code. Supabase is
  already the auth and data vendor (`docs/decisions/platform-data.md`), so no vendor decision
  is being made here and none should be smuggled in.
- **`react-native-webrtc` is the transport.** A dependency with a native module is APK weight
  and a prebuild (`.claude/rules/react-native.md`) — it enters `package.json` in this step
  with its import site, not before.
- The join code is a **6-character code with a QR rendering of an HTTPS link**. The scanner is
  in-app; App Links are deliberately out of scope (two `BLOCKED` HANDOFF rows).
- Ownership is settled and must be encoded from the start: the **host** owns the swing, the
  camera device owns nothing. Do not build a symmetric peer and "decide later".
- `hello` carries capabilities because a mid-range phone is not the S25+ and §2.3 forbids
  silent degradation.

## Files & Areas Touched

- `apps/mobile/package.json` — `react-native-webrtc`; `app.json` if a config plugin or
  permission is required, then `npx expo prebuild -p android --clean`.
- `apps/web/src/app/dev/pair/` — a **dev-only** peer that speaks the same protocol from a
  desktop browser, in either role (host or camera). This is the primary debugging pair, not the
  emulator: the desktop is a first-class LAN citizen so it forms a DIRECT peer connection with
  the phone (no relay), `chrome://webrtc-internals` exposes every ICE candidate and stat that
  `react-native-webrtc` hides, and iterating on the protocol costs a page refresh instead of an
  APK rebuild. `getUserMedia` is satisfied because `localhost` is a secure context.
  **It must not build in production.** Route-gated on `NODE_ENV !== "production"` with a test
  asserting a 404 in a production build — otherwise this quietly becomes the browser-guest
  feature that was deliberately cut (`DESIGN-dual-device.md`, Rejected).
- `docker-compose.yml` — a `coturn` service for DEVELOPMENT, needed ONLY for the
  emulator-to-phone pair. The emulator sits behind the
  emulator NAT (guest `10.0.2.15`, host reachable at `10.0.2.2`, nothing inbound), so a phone
  cannot reach it and no direct ICE pair will ever form emulator-to-phone. Both ends CAN reach
  the dev PC outbound, so a relay on this machine is what makes a two-client dev loop possible
  at all. It is a dev convenience, not the production TURN decision (step 04 owns that).
- `spikes/dual-device/` — the harness's non-UI logic (protocol types, the peer state machine)
  so it is testable without a device and deletable in one commit.
- `apps/mobile/src/features/spike/DualDeviceSpikeScreen.tsx` — `__DEV__`-only screen: **Host**
  shows the code + QR and a connected-peer card; **Join** scans or accepts a typed code.
- `packages/schema/` — the message union, if it is cheaper to put it there now than to move it
  later. Decide and log; do not fork two copies.

## Steps

1. Add `react-native-webrtc`, prebuild, and confirm the dev client still launches on the
   emulator. Record the APK-size delta in `_PROGRESS.md`.
2. Build the dev web peer at `/dev/pair` first — protocol logic is cheaper to get right against
   real WebRTC internals than against two mobile logcats. Support BOTH roles from one page.
3. Stand up `coturn` in `docker-compose.yml` with a SMALL relay port range (Docker Desktop maps
   ports one at a time — a wide range takes minutes to start). Point both clients at it via an
   `EXPO_PUBLIC_*` ICE-server env var so production can swap it without a code change. Document
   the recipe in `docs/RUNBOOK.md`.
4. Define the message union (`hello`, `assign`, `configure`, `clock`, `arm`, `start_at`,
   `stop`, `state`, `bye`) as discriminated types with a version field. Only `hello` and `bye`
   are exercised in this step; the rest are declared so later steps do not renegotiate shape.
5. Build the peer state machine as a pure reducer in `spikes/dual-device/` — `idle` →
   `advertising`/`joining` → `signaling` → `connected` → `closed`, with explicit failure
   states for "code not found", "code expired" and "peer gone".
6. Wire signaling: host subscribes to a Realtime channel named by the code and publishes its
   SDP offer; the joiner subscribes, answers, and both trickle ICE. Codes expire (minutes).
7. Open the data channel; exchange `hello`; render the peer's capabilities on both screens.
8. Add reconnection: a dropped channel retries with backoff and surfaces a truthful state,
   never a silent spinner (`.claude/rules/react-native.md` — every request times out).
9. Log a decision entry for the signaling choice and the dependency in `docs/decisions/`.

## Quality Standards

- The peer state machine is a **pure reducer with unit tests** — connection lifecycle,
  expiry, and peer-gone are all reachable without a device.
- No `any` in the protocol types; the union is exhaustively switched.
- Every subscription and timer created is torn down in the same hook.
- Nothing spike-related renders outside `__DEV__`, including layout accommodations.
- The harness is confined to `spikes/dual-device/` plus one screen, so step 04 can delete it.

## Verification

- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` (the dev peer lives in the web
  workspace, so its oracle applies too)
- Phone + desktop browser at `/dev/pair`, run in BOTH directions: phone-as-host with the desktop
  as camera, and desktop-as-host with the phone as camera. Both render the peer's `hello`.
- Kill one end — the other reaches an explicit failure state, never a spinner.
- **Neither the desktop peer nor the emulator proves the phone-to-phone path.** Chrome's WebRTC
  stack and `react-native-webrtc` are different implementations, and the emulator is a synthetic
  feed on x86_64. They prove protocol and flow. No timing, fps or reliability claim comes from
  either — that is step 03, on two real phones.

## Definition of Done

- [ ] `pnpm --filter mobile exec tsc --noEmit` exits 0
- [ ] `pnpm --filter mobile test` passes, including new reducer tests for connect / expire /
      peer-gone
- [ ] `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` exits 0
- [ ] Phone and desktop hold a data channel in BOTH role directions, each rendering the other's
      capabilities
- [ ] `/dev/pair` returns 404 in a production build, with a test asserting it
- [ ] Killing one end moves the other to an explicit failure state within 10 seconds
- [ ] APK-size delta from `react-native-webrtc` recorded in `_PROGRESS.md`
- [ ] Signaling + dependency decision entered in `docs/decisions/`

## Notes

Two physical Android devices are a `HANDOFF` row. **Emulator-to-phone works only through the
dev `coturn` relay** — the emulator NAT makes a direct peer connection impossible, so without a
relay this step has no two-client loop at all. With it, steps 01 and 02 are fully developable on
emulator + S25+; step 03 still needs two real phones, because its whole deliverable is a timing
number and the emulator has no real camera clock.
