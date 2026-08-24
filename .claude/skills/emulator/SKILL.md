---
name: emulator
description: Launch the SwingSage desktop Android emulator (the swingsage AVD) and load the app on it, then do the same on the S25+ phone if it is already adb-connected — soft-failing with a one-line hint when wireless debugging is off. Use whenever the user types /emulator or asks to launch/start/boot the Android emulator, put the app on the emulator or phone, or get the Android debug environment up on the PC.
---

# /emulator — bring the Android surfaces up

One job: the emulator running with the app on screen, plus the phone if it happens to be connected. Everything is in one idempotent script — safe to re-run when the emulator is already up (it skips the boot and just redeploys the app).

## Do this

Run from anywhere (the script resolves the repo root itself):

```bash
bash .claude/skills/emulator/scripts/launch.sh            # JS-only
bash .claude/skills/emulator/scripts/launch.sh --native   # Kotlin / app.json changed
bash .claude/skills/emulator/scripts/launch.sh --restart  # bounce Metro on the FIRST attempt
```

Cold boot takes ~30–60 s; already-running takes ~10 s. The script prints a summary line per device — `EMULATOR: …` and `PHONE: …`.

**It retries once, by itself.** `dev-device.mjs`'s commonest failure is *"on MainActivity, but no JS runtime reached Metro — the device is on a STALE CACHED BUNDLE"*, whose own advice is to re-run with `--restart`. The script now does that automatically and reports `UP (needed a Metro restart)`, so a stale bundle is not something to read an error about and retype. A `FAIL` line therefore means it failed **twice** — go to RUNBOOK §13 rather than running it again.

**This script only boots the AVD and retries.** Everything else is `apps/mobile/scripts/dev-device.mjs`, the single code path for putting the app on a device, which the script calls once per target. That is deliberate: a second copy of the Metro/install/launch logic lived here, hardcoded :8081, and drifted the moment Metro moved to :8082 — which is how "it lost connection again" kept coming back. Never reintroduce it.

## Putting the app on a device — ALWAYS this one command

For anything that is not "boot the emulator too", skip this skill and use the command directly:

```bash
pnpm --filter mobile phone          # JS/TS work — the normal case
pnpm --filter mobile phone:native   # after a Kotlin or app.json change
pnpm --filter mobile emu            # the AVD instead
pnpm --filter mobile emu:native
```

**Never `adb install` an APK by hand, and never `npx expo run:android`.** A raw `adb install` leaves the dev client with no server URL, so it sits on `DevLauncherActivity` — the white screen — and that has cost time in this project more than once. The script instead: builds (only with `--native`), restarts Metro **after** a native build (a `prebuild --clean` plus a gradle run wedges Metro's watcher — it keeps listening and stops answering), health-checks Metro by the **body** of `/status`, launches at the LAN URL, and fails loudly if the app is still on `DevLauncherActivity` rather than claiming success.

## Then reply

Relay the three summary lines in plain words and stop. No extra diagnostics, no screenshots unless asked. A missing phone is the **expected** case, not an error — pass on the one-line hint about enabling wireless debugging and move on.

## Rules that bind here

- **Never retry the phone connection or scan for it.** The wireless-debugging port is random (30000–49999), mDNS does not find this device, and port scans have already been tried and failed (docs/ENVIRONMENT.md). If `adb devices` doesn't show it, only Taylor can fix that, on the phone.
- **"PHONE: not connected" means `adb devices` is empty of it — nothing else.** The script picks the phone as *any ready device that is not `emulator-*`*, because matching on the USB serial or on `10.0.1.123:` reported "not connected" while the phone was attached and working: wireless debugging attaches over mDNS as `adb-R3CY10EZ19E-…_adb-tls-connect._tcp`, which contains neither. Do not narrow that test again.
- **The S25+ is Taylor's daily driver.** Invoking /emulator is his say-so for exactly this script's actions on it — reverse ports, install the APK, launch the app. It is not a licence to tap, screenshot, or otherwise drive the phone afterwards.
- **The emulator is fair game** — drive it freely after launch (root CLAUDE.md).
- If the script reports a failure, debug with the step-by-step commands in docs/RUNBOOK.md §13 rather than editing this skill's script mid-incident.
