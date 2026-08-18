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

# ---- Metro ---------------------------------------------------------------------------------
# An OPEN 8081 is NOT Metro, and this script used to assume it was — which is how the app came
# up white with every summary line reading UP. The QStash dev server's log server binds 8081 too
# (its main server is 8080) and answers 404 where Metro answers `packager-status:running`, so the
# body is the only honest test. Both addresses get asked, because they disagree: a specific
# 127.0.0.1 bind beats Metro's wildcard bind for loopback traffic, and the emulator reaches the
# host ONLY through loopback (`adb reverse`, and 10.0.2.2) — so it is the surface that breaks
# while the phone on the LAN address stays fine. See docs/ENVIRONMENT.md.
metro_at() { curl -s -m 3 "http://$1:8081/status" 2>/dev/null | grep -q "packager-status:running"; }

HOST_LAN=$(node -e "const n=require('os').networkInterfaces();for(const a of Object.values(n).flat())if(a&&a.family==='IPv4'&&!a.internal&&a.address.startsWith('10.'))console.log(a.address)" 2>/dev/null | head -1)

# The url the DEVICE should load from: loopback when Metro genuinely owns it (adb reverse carries
# it there), otherwise the LAN address, which a wildcard-bound Metro serves even when loopback is
# squatted. Empty means Metro is not serving anywhere.
metro_device_url() {
  if metro_at "127.0.0.1"; then echo "http://localhost:8081"
  elif [ -n "$HOST_LAN" ] && metro_at "$HOST_LAN"; then echo "http://$HOST_LAN:8081"
  fi
}

start_metro() {
  mkdir -p "$REPO_ROOT/apps/mobile/.expo"
  ( cd "$REPO_ROOT/apps/mobile" && nohup npx expo start --dev-client \
      > "$REPO_ROOT/apps/mobile/.expo/metro-launch.log" 2>&1 & disown ) >/dev/null 2>&1
  for _ in $(seq 1 30); do [ -n "$(metro_device_url)" ] && return 0; sleep 2; done
  return 1
}

deploy() {  # $1 = serial, $2 = metro url -> reverse ports, install, launch ON THAT SERVER
  adb -s "$1" reverse tcp:8081 tcp:8081 >/dev/null
  adb -s "$1" reverse tcp:3000 tcp:3000 >/dev/null
  adb -s "$1" install -r "$APK" >/dev/null || return 1
  if [ -n "$2" ]; then
    # Launch the dev client AT a named server rather than letting it choose — its choice is
    # loopback, which is the squatted one. %3A/%2F because the intent data is a url in a url.
    local encoded
    encoded=$(printf '%s' "$2" | sed 's|:|%3A|g; s|/|%2F|g')
    # MSYS_NO_PATHCONV is set HERE and nowhere else: Git Bash mangles the `swingsage://...`
    # intent data into a Windows path, but exporting it globally would also stop the conversion
    # of $APK above, and `adb install` cannot stat a POSIX path. One command, one variable.
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
      adb -s "$1" shell am start -a android.intent.action.VIEW \
      -d "swingsage://expo-development-client/?url=$encoded" >/dev/null 2>&1
  else
    adb -s "$1" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  fi
}

[ -f "$APK" ] || { echo "EMULATOR: FAIL — no APK at $APK (build it first: cd apps/mobile/android && ./gradlew assembleDebug)"; exit 1; }

# ---- Metro first: without it, every launch below is a white screen ----
METRO_URL=$(metro_device_url)
if [ -z "$METRO_URL" ]; then
  echo "metro not serving — starting it"
  start_metro && METRO_URL=$(metro_device_url)
fi
if [ -z "$METRO_URL" ]; then
  echo "METRO: FAIL — not serving. See apps/mobile/.expo/metro-launch.log; if :8081 is held by qstash.exe, docs/ENVIRONMENT.md has the fix."
elif [ "$METRO_URL" = "http://localhost:8081" ]; then
  echo "METRO: UP on $METRO_URL"
else
  echo "METRO: UP on $METRO_URL — loopback :8081 is squatted, so the app is launched there explicitly"
fi

# ---- desktop emulator ----
if boot_done "$EMU"; then
  echo "emulator already booted"
else
  "$SDK/emulator/emulator.exe" -avd swingsage -no-snapshot-load -gpu host -no-boot-anim >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 36); do boot_done "$EMU" && break; sleep 5; done
fi

if boot_done "$EMU"; then
  if deploy "$EMU" "$METRO_URL"; then echo "EMULATOR: UP — app launched on $EMU"
  else echo "EMULATOR: FAIL — booted but install/launch failed (run the deploy steps by hand to see the error)"; fi
else
  echo "EMULATOR: FAIL — did not boot within 3 min (is the swingsage AVD present? RUNBOOK §13 rebuilds it)"
fi

# ---- phone (only if already connected; the wireless port cannot be discovered from the PC) ----
PHONE=$(adb devices | awk -v s="$PHONE_SERIAL" -v ip="$PHONE_IP" \
  '$2=="device" && ($1==s || index($1, ip":")==1) {print $1; exit}')
if [ -n "${PHONE:-}" ]; then
  if deploy "$PHONE" "$METRO_URL"; then echo "PHONE: UP — app launched on $PHONE"
  else echo "PHONE: FAIL — connected but install/launch failed"; fi
else
  echo "PHONE: not connected — wireless debugging is likely off. To add it: enable Wireless debugging on the S25+, read IP:PORT off the main Wireless debugging screen, then: adb connect IP:PORT && bash .claude/skills/emulator/scripts/launch.sh"
fi
