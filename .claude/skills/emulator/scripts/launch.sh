#!/usr/bin/env bash
# /emulator — bring up the swingsage AVD with the app running, then do the same on the S25+ if
# (and only if) it is already adb-connected. One summary line per device; exits 0 even when the
# phone is absent (that is a soft fail, not an error).
#
# This script owns exactly TWO things: booting the AVD, and retrying a launch that failed for a
# reason a retry actually fixes. Everything else — is Metro genuinely serving, which port it is
# on, restarting it when it listens but does not answer, installing, and launching the dev
# client at the right URL — belongs to `apps/mobile/scripts/dev-device.mjs`, which is the single
# code path for putting this app on a device. This script used to duplicate all of it and
# hardcode :8081; the duplicate drifted the moment Metro moved to :8082, and a second copy of
# that logic is how "it lost connection again" keeps coming back. Do not reintroduce it here.
#
# Pass --native to rebuild the APK first (a Kotlin or app.json change). Without it, JS-only.
# Pass --restart to bounce Metro on the first attempt rather than only on the retry.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SDK="$HOME/AppData/Local/Android/Sdk"
DEV_DEVICE="$REPO_ROOT/apps/mobile/scripts/dev-device.mjs"
EMU="emulator-5554"

FLAGS=()
for arg in "$@"; do
  case "$arg" in
    --native|--restart) FLAGS+=("$arg") ;;
    *) echo "unknown flag: $arg (expected --native and/or --restart)" >&2; exit 2 ;;
  esac
done

boot_done() { [ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }

has_flag() { local f; for f in ${FLAGS+"${FLAGS[@]}"}; do [ "$f" = "$1" ] && return 0; done; return 1; }

# Put the app on one target, and retry ONCE with --restart if the first go fails.
#
# The failure this exists for is dev-device's own "on MainActivity but no JS runtime reached
# Metro" — a device sitting on a stale cached bundle, which its error text tells you to fix by
# re-running with --restart. Making a person read that and retype the command is exactly the
# manual step /emulator is supposed to remove. A native rebuild is NOT repeated on the retry:
# the APK is already built and installed by then, and only the bundler needs bouncing.
launch() {
  local label="$1"; shift            # "EMULATOR" / "PHONE"
  local target=("$@")                # e.g. --emulator, or nothing for the phone

  if node "$DEV_DEVICE" ${target+"${target[@]}"} ${FLAGS+"${FLAGS[@]}"}; then
    echo "$label: UP"
    return 0
  fi

  if has_flag --restart; then
    echo "$label: FAIL — Metro/install/launch failed even after a restart (the output above names which)"
    return 1
  fi

  echo "  ↻ retrying with a Metro restart…"
  if node "$DEV_DEVICE" ${target+"${target[@]}"} --restart; then
    echo "$label: UP (needed a Metro restart)"
    return 0
  fi
  echo "$label: FAIL — Metro/install/launch failed twice (the output above names which)"
  return 1
}

# ---- desktop emulator ----
if boot_done "$EMU"; then
  echo "emulator already booted"
else
  "$SDK/emulator/emulator.exe" -avd swingsage -no-snapshot-load -gpu host -no-boot-anim >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 36); do boot_done "$EMU" && break; sleep 5; done
fi

if boot_done "$EMU"; then
  launch EMULATOR --emulator || true
else
  echo "EMULATOR: FAIL — did not boot within 3 min (is the swingsage AVD present? RUNBOOK §13 rebuilds it)"
fi

# ---- phone (only if already connected; the wireless port cannot be discovered from the PC) ----
#
# ANY ready device that is not the emulator is the phone. Matching on the USB serial or a
# hardcoded IP does not work and silently reported "not connected" while the phone was attached
# and working: wireless debugging attaches over mDNS as
# `adb-R3CY10EZ19E-o9Djq8._adb-tls-connect._tcp`, which contains neither `10.0.1.123:` nor a bare
# serial. There is only ever one phone on this machine, so "not an emulator" is the whole test.
PHONE=$(adb devices | awk '$2=="device" && $1 !~ /^emulator-/ {print $1; exit}')
if [ -n "${PHONE:-}" ]; then
  echo
  launch PHONE || true
else
  echo
  echo "PHONE: not connected — wireless debugging is likely off. To add it: enable Wireless debugging on the S25+, read IP:PORT off the main Wireless debugging screen, then: adb connect IP:PORT && bash .claude/skills/emulator/scripts/launch.sh"
fi
