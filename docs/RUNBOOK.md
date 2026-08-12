# Runbook — running and testing SwingSage locally

How to actually start the thing, on a desktop and on a phone. Facts verified on
**2026-08-08**; where something is machine-specific it says so.

For what the system *is*, see [`CURRENT-STATE.md`](CURRENT-STATE.md). For what is being built
next, see [`../.claude/ROADMAP.md`](../.claude/ROADMAP.md).

---

## 1. Dev environment

| | |
|---|---|
| Primary machine | Windows 11, repo at `C:\Users\taylo\development\golf` |
| Phone available for testing | **Galaxy S25+** (`SM-S936U1`), Android 16, Snapdragon 8 Elite — no iPhone on hand. A flagship, which matters for the step 02 spike (§6) |
| LAN IP (DHCP, re-check after a router reboot) | `10.0.1.107` — `ipconfig \| grep IPv4` |
| Analyzer Python | `services/analyzer/.venv/Scripts/python.exe` — always this interpreter, never a global `python` |
| Postgres | Docker, port **5433** (not 5432) |

---

## 2. Web app — desktop

From the **repo root**:

```bash
docker compose up -d          # Postgres on :5433. Docker Desktop must be running.
pnpm i                        # installs every workspace package
pnpm --filter web db:migrate  # apply apps/web/drizzle/*.sql, then give the app's non-superuser
                              # role (swingsage_app) its password — both, in that order
pnpm --filter web db:seed     # create the one seeded user every swing is owned by
pnpm --filter web db:backfill # index every services/analyzer/out/<id>/ folder, PUBLISH its
                              # artifacts into the media store, and sync scores
pnpm dev                      # http://127.0.0.1:3000
```

**Two database URLs, and mixing them up is a security change, not a config typo.**
`DATABASE_URL` is the schema OWNER — migrations and the `db:*` scripts. `APP_DATABASE_URL` is what
the running app serves requests on: `swingsage_app`, a non-superuser with no `BYPASSRLS`, which is
what makes row-level security actually apply (D42). Both are in `.env.example`. There is no
fallback between them, and the app refuses to start if `APP_DATABASE_URL` turns out to be
privileged — so "it works but the boundary is gone" is not a reachable state.

If a fresh sign-in cannot see the ten development fixtures, they still belong to the pre-auth
`admin` row: `pnpm --filter web db:claim-fixtures you@example.com` moves them, once.

**Use `127.0.0.1`, not `localhost`** on this machine — `localhost` resolves to `::1` first and
the dev server answers on IPv4.

**`pnpm dev` run in the background reports a false failure.** The pnpm wrapper exits with code 1
while `next dev` keeps running, detached — so a task monitor says "failed" about a server that is
serving fine. Ask the port, never the exit code: `curl -s -o /dev/null -w "%{http_code}"
http://127.0.0.1:3000/api/v1/client`, or `netstat -ano | grep ":3000 "` for the surviving PID.
Starting a second one is what actually fails, with `Another next dev server is already running`
and the PID to `taskkill /PID <pid> /F` if you want it gone.

`db:backfill` is idempotent; re-run it any time. **A fixture analysed by hand from the CLI does
not touch Postgres at all**, so its score stays stale in the swing list until backfill runs.

**Since step 09 no route reads `services/analyzer/out/` directly.** Media is served through
`lib/media`, addressed by identity rather than by folder name (D33), and `db:backfill` is what
publishes a CLI-analysed fixture into the store. If a swing appears in the log but its video or
overlays are missing, that is almost always an unpublished fixture — re-run backfill.

The default driver is **local** and needs no credentials: it writes `.media/` at the repo root,
hard-linked from `services/analyzer/out`, so it costs essentially no disk. Delete `.media/` and
re-run backfill to rebuild it. To use Supabase Storage instead, run
`pnpm --filter web media:provision` once and set `MEDIA_DRIVER=supabase`. Cloud is never inferred
from the Supabase auth vars — see [`infra/storage/README.md`](../infra/storage/README.md).

---

## 3. Web app — on the Android phone

The dev server already binds every interface (`next dev -H 0.0.0.0`), and `next.config.ts`
enumerates this machine's own IPv4 addresses into `allowedDevOrigins` at startup. Nothing to
configure.

1. Phone and PC on the **same wifi**.
2. `pnpm dev` on the PC.
3. On the phone, open **`http://10.0.1.107:3000`**.

If the IP has changed, get the current one with `ipconfig` and use that — the allowlist is
computed dynamically, so a new address is picked up on the next `pnpm dev`.

**If the page renders but nothing moves — no skeleton, no trace, no working controls — that is
the Next 16 cross-origin block, not a bug in the player.** Next serves the server-rendered HTML
to any origin but drops `/_next/*` unless the origin is allowlisted, so the page hydrates into
nothing. Restart `pnpm dev` after an IP change; that is almost always the fix.

Windows Firewall may prompt on the first run — allow Node on private networks, or the phone
gets a connection timeout.

### What you can actually do on the phone today

Load a swing, scrub it frame by frame, toggle every overlay (skeleton, club, trace and its nine
smoothing variants, silhouette, isolation, butt line, angles), read the scorecard and coach
narrative, compare two swings, place head markers, and trigger a re-analysis. It is a desktop-first
layout on a phone screen.

**It is no longer the only way to watch a swing on the phone.** The native app (§6) plays one
frame-exactly as of `mobile-player` step 01 — verify it with §11. What the web player still has and
the native one does not is every **overlay**: skeleton, club, trace, silhouette, angles, the
scorecard and the coach narrative. Those are steps 02–03.

---

## 4. Analyzer

From `services/analyzer/`, always via the venv interpreter:

```bash
# analyse one clip — ALWAYS pass --club-detector on fixtures
.venv/Scripts/python.exe scripts/burnin.py ../../fixtures/swing2.mp4 \
    --club-detector runs/clubhead/weights/best.pt

# ~5.5 min per clip on this machine for a ~520-frame fixture.
# --out <dir> writes elsewhere, so you can compare against the stored artifact
# instead of overwriting it.

.venv/Scripts/python.exe scripts/rescore.py      # re-run ONLY scoring over every out/
.venv/Scripts/python.exe scripts/resegment.py    # add ONLY silhouette + butt line
.venv/Scripts/python.exe scripts/refilmstrip.py  # add ONLY filmstrip.jpg — the scrubber's picture
```

`burnin.py` writes `filmstrip.jpg` itself now, so `refilmstrip.py` is only for swings analysed
before it did. It reads pixels and `playback_window` and runs no stage, so unlike a re-run it
cannot damage a good club solve. Publish it with `pnpm --filter web db:backfill`.

**Omitting `--club-detector` silently regenerates the club trace on the weaker classical-only
path and overwrites the better artifact.** This has actually happened. Pass it on every fixture
re-run, whatever the reason for the run.

After a manual run: `pnpm --filter web db:backfill` from the repo root, or the swing list shows
a stale score.

### Looking at CV output rather than trusting numbers

```bash
.venv/Scripts/python.exe scripts/checkclub.py out/<stem>    # club over the real frame
.venv/Scripts/python.exe scripts/checktrace.py out/<stem>   # the drawn polyline specifically
.venv/Scripts/python.exe scripts/checkangles.py out/<stem>  # angle drawn vs value labelled
.venv/Scripts/python.exe scripts/clubdebug.py out/<stem>    # mask -> candidates -> shaft
```

Coverage percentages have overstated club quality three separate times. Run `checkclub.py` and
look at the frame before believing any club number.

---

## 5. Tests

```bash
# analyzer — from services/analyzer, ~5s, no video/GPU needed
.venv/Scripts/python.exe -m pytest tests          # 125 passed, 2 skipped, 1 xfailed

# clients — from the repo root
pnpm --filter web test                            # vitest, 167 tests
pnpm --filter mobile test                         # jest-expo, 83 tests (logic + components)
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit

# the account lifecycle, against the RUNNING system — needs `pnpm dev` up (§4.2 + §4.3)
pnpm --filter web verify:account                  # 7 checks; creates and deletes its own identity

# every swing's media, fetched over HTTP exactly as the phone fetches it
pnpm --filter web verify:media you@example.com    # thumb + video + analysis per swing, real session

# the shared contract — from the repo root
pnpm --filter @swingsage/schema test              # vitest, 100 tests
pnpm schema:check                                 # generated types match the schemas
pnpm schema:generate                              # rewrite them after a schema edit
pnpm --filter @swingsage/schema lock              # re-lock shape-lock.json, then FAILS on purpose

# web end-to-end — needs Docker Postgres up and at least one analysed swing
pnpm --filter web test:e2e                        # playwright, 1 path, headless
```

**Editing a contract is four steps, and CI fails if you skip one.** Edit
`packages/schema/schemas/*.schema.json`, run `pnpm schema:generate`, run `pnpm --filter
@swingsage/schema lock` and read the `shape-lock.json` diff, then commit all of it. The lock
command rewrites the file and then fails the run deliberately — the same idiom as
`pytest --update-golden` — because re-locking is the moment you decide a shape change is right.
A change that removes, retypes or newly requires a field is a break for a client already in
someone's hands; see D41.

**`pnpm --filter web test` now REQUIRES Postgres**, and needs BOTH database URLs set. Two suites
cover the authorization boundary and they answer different questions:

* `src/db/rls.test.ts` proves the **policies** are right — a golfer cannot read another golfer's
  swing, an approved coach can, a pending one cannot, a revoked one loses access immediately. It
  opens its own connection and impersonates `authenticated` by hand.
* `src/db/appBoundary.test.ts` proves the **product uses them**, through `withUser` and the app's
  own connection. That distinction is not academic: the first suite passed for the entire period
  in which the app bypassed every policy it was checking (D26), because the app connected as a
  superuser. Point `APP_DATABASE_URL` at an owner account and this suite fails immediately, naming
  the role.
* `src/db/accountDeletion.test.ts` proves §4.3 **actually deletes** — it counts every user-owned
  table before and after, so a table added later without a cascading foreign key fails the suite
  instead of quietly surviving a deletion.

**"The thumbnails are blank" has three unrelated causes and only one command separates them.**
The object may be missing, the route may be refusing the request, or the client may never have
asked properly. `pnpm --filter web verify:media <email>` answers the first two by fetching every
swing's `thumb`, `video` and `analysis` over HTTP with a real session — so all-`200` means the
remaining suspect is the client. When it *is* the client, note that a media route answering **404**
rather than 401 does not rule out authentication: an unauthenticated request is answered as the
`DEV_USER_EMAIL` identity, which owns nothing (D48).

**`pnpm --filter web verify:account` is a different kind of check and is not in the suite.** It
needs a real Supabase project and a running server, because what it exercises belongs to neither:
two concurrent sessions on one account (§4.2, the prerequisite for multi-phone capture), and the
admin-API call that erases an identity at the vendor (§4.3), which nothing else in the project
executes. It creates `session-probe@swingsage.invalid`, drives seven checks through the real HTTP
API, and deletes it again. Add that address to `AUTH_ALLOWED_EMAILS` if you set that variable —
otherwise every check 401s for allowlist reasons and reads as a session failure.

Both **fail rather than skip** without a database, deliberately: a security test that silently
skips still reports the suite green, which is worse than not having it. `docker compose up -d`
then `pnpm --filter web db:migrate`.

Those tests run against **local** Postgres, not the hosted Supabase project. Migration 0003
creates an `auth` shim and the `anon`/`authenticated`/`service_role` roles locally, and 0008 adds
`swingsage_app` and the grants Supabase already makes — each guarded so nothing is attempted where
the real ones exist. That is what lets the boundary be verified with no cloud credentials.

Web uses **Vitest**, mobile uses **jest-expo** — different runners because Expo's preset carries
the React Native transform, and fighting that into Vitest bought nothing.

The web tests deliberately assert **documented behaviour, not current coordinates**. That logic
is being re-expressed on mobile, and a snapshot of numbers would lock in one implementation;
behavioural assertions survive the port and become the oracle for the second one.

**The repo uses `node-linker=hoisted`** (root `.npmrc`), not pnpm's default symlinked layout.
React Native's Android build cannot use the symlinked one: `expo-modules-core` compiles C++
through CMake + ninja, which sees the same source through both its symlinked and its real
`.pnpm/…` path, decides the generated manifest is stale, regenerates, and dies on
`ninja: error: manifest 'build.ninja' still dirty after 100 tries`. The cost is that a hoisted
tree is npm-shaped, so pnpm no longer catches a package importing something it did not declare.
See `docs/decisions/` D21.

If you ever switch the linker back, **delete every `node_modules` first** — a leftover
`node_modules/.pnpm` keeps resolving and reproduces the exact failure you were trying to fix.

Two pnpm-specific gotchas already handled in `apps/mobile/package.json`, both of which produce
baffling errors if they regress:

- Expo's stock `transformIgnorePatterns` assumes a flat `node_modules`. pnpm nests packages
  under `node_modules/.pnpm/<name>@<ver>/node_modules/`, so React Native's ESM goes
  untransformed and every test dies on *"Cannot use import statement outside a module"*.
- `tsconfig.json` needs `types: ["jest"]`, or `tsc` fails on test files while `jest` itself
  passes — the kind of split where CI stays green and the editor lies.

**Component rendering on mobile now works** — it was previously recorded here as unusable, with
`render()` "returning an object with no query functions" across two dependency-pinning attempts.
That object was a **Promise**: `@testing-library/react-native` v14 made `render` and `fireEvent`
async. Destructuring a Promise succeeds and hands back `undefined` for every name, which is why
the symptom pointed nowhere near the cause. Component tests must therefore be `async`:

```tsx
const { getByText } = await render(<HomeScreen />);
await fireEvent.press(getByText("Try again"));
```

Two supporting details, both silent when wrong:

- v14 peer-depends on a package called **`test-renderer`**, *not* `react-test-renderer`. It was
  simply absent, and nothing warned.
- Take queries from `render()`'s return value rather than the exported `screen` singleton.
  jest-expo resolves the library's TypeScript `src/` via the `react-native` export condition while
  its `main` points at `dist/`, so `screen` can land in a different module instance than the
  `render` meant to populate it — and then insists `render` was never called.

**Playwright is the end-to-end path, and it is deliberately un-mocked.** It drives a real browser
against the real Next.js server, which reads Postgres and streams video off disk, so a pass means
the whole chain works and a failure can be any link in it. That is the trade it exists to make:
every other test in this repo stops at the edge of one layer, and the gaps *between* the layers —
a stale `analysis.json`, a media root pointing elsewhere, a swing row whose artifacts were never
backfilled — all produce a page that renders and a player that never shows a frame. None of those
are visible to a unit test. It asserts the video reaches `HAVE_METADATA` with real dimensions,
which is the first point at which the media route is proven to have served decodable video rather
than a 404 body.

It does **not** check that the overlay is drawn on the correct frame — that is Gate 3, needs pixel
comparison against the analyzer's burn-in, and belongs to `analysis-ground-truth`.

If `tsc` reports errors inside `.next/dev/types/` or `.next/types/`, those are stale generated
files, not real errors — `rm -rf apps/web/.next/dev/types apps/web/.next/types` and re-run.

`--update-golden` rewrites snapshots **and then fails the run on purpose**, so a golden update
is always two commands. Look at the diff before accepting it: a snapshot only proves nothing
*changed*, never that anything is *right*.

---

## 6. Mobile app — running it on your Android

### First: ask the DEVICE what is installed, never the repo

There are **two** SwingSage surfaces reachable from the phone — the web player over LAN (§3) and
the native dev build — and the repository cannot tell you which is installed or running. Answer
that from the device, in three commands:

```bash
adb devices -l                                   # wireless debugging shows up as adb-tls-connect
adb shell pm list packages | grep swingsage      # com.swingsage.spike = the native dev build
adb shell pidof com.swingsage.spike              # a pid means it is running right now
adb shell dumpsys power | grep mWakefulness      # "Dozing" = screen asleep, screenshots come back black
adb exec-out screencap -p > screen.png           # look at it rather than inferring
```

**This section exists because the question was once answered from `apps/mobile/`'s contents** —
"it's a spike harness, so there is no mobile app" — while a working dev build was installed and in
use on the S25+. The repo describes what the product *is*; only the device knows what is
*installed*. The `agent-device` and `dogfood` skills automate the rest of this loop.

`apps/mobile/` exists as of spine step 02: **Expo 57 / React Native 0.86 / React 19**, chosen in
`decisions/` D5. The step 02 spike harness that used to live behind sign-in is **deleted**
(D44) — its measurements are recorded in D34–D40 and the two native modules it justified survive
in `modules/`. What runs today is Google sign-in, a real **swing log** with thumbnails and scores,
a per-swing detail screen, and — since `mobile-player` step 01 — a **frame-exact player** on that
screen: video, scrub bar, play/pause, ±1 and ±10 frame steps, and a development-only frame-sync
panel. No overlays yet; those are step 02. Verifying the player is §11.

Navigation is React Navigation 7 native-stack, not Expo Router (D47). Two build faults that look
like something else: a native dependency failing with `ninja: error … Filename longer than 260
characters` is **ninja's own limit, not Windows'** (long paths are already enabled here), and
`pnpm add` failing with `ENOENT … _tmp_NNNNN` means **Metro is running** — stop it and the install
works first time. Both are in `ENVIRONMENT.md`.

### Which of the two ways to run it you need

| | Expo Go | Development build |
|---|---|---|
| Setup | install an app, scan a QR | one build, then same as Expo Go |
| Runs the UI | yes | yes |
| **Runs sign-in** | **no** | **yes** |
| **Hosts `modules/`** | **no** | **yes** |

Expo Go cannot host native modules, and Google Sign-In is one — so Expo Go is only useful for
confirming the toolchain reaches the phone; **anything past the sign-in screen needs a development
build.** After that build is installed once, the day-to-day loop is identical — save a file, the
phone reloads.

### Expo Go (2 minutes, no build)

```bash
# 1. On the phone: install "Expo Go" from the Play Store.
# 2. On the PC, from the repo root:
pnpm --filter mobile start
```

Scan the QR with the Expo Go app (not the camera app); phone and PC on the same wifi. If the QR
route fails, press `s` in the terminal to switch modes, or type the `exp://10.0.1.107:8081` URL
shown. The IP is DHCP, and Windows Firewall may need to allow Node on private networks.

Useful keys while it runs: `r` reload · `j` open debugger · `m` toggle dev menu.

### Development build — locally, no Expo account (the fast path)

**This machine already has everything needed**: Android SDK (platforms 33–35, build-tools
through 36, NDK), JDK 17 and `adb`. An Expo/EAS account is **not** required for Android — that
was recorded as a blocker in step 02's first pass and it was wrong.

**No cable required.** The device is a **Galaxy S25+ (Android 16, Snapdragon 8 Elite)**, and `adb pair` is
available here (adb 35.0.2). On the phone: *Developer options → Wireless debugging → on → Pair
device with pairing code*, then with phone and PC on the same wifi:

```bash
adb pair 10.0.1.NNN:PORT          # the PAIRING dialog's address + its 6-digit code
adb connect 10.0.1.NNN:PORT       # the OTHER port, on the main Wireless debugging screen
adb devices                       # must list a device, not "unauthorized"

cd apps/mobile
npx expo run:android              # first build ~5-10 min; later ones are fast
```

**Read both addresses off the phone** — they are the *phone's* address, not this PC's. This LAN
is `10.0.1.x` (the PC was `10.0.1.107` on 2026-08-10, DHCP — check with `ipconfig`), so anything
starting `192.168.` means you are reading the wrong number or are on the wrong network.

Those are two different **ports**, and mixing them up is the usual failure: the pairing dialog's
port is single-use and disappears when you close it, while the port on the main Wireless
debugging screen is the persistent one. Pairing survives reboots — normally you just re-run
`adb connect`.

USB works too (plug in, enable USB debugging, accept the RSA prompt) but is never *required*.

That compiles the APK, installs it, and starts Metro. **After the first install nothing needs a
cable or a rebuild**: `pnpm --filter mobile start`, edit a file, Metro pushes it over wifi and the
phone reloads. Only a change to a module's **native** code (`modules/*/android/**.kt`,
`modules/*/ios/**.swift`) needs `npx expo run:android` again — JS and TS changes never do.

**Two machine-level faults were found and fixed while getting this to build** — both were
pre-existing, both broke *every* Android build on this PC, and one is still only worked around:

1. **`ANDROID_SDK_ROOT` is malformed.** Its value is
   `ANDROID_SDK_ROOT=C:\Users\taylo\AppData\Local\Android\Sdk` — the variable name got included
   in its own value. Android Gradle Plugin prefers `ANDROID_SDK_ROOT` over the (correct)
   `ANDROID_HOME`, so it fails with the unhelpful *"The filename, directory name, or volume label
   syntax is incorrect"*.
   **Not yet fixed permanently** — it needs a change to your Windows user environment variables,
   which is yours to make:
   *Settings → System → About → Advanced system settings → Environment Variables → User
   variables → `ANDROID_SDK_ROOT` → set the value to exactly*
   `C:\Users\taylo\AppData\Local\Android\Sdk`.
   Until then, prefix builds with it:
   ```bash
   ANDROID_SDK_ROOT="C:\\Users\\taylo\\AppData\\Local\\Android\\Sdk" ./gradlew :app:assembleDebug
   ```
2. **NDK `27.1.12297006` was a broken partial install** — an empty directory containing only a
   `.installer` marker, dated May 2025. React Native 0.86 asks for that exact version by name, so
   the build died on *"did not have a source.properties file"*. The empty stub was deleted so
   Gradle re-downloads it properly. **Already fixed**, no action needed.

### The Android signing key — where it is, and what its fingerprint is for

Google OAuth binds an Android client to a **package name + signing SHA-1**, so this comes up any
time a native provider is wired. Two things are easy to get wrong:

* **The keystore is NOT `~/.android/debug.keystore`.** Expo's prebuild writes its own into the
  project, and that is what `expo run:android` and `gradlew assembleDebug` sign with. Nothing
  created the user-level one, so pointing `keytool` there fails with a file-not-found that reads
  like a `keytool` problem.
* **`keytool` ships with the JDK**, not the Android SDK. It is on PATH here via Eclipse Adoptium 17
  (`JAVA_HOME` is set), so the command works from any shell once the path is right.

```bash
cd apps/mobile
keytool -list -v -keystore android/app/debug.keystore \
        -alias androiddebugkey -storepass android -keypass android
```

| | |
|---|---|
| Package | `com.swingsage.spike` |
| Keystore | `apps/mobile/android/app/debug.keystore` — **generated, not committed** (`apps/mobile/.gitignore` ignores all of `/android`). Regenerating it reproduces the SAME fingerprint, because it is React Native's stock debug key rather than a random one. |
| SHA-1 | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |

**That SHA-1 is React Native's stock debug key and it is public** — the same fingerprint appears in
every React Native project on earth, and it is committed here. Anyone can sign an APK with it. For
a development-only OAuth client that is the normal trade; **it must never be the fingerprint on a
production client**, which uses the release key created at step 10. `build.gradle` currently signs
*release* with the debug config too, which is fine while nothing ships and is a step-10 fix.

Builds here are local, so this keystore really is the signing key. **An EAS build is signed by an
EAS-managed keystore with a different SHA-1** (`npx eas credentials` prints it), so switching build
routes means another OAuth client.

**Play App Signing does not apply yet, and its console page does not exist yet.** Google's OAuth
setup guide points at Play Console → Release → Setup → **App Integrity** for the SHA-1, and every
provider doc repeats it. That page only appears once an app has been created in Play Console and a
build uploaded; SwingSage has neither, so there is nothing there to read and nothing to configure.
It is a **step 10 / `launch-readiness`** concern, not a prerequisite for wiring a provider.

What it will mean when it does apply, so it is not rediscovered under submission pressure:

* **An Android OAuth client holds exactly ONE package + SHA-1 pair.** Supporting more than one
  certificate means more than one client, not more fingerprints on one client. Every client id
  then goes in Supabase's *Authorized Client IDs* list.
* **Play App Signing introduces a second key you do not hold.** You sign with an *upload* key;
  Google re-signs with an *app signing* key it holds, and that is the certificate the installed
  app actually carries — so it is Google's fingerprint, not the upload key's, that OAuth must
  trust. Registering only the upload key is the classic "works in debug, broken in production"
  sign-in failure.
* So the eventual set is: one client on the debug fingerprint above (development), and one on the
  Play app-signing fingerprint (production). The debug client must not be what production trusts —
  its key is public.

Sources: [Client authentication](https://developers.google.com/android/guides/client-auth),
[Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756).

### Development build — via EAS (cloud, needed for iOS)

`eas.json` is committed with `development` / `preview` / `production` profiles. This route needs
a free Expo account and an interactive login, so it cannot be set up unattended:

```bash
cd apps/mobile
npx eas login                     # you must do this part
npx eas build --profile development --platform android
```

It builds in the cloud and gives a QR to install the APK — no USB, no local toolchain. Slower per
build (~10-15 min) but it is the **only** route to iOS, since there is no Mac (D5/D12).

### Signing in on the phone (step 04, D43)

The app is behind sign-in. The first screen is **Sign in**, with a Google button; the home screen
is behind it.

**Before the first run**, `apps/mobile/.env` must carry four values — copy them from
`apps/mobile/.env.example`, which holds the real (public) ones for this project:

| | |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://xjcjqwcmwoouxczrrvar.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `EXPO_PUBLIC_API_BASE_URL` | **this PC's LAN address**, e.g. `http://10.0.1.107:3000` — never `localhost`, which on a phone means the phone |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | the **web** client id, not the Android one |

Expo inlines `EXPO_PUBLIC_*` at **build** time, so after editing `.env` restart the bundler
(`pnpm --filter mobile start --clear`). A value added while Metro is running does not reach the app.

Sign-in needs the **native** build (`npx expo run:android`), not Expo Go — Google Sign-In is a
native module. The `.env` values are read by JS, so changing one only needs a bundler restart; only
the first install after adding the module needs a rebuild.

**What proves it worked, in order:**

1. The **Sign in** screen appears — the gate is on.
2. Tapping *Sign in with Google* opens the account chooser **inside the app**, no browser.
3. The app swaps to **Your swings**, with an **account bar** at the top showing the Google address.
4. It reads **No swings yet** (or a count). That is the whole chain proven: Google → Supabase
   session → bearer token → `/api/v1/swings` → row-level security. A new account correctly has
   none — the fixtures belong to the development identity until
   `pnpm --filter web db:claim-fixtures <email>` moves them.
5. Force-stop and reopen the app: straight back to **Your swings**, no sign-in. That is §4.2's
   session-survives-restart requirement.
6. *Sign out* (top **left** — the dev-client bubble sits over the top right and swallows taps)
   returns to the sign-in screen, and tapping Google again offers the **chooser** rather than
   silently reusing the last account.

Anything other than a swing count is the home screen's diagnostic, and each means something
different. Note it never says "No swings yet" when it could not reach the server — the two are
deliberately separate states, because a network failure rendering as an empty log reads as lost
data:

| It says | What is actually wrong |
|---|---|
| `Cannot reach SwingSage` | `EXPO_PUBLIC_API_BASE_URL` is wrong or `pnpm dev` is not running. The phone must reach this PC — check `ipconfig`, and that Next is bound to `0.0.0.0` (see §3). |
| `Your session has expired` | A 401: the request arrived and was declined. Usually `AUTH_ALLOWED_EMAILS` in `apps/web/.env` not listing the Google address you signed in with. |
| `Google returned no ID token` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is the Android id, or the build's signing SHA-1 does not match the Android OAuth client. |
| `DEVELOPER_ERROR` from Google | Same fingerprint mismatch, reported by Google instead. Check the SHA-1 table above. |

**Two devices at once (§4.2, and §12 depends on it):** sign in on the phone, then sign in as the
same account in a desktop browser at `http://127.0.0.1:3000`. Both must stay signed in, and signing
out of one must not sign out the other — both paths use `scope: "local"` precisely for this.

### What you will see, and what it means

**Account bar** (sign out on the left, the signed-in Google address on the right), then **Your
swings** — a count, or `No swings yet`. That is the whole app today, and it is deliberately the
whole app: the swing log, the player and capture are the `mobile-player`, `mobile-app-shell` and
`in-app-capture` tracks.

The probe harness that used to sit here is gone (D44). If a measurement from it needs repeating,
it gets rebuilt against the real player rather than resurrected — the harness measured a
throwaway screen, and re-running it would prove things about code nobody ships. What survives:

| | |
|---|---|
| `modules/frame-clock` | Per-frame presented-frame callback. Neither platform's high-level API exposes one, and the whole overlay depends on it. Load-bearing for `mobile-player`. |
| `modules/high-speed-camera` | Camera2 constrained-high-speed session. 120/240fps is invisible to every higher-level API (D38). Load-bearing for `in-app-capture`. |
| D34–D40 | Every number the harness produced, with its method. |

> **The S25+ is a flagship, and the spike's numbers are flagship numbers.** Read them
> asymmetrically: a **failure** would have been decisive, but the passes do not generalize
> downward — a flagship has the headroom to absorb exactly the dropped frames a mid-range device
> would expose. A mid-range measurement is still outstanding and now belongs to `mobile-player`.

### iOS

**No iOS device and no Mac**, so iOS is unbuildable locally under any framework — this is why
EAS is mandatory rather than convenient (D5, D12). It does not block progress: step 02 runs
**Android first**, because the risk that could invalidate the framework choice sits on the device
you already have. If Android fails, iOS never needs measuring.

The iOS half of the native module (`AVPlayerItemVideoOutput` + `CADisplayLink`) is written and
committed, but **has never been compiled** — there is no Mac to compile it on. Treat it as
unverified source until an EAS build runs.

iOS is needed to *finish* step 02 and for step 10's TestFlight verification. Options: a borrowed
or second-hand device, or a cloud device farm for the measurement pass. The iOS simulator cannot
exercise camera capture and is not a substitute.

Store developer accounts are **not** needed until around step 10; enrolling on day one only
starts Apple's annual $99 clock early. Begin enrolment around step 07 for buffer. The account
*type*, however, should be decided early: a **personal** Google Play account registered after
13 Nov 2023 must run a closed test with 12 testers opted in for 14 continuous days before it can
publish, while an **organization** account is exempt but needs D-U-N-S verification. See spine
step 10 for the full comparison.

---

## 11. Verifying the player on the phone — the 30-second pass

The one part of `mobile-player` step 01 that automation cannot do. Everything up to this point is
already run and green: `tsc`, 83 jest tests, `verify:media`, the Gradle build, the install, and a
launch with a clean logcat.

**Before anything, uncover the phone.** If it is face-down or has something on it, the proximity
sensor raises Samsung's *Accidental touch protection* and **every** `adb shell input` event is
swallowed — taps report success and land nowhere. Check with:

```bash
adb shell dumpsys window | grep mCurrentFocus     # UnintentionalLcdOn = protection is up
```

There is no way to dismiss it over adb. See `ENVIRONMENT.md` → Machine-level faults.

Then, on the phone:

1. Open **SwingSage** → tap any swing (e.g. **6iron3**). The video appears with a scrub bar under
   it and the transport below that.
2. In the **Frame sync** panel at the bottom, tap **Run 250 seeks**. It seeks to 250 pseudo-random
   frames, waiting for each to reach the glass before asking for the next, and takes about 15–30
   seconds.
3. Read two lines:
   - **Seeks exact (JS)** — `250/250 · 100.0%` is the pass. This is the requested frame compared
     against the frame the native callback reported.
   - **Seeks exact (native)** — scored on the playback thread when the frame is decoded. It should
     agree with the line above; a divergence means the bridge is dropping or reordering events,
     which is why both are shown.
4. Tap **+1** and **−1** at both ends of the clip. One tap must move exactly one frame, and at
   frame 0 and the last frame the control must do nothing rather than wrap.
5. Drag the scrub bar quickly end to end. The picture should track the finger; **Drift** in the
   panel reads `0 — locked` when the presented frame equals the requested one.

Report the two exactness figures — they are the step's measurement and go into `CURRENT-STATE.md`
§11b, which currently records scrubbing as unmeasured.

```bash
# rebuild and reinstall after a NATIVE change (a JS change only needs Metro)
cd apps/mobile/android && unset ANDROID_SDK_ROOT && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -c && adb shell monkey -p com.swingsage.spike -c android.intent.category.LAUNCHER 1
adb logcat -d | grep -E "ReactNativeJS|has been rejected"    # empty is the pass
```

## 12. Verifying the OVERLAY — Gate 3, half of it here and half on the phone

Step 02 draws the skeleton, club, trace, orientation rods and angle arcs on the phone. "The stick
figure looks wrong" has two unrelated causes and this splits them, exactly as Gates 1 and 2 do:

### 12a. The geometry — on this machine, no phone needed

`scripts/checkoverlay.ts` imports the **same modules the phone runs** and lays their output over the
analyzer's own burn-in. Gate 1 drew frame N's pose onto frame N's pixels in the process that
computed them, so a disagreement here is a port bug in the client and nothing else.

```bash
pnpm exec tsx scripts/checkoverlay.ts services/analyzer/out/swing1
pnpm exec tsx scripts/checkoverlay.ts services/analyzer/out/swing1 150 --angles 3
for d in services/analyzer/out/*/; do pnpm exec tsx scripts/checkoverlay.ts "$d"; done
```

Writes `checkoverlay_<stem>.html` plus a PNG per frame into the same directory. Everything the
mobile renderer draws comes out as a **thin magenta hairline**; the burn-in underneath keeps its
green / yellow / cyan. A hairline running down the middle of a burn-in bone is the pass. A hairline
beside it is the bug. `--true-colour` switches to the real palette, `--stage PX` changes the width
the view count is costed at (default 360, a phone), `--angles N|all` adds angle arcs.

Corrections live in Postgres rather than in the artifact, so this script — which reads a directory —
cannot see them. Pass them: `--stages impact=143` re-cuts the boundaries the same way the phone does.

The per-frame line also prints the **view count** — the number of `View`s that frame costs on the
device, since every stroke is one — and how many angle fields drew versus abstained.

### 12b. The frame lock — only the phone can answer this

A JS change needs no rebuild: Metro is already serving it, so shake the device (or `adb shell input
keyevent 82`) → **Reload**.

The swing screen is full-bleed, so everything lives in panels that slide up over the picture — which
keeps playing behind them, so reading the instrument does not disturb what it is measuring. Swipe a
panel down to close it, up to make it taller; tapping outside or the Android back button also
closes it.

Two chips sit on the **right-hand side, just under the title**: **⧉** opens *Overlays* (the tiles
that turn each drawing on) and **▯▯** opens *Compare*. The frame-sync instrument is at the **bottom
of the Metrics panel** and is development-only — it is absent from a release build.

1. Open **SwingSage** → any swing. The skeleton and the club-head trace are on by default.
2. Tap **METRICS** in the dock and scroll to the bottom. Read **Overlay drift** —
   `100.0% locked · p95 0 · max 0` is the pass. It is scored natively, against the frame actually
   on the glass.
3. Read **Trace views** beside it. Close the panel, tap **⧉**, turn the **Club head trace** tile
   off, close, and read Overlay drift again. **The two drift figures, with the trace on and with it
   off, are the measurement** — they answer whether plain `View`s carry a hundred-plus-segment
   polyline at 60 fps, which is the one open question the overlay step owes a number for.
4. Tap **Run 250 seeks** with the trace ON. Seek exactness must still be `250/250 · 100.0%`.
5. Compare against `services/analyzer/out/<stem>/checkoverlay_<stem>_f<frame>.png` at the same
   frame — that is Gate 3 proper.
