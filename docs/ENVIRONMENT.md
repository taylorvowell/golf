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
| Bluetooth shutter remote | Taylor owns an **Autumn tech Bluetooth shutter button** (camera-remote style). Pairs as a Bluetooth HID keyboard and sends volume-key presses; the session screen claims those keys via `modules/shutter-remote` so a press starts/stops recording. The phone's own volume rocker triggers the same path, and `adb shell input keyevent 24` simulates a press for testing. |

**Connecting is a COMMAND, never an ask** (Taylor, 2026-08-22 — *"ive never had to give you the
debug shit before just find it"*). Wireless debugging picks a new random port every time it is
toggled, and this file used to send someone to read it off the phone. It is discoverable from this
PC:

```bash
node scripts/adb-phone.mjs       # already-connected → cached port → mDNS → port sweep
adb devices -l                   # must say `device`, not `unauthorized`
```

The rungs, cheapest first: whatever `adb devices` already lists; the last port that worked
(`.adb-phone.json`, gitignored — a port survives until wireless debugging is toggled, so it is
usually still live after a PC reboot); `adb mdns services`; then a TCP sweep of **30000–50000** on
every 10.x neighbour in the ARP table, which takes about twenty seconds and has never failed.
`scripts/env-probe.mjs` runs the two cheap rungs at session start, so a phone that was connected
yesterday is simply connected again.

**mDNS is unreliable on this device and is not the answer.** It resolved the phone on 2026-08-20
and returned nothing on 2026-08-11 and 2026-08-22 with wireless debugging demonstrably on. The
sweep is what makes the finder deterministic. Measured 2026-08-22: phone at `10.0.1.123`, port
`33787`, found by sweep in ~20s after mDNS came back empty.

---

## Machine-level faults

### Two CLIs are logged into the WRONG account

Taylor has two identities on this machine, and three CLIs disagree about which is current:

| CLI | Account it uses | Correct? |
|---|---|---|
| `vercel` | `summittape` / team `summit-78555d07` by default | **No** — fixed for this repo by `.vercel/project.json`; outside it, pass `--scope taylorvowells-projects` |
| `supabase` | **summittape** — `supabase projects list` shows `summittape-staging` (org `dtkcusaoawffmcalbnwd`) | **No.** A `supabase db push` from this repo would target the wrong account. Use the Supabase **MCP** instead, which is correctly on taylorvowell's org. |
| `eas` / `modal` | `taylorvowell@gmail.com` | Yes |

### `gh` CLI cannot authenticate — and a stale env var shadows the fix

Found 2026-08-22. **Both** credential sources are invalid, and they fail independently:

```
X Failed to log in to github.com using token (GITHUB_TOKEN) — the token in GITHUB_TOKEN is invalid.
X Failed to log in to github.com account taylorvowell (keyring) — the token in keyring is invalid.
```

**The trap is precedence:** `gh` prefers `GITHUB_TOKEN` over the keyring, so `gh auth login` on its
own re-authenticates the keyring and then keeps failing, because the bad env var still wins. Unset
it first, in a **new** shell, then log in:

```
setx GITHUB_TOKEN ""      # then open a NEW terminal — setx does not affect the current one
gh auth login -h github.com
```

Blocks `gh` PRs/issues/`gh api` only. Vercel's GitHub connection is server-side and unaffected;
`git` over HTTPS to `https://github.com/taylorvowell/golf.git` is unaffected.

| Fault | Status |
|---|---|
| **`modal skills install` silently loses ~30% of its docs on Windows** — the installer writes files with the system default codec (cp1252), so every Modal doc containing a non-Latin-1 character dies with `'charmap' codec can't encode character`. Found 2026-08-22: 45 of 153 doc resources failed, and the run still left a *usable-looking* skill behind — 205 files, `SKILL.md` present, no obvious sign a third of the reference material was missing. | **Fixed by forcing Python UTF-8 mode.** Always install and update with `PYTHONUTF8=1`: `PYTHONUTF8=1 services/analyzer/.venv/Scripts/python.exe -m modal skills install --claude -y` (and the same for `modal skills update`). Verify by count — a clean run ends with `Installed Modal skill to ...` and no warning line, and `find .claude/skills/modal -type f | wc -l` is 205 with 204 `.md` references. |
| **`python3` is a Microsoft Store stub, not Python** — `C:\Users\taylo\AppData\Local\Microsoft\WindowsApps\python3` is Windows' app-execution alias. It resolves, so `command -v python3` succeeds and any doc saying `python3 -m <anything>` *looks* runnable — but executing it opens the Microsoft Store or fails with no useful error. Found 2026-08-22 when `python3 -m modal setup` would not run. | **Permanent — never write `python3` in a command for this machine.** `python` is real Python 3.13.7 (`C:\Python313`) and `py` is the 3.13.14 launcher. For anything analyzer-related the answer is neither: use the venv interpreter, `services\analyzer\.venv\Scripts\python.exe`, which is where analyzer deps actually live. |
| **ProtonVPN blocks phone→PC LAN traffic** — with ProtonVPN connected, the phone cannot reach `10.0.1.107:3000` (and even the PC cannot curl its own LAN IP), so the app's swing list spins and then reads "Cannot reach SwingSage". Node's firewall allow-rules are fine; it is Proton's own firewall. Found 2026-08-12. | **Workaround exists.** Either enable *Allow LAN connections* in ProtonVPN (or disconnect it), or bypass the LAN entirely: `adb reverse tcp:3000 tcp:3000` + set `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000` in `apps/mobile/.env` + restart Metro (env is inlined at bundle time). Revert the .env after — the documented LAN value is what non-adb sessions expect. |
| **`ANDROID_SDK_ROOT` contains its own name** — the value is literally `ANDROID_SDK_ROOT=C:\Users\taylo\AppData\Local\Android\Sdk`. AGP prefers it over the correct `ANDROID_HOME` and dies with *"The filename, directory name, or volume label syntax is incorrect"*, which names nothing. | **Still broken.** Workaround: `unset ANDROID_SDK_ROOT` before any `gradlew` invocation. Permanent fix is a Windows *user* environment variable edit. `expo run:android` is unaffected — it writes `local.properties`. |
| **Samsung *Accidental touch protection* blocks every `adb shell input`** — when the proximity sensor is covered (phone face-down or under something), `com.samsung.android.gesture`'s PocketProximityManager raises an `UnintentionalLcdOn` window that consumes all injected touches. Taps and swipes report success and land nowhere, so a UI automation run reads as "the app did not respond". | **Not fixable over adb.** `settings put system screen_off_pocket 0`, `dumpsys sensorservice restrict <pkg>` and `am force-stop com.samsung.android.gesture` were all tried on 2026-08-12 and none dismissed it. Someone has to uncover the phone. `screen_off_pocket` is now left at `0` and `svc power stayon true` is set, which should stop it recurring; check `dumpsys window \| grep mCurrentFocus` for `UnintentionalLcdOn` before blaming the app. |
| **`ffmpeg` on this machine is 9.0 and has REMOVED `-vsync`** — every recipe on the internet still says `-vsync 0`, and ffmpeg 9 answers *"Unrecognized option 'vsync'"* and aborts before reading the input. | Use `-fps_mode passthrough`. `scripts/checkoverlay.ts` does. The failure is at least loud — an abort, not a silently wrong frame. |
| **NDK `27.1.12297006` was an empty stub** — a directory with only a `.installer` marker. RN 0.86 asks for that exact version and failed on *"did not have a source.properties file"*. | Fixed — the stub was deleted and Gradle re-downloaded it. |
| **A long-running Metro can silently HANG** — found 2026-08-17: node was still listening on `0.0.0.0:8081`, connections were ACCEPTED, but nothing was ever served — even `curl 127.0.0.1:8081/status` timed out with 0 bytes, and the phone's dev client showed `ECONNREFUSED` (a full accept-queue sends RSTs), which reads exactly like a firewall problem. It is not one: Node's allow-rules were verified fine and no block rules exist. | Diagnose by curling `/status` on **loopback first** — if loopback hangs, it is Metro, not the network. Kill the pid (`netstat -ano \| grep :8081`) and restart (`pnpm --filter mobile start`); the phone reached `10.0.1.107:8081` immediately once Metro was fresh. Rule out the qstash squatter (next row) and ProtonVPN (above) with the same netstat first. |
| **`expo run:android --device` matches Expo's own device names, not adb serials** — `--device adb-…_adb-tls-connect._tcp` and `--device SM-S936U1` both fail with *"Could not find device with name"*; the name that works for the S25+ is the underscore model form **`SM_S936U1`**. | Use `npx expo run:android --device SM_S936U1` (wireless adb must already be connected — mDNS: `adb mdns services`). Setting `ANDROID_SERIAL` alone does not help device selection. |
| **`expo run:android --device` leaves an arm64-only `app-debug.apk` that CRASHES the emulator on open** — building for the S25+ builds only that device's ABI (`arm64-v8a`), overwriting the universal debug APK. The x86_64 emulator still *installs* it (its abilist advertises arm64 translation) but SoLoader dies on launch with `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`, so "the app keeps closing" on the emulator after any phone-targeted build. Found 2026-08-18. | Rebuild multi-ABI before an emulator deploy: `cd apps/mobile/android && unset ANDROID_SDK_ROOT && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64` (gradle.properties' four-ABI default is overridden by expo's `-P` flag, not edited). Check with `aapt list …/app-debug.apk \| grep ^lib/`. A clean uninstall does NOT fix it — the APK itself lacks x86_64 libs. |
| **The AVD can come up with NO adb ports and never register** — `qemu-system-x86_64.exe` runs, the window paints, every startup check passes, and `adb devices` stays empty forever because 5554/5555 are never bound (`netstat -ano | grep 127.0.0.1:555` returns nothing). Seen 2026-08-23 after force-killing qemu mid-write; `-ports 5554,5555`, `-wipe-data` and a full adb kill-server/start-server cycle all failed to recover it, and the log stalls right after `Critical: Failed to load opengl32sw`. | Do NOT `taskkill //F` qemu — close the emulator window or `adb -s emulator-5554 emu kill`, which lets it flush. Once wedged, retrying the same launch is wasted time: the recovery is deleting `~/.android/avd/swingsage.avd/*.lock` and the corrupt `quickbootChoice.ini`, or recreating the AVD from `avdmanager`. The PHONE is unaffected and stays the faster route to an interactive check. |
| **`qstash.exe` can squat Metro's port 8081** — found 2026-08-13 bound to `127.0.0.1:8081` after Metro exited, so the dev client sat on "Loading from …:8081" forever and `curl 127.0.0.1:8081/status` answered 404 (`Cannot GET /`). Explained same day: the QStash dev server's **log server** listens on 8081 (main server 8080), and killing the `npx @upstash/qstash-cli dev` wrapper **orphans the `qstash.exe` child**, which keeps both ports. | Diagnose with `netstat -ano \| grep :8081` and `tasklist //FI "PID eq <pid>"` — if the listener is not `node`, Metro is not running no matter what the port probe says. Restarting Metro (`npx expo start --dev-client`) binds the wildcard address and coexists with the loopback-only squatter — but **coexistence only saves the LAN path, never the emulator**. A specific `127.0.0.1` bind beats a wildcard bind for loopback traffic, and the emulator reaches the host through loopback both ways (`adb reverse` → `localhost`, and `10.0.2.2`), so it keeps hitting QStash and shows a WHITE SCREEN. Confirmed 2026-08-18: `curl 127.0.0.1:8081/status` → 404 `Cannot GET /status` while `curl 10.0.1.107:8081/status` → 200 `packager-status:running`, same moment, same Metro. Fix without killing the queue — relaunch the dev client on the LAN URL: `adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "swingsage://expo-development-client/?url=http%3A%2F%2F10.0.1.107%3A8081"` (`MSYS_NO_PATHCONV=1` first, or Git Bash rewrites the path). After stopping the QStash dev server, `tasklist //FI "IMAGENAME eq qstash.exe"` and `taskkill //PID <pid> //F` the survivor — the wrapper's death does not take the child with it. |
| **The S25+ routes app traffic over LTE even while wifi is connected — it is NOT a VPN.** Wi-Fi stays associated (wireless adb keeps working at `10.0.1.123`) while `dumpsys connectivity` reports `Active default network` = `MOBILE[LTE]`, so the app's sockets leave over cellular with a CGNAT source address (`100.x.x.x`, the 100.64/10 carrier range) and cannot reach this PC at `10.0.1.107`. Misread as ProtonVPN on 2026-08-23 — the 100.x address looks like a VPN and is not. | Never diagnose this from the address. Read the default network: `adb -s <serial> shell dumpsys connectivity \| grep "Active default network"` and the matching `NetworkAgentInfo`. The fix is not to change networks — it is `adb reverse` + launching at `127.0.0.1`, which `dev-device.mjs` does, because that route is the debug transport and is indifferent to which interface owns the default route. |
| **A phone reconnect silently kills `adb reverse`, and the app then sits on its cached bundle** — wireless debugging picks a NEW port on every reconnect, and a reverse mapping belongs to the old connection. The dev client foregrounds, finds nothing at `127.0.0.1:8082`, and shows the last bundle it downloaded with no error anywhere. Reads exactly like "the app is running but none of my changes are in it" (2026-08-23). | Re-create it: `adb -s <serial> reverse tcp:8082 tcp:8082`, then force-stop and relaunch. `dev-device.mjs` now VERIFIES the mapping with `reverse --list` instead of trusting the command's exit code, so a re-run repairs it. Confirm the app really attached: `curl -s 127.0.0.1:8082/json/list` must list a `swingsage` runtime — an empty list means the bundle never ran. |
| **Metro moved to :8082, and one command now guarantees a device loads** — three unrelated faults produced the same white screen (a hung Metro that still accepts connections, a freshly `adb install`ed dev client with no server URL sitting on `DevLauncherActivity`, and the qstash squatter on loopback:8081). Diagnosing between them by hand cost time twice on 2026-08-18. | `pnpm --filter mobile phone` (add `:native` after a Kotlin/`app.json` change; `emu`/`emu:native` for the AVD). It health-checks Metro by the BODY of `/status`, restarts it if it listens without answering, optionally rebuilds multi-ABI and installs, launches the dev client at the LAN URL, and fails loudly if the app is still on `DevLauncherActivity`. Do not go back to raw `adb install` — that is the step that leaves the dev client with no server URL. |
| **The S25+ runs THREE-BUTTON navigation** (`adb shell settings get secure navigation_mode` → `0`; `2` is gesture) — so Android draws its own translucent **contrast scrim** behind the nav bar, which reads as "the app has a grey bar at the bottom" even though the theme sets `android:navigationBarColor` to transparent and the app is edge-to-edge. The desktop emulator defaults to gesture navigation and therefore never shows it, so this is invisible on the AVD. | `apps/mobile/plugins/withTransparentNavBar.js` sets `android:enforceNavigationBarContrast=false` (API 29+), which is the only switch for that scrim. It is native config: `npx expo prebuild -p android --clean` then `pnpm --filter mobile phone:native`. Under gesture navigation it changes nothing, because there is no scrim to remove. |

## Ports

| Port | What |
|---|---|
| 3000 | `pnpm dev` — Next, bound `0.0.0.0` so the phone can reach it |
| 5433 | local Postgres (`golf-postgres-1`), needs Docker Desktop |
| 8081 | **QStash's dev log server only.** Metro used to live here and the two collided permanently; SwingSage moved off it 2026-08-18. Nothing of ours binds 8081 any more — a listener here is the other project and is expected. |
| 8082 | **Metro** (SwingSage). `apps/mobile/scripts/dev-device.mjs` and `scripts/env-probe.mjs` both hardcode it; change it in both or the probe lies. |
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
| Org | `vercel_icfg_zFmUzg8N8tvg3nrzfsm3sOE5` ("taylorvowell's projects") — **a Vercel-managed org**, created through the Vercel Marketplace integration, not directly on supabase.com |
| Org plan | **Free.** Verified 2026-08-22: a new project in this org costs **$0/mo**. |
| Billing path | **Through Vercel, not Supabase.** A Vercel-managed org is upgraded from the Vercel dashboard's integration page — going to supabase.com billing is the wrong door. |
| Other projects in the org | `jars-application` (`mwicmqgvwcevoyoikunc`) + `jars-spac` (`ezwsyjvilpcxnantpujj`), both `INACTIVE`/paused, us-east-1, PG15 — a different product, **slated for deletion** (see `HANDOFF.md`; the MCP has no project-delete, so it is a dashboard action). **Paused projects do not count against Free's 2-active-project cap**, so `golf-swing` + `swingsage-prod` are the two active slots either way. The *preview* project is the third and is what forces Pro. |
| **Hosted schema LAGS local** | Hosted migrations stop at `0009a` (2026-08-20): 0010–0014 (queue runner/heartbeat, roles/profiles/goals, notifications, profile trim) exist only on the local Docker Postgres, which is the dev database of record. `golfer_profiles` does not exist hosted. Sync belongs to platform-foundation step 10. |

**Which auth providers are actually on** is a dashboard setting, so read it from the project rather
than from a doc:

```bash
curl -s https://xjcjqwcmwoouxczrrvar.supabase.co/auth/v1/settings \
     -H "apikey: sb_publishable_y76ZD3rEE38_yt-gW34Z6Q_aZ6a3d4q"
```

Re-verified **2026-08-22**: `google: true`, `email: true`, `phone: true`, `apple: false`, and
`sms_provider: "twilio_verify"` — Taylor wired **Twilio Verify** in the dashboard on 2026-08-22.
Read `sms_provider` together with `phone`: the field defaults to the string `twilio` even when
nothing is configured, so `twilio` + `phone: false` means *unset*, and only `twilio_verify` +
`phone: true` means live. `swingsage-prod` still reads the unset pair and needs the same setup.
**Twilio Verify, not Programmable SMS, is deliberate:** Twilio exempts verification-only traffic
from A2P 10DLC registration and includes Fraud Guard against SMS pumping, which is why the
registration hand-off closed as not-applicable. The trade is ~$0.058/verification vs ~$0.008 for a
raw SMS, and Twilio — not Supabase — owns the message body and code length, so there is no template
to edit on our side.

**A hosted project DOES have test phone numbers, and this doc said the opposite until 2026-08-22.**
Auth → Sign In / Providers → Phone → **Test OTP** maps a fixed number to a fixed code: Supabase
short-circuits both calls, so no SMS is sent, nothing is charged, and the code never expires.
Configured on `golf-swing` for Taylor's mobile (Taylor, 2026-08-22). The zero-cost development path
therefore needs no `supabase start` stack, which is what D31 assumed it required. **The number and
its code are deliberately not written here** — together they are a standing sign-in for that
project, and this file is committed. They live in the dashboard, and the number alone is in
`apps/web/.env` as `AUTH_ALLOWED_PHONES`, which is gitignored. There is no `supabase/` directory in
the repo yet; the CLI is installed (2.104.0).

## Supabase — project `swingsage-prod` (production)

Created 2026-08-22 via the MCP API, in the same Vercel-managed org as `golf-swing`. **$0/mo** —
this is the second active project on Free, and it is the production database.

| | |
|---|---|
| Ref | `nprxxjeavdlsqthnofof` |
| URL | `https://nprxxjeavdlsqthnofof.supabase.co` |
| Region | **`us-east-1`, chosen deliberately** — it is the same AWS region as Vercel's default function region `iad1`, so the API and the database co-locate with no `vercel.json` override. Do **not** "fix" this to match `golf-swing`'s `us-west-2`; dev-region parity buys nothing and cross-continent production round trips cost every request. |
| Publishable key | `sb_publishable_2xtD_fKXE5MnVw6t0OcO0w_UjNOOjFJ` — public by design |
| Secret key | Not readable over the API. Taylor pastes it into `production-credentials.local.txt`. |
| DB password | The **postgres** password is still not set to anything known (integration-injected into Vercel as `POSTGRES_*`, write-only). The **app role** `swingsage_app` has its own generated password — `PROD_APP_DATABASE_PASSWORD` in `production-credentials.local.txt` (2026-08-23). |
| Schema | **Migrated 2026-08-23** — all 19 drizzle migrations applied over the MCP, `drizzle.__drizzle_migrations` journal stamped to match local (so `db:migrate` no-ops), 13 tables = exact local parity, RLS forced everywhere, **0 security-advisor findings**. |
| **Pooler host is `aws-0-us-east-1.pooler.supabase.com`** | NOT `aws-1-…` — the region name alone does not determine the prefix, and the wrong host answers `tenant/user not found` for EVERY user, which reads exactly like a role problem. Probe with `postgres.<ref>` + a wrong password: "password authentication failed" = right host. |
| **Custom roles through the pooler need a SCRAM verifier** | Supavisor auth_query REFUSES md5 (`EAUTHQUERY: MD5 secrets are not supported`). Set the password as a locally-computed `SCRAM-SHA-256$...` verifier literal (never plaintext in a transcript, never md5). `APP_DATABASE_URL` = `postgresql://swingsage_app.nprxxjeavdlsqthnofof:<pw>@aws-0-us-east-1.pooler.supabase.com:5432/postgres` — proven: connects, `set local role authenticated` works, RLS answers. |
| Auth providers | None configured. **The deployed app's auth home is `golf-swing` for now** (deliberate interim, decisions register) — this project's auth hosts nothing until the cutover HANDOFF row is done. Google needs the web client pasted in the dashboard; the debug-keystore SHA-1 works for the dev-install APK. |

## Vercel

| | |
|---|---|
| Project | **`golf`** — `https://golf-pi-eight.vercel.app`, Node 24.x, GitHub-connected. Created 2026-08-22. |
| Team | **`taylorvowells-projects`** ("taylorvowell's projects") — the same account the Supabase org `vercel_icfg_zFmUzg8N8tvg3nrzfsm3sOE5` belongs to. |
| Env vars | **16 Supabase vars, injected by the Vercel↔Supabase integration** (connected 2026-08-22, Preview + Production, marked Sensitive so values are write-only): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_SECRET`, the three `NEXT_PUBLIC_SUPABASE_*`, and `POSTGRES_{URL,URL_NON_POOLING,PRISMA_URL,HOST,USER,PASSWORD,DATABASE}`. **`SUPABASE_SECRET_KEY` happens to match the name the code already uses.** Still absent and Claude's to add: `DATABASE_URL`, `APP_DATABASE_URL`, `SUPABASE_JWKS_URL`, `QSTASH_*`, `WORKER_*`, `REPLICATE_API_TOKEN`, `AUTH_ALLOWED_EMAILS`. |
| Preview shares the production DB | The integration was connected for **Production + Preview** with no Supabase branching (branching is Pro). A preview deploy therefore writes to `swingsage-prod`. Acceptable while there is no data; the fix is the third Supabase project, which is also the Pro trigger. |
| Plan | Hobby (free). Upgrade to Pro before the store listing goes live — see `decisions/platform-data.md`. |
| **CLI defaults to the WRONG team** | `vercel whoami` returns **`summittape`**, and a bare `vercel project ls` fetches from team **`summit-78555d07`** (`summittape`, `command-center`, `ridgelinewells`, `web` — a different business). SwingSage is invisible from that scope. **Every Vercel command must pass `--scope taylorvowells-projects`**, or be run after `vercel link` writes `.vercel/project.json`. A deploy run without it lands in the wrong account. |
| Repo link | **Linked 2026-08-22.** `.vercel/project.json` → `prj_NQzYmaeByZTGhUFiLQ49HQD2EskB` / `team_unoTKDmjIrRA4ZpSmd1G7z17`. Any Vercel command run from the repo root now resolves to `taylorvowells-projects/golf` with no `--scope` flag; the wrong-team trap above only bites outside this directory. Linking also wrote a root `.env.local` holding a `VERCEL_OIDC_TOKEN` — gitignored, and **not** the app's config, which stays in `apps/web/.env`. |
| **DEPLOYED 2026-08-23** | Production live at **`https://www.swingsage.io`** (alias; stable project URL `golf-pi-eight.vercel.app`). Root Directory `apps/web`, framework nextjs, Node 24, Fluid on. Env: 20 vars set by Claude (auth → `golf-swing` interim, data → `swingsage-prod` pooler, media → R2, queue → prod QStash + Modal, `JOBS_CLUB_VARIANTS=false`) + the 16 integration `POSTGRES_*`/`SUPABASE_*` leftovers (unused by the app except where overridden). CLI `whoami` is now **taylorvowell** (the summittape default has been fixed at some point — the old trap row above is stale for `vercel`, still true for `supabase`). |
| **Deploys are `node scripts/deploy-web.mjs` — NEVER a bare server-side build** | Vercel's Linux builders split this app past Hobby's 12-function cap; the CLI's local build bundles to ~6, so production is build-locally + `--prebuilt`, with the script repairing the Windows builder's five defects (backslashed symlinks, missing chunks/next-runtime/dep-packages in filesets, over-traced local files). RUNBOOK "The deployed web app". Retires when a Linux CI build lands. |

## Cloudflare — account `Taylorvowell@gmail.com's Account`

| | |
|---|---|
| Account ID | `29a846d28a4d7875137080db6e9a4680` |
| Domain | `swingsage.io`, with CNAMEs pointing at Vercel (Taylor, 2026-08-22) |
| R2 buckets | **Created 2026-08-22**, location hint `enam` to match `swingsage-prod` in us-east-1: `swing-source`, `swing-artifacts`, `swing-models` — the exact names in `apps/web/src/lib/media/keys.ts`. |
| **Two token tiers, and the difference bites** | An **Object Read & Write** R2 token is S3-only and bucket-scoped: it *cannot* `ListBuckets` or `CreateBucket` and returns `403 AccessDenied` on both. Bucket management needs **Admin Read & Write**. Both are in `production-credentials.local.txt` (`R2_TOKEN`/`R2_ACCESS_KEY_ID` object-tier, `R2_ADMIN_*` admin-tier). Use the object-tier keys for the app's runtime driver; the admin keys are provisioning-only. |
| **An empty zone list means nothing** | `GET /client/v4/zones` with **either** R2 token returns `success: true` with `[]`, because an R2-scoped token carries no `Zone:Read`. That is *not* evidence the domain is missing — it was read that way once. To actually inspect DNS, a token with `Zone:Read` is required, and none is issued (deliberately — nothing in the build needs DNS-edit rights). |
| R2 needs no DNS | Media is private buckets + short-lived signed URLs on `<account>.r2.cloudflarestorage.com`. A `media.` custom domain is a later CDN optimisation, never a prerequisite. |

## Upstash QStash

| | |
|---|---|
| **Region-specific endpoint — the default 404s** | `QSTASH_URL=https://qstash-us-east-1.upstash.io`. The documented default `https://qstash.upstash.io` resolves to **eu-central-1** and returns `404 user not found in this region` for this account. Always use the URL from the credentials sheet, never the default from the docs. |
| Verified | `GET {QSTASH_URL}/v2/schedules` → HTTP 200, 2026-08-22. Delivered a real job to the Modal worker end-to-end 2026-08-23. |
| CLI | `upstash` v0.3.0 is installed but **unauthenticated** (`upstash auth login`). Not required — the REST API works with the token. |

## Modal — the analyzer worker host (D64)

| | |
|---|---|
| Workspace / profile | `taylorvowell` (the CLI profile is correct — one of the two CLIs on this machine that is) |
| App | **`swingsage-analyzer`** — deployed 2026-08-23 from `services/analyzer/service/modal_app.py` |
| Endpoint | `https://taylorvowell--swingsage-ingress.modal.run` — `GET /healthz`, `POST /jobs` (QStash-signature-verified). The label is namespaced on purpose: a bare `label="ingress"` claims the workspace-global name `taylorvowell--ingress` |
| Secret | **`swingsage-analyzer`**, exactly 4 keys: `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `WORKER_PUBLIC_URL` (= the endpoint + `/jobs`, byte-exact), `SWINGSAGE_CLUB_WEIGHTS_URL` (signed URL from `models:publish`, 365-day TTL, minted 2026-08-23). `modal secret create --force` replaces the WHOLE secret — always re-supply all 4 |
| Volume | **`swingsage-models`** — manifest assets under `/mnt/models/app/{models,runs}` + `/mnt/models/rtmlib`, plus the bench fixture at `/mnt/models/fixtures/pro_2.mp4`. Symlinked to the real asset paths at container start because the `SWINGSAGE_MODEL_ROOT`/`SWINGSAGE_RTMLIB_CACHE` overrides relocate only fetch-and-check, not the pipeline's loaders — found the hard way 2026-08-23 |
| Runner | L4 GPU, 8 vCPU, 16 GB, `timeout=1800`, Modal retries ×2, `max_containers=4` (the spend guard), one job per container at a time |
| **CLI needs `PYTHONUTF8=1`** | Same cp1252 fault as `modal skills install` (machine-faults table): `modal deploy`/`run` die mid-output without it. Prefix every Modal command |
| Measured 2026-08-23 (pro_2, L4, CUDA-proven at 26.1 ms/frame pose) | variants-off **124.6s**; variants-on **676.6s** (the `variants` stage alone is 570s on Modal vCPUs). Capacity model in `docs/decisions/platform-data.md` |

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
- **RN 0.86.2's bundle download dies on Metro's multipart response — the dev client sits on
  "Loading from …" forever.** okhttp throws `ProtocolException: Expected leading [0-9a-fA-F]
  character but was 0xd` (visible only via `adb logcat --pid <pid>`; the screen just never
  loads). Content-dependent — the 2026-08-14 bundle downloaded fine, the 2026-08-18 one hit it
  every time, on two independent Metro instances and both network routes (LAN and `10.0.2.2`),
  so it is NOT the hung-Metro trap (whose `/status` check passes here too). Upstream closed it
  unfixed (facebook/react-native#56034). **The standing fix is `apps/mobile/metro.config.js`**,
  which strips `Accept: multipart/mixed` from bundle requests so Metro answers plain
  `Content-Length` (only cost: no download-progress percentage). **A Metro started before
  2026-08-18 predates that file — restart it or the client will hang.** Sibling fact: Metro
  actually binds `0.0.0.0:8081`; the loopback QStash squatter out-specifics it on `127.0.0.1`
  only, which is why the LAN URL works and `localhost` doesn't.
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
