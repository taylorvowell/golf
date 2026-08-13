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
| Device | **Galaxy S25+**, `SM-S936U1`, Android 16, Snapdragon 8 Elite. Flagship — read capture results asymmetrically (a failure is decisive, a pass does not clear a mid-range device). |
| No iPhone | iOS is unbuildable locally: no Mac, no device (D5, D12). |
| adb serial | `R3CY10EZ19E` |
| App package | `com.swingsage.spike` |
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

## Ports

| Port | What |
|---|---|
| 3000 | `pnpm dev` — Next, bound `0.0.0.0` so the phone can reach it |
| 5433 | local Postgres (`golf-postgres-1`), needs Docker Desktop |
| 8081 | Metro |

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
  there are unreachable in exactly the builds used to test them.
