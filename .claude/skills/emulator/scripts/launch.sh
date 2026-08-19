#!/usr/bin/env bash
# /emulator — bring up the swingsage AVD with the app running, then do the same on the S25+ if
# (and only if) it is already adb-connected. One summary line per device; exits 0 even when the
# phone is absent (that is a soft fail, not an error).
#
# This script owns exactly ONE thing: booting the AVD. Everything else — is Metro genuinely
# serving, which port it is on, restarting it when it listens but does not answer, installing,
# and launching the dev client at the right URL — belongs to
# `apps/mobile/scripts/dev-device.mjs`, which is the single code path for putting this app on a
# device. This script used to duplicate all of it and hardcode :8081; the duplicate drifted the
# moment Metro moved to :8082, and a second copy of that logic is how "it lost connection again"
# keeps coming back. Do not reintroduce it here.
#
# Pass --native to rebuild the APK first (a Kotlin or app.json change). Without it, JS-only.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SDK="$HOME/AppData/Local/Android/Sdk"
DEV_DEVICE="$REPO_ROOT/apps/mobile/scripts/dev-device.mjs"
EMU="emulator-5554"
PHONE_SERIAL="R3CY10EZ19E"   # USB serial; wireless shows as 10.0.1.123:<port>
PHONE_IP="10.0.1.123"
NATIVE="${1:-}"

boot_done() { [ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }

# ---- desktop emulator ----
if boot_done "$EMU"; then
  echo "emulator already booted"
else
  "$SDK/emulator/emulator.exe" -avd swingsage -no-snapshot-load -gpu host -no-boot-anim >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 36); do boot_done "$EMU" && break; sleep 5; done
fi

if boot_done "$EMU"; then
  if node "$DEV_DEVICE" --emulator $NATIVE; then
    echo "EMULATOR: UP — app launched on $EMU"
  else
    echo "EMULATOR: FAIL — booted, but Metro/install/launch failed (the output above names which)"
  fi
else
  echo "EMULATOR: FAIL — did not boot within 3 min (is the swingsage AVD present? RUNBOOK §13 rebuilds it)"
fi

# ---- phone (only if already connected; the wireless port cannot be discovered from the PC) ----
PHONE=$(adb devices | awk -v s="$PHONE_SERIAL" -v ip="$PHONE_IP" \
  '$2=="device" && ($1==s || index($1, ip":")==1) {print $1; exit}')
if [ -n "${PHONE:-}" ]; then
  if node "$DEV_DEVICE" $NATIVE; then
    echo "PHONE: UP — app launched on $PHONE"
  else
    echo "PHONE: FAIL — connected, but Metro/install/launch failed (the output above names which)"
  fi
else
  echo "PHONE: not connected — wireless debugging is likely off. To add it: enable Wireless debugging on the S25+, read IP:PORT off the main Wireless debugging screen, then: adb connect IP:PORT && bash .claude/skills/emulator/scripts/launch.sh"
fi
