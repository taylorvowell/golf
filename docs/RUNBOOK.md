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
| Phone available for testing | **Android** — no iPhone on hand |
| LAN IP (DHCP, re-check after a router reboot) | `10.0.1.107` — `ipconfig \| grep IPv4` |
| Analyzer Python | `services/analyzer/.venv/Scripts/python.exe` — always this interpreter, never a global `python` |
| Postgres | Docker, port **5433** (not 5432) |

---

## 2. Web app — desktop

From the **repo root**:

```bash
docker compose up -d          # Postgres on :5433. Docker Desktop must be running.
pnpm i                        # installs every workspace package
pnpm --filter web db:migrate  # apply apps/web/drizzle/*.sql
pnpm --filter web db:seed     # create the one seeded user every swing is owned by
pnpm --filter web db:backfill # index every services/analyzer/out/<id>/ folder + sync scores
pnpm dev                      # http://127.0.0.1:3000
```

**Use `127.0.0.1`, not `localhost`** on this machine — `localhost` resolves to `::1` first and
the dev server answers on IPv4.

`db:backfill` is idempotent; re-run it any time. **A fixture analysed by hand from the CLI does
not touch Postgres at all**, so its score stays stale in the swing list until backfill runs.

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
narrative, compare two swings, place head markers, and trigger a re-analysis. It is a desktop-
first layout on a phone screen — the mobile client does not exist yet.

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
```

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
# analyzer — from services/analyzer, ~4s, no video/GPU/out/ needed
.venv/Scripts/python.exe -m pytest tests          # 80 passed, 2 skipped, 1 xfailed

# clients — from the repo root
pnpm --filter web test                            # vitest, 71 tests
pnpm --filter mobile test                         # jest-expo, 33 tests (logic + components)
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit

# web end-to-end — needs Docker Postgres up and at least one analysed swing
pnpm --filter web test:e2e                        # playwright, 1 path, headless
```

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
See `docs/DECISIONS.md` D21.

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
const { getByText } = await render(<ProbeCard probe={probe} />);
await fireEvent.press(getByText("Run probe"));
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

## 6. Mobile app — running the spike on your Android

`apps/mobile/` exists as of spine step 02: **Expo 57 / React Native 0.86 / React 19**, chosen in
`DECISIONS.md` D5. Right now it is a **spike harness, not the product** — three probe cards for
the questions that decide whether the framework choice holds.

### Which of the two ways to run it you need

| | Expo Go | Development build |
|---|---|---|
| Setup | install an app, scan a QR | one build, then same as Expo Go |
| Runs the UI | yes | yes |
| **Runs the probes** | **no** | **yes** |

Expo Go cannot host native modules, and all three probes are native-module questions. So Expo Go
is only useful for confirming the toolchain reaches the phone; **the measurements need a
development build.** After that build is installed once, the day-to-day loop is identical —
save a file, the phone reloads.

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

```bash
# phone on USB, USB debugging on, "Allow" the RSA prompt
adb devices                       # must list a device, not "unauthorized"

cd apps/mobile
npx expo run:android              # first build ~5-10 min; later ones are fast
```

That compiles the APK, installs it, and starts Metro. After the first install you can just run
`pnpm --filter mobile start` and open the app.

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

### What you will see, and what it means

A **Device** card, then a video panel playing `assets/frameclock.mp4` — a generated 600-frame,
exactly-60fps, GOP-10 clip with its own frame number burned into every frame, plus a green bar
that advances 1/599 of the width per frame. A **white marker drawn by JS** sits on top of it.

> **The white marker and the green bar should be exactly on top of each other.** Any visible gap
> between them *is* the overlay drift, readable by eye and on a screen recording. That is the
> phone-side equivalent of the analyzer's Gate 1 burn-in: the truth drawn onto the pixels it
> describes. Regenerate the clip with `node scripts/make-frame-clip.mjs`.

Then the three probe cards:

1. **Overlay locked to the presented frame** — the one that matters. Press *Run probe*: it plays
   for 5s and reports drift in frames (p50/p95/max) plus the share of frames exactly locked. The
   bar is **p95 = 0**, which is D13's stated criterion, not a rounding of "close enough".
2. **Frame-exact seeking** — seeks to 20 fixed targets chosen to sit on, just after, and just
   before a keyframe, since Android decodes-and-skips from the preceding sync point and a target
   just *before* one is the worst case. Bar is **max error = 0 frames**.
3. **Sustained 60fps capture** — still **NEEDS CAMERA**: no camera path is wired yet, and it is
   third because probes 1 and 2 carry the risk that could invalidate D5.

A probe cannot display PASS or FAIL without a measurement attached to it — that invariant is
enforced in `src/spike/probes.ts` and covered by the mobile test suite, because a card claiming
PASS with nothing behind it would quietly convert "untested" into "validated".

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
