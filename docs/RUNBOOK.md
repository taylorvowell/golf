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
.venv/Scripts/python.exe -m pytest tests

# web — from the repo root
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
```

There are **no web app tests yet**; a harness for both clients is spine step 02.

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

### Run it on the phone (2 minutes, works today)

```bash
# 1. On the phone: install "Expo Go" from the Play Store.
# 2. On the PC, from the repo root:
pnpm --filter mobile start
```

A QR code appears in the terminal. **Scan it with the Expo Go app** (not the camera app) — phone
and PC on the same wifi. The spike loads.

If the QR route fails, press `s` in the terminal to switch modes, or open Expo Go and type the
`exp://10.0.1.107:8081` URL shown. Same LAN caveat as the web app: the IP is DHCP, and Windows
Firewall may need to allow Node on private networks.

Useful terminal keys while it runs: `r` reload · `j` open debugger · `m` toggle dev menu.

### What you will see, and what it means

A **Device** card with platform, screen and a live UI frame rate. That number is JS-driven
`requestAnimationFrame` — **not** video or capture rate. It exists to prove the toolchain reaches
your phone from a Windows machine, nothing more.

Then three probe cards, all currently **NEEDS DEV BUILD**:

1. **Overlay locked to the presented frame** — the one that matters. The web player does this
   with `requestVideoFrameCallback`; iOS has a clean analogue and the Android equivalent is
   unconfirmed. If this fails on Android, D5 reopens and the framework choice changes.
2. **Frame-exact seeking.**
3. **Sustained 60 fps capture.**

They are blocked because **Expo Go cannot host native modules**, and all three need one. That is
expected at this stage, not a bug.

### Next: the development build

To actually measure the three probes, Android needs a **development build** (a real APK with the
native modules compiled in) instead of Expo Go:

```bash
pnpm --filter mobile exec expo install expo-dev-client
# then, once an Expo account + EAS is set up:
pnpm --filter mobile exec eas build --profile development --platform android
```

EAS builds in the cloud, which is what makes a **Windows machine viable** — there is no local
Android SDK requirement this way, and iOS is impossible locally at all (no Xcode on Windows,
D5/D12). The resulting APK installs directly on the phone.

### iOS

**No iOS device and no Mac**, so iOS is unbuildable locally under any framework — this is why
EAS is mandatory rather than convenient (D5, D12). It does not block progress: step 02 runs
**Android first**, because the unconfirmed risk sits on the device you already have. If Android
fails, iOS never needs measuring.

iOS is needed to *finish* step 02 and for step 10's TestFlight verification. Options: a borrowed
or second-hand device, or a cloud device farm for the measurement pass. The iOS simulator cannot
exercise camera capture and is not a substitute.

When it lands, the Android device above covers Android testing. **iOS has no device**, which
matters for two steps — but neither is blocked on it starting:

- **Step 02's spike** measures capture rate, dropped frames and seek accuracy on both an iPhone
  and a mid-range Android. It runs **Android first**: the per-frame overlay callback is confirmed
  on iOS and unconfirmed on Android, so the device already on hand carries the risk that could
  actually invalidate the framework choice. iOS is needed to finish the step, not to begin it.
- **Step 10** needs signed builds through TestFlight, verified on a real iOS device.

Options are a borrowed/second-hand iPhone, a cloud device farm for the measurement pass, or —
weakest — the iOS simulator, which cannot validate camera capture at all and so cannot answer
the spike's actual question.

Store developer accounts are **not** needed until around step 10; enrolling on day one only
starts Apple's annual $99 clock early. Begin enrolment around step 07 for buffer. The account
*type*, however, should be decided early: a **personal** Google Play account registered after
13 Nov 2023 must run a closed test with 12 testers opted in for 14 continuous days before it can
publish, while an **organization** account is exempt but needs D-U-N-S verification. See spine
step 10 for the full comparison.
