---
name: emulator
description: Launch the SwingSage desktop Android emulator (the swingsage AVD) and load the app on it, then do the same on the S25+ phone if it is already adb-connected — soft-failing with a one-line hint when wireless debugging is off. Use whenever the user types /emulator or asks to launch/start/boot the Android emulator, put the app on the emulator or phone, or get the Android debug environment up on the PC.
---

# /emulator — bring the Android surfaces up

One job: the emulator running with the app on screen, plus the phone if it happens to be connected. Everything is in one idempotent script — safe to re-run when the emulator is already up (it skips the boot and just redeploys the app).

## Do this

Run from anywhere (the script resolves the repo root itself):

```bash
bash .claude/skills/emulator/scripts/launch.sh
```

Cold boot takes ~30–60 s; already-running takes ~10 s. The script prints exactly three summary lines — `METRO: …`, `EMULATOR: …` and `PHONE: …`.

`METRO:` comes first because it is the one that used to be missing: the script now verifies Metro is genuinely serving (asking `/status` for `packager-status:running`, not just that :8081 is open), starts it if it is not, and launches the dev client **at that exact server**. A line reading `UP on http://10.0.1.107:8081 — loopback :8081 is squatted` is normal and healthy — it means the QStash dev server holds loopback and the app was pointed at the LAN address instead.

## Then reply

Relay the three summary lines in plain words and stop. No extra diagnostics, no screenshots unless asked. A missing phone is the **expected** case, not an error — pass on the one-line hint about enabling wireless debugging and move on.

## Rules that bind here

- **Never retry the phone connection or scan for it.** The wireless-debugging port is random (30000–49999), mDNS does not find this device, and port scans have already been tried and failed (docs/ENVIRONMENT.md). If `adb devices` doesn't show it, only Taylor can fix that, on the phone.
- **The S25+ is Taylor's daily driver.** Invoking /emulator is his say-so for exactly this script's actions on it — reverse ports, install the APK, launch the app. It is not a licence to tap, screenshot, or otherwise drive the phone afterwards.
- **The emulator is fair game** — drive it freely after launch (root CLAUDE.md).
- If the script reports a failure, debug with the step-by-step commands in docs/RUNBOOK.md §13 rather than editing this skill's script mid-incident.
