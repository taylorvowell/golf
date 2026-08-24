---
name: switch
description: Switch the phone between LOCAL DEV mode (Metro + fast refresh, for rapid front-end work at the desk) and REMOTE/PORTABLE mode (standalone release APK needing nothing from this PC, for the golf simulator or the range — where Taylor still drives VS Code and Claude over TeamViewer, but the phone is off this LAN so adb cannot reach it and phone-side fixes must wait until he is home). Use when Taylor types /switch, or says any of "local dev", "remote dev", "switch to dev", "going to the sim", "going to the range", "put it on my phone properly", "I want fast refresh", "make it portable", "back to local". Both modes always talk to the PRODUCTION backends — the switch is only about where the JavaScript comes from, never which servers are used.
---

# Switch the phone between dev and portable

Two modes, one phone, one command each way. **Both use production** (Vercel API →
`swingsage-prod` → R2 → Modal): the API base lives in `apps/mobile/.env` and points at the
deployment. Taylor's standing rule (2026-08-23): *"I don't ever want to test against local
shit."* Never point the app at `localhost` or a LAN address to "make dev work" — that is not
what dev mode means here.

## Which mode is he asking for

| He says | Mode | Why |
|---|---|---|
| "local dev", "switch to dev", "fast refresh", "I'm back at the desk", "let's iterate" | **DEV** | Metro serves the JS; edits appear in seconds |
| "remote dev", "going to the sim/range", "make it portable", "I want to take it with me", "install it properly" | **PORTABLE** | Standalone APK; the PC can be off |

If genuinely ambiguous, ask once — but prefer the reading above; "dev" alone means DEV.

## Do it

Always confirm the phone first (never ask Taylor for an IP or port):

```bash
node scripts/adb-phone.mjs        # from the repo root; cached port → mDNS → LAN sweep
```

**DEV mode:**

```bash
pnpm --filter mobile phone        # add :native after a Kotlin or app.json change
```

**PORTABLE mode:**

```bash
pnpm --filter mobile phone:release
```

That is the whole switch. Same package and the same debug-keystore signature, so **the
session, the app data and Google sign-in survive** every swap. Report which mode is now live
and what it means for him (fast refresh on / PC can be off).

## What each mode actually is

- **DEV** — the Expo dev client fetches the bundle from Metro on this PC over `adb reverse`.
  Fast refresh works. The phone must be able to reach this machine, so it is desk-only.
  `apps/mobile/scripts/dev-device.mjs` handles Metro health, the rebuild-if-native, the
  install and the launch; it is the only supported path (RN rules).
- **PORTABLE** — a release APK with the JS compiled in. No Metro, no LAN, nothing needed from
  this PC. Reloading means relaunching. `apps/mobile/scripts/release-device.mjs` deletes the
  cached bundle outputs, builds with `--no-build-cache`, **verifies the shipped bundle is
  newer than every source file** (gradle has skipped re-bundling past real edits — a whole
  evening's UI fixes once shipped inside a stale bundle), then installs and relaunches.

## PORTABLE does not mean Claude is unavailable — but the phone is out of reach

**Taylor keeps working with Claude while he is out.** The PC stays on at home and he reaches
VS Code and Claude through **TeamViewer / remote desktop** from the simulator or the range,
with the app running on the phone beside him. So a session in PORTABLE mode is a normal
working session, just with the device on the other side of a screen share.

**What Claude can still do for him, fully:**

- Read the Vercel runtime logs, QStash deliveries and Modal worker logs for the swing he just
  hit — the whole pipeline is remote and observable from here.
- Query `swingsage-prod` over the Supabase MCP; inspect R2 objects.
- Fix and **deploy** anything server-side — `node scripts/deploy-web.mjs`, `modal deploy`,
  a migration. Those land on the phone's next request, with no reinstall at all.

**The one thing that does NOT work remotely: touching the phone.** `adb` needs the device on
this machine's LAN, and at the sim it is not. So no install, no relaunch, no logcat, no
screenshot — and therefore **any mobile-JS or native fix is queued until he is home**. Say so
plainly rather than building an APK he cannot receive: "that is a phone-side fix, so it lands
when you are back on your wifi; here is what I can change server-side meanwhile."

**Therefore: build before he leaves.** If he mentions going to the sim/range, run
`pnpm --filter mobile phone:release` FIRST so the phone carries the newest JS out the door.
A switch requested on the way out is the last chance to ship a fix for hours.

## Traps

- **A stale bundle is the failure mode to fear**, and it always reads as "my change did
  nothing". `phone:release` refuses to install one. If it dies saying STALE, delete
  `apps/mobile/android/app/build` and rerun — never install past it.
- **They cannot both be installed at once** (same applicationId). Switching replaces the
  other. Side-by-side needs a `.debug` suffix plus its own Google OAuth Android client — an
  optional row in `docs/HANDOFF.md`, not something to improvise.
- **Never edit `apps/mobile/.env` to change backends as part of a switch.** The mode is about
  the JS source, never the servers.
- After a Kotlin or `app.json` change, DEV needs `phone:native` — plain `phone` will not
  rebuild native code and the change silently will not be there.
