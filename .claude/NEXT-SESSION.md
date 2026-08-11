# Where the build is, and what to do next

Written 2026-08-11 to end a long session cleanly. Read this, then
[`.claude/ROADMAP.md`](ROADMAP.md) for the macro picture.

## Spine track: `platform-foundation` — 5 of 10 steps complete

| Step | State | Notes |
|---|---|---|
| 01 Architecture Decisions | ✅ | |
| **02 Mobile Client Spike** | ✅ **closed 2026-08-11** | Every probe measured on a Galaxy S25+. D34–D40. |
| 03 Supabase Migration | 🔄 | Schema + 11 RLS tests shipped. Open only because D10 wants a project *per environment* and one exists. |
| 04 Passwordless Auth | 🔄 | Email OTP works. Deferred by D27; provider set changed to phone/Google/Apple by **D31**. Known gap: RLS inert because the app connects as superuser (**D26**). |
| 05 Roles/Onboarding/Profiles | ⬜ | Constrained by **D32** — one identity, onboarding forks, not auth. |
| 06 Swing/Session/Equipment | ✅ | A swing owns views; identity is a uuid (D30). |
| **07 API Contract + Shared Schema** | ⬜ | **← NEXT** |
| 08 Entitlement Engine | ⬜ | |
| 09 Media Storage | ✅ | Media addressed by identity, not folder name (D33). |
| 10 Environments + Release | ⬜ | |

## Next step: 07 — API Contract and Shared Schema

**Why it is next, and why it is app work rather than web work.** A native app cannot be
force-updated. `analysis.json` is at `schema_version: 9` — nine contract changes that were free
because the web client shipped in the same commit; every one would have been an outage on a store
build. Step 07's own Verification runs `pnpm --filter mobile exec tsc --noEmit`, and it generates
the types `apps/mobile` will import. Step 02's progress note already says hand-writing those now
"would only create the duplicate that step deletes."

Two measurements from this session feed directly into it:

- **`analysis.json` is 2.8–13.7 MB.** Parsing is cheap (199 ms on device); **transfer is not**
  (2781 ms over LAN for 13.7 MB). Pose frames dominate. The API likely needs a lean per-view
  payload, and that is a schema decision to make *before* the schema is authored.
- **Supabase Free caps uploads at 50 MB/file**, below a 270–330 MB phone video. Relevant to
  `media-pipeline`, not 07, but it is the same class of constraint.

Start with: `/build` (the orchestrator resolves the spine track automatically).

## What was proven on the phone, and what must survive

Full detail in [`docs/CURRENT-STATE.md`](../docs/CURRENT-STATE.md) §11b. Headlines:

| | Result |
|---|---|
| Overlay locked to the presented frame | **99.2% exact**, ~49 ms draw budget |
| Frame-exact seeking | **100% exact** with target `frame / fps` |
| Seeking over HTTP | identical to bundled — network adds **zero** error |
| High-frame-rate capture | **1080p @ 231 fps** |

**Two modules are load-bearing and must NOT be deleted with the spike:**

- `apps/mobile/modules/frame-clock` — no Expo/RN video component surfaces a frame callback.
- `apps/mobile/modules/high-speed-camera` — Camera2 constrained high-speed, on the **deprecated**
  overload. "Fixing" that deprecation removes 240 fps with no error to explain it.

**Two traps worth re-reading before touching mobile video:**

1. **Never port the web player's `(frame + 0.5) / fps` seek rule to Android.** media3 resolves
   seeks *forward* to the next boundary; HTML video seeks to the frame *containing* the time. The
   conventions are opposite and the web rule costs exactly one frame on every seek (D40).
2. **A measurement harness that can fail silently is not a harness.** An async probe that threw
   with no `try`/`catch` left its button dead and nothing logged — indistinguishable from never
   having been tapped. It cost a round three separate times.

## Running it again

```bash
# web + db
docker compose up -d
pnpm --filter web db:migrate && pnpm --filter web db:backfill
pnpm dev                       # http://127.0.0.1:3000, or http://<LAN-IP>:3000 from the phone

# mobile spike (still installed as com.swingsage.spike)
cd apps/mobile && npx expo start          # keep it in the FOREGROUND — see below
ANDROID_SDK_ROOT="C:\Users\taylo\AppData\Local\Android\Sdk" npx expo run:android   # native changes only
node scripts/pull-probe-results.mjs       # read probe results out of logcat
```

**Metro must not be backgrounded with a shell `&`.** Every instance started that way became a
zombie — the socket stayed `LISTENING` while even `127.0.0.1` returned `000` — which looked exactly
like a firewall block and cost most of an afternoon. Run it in its own terminal.

`ANDROID_SDK_ROOT` still needs overriding per-invocation until the Windows user variable is fixed
(its value contains its own name). See [`docs/RUNBOOK.md`](../docs/RUNBOOK.md) §6.

## Open items, named rather than buried

- **Scrubbing is unmeasured** on mobile. Four instrument revisions could not measure it honestly;
  a seeked frame is displayed on arrival so there is no lead on that path. Reassigned to
  `apps/mobile/scripts/measure_overlay.py`, which compares the drawn marker and the burned-in bar
  inside one screenshot.
- **231 fps against a requested 240** is 3.6% short — likely encoder ramp or the stop edge, not a
  rate cap. One look before `in-app-capture` relies on an exact rate.
- **iOS is entirely untested.** No Mac, no device. Android leads by D31's amendment.
- **Storage-level RLS is deferred** with D24's service-role scoping — the media driver holds a
  credential that bypasses `storage.objects`, so writing policies now would ship an inert boundary.
- **Buckets exist in one environment, not D10's three.** A preview Supabase project is free; the
  third needs Pro at $25/mo. Taylor's call.
- **`lib/jobs.ts` re-analyses without `--club-detector`** — a standing trap CLAUDE.md names by
  hand. Pre-existing, left alone by D30 because fixing it changes analyzer invocation.

## The spike's own future

`apps/mobile/src/spike/` is one directory to delete when `mobile-app-shell` starts — `App.tsx` was
written for exactly that. Do **not** delete `modules/`. The probe screen now shows only unanswered
questions, and every settled one carries its verdict and decision number, so nothing is lost when
it goes.
