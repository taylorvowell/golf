# Where the build is, and what to do next

Written 2026-08-11. Read this, then [`.claude/ROADMAP.md`](ROADMAP.md) for the macro picture and
[`docs/CURRENT-STATE.md`](../docs/CURRENT-STATE.md) for what actually exists.

## Spine track: `platform-foundation` — 7 of 10 steps complete

| Step | State | Notes |
|---|---|---|
| 01 Architecture Decisions | ✅ | |
| 02 Mobile Client Spike | ✅ | Every probe measured on a Galaxy S25+. D34–D40. **Harness deleted 2026-08-11 (D44)** — the modules survive, the instruments do not. |
| 03 Supabase Migration | ✅ | App connects as a non-superuser; RLS is real, not decorative (D42). |
| **04 Passwordless Auth** | 🔄 **← CURRENT** | Google native sign-in **verified on the phone** (D43). Blocked from closing by Apple ($99 + hardware), phone OTP (local Supabase stack), account deletion and identity linking. |
| 05 Roles/Onboarding/Profiles | ⬜ | Constrained by **D32** — one identity, onboarding forks, not auth. |
| 06 Swing/Session/Equipment | ✅ | A swing owns views; identity is a uuid (D30). |
| 07 API Contract + Shared Schema | ✅ | One schema generates both clients; `/api/v1/`; 426 upgrade path (D41). |
| 08 Entitlement Engine | ⬜ | |
| 09 Media Storage | ✅ | Media addressed by identity, not folder name (D33). |
| 10 Environments + Release | ⬜ | |

## What runs right now

Sign in with Google on the S25+ → **Your swings** → `No swings yet`. That is the whole mobile app,
and it is honest about being that. The web player at `127.0.0.1:3000` is still the only surface
that renders a swing.

## Next: 05 — Roles, Onboarding, and Profiles

04 cannot close without Apple hardware and a local Supabase stack, and neither blocks 05. 05 is
also the first step that needs a screen a golfer navigates *to*, which is the natural point to
stop placeholdering the mobile shell.

Before starting it, decide whether `mobile-app-shell` should take the spine flag: 05's onboarding
is mobile UI, and building it inside a single placeholder screen would build the navigation
problem twice.

## One thing waiting on Taylor

**The Android package is `com.swingsage.spike`** and should be `com.swingsage.app` — permanent
from the first store upload, and visible in the Play Store URL forever. It was not renamed with
the rest of the spike because Google binds an OAuth client to one *package + SHA-1* pair, so
renaming first breaks the sign-in verified hours earlier. Needs one Google Cloud Console visit to
add a second Android client (free, additive); the rename is a one-line change after that. D44.

## Traps worth re-reading before touching mobile

1. **Never port the web player's `(frame + 0.5) / fps` seek rule to Android.** media3 resolves
   seeks *forward* to the next boundary; HTML video seeks to the frame *containing* the time. The
   conventions are opposite and the web rule costs exactly one frame on every seek (D40).
2. **Do not "fix" the deprecated `createConstrainedHighSpeedCaptureSession` overload** in
   `modules/high-speed-camera`. The modern `SessionConfiguration` API is silently swallowed on
   this device — no callback, no error, no 240 fps.
3. **`modules/frame-clock` and `modules/high-speed-camera` have no consumer in the tree** since
   D44 and will read as dead code to any sweep. They are step 02's actual deliverable. Do not
   delete them.
4. **Metro must not be backgrounded with a shell `&`** in an interactive terminal — every instance
   started that way became a zombie whose socket stayed `LISTENING` while `127.0.0.1` returned
   `000`, which looks exactly like a firewall block.
5. **`pnpm install` fails with `ERR_PNPM_ENOENT` while Metro or `pnpm dev` is running** — they hold
   files in the hoisted tree. Stop both, install, restart. `pnpm install --force` repairs a tree
   left half-written by the failure.

## Running it again

```bash
docker compose up -d
pnpm --filter web db:migrate && pnpm --filter web db:backfill
pnpm dev                       # http://127.0.0.1:3000, or http://<LAN-IP>:3000 from the phone

cd apps/mobile && npx expo start          # keep it in the FOREGROUND
ANDROID_SDK_ROOT="C:\Users\taylo\AppData\Local\Android\Sdk" npx expo run:android   # native changes only
```

`ANDROID_SDK_ROOT` still needs overriding per-invocation until the Windows user variable is fixed
(its value contains its own name). See [`docs/RUNBOOK.md`](../docs/RUNBOOK.md) §6.

## Open items, named rather than buried

- **Scrubbing is unmeasured** on mobile, and the instrument assigned to measure it went with the
  spike (D44). Rebuilt against the real player in `mobile-player`, not resurrected.
- **231 fps against a requested 240** is 3.6% short — likely encoder ramp or the stop edge, not a
  rate cap. One look before `in-app-capture` relies on an exact rate.
- **iOS is entirely untested.** No Mac, no device. Android leads by D31's amendment.
- **Storage-level RLS is deferred** with D24's service-role scoping — the media driver holds a
  credential that bypasses `storage.objects`, so writing policies now would ship an inert boundary.
- **Buckets exist in one environment, not D10's three.** A preview Supabase project is free; the
  third needs Pro at $25/mo. Taylor's call.
- **`lib/jobs.ts` re-analyses without `--club-detector`** — a standing trap CLAUDE.md names by
  hand. Pre-existing, left alone by D30 because fixing it changes analyzer invocation.
- **The `DEV_USER_EMAIL` development identity and the seeded admin are still in the tree**, and
  own the ten local fixtures. D31 deletes them once phone sign-in works, not before.
