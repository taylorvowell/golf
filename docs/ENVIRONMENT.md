# Environment — the machine, the devices, the services

**Facts about the running system, not about the code.** Everything here was learned the hard way
once; none of it should be learned twice.

Live state (is the phone connected, is Postgres up, which ports are listening) is **not** in this
file — it goes stale the moment it is written. Run the probe instead; it takes 0.4s and is injected
into every session automatically:

```bash
node scripts/env-probe.mjs
```

This file holds only what a probe **cannot** discover: identifiers, dashboard state, and the
machine-level faults that have already cost time.

---

## The phone

| | |
|---|---|
| Device | **Galaxy S25+**, `SM-S936U1`, Android 16, Snapdragon 8 Elite. Flagship — read capture results asymmetrically (a failure is decisive, a pass does not clear a mid-range device). **Taylor's daily-driver: never driven without his say-so** (root `CLAUDE.md`). |
| Desktop emulator | AVD **`swingsage`** → `emulator-5554`. medium_phone 1080×2400 @420dpi, Android 36 `google_apis_playstore` **x86_64**, **8 cores / 8 GB RAM** (raised from 4/4 GB 2026-08-15 for interaction smoothness), `hw.gpu.mode=host` (the GTX 1080 renders), guest window/transition/animator scales set to 0. **Claude drives this one freely.** For layout and behaviour only — every *number* off it is meaningless (software-rendered x86_64). RUNBOOK §13. |
| Emulator hypervisor | Runs on **WHPX** — the slow path on this AMD 5950X. Google's faster **AEHD** driver is mutually exclusive with the Windows hypervisor, which **Docker Desktop (the dev Postgres) requires** — so AEHD stays off the table unless the DB ever leaves Docker Desktop. Do not re-derive this; it was checked 2026-08-15. |
| Emulator sign-in | **The one thing it cannot self-serve.** A fresh AVD has no Google account, so native Google sign-in stops at "Checking info…" and everything behind the auth gate is unreachable. Adding one is one-time and persists in the AVD. |
| No iPhone | iOS is unbuildable locally: no Mac, no device (D5, D12). |
| adb serial | `R3CY10EZ19E` (the phone). **Always `adb -s <target>`** — with both attached, a bare `adb shell input` is a coin flip between the emulator and Taylor's phone. |
| App package | `com.swingsage.spike` |
| APK is universal | `gradle.properties` builds all four ABIs (`armeabi-v7a,arm64-v8a,x86,x86_64`), so the **same** `app-debug.apk` installs on the phone and the emulator — no separate build. |
| Last known address | `10.0.1.123:39593` (2026-08-12; was .125 the day before — the IP moves too, just rarely). **The port changes on every reboot** — the IP usually does not. |

**Connecting.** Pairing survives reboots, so this is normally one command:

```bash
adb connect 10.0.1.123:PORT      # PORT read off the phone; IP is usually stable
adb devices -l                   # must say `device`, not `unauthorized`
```

Read `IP:PORT` off *Developer options → Wireless debugging* — the number on the **main** screen,
not the pairing dialog's (that one is single-use and disappears).

**Do not hunt for it.** `adb mdns services` returns nothing on this network, a `/24` ping sweep plus
a port scan of 5555/5037 finds nothing, and the wireless-debugging port is random in the 30000–49999
range. All three were tried on 2026-08-11 and all three failed. If the probe says the phone is not
connected, the only way forward is someone reading two numbers off the screen.

---

## Machine-level faults

| Fault | Status |
|---|---|
| **ProtonVPN blocks phone→PC LAN traffic** — with ProtonVPN connected, the phone cannot reach `10.0.1.107:3000` (and even the PC cannot curl its own LAN IP), so the app's swing list spins and then reads "Cannot reach SwingSage". Node's firewall allow-rules are fine; it is Proton's own firewall. Found 2026-08-12. | **Workaround exists.** Either enable *Allow LAN connections* in ProtonVPN (or disconnect it), or bypass the LAN entirely: `adb reverse tcp:3000 tcp:3000` + set `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000` in `apps/mobile/.env` + restart Metro (env is inlined at bundle time). Revert the .env after — the documented LAN value is what non-adb sessions expect. |
| **`ANDROID_SDK_ROOT` contains its own name** — the value is literally `ANDROID_SDK_ROOT=C:\Users\taylo\AppData\Local\Android\Sdk`. AGP prefers it over the correct `ANDROID_HOME` and dies with *"The filename, directory name, or volume label syntax is incorrect"*, which names nothing. | **Still broken.** Workaround: `unset ANDROID_SDK_ROOT` before any `gradlew` invocation. Permanent fix is a Windows *user* environment variable edit. `expo run:android` is unaffected — it writes `local.properties`. |
| **Samsung *Accidental touch protection* blocks every `adb shell input`** — when the proximity sensor is covered (phone face-down or under something), `com.samsung.android.gesture`'s PocketProximityManager raises an `UnintentionalLcdOn` window that consumes all injected touches. Taps and swipes report success and land nowhere, so a UI automation run reads as "the app did not respond". | **Not fixable over adb.** `settings put system screen_off_pocket 0`, `dumpsys sensorservice restrict <pkg>` and `am force-stop com.samsung.android.gesture` were all tried on 2026-08-12 and none dismissed it. Someone has to uncover the phone. `screen_off_pocket` is now left at `0` and `svc power stayon true` is set, which should stop it recurring; check `dumpsys window \| grep mCurrentFocus` for `UnintentionalLcdOn` before blaming the app. |
| **`ffmpeg` on this machine is 9.0 and has REMOVED `-vsync`** — every recipe on the internet still says `-vsync 0`, and ffmpeg 9 answers *"Unrecognized option 'vsync'"* and aborts before reading the input. | Use `-fps_mode passthrough`. `scripts/checkoverlay.ts` does. The failure is at least loud — an abort, not a silently wrong frame. |
| **NDK `27.1.12297006` was an empty stub** — a directory with only a `.installer` marker. RN 0.86 asks for that exact version and failed on *"did not have a source.properties file"*. | Fixed — the stub was deleted and Gradle re-downloaded it. |
| **A long-running Metro can silently HANG** — found 2026-08-17: node was still listening on `0.0.0.0:8081`, connections were ACCEPTED, but nothing was ever served — even `curl 127.0.0.1:8081/status` timed out with 0 bytes, and the phone's dev client showed `ECONNREFUSED` (a full accept-queue sends RSTs), which reads exactly like a firewall problem. It is not one: Node's allow-rules were verified fine and no block rules exist. | Diagnose by curling `/status` on **loopback first** — if loopback hangs, it is Metro, not the network. Kill the pid (`netstat -ano \| grep :8081`) and restart (`pnpm --filter mobile start`); the phone reached `10.0.1.107:8081` immediately once Metro was fresh. Rule out the qstash squatter (next row) and ProtonVPN (above) with the same netstat first. |
| **`expo run:android --device` matches Expo's own device names, not adb serials** — `--device adb-…_adb-tls-connect._tcp` and `--device SM-S936U1` both fail with *"Could not find device with name"*; the name that works for the S25+ is the underscore model form **`SM_S936U1`**. | Use `npx expo run:android --device SM_S936U1` (wireless adb must already be connected — mDNS: `adb mdns services`). Setting `ANDROID_SERIAL` alone does not help device selection. |
| **`expo run:android --device` leaves an arm64-only `app-debug.apk` that CRASHES the emulator on open** — building for the S25+ builds only that device's ABI (`arm64-v8a`), overwriting the universal debug APK. The x86_64 emulator still *installs* it (its abilist advertises arm64 translation) but SoLoader dies on launch with `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`, so "the app keeps closing" on the emulator after any phone-targeted build. Found 2026-08-18. | Rebuild multi-ABI before an emulator deploy: `cd apps/mobile/android && unset ANDROID_SDK_ROOT && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64` (gradle.properties' four-ABI default is overridden by expo's `-P` flag, not edited). Check with `aapt list …/app-debug.apk \| grep ^lib/`. A clean uninstall does NOT fix it — the APK itself lacks x86_64 libs. |
| **`qstash.exe` can squat Metro's port 8081** — found 2026-08-13 bound to `127.0.0.1:8081` after Metro exited, so the dev client sat on "Loading from …:8081" forever and `curl 127.0.0.1:8081/status` answered 404 (`Cannot GET /`). Explained same day: the QStash dev server's **log server** listens on 8081 (main server 8080), and killing the `npx @upstash/qstash-cli dev` wrapper **orphans the `qstash.exe` child**, which keeps both ports. | Diagnose with `netstat -ano \| grep :8081` and `tasklist //FI "PID eq <pid>"` — if the listener is not `node`, Metro is not running no matter what the port probe says. Restarting Metro (`npx expo start --dev-client`) binds the wildcard address and coexists with the loopback-only squatter — but **coexistence only saves the LAN path, never the emulator**. A specific `127.0.0.1` bind beats a wildcard bind for loopback traffic, and the emulator reaches the host through loopback both ways (`adb reverse` → `localhost`, and `10.0.2.2`), so it keeps hitting QStash and shows a WHITE SCREEN. Confirmed 2026-08-18: `curl 127.0.0.1:8081/status` → 404 `Cannot GET /status` while `curl 10.0.1.107:8081/status` → 200 `packager-status:running`, same moment, same Metro. Fix without killing the queue — relaunch the dev client on the LAN URL: `adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "swingsage://expo-development-client/?url=http%3A%2F%2F10.0.1.107%3A8081"` (`MSYS_NO_PATHCONV=1` first, or Git Bash rewrites the path). After stopping the QStash dev server, `tasklist //FI "IMAGENAME eq qstash.exe"` and `taskkill //PID <pid> //F` the survivor — the wrapper's death does not take the child with it. |

## Ports

| Port | What |
|---|---|
| 3000 | `pnpm dev` — Next, bound `0.0.0.0` so the phone can reach it |
| 5433 | local Postgres (`golf-postgres-1`), needs Docker Desktop |
| 8081 | Metro — **and the QStash dev server's log server**, which is why the two collide. Metro answers on the LAN address, QStash on loopback, whenever both are up. |
| 8080 | QStash local dev server (`npx @upstash/qstash-cli dev`) — fixed test credentials, no Upstash account; the token and both signing keys are in `apps/web/.env.example`'s queue block and RUNBOOK §4 |
| 8787 | analyzer worker HTTP server (`python -m service.server` from `services/analyzer`) — QStash delivers to `/jobs`, health at `/healthz` |

`localhost` on a phone means the phone. Anything the device fetches must use this PC's LAN address
(`10.0.1.x`, from the probe). `192.168.x` means you are on the wrong network or reading the wrong
number.

---

## Supabase — project `golf-swing`

| | |
|---|---|
| Ref | `xjcjqwcmwoouxczrrvar` (us-west-2, Postgres 17) |
| URL | `https://xjcjqwcmwoouxczrrvar.supabase.co` |
| Publishable key | `sb_publishable_y76ZD3rEE38_yt-gW34Z6Q_aZ6a3d4q` — public by design |
| Secret key | `apps/web/.env` only. Never in a client bundle, never printed. |
| One project, not three | D10 — dev/staging/prod separation is money and belongs to step 10. |

**Which auth providers are actually on** is a dashboard setting, so read it from the project rather
than from a doc:

```bash
curl -s https://xjcjqwcmwoouxczrrvar.supabase.co/auth/v1/settings \
     -H "apikey: sb_publishable_y76ZD3rEE38_yt-gW34Z6Q_aZ6a3d4q"
```

As of 2026-08-11: `google: true`, `email: true`, `phone: false`, `apple: false`. Phone needs a paid
SMS provider plus A2P 10DLC registration, and a **hosted** project has no test-number setting — the
free phone path requires a local `supabase start` stack (D31). There is no `supabase/` directory in
the repo yet; the CLI is installed (2.104.0).

## Google OAuth

| | |
|---|---|
| Web client id | `665583572860-v7lsnd65s2pmr9g4qu29jurb7gqoltk4.apps.googleusercontent.com` — **this is the one the app uses** |
| Android client id | `665583572860-tlfq1jrit3g4hrmoatlcub81r6t13gn8.apps.googleusercontent.com` — must exist, is never in the bundle |
| Web client **secret** | Supabase dashboard only. An Android OAuth client has no secret at all. |
| Bound to | package `com.swingsage.spike` + SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |
| Keystore | `apps/mobile/android/app/debug.keystore` — React Native's **public** stock debug key. Fine for development, never for production. **Not committed**: `apps/mobile/.gitignore` ignores all of `/android`, so a fresh clone regenerates it — and reproduces the same SHA-1, which is why sign-in survives a `prebuild`. Verified 2026-08-12. |
| iOS client | **Does not exist.** Which is why the library's Expo config plugin is deliberately absent from `app.json`: its only job is an iOS URL scheme and it throws without one. Android needs nothing from it. |

Google mints the ID token with `aud` = web client, `azp` = Android client. Passing the Android id to
`GoogleSignin.configure` yields a token Supabase rejects with no useful error, and Google returns a
valid-looking user with `idToken: null` rather than failing. See D43.

---

## Local database

| | |
|---|---|
| Owner connection | `DATABASE_URL` → `swingsage` — migrations and CLI only |
| App connection | `APP_DATABASE_URL` → `swingsage_app` — non-superuser, no BYPASSRLS. The app refuses to start on anything privileged (D42). |
| Development identity | id `00000000-0000-4000-8000-0000000000de`, stored as `dev@swingsage.invalid`. **Never a real address** — `users.email` is UNIQUE, so a fallback holding a real one breaks that person's first real sign-in (D43). |
| The ten fixtures | owned by the development identity. `pnpm --filter web db:claim-fixtures <email>` moves them onto a real account and deletes the pre-auth rows. |
| Session/deletion probe | `session-probe@swingsage.invalid`, created and destroyed by `pnpm --filter web verify:account`. It must be in `AUTH_ALLOWED_EMAILS` or every check in that script 401s for a reason that has nothing to do with what it is testing. |

Auth lives in the hosted project while data is local, so a real sign-in produces an id that exists
in hosted `auth.users` and not locally. `app.ensure_profile()` detects the local shim and mirrors the
row — that is why signing in works at all across the split.

**The split has no cascade across it, and the symptom is a 500 that looks like a broken session.**
Deleting an identity in the Supabase dashboard or through the admin API removes the hosted
`auth.users` row and leaves the local `public.users` mirror in place. The next sign-in under that
same address mints a *new* id, `app.ensure_profile()` hits the UNIQUE constraint on `users.email`,
and every API call answers 500. If sign-in suddenly 500s for one address, look here first:

```bash
docker exec golf-postgres-1 psql -U swingsage -d swingsage \
  -c "select id, email from public.users;"
```

The product's own deletion path is unaffected — `DELETE /api/v1/account` removes the profile row
*before* the identity, deliberately (D45). This only bites when an identity is deleted by hand.

---

## Toolchain gotchas that look like bugs

- **Expo inlines `EXPO_PUBLIC_*` at build time.** A value added while Metro is running never reaches
  the app. Restart with `--clear`; the transform cache holds the old literal otherwise.
- **Next 16 refuses a second `next dev` for the same directory.** There is no `-p 3100` escape — stop
  the first one or use the one that is running.
- **pnpm uses the hoisted linker here** (`.npmrc`, D21) — everything lands in the repo-root
  `node_modules`, and `apps/*/node_modules` is nearly empty. That is correct, not a broken install.
  An orphaned directory in the root `node_modules` makes `pnpm add` fail with
  `ENOENT … scandir '<pkg>_tmp_NNNNN'`. **Deleting the orphan is not the fix — it comes straight
  back.** The cause is **Metro holding open handles on `node_modules` while pnpm relinks it**, so
  stop Metro (`netstat -ano | grep :8081`, then `taskkill //PID <pid> //T //F`) and re-run
  `pnpm install`. It succeeds first time with the bundler down. The name in the error is whichever
  package pnpm happened to reach when it hit the lock, so it moves between runs and looks unrelated
  to the package you were installing.
- **A native Android build can fail on a 260-character path, and the registry is not the fix.**
  `ninja: error: Stat(...): Filename longer than 260 characters` comes from the `ninja` bundled
  with the Android SDK's CMake, which has that limit hard-coded. `LongPathsEnabled` is **already
  `0x1`** on this machine and changes nothing. The offender so far is
  `react-native-gesture-handler`, excluded from autolinking in `apps/mobile/react-native.config.js`
  (D47). A newer `cmake;3.31.4` is installed alongside `3.22.1` if a future package needs one.
- **`adb shell input keyevent 4` (Back) exits the app** and lands on whatever the owner was using.
  Relaunch with `monkey -p com.swingsage.spike -c android.intent.category.LAUNCHER 1` instead.
- **The expo-dev-client bubble is pinned top-right** and swallows taps under it. Controls placed
  there are unreachable in exactly the builds used to test them. (The after-swing opener toggle
  lives top-right by design — on dev builds tap its left edge, ~x 870 on the emulator.)
- **`next dev` compiles each API route on its first hit, and `/api/v1/swings/:id/analysis` can
  take >12 s the first time** — past the mobile client's request timeout, so the first swing
  opened after a web-server restart shows "the analysis could not be loaded" while everything
  else works. Reopening the swing succeeds (the route is compiled). Development-only; a
  production build has no on-demand compile.

## Replicate

Taylor has a **Replicate account in active use** (stated 2026-08-17). Its API token lives in
**`apps/web/.env` as `REPLICATE_API_TOKEN`** (added 2026-08-17; server-side and gitignored,
never the mobile env — the consumer is the D57 voice-bank generation script). The session
probe reports its presence. Relevant to two open
decisions, neither yet switched to it:

- **Voice bank generation (D57):** Replicate hosts the chosen model itself —
  **`google/gemini-3.1-flash-tts`, official listing** (verified 2026-08-17: 30 voices,
  style prompts + inline tags like `[whispering]`/`[excitedly]`/pause controls) — plus the
  bake-off alternates (MiniMax Speech 02 HD $0.10/1k chars, Chatterbox $0.025/1k, Kokoro
  $0.02/1k). **Replicate is the generation route:** one existing account covers the chosen
  model and every alternate; no Google AI Studio key needed. Page shows no explicit price;
  immaterial at ~$1–5/bank scale.
- **Analyzer worker host (open HANDOFF row / D18 reopened):** Replicate runs custom models
  via Cog on per-second GPU billing — a candidate for the bursty serverless-GPU shape the
  session economics point at. Input to that decision, not decided.
