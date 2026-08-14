#!/usr/bin/env bash
# /emulator — bring up the swingsage AVD with the app running, then do the same
# on the S25+ if (and only if) it is already adb-connected. Prints one summary
# line per device; exits 0 even when the phone is absent (that is a soft fail).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SDK="$HOME/AppData/Local/Android/Sdk"
APK="$REPO_ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
PKG="com.swingsage.spike"
EMU="emulator-5554"
PHONE_SERIAL="R3CY10EZ19E"   # USB serial; wireless shows as 10.0.1.123:<port>
PHONE_IP="10.0.1.123"

boot_done() { [ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }

deploy() {  # $1 = serial -> reverse ports, install, launch
  adb -s "$1" reverse tcp:8081 tcp:8081 >/dev/null &&
  adb -s "$1" reverse tcp:3000 tcp:3000 >/dev/null &&
  adb -s "$1" install -r "$APK" >/dev/null &&
  adb -s "$1" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
}

[ -f "$APK" ] || { echo "EMULATOR: FAIL — no APK at $APK (build it first: cd apps/mobile/android && ./gradlew assembleDebug)"; exit 1; }

# ---- desktop emulator ----
if boot_done "$EMU"; then
  echo "emulator already booted"
else
  "$SDK/emulator/emulator.exe" -avd swingsage -no-snapshot-load -gpu host -no-boot-anim >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 36); do boot_done "$EMU" && break; sleep 5; done
fi

if boot_done "$EMU"; then
  if deploy "$EMU"; then echo "EMULATOR: UP — app launched on $EMU"
  else echo "EMULATOR: FAIL — booted but install/launch failed (run the deploy steps by hand to see the error)"; fi
else
  echo "EMULATOR: FAIL — did not boot within 3 min (is the swingsage AVD present? RUNBOOK §13 rebuilds it)"
fi

# ---- phone (only if already connected; the wireless port cannot be discovered from the PC) ----
PHONE=$(adb devices | awk -v s="$PHONE_SERIAL" -v ip="$PHONE_IP" \
  '$2=="device" && ($1==s || index($1, ip":")==1) {print $1; exit}')
if [ -n "${PHONE:-}" ]; then
  if deploy "$PHONE"; then echo "PHONE: UP — app launched on $PHONE"
  else echo "PHONE: FAIL — connected but install/launch failed"; fi
else
  echo "PHONE: not connected — wireless debugging is likely off. To add it: enable Wireless debugging on the S25+, read IP:PORT off the main Wireless debugging screen, then: adb connect IP:PORT && bash .claude/skills/emulator/scripts/launch.sh"
fi
