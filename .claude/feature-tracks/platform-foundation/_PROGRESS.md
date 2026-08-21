# platform-foundation — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

Track goal: close the architecture questions `PROJECT_MAIN.md` §44 deliberately left open,
then build the platform every later track assumes — identity, the real data model, a versioned
API with a generated shared schema, the entitlement seam, media addressing, and a release
pipeline for all three artifacts.

**10 steps, and deliberately front-loaded.** This track delivers no user-visible value. It
exists because a native app cannot be force-updated, so API versioning, the shared contract,
and the entitlement seam get permanently more expensive after the first store release. See
`docs/decisions/` D3 for the review that shaped it.

**Starting position (2026-08-08):** a proof-of-concept analyzer + desktop web player running
against local Docker Postgres and a single seeded admin user, with media on local disk. See
[`docs/CURRENT-STATE.md`](../../../docs/CURRENT-STATE.md) for what that includes and
[`docs/PRODUCT-COVERAGE.md`](../../../docs/PRODUCT-COVERAGE.md) for the gap this track starts
closing.

---

## 05 - Roles, Onboarding, and Profiles — amendment 2: the six-answer profile
**Logged:** 2026-08-20 23:59 UTC
**Phase:** Platform Foundation
**Summary:** Final shape (Taylor): the profile asks exactly SIX things — handedness, swing style, handicap, age, driver speed, 7-iron carry — on one page, two columns. Goals left the profile entirely (the guidance features own them later): GoalPicker, the Goals screen/route, the golfer_goals table, its D54 cap trigger and the wire fields are all deleted, and migration 0015 dropped the eleven other columns (skill level, average score, injuries, practice access/frequency, rounds, height, years playing, working-with-coach, coaching style, feedback depth) plus the table. Onboarding is now role → handedness → style → handicap. profileFields.test.ts pins the six; profileRls.test.ts pins the table's exact columns and golfer_goals' absence. Gates: mobile tsc + 407 jest, web tsc/lint + 232 vitest, schema 100 vitest, migration applied locally.
**Notes:** Contract changes (removing the goal fields and the eleven properties) are still net-additive against the last commit — nothing shipped between, so no client ever saw them. The D54 curated-eight goal set remains a product decision for goal-progression; only its residence in the profile is gone.

---

## 05 - Roles, Onboarding, and Profiles — amendment: the 2026-08-20 profile trim
**Logged:** 2026-08-20 23:05 UTC
**Phase:** Platform Foundation
**Summary:** Taylor rejected both the full field set and the hub redesign: My profile is back to ONE page with two groups — The essentials (handedness, style, skill, handicap, goals, driver speed, 7-iron carry, average score) and More about you (height, age, years playing, injuries, practice access/frequency, rounds, coach status, coaching style, feedback depth). Thirteen §5.5 fields (both misses, shot shape, grip, fitting+year, launch monitor, climate, altitude, wingspan, wrist-to-floor, mobility screen, swing-change) were removed from the app, the API writable list, the shared contract AND the database in one change — migration 0014 drops the columns ('no tech debt'); all were hours old and NULL everywhere. profileFields.test.ts pins the cut list. Gates: mobile tsc + 411 jest, web tsc/lint + 235 vitest, schema 100 vitest, migration applied locally.
**Notes:** Found while applying: the HOSTED Supabase project stops at migration 0009a — 0010-0013 (queue runner/heartbeat, roles/profiles/goals, notifications) were only ever applied to the local Docker Postgres, so golfer_profiles does not exist hosted and 0014 had nothing to drop there. Recorded in ENVIRONMENT.md; syncing hosted belongs to step 10 (environments), not this trim.

---

## 05 - Roles, Onboarding, and Profiles
**Completed:** 2026-08-20 19:58 UTC
**Phase:** Platform Foundation
**Summary:** The mobile half lands and closes the step. Profile wire types joined the shared contract (api.schema.json definitions + generated types; shape-lock relocked, purely additive), and the app grew a profile data layer (useProfile — module cache, optimistic PATCH with revert-on-failure, cleared at the auth boundary), a field registry covering every §5.2/§5.4/§5.5 field in golfer language (a future field is one registry entry — tiles, editor and completeness all derive from it), the FieldEditorSheet (choice/number/multi/mobility), a ranked GoalPicker (rank = tap order, cap 3), the rebuilt GoalsScreen, MyProfileScreen behind the profile drawer's My profile row, and the onboarding sequence (role → handedness → style → goals → skill; handedness the only unskippable answer; every tap saves so the profile row is the draft; auto-opens once per launch while onboardingCompletedAt is null; debug-menu "Run onboarding" reruns it).
**Notes:** Same-session bonus scope (Taylor): left-handed mirroring — PoseOutline/posePlacement gained a mirrored mode, the alignment ghost, view switcher icons, dual-sync pip and "aim for this" reference all follow profile handedness, and the session screen swaps its control/sync rails so zoom + camera flip sit on the right edge for a lefty. Named shortfall: the enqueue-path handedness default has no seam yet (no client enqueue path exists — import door is session-mode step 06); it moves there rather than holding this step open. Gates: mobile tsc + 411 jest, web tsc/lint + 235 vitest, schema 100 vitest.

---

## 04 — Passwordless Authentication (in progress) — account lifecycle 2026-08-12

**Logged:** 2026-08-12 03:17 UTC
**Phase:** Platform Foundation
**Status:** step 04 stays `in-progress` — this entry records work inside it, not its completion.

**Summary:** §4.3 account deletion and §4.2 multi-device sessions are built and proved end to end
against the running system (D45). `DELETE /api/v1/account` sweeps object storage, cascades the
database from `public.users`, then erases the auth identity — **in that order, chosen by failure
mode**: media-first because bytes with no row cannot be enumerated afterwards, identity-last
because a failure there leaves someone who can sign in and ask again. D31's "every account carries
an email" invariant landed with it as `users.email NOT NULL` plus a matchable `SS_EMAIL_REQUIRED`,
deliberately *before* phone OTP — the provider that produces the case it guards.

**Notes:**

- **`app.delete_own_account()` takes no argument.** Identity comes from `auth.uid()` inside a
  SECURITY DEFINER function in a schema PostgREST does not serve — the same shape D42 established
  for `ensure_profile`. `users` has no DELETE policy and is not meant to get one: a request-role
  delete on that table has a blast radius of one entire person, so the safe version is the one
  where the target cannot be named. There is no parameter to validate.
- **One fenced admin call.** `lib/account/identity.ts` is the only module allowed to touch
  `auth.admin` — one function, client built inside it, never returned, no read path.
  `service-role.test.ts` now fails on a second call site and on any route importing the seam
  instead of the orchestration. The risk was never that file; it is `listUsers` / `getUserById`
  arriving later on a request path, which is D26 with different names.
- **Verified against the running system, not mocked:** `pnpm --filter web verify:account`, 7/7 —
  two sessions on one account served concurrently (200/200), a local sign-out leaving the other
  alive, a **global** sign-out demonstrably killing it (the failure that would silently break §12),
  `DELETE` returning 200, `getUserById` finding nothing, and a still-unexpired token answering 401.
  It is a script rather than a test because the admin API that erases an identity at the vendor is
  executed nowhere else — mocked, it would have shipped never having run.
- **Found while running it:** deleting a hosted auth identity does **not** remove its local
  `public.users` mirror (auth hosted, data local, no cascade across the gap). The next sign-in
  under that address mints a new id and hits the UNIQUE email — every call 500s and reads exactly
  like a broken session. D43's collision from the other direction; now in `ENVIRONMENT.md` with the
  one query that diagnoses it. The product path is immune *because* of the ordering above.
- **A real bug the test caught:** `pg_catalog.coalesce(...)` does not exist — `coalesce` is SQL
  grammar, not a schema-qualifiable function, exactly as migration 0008 records in its own comment.
  Under `search_path = ''` it fails at call time, not at create time, so `ensure_profile` would
  have raised "function does not exist" on every first sign-in. Migration 0009 carries the
  correction and both databases were re-applied.
- **Mobile:** a delete-account screen that lists the six consequences *before* the control (§34 is
  informed consent, not a warning after the decision) and confirms by typed word rather than a
  second tap — the only irreversible action in the product, and a double-tap would cost a golfer
  every swing they own. Reached from a quiet footer link; `mobile-app-shell` owns the settings
  surface, so inventing one here would be the second one when that track ships.
- **Not verified on the device's screen.** The bundle Metro serves contains every string of the
  new screen, but the phone was in its owner's hands. One relaunch is all it needs.
- **Still open, and blocking step 04:** phone OTP (needs a local `supabase start` stack; there is
  still no `supabase/` directory), identity linking (needs a second provider to link *to*), Apple,
  real SMS, the `com.swingsage.spike` rename, and deleting `DEV_USER_EMAIL`.

---

## 04 — Passwordless Authentication (in progress) — spike harness removed 2026-08-12

**Logged:** 2026-08-12 00:44 UTC
**Phase:** Platform Foundation
**Status:** step 04 stays `in-progress` — this entry records work inside it, not its completion.

**Summary:** Google sign-in was verified on the S25+, and the screen behind it was the step 02
probe harness. Deleted it (D44): `src/spike/` (11 files, ~2,100 lines), all six probe scripts in
`apps/mobile/scripts/`, the 729 KB synthetic ground-truth clip and two generated 8 MB fixtures,
the developer-facing `ServerCheck` card, the `expo-asset` dependency and the orphaned `:8790`
fixture server. Replaced by `src/screens/HomeScreen.tsx` — a placeholder that is nonetheless a
product surface, and which keeps the harness's one load-bearing property: a request that never
reached the server renders as "Cannot reach SwingSage", never as "No swings yet".

**Notes:**

- **Kept deliberately:** `modules/frame-clock` and `modules/high-speed-camera`. They were the
  spike's actual deliverable and are load-bearing for `mobile-player` and `in-app-capture`. They
  now have **no consumer in the tree** and will read as dead code to any sweep.
- **A named cost:** `measure_overlay.py` was the instrument assigned to close step 02's one open
  measurement — scrubbing. It is gone, scrubbing stays unmeasured, and that is recorded in
  `CURRENT-STATE.md` §11b as `mobile-player`'s problem rather than quietly closed.
- The palette moved out of the spike into `src/theme.ts`; four screens had been hardcoding the
  same ten hex values because the canonical copy lived in a directory the plan called throwaway.
- `src/app/` was renamed `src/screens/` mid-run — Expo's CLI reported "Using src/app as the root
  directory for Expo Router", and installing `expo-router` later would have silently reinterpreted
  the entry point. `mobile-app-shell`'s `owns` path in `ROADMAP.json` moved with it.
- **Verified:** web tsc/lint clean, 157 vitest, mobile tsc clean, 34 jest, Android
  `assembleDebug` BUILD SUCCESSFUL and installed on the S25+, and the served Android bundle
  contains the new home screen with **zero** occurrences of any spike string.
- **Not verified on the device's screen** — the phone was in use. One relaunch is all it needs.
- **Still open, and blocking step 04:** the package is still `com.swingsage.spike` (needs one
  Google Cloud Console visit before renaming, D44), phone OTP, Apple, account deletion, identity
  linking, and deleting the `DEV_USER_EMAIL` identity.

---

## 03 — Supabase Project and Data Platform Migration ✅ 2026-08-11

**Completed:** 2026-08-11 16:45 UTC
**Phase:** Platform Foundation

**The policies were right the whole time. The product was not using them.** D24 shipped RLS on
eight tables, forced, sixteen policies, coach access tested five phases early. D26 then found the
app connected as `swingsage` — a superuser — and would have connected on Supabase as `postgres`,
which is not a superuser but carries `BYPASSRLS`. Both are exempt from `FORCE ROW LEVEL SECURITY`,
`auth.uid()` was NULL because nothing set the claims, and `rls.test.ts` passed throughout because
it impersonates `authenticated` by hand. Decision **D42** closes it.

**Four changes, and none of them works alone:**

| | |
|---|---|
| `swingsage_app` | Login role, **NOINHERIT**, no superuser, no `BYPASSRLS`, member of `anon`/`authenticated` and **not** `service_role`. Holds membership without privileges, so a query outside the seam reads *nothing* rather than everything. |
| `withUser(userId, fn)` | The only way the app reaches Postgres. Transaction → `request.jwt.claims` → `set local role authenticated` → both revert on commit, so a pooled connection cannot carry one request's identity into the next. |
| The ambient `db` export | **Deleted.** `src/db/client.ts` no longer exists; `views`/`scores`/`stages`/`markers`/`jobs`/`swings` take the transaction as their first argument. There is nowhere else to run a query. |
| `withOwner(reason, fn)` | The privileged counterpart, and it **throws at import if `NEXT_RUNTIME` is set** — a route that imports it fails to build. Four call sites, all CLI. |

**The startup assertion is what makes a misconfiguration loud rather than invisible.** Pointing
`APP_DATABASE_URL` at the owner would restore the entire defect with every test still green, so
`withUser` checks four properties against the live connection before serving: not superuser, not
`BYPASSRLS`, member of `authenticated`, **not** member of `service_role`. Verified by doing exactly
that — 11 of 12 boundary tests fail with the offending role named. There is no fallback from
`APP_DATABASE_URL` to `DATABASE_URL`.

**`app.ensure_profile()` removes the last elevated write from a request path**, and its schema was
a real finding rather than a detail. In `public` it is a PostgREST endpoint, and Supabase's own
default privileges grant EXECUTE on new public functions **directly to `anon`** — which
`revoke … from public` does not undo. The advisor flagged it as externally facing. It now lives in
an `app` schema PostgREST does not serve: unreachable by construction, not by a grant that has to
stay right. Advisors back to **zero findings**.

**Three things this turned up on the way:**
- **The hosted project was three migrations behind and nothing said so.** 0005, 0006 and 0007 had
  only ever run against local Docker Postgres — eight tables hosted, ten locally. All applied; both
  now agree. A standing hazard while migrations reach production by hand.
- **The local shim diverged from Supabase invisibly.** `authenticated` had no USAGE on the local
  `auth` schema, and it did not matter because a policy expression is parsed when *created*, as the
  owner. The first line of app code to ask "who am I" failed locally and would have worked hosted.
- **Point-in-time grants**, twice already (0003, then 0006 repairing 0005). Now `alter default
  privileges`, so the next table is covered by a rule instead of by remembering.

Also: `claimLegacyFixtures` left the request path for `pnpm --filter web db:claim-fixtures <email>`
(it was a privilege grant racing whoever signed in first, on a LAN-reachable server);
re-analysis is owner-only with a 403 rather than a coach-triggered 500; and `ownedView(access)`
fixes storage addressing keyed off the caller instead of the owner.

Oracles: web tsc/lint clean, **149 vitest** (14 new), Playwright green, mobile tsc clean, **100
schema vitest**, analyzer **123 pytest**. Every route re-checked against the running server —
analysis/markers/stages/thumb/silhouette 200, video 206 to a Range request, unversioned 404, a
stage write and clear round-tripping through RLS, and `pg_stat_activity` confirming the server
connects as `swingsage_app`.

**Carried forward deliberately, not forgotten:** one Supabase project rather than three (D10 —
money, and it is step 10's work), and the analyzer's service role is still unscoped to specific
tables because what it needs is defined by the `analyzer-service` track. The hosted `swingsage_app`
has no password yet; setting one belongs with the secret manager step 10 builds.

Next: **04 — Passwordless Authentication** (in-progress; `DEV_USER_EMAIL` is still the identity
in local dev and is deleted, not disabled, when 04 closes).

---

## 07 — API Contract and Shared Schema ✅ 2026-08-11

**Completed:** 2026-08-11 14:45 UTC
**Phase:** Platform Foundation

**One fact drives all of this: a native app cannot be force-updated.** `analysis.json` is at
`schema_version: 9` — nine contract changes, every one free because the client that read it shipped
in the same commit. That stops being true at the first store release. Decision **D41**.

**One schema, generated types, no hand-written duplicates.** `packages/schema/schemas/` now holds
JSON Schema for `analysis.json`, `coach_report.json`, `silhouette.json` and every API body;
`src/generated/` is compiled from it and both clients import it. `apps/web`'s ~300-line
`Analysis` / `Scorecard` block is **deleted, not kept alongside** — 16 files repointed at
`@swingsage/schema/contract`, a validator-free entry point so no phone bundles Ajv.

**The producer validates before writing, against the same files.** `swingsage/contract.py` — not a
copy of the schemas, because a copy is a thing that can drift. `burnin.py`, `rescore.py` and
`resegment.py` all write through it, and a failing artifact never reaches disk (no file, no
`.tmp` left behind). Proven on a real fixture: a club head mutated from `[x, y]` to `[x, y, 0.5]` —
a shape change that still looks like data, and would have rendered the club in the wrong place on
every shipped build — is rejected as `/club/frames/0/head Additional items are not allowed`.

**The additive-only rule is now a test, not a convention.** `schemas/shape-lock.json` is the
committed signature of all four contracts (526 nodes). A node that is removed, retyped, re-`$ref`ed,
newly required, or that drops an enum member fails the suite; additions pass and are re-locked
deliberately with `pnpm --filter @swingsage/schema lock`, which rewrites the file and then **fails
the run on purpose** — the same idiom as `pytest --update-golden`. This project's own history is
that conventions about the contract held only once a test enforced them.

**`required` describes every artifact ever stored, not today's pipeline.** That distinction did the
real work: `checkpoints` (schema 3), `playback_window` (5), `posture` (8) and `playback_pad` (9)
stay optional, and tightening the rest surfaced **~96 places in the player that assumed a block an
older artifact may not carry**. Those are now optional chains. That is what "a schema-3 artifact
still renders" actually costs, and the compiler found it rather than a user.

**Everything is versioned in the path.** Every route moved to `/api/v1/`; `route-auth.test.ts` now
also fails on anything unversioned and on any undocumented public route. Added `GET /api/v1/client`
— the one deliberately unauthenticated route, because a build too old to sign in must still be able
to learn that it is too old. A build below the floor gets **426** with an `UpgradeRequired` body,
gated once in `proxy.ts` rather than per route, and **fails open for a caller with no version
header** so the web app cannot 426 itself off its own API. Mobile renders it as a terminal screen
with a store link — no retry, no dismiss.

**Verified against the running server, not just compiled:** `/api/v1/client` → 200 with the version
floor and artifact-schema range; `/api/v1/swings` with `x-swingsage-client-version: 0.0.1` → **426**
with the Play Store link; the same route with no header → 200; `/api/swings` → **404**; and
`analysis`, `markers`, `stages`, `thumb` all 200 with `video` still answering **206** to a Range
request. Playwright green.

**First `.github/workflows/` in the repo.** Four jobs: the contract gate (drift check, then
regenerate-and-`git diff --exit-code`, then the contract tests), both clients, and the analyzer's
contract tests. It deliberately does not install the CV stack — gigabytes, GPU-shaped, and its
tests need gitignored fixtures. A `.gitattributes` pins the generated files to LF so a Windows
commit cannot fail the byte-comparison for a reason unrelated to the schema.

Oracles: web tsc/lint clean, **135 vitest** (14 new), mobile tsc clean + **66 jest** (12 new),
**100 schema vitest**, analyzer **123 pytest** (43 new), Playwright green, drift check clean twice
in a row.

**Two findings worth carrying forward.** A `T | null` field is an `anyOf`, so `jsonschema` reports a
bad value inside `T` at the *parent* with the whole parent as the instance — the first broken-artifact
run produced a **1.4 MB error message**, which is strictly worse than none because it buries the one
line that says what broke. `contract.errors()` now descends to the deepest sub-error and truncates,
and a test asserts the message stays under 400 characters and names the field. And `pnpm install`
died three times on Windows with `ENOENT … @expo/cli_tmp_NNNN`; `rm -rf node_modules/@expo/cli`
then re-installing cleared it. The dev server also holds `src/app/api/` open, so a route directory
cannot be `git mv`d while it runs.

**Open against the DoD:** nothing. The deprecation window (12 months, announced three ways) is
written but untested — there is only one API version, so `DEPRECATED_API_VERSIONS` is empty and the
`Deprecation` / `Sunset` header path has no live case yet.

Next: **03 — Supabase Project and Data Platform Migration** (still in-progress from an earlier run).

---

## 02 — Mobile Client Spike and Workspace ✅ 2026-08-11

**Every probe is measured, on real hardware, from decoded artifacts rather than API self-reports.**
Galaxy S25+ (SM-S936U1, Android 36), driven over wireless debugging. Decisions **D34–D40**; the
standing summary is `docs/CURRENT-STATE.md` §11b.

| | Result |
|---|---|
| Overlay locked to the presented frame | **99.2% exact** (n=250), ~49 ms of lead to draw in |
| Frame-exact seeking | **100% exact** once the target became `frame / fps` |
| Seeking over HTTP | **identical to bundled** — the network adds zero error |
| True high-frame-rate capture | **1080p @ 231 fps** |
| Sustained 60 fps capture | 59.5–60.0 fps |
| `analysis.json` parse on device | 13.7 MB in **199 ms** |

**D5's Expo/React Native choice is confirmed on Android.** React is not the overlay bottleneck —
removing it entirely scored no better (99.0% vs 99.2%) — and plain rotated `View`s were fast
enough, so the Skia retest `Skeleton.tsx` warned about is **cancelled rather than deferred**.

**The single most valuable finding is a convention inversion.** media3 resolves a seek FORWARD to
the next frame boundary, so the web player's `(frame + 0.5) / fps` lands on N+1 — 0% exact,
measured. HTML video seeks to the frame *containing* a time; the conventions are opposite. Porting
the web rule to Android silently costs a frame on every seek, and it did. Now a standing warning.

**Two modules must survive the spike's deletion**, and this is written into §11b so it is not lost:
`modules/frame-clock` (no Expo/RN video component surfaces a frame callback) and
`modules/high-speed-camera` (Camera2 constrained high-speed, on the **deprecated** overload — the
modern `SessionConfiguration(SESSION_HIGH_SPEED, …)` is silently swallowed on this device).

**Three libraries were tried for high-speed capture and two lied or refused.** `vision-camera` v5
accepted 240 and delivered 60 without an error; CameraX 1.5 refused honestly, because it gates on a
`CamcorderProfile` this device leaves empty; only Camera2 reads the configuration map the sensor
actually publishes. Both losing paths were removed, with their reasons recorded so they are not
re-attempted.

**The process finding worth carrying forward:** an async probe that throws with no `try`/`catch`
leaves its button dead and nothing logged — indistinguishable from never having been tapped. That
cost a round three separate times. Every probe now reports its own failure and the native side has
a watchdog. A measurement harness that can fail silently is not a harness.

**Open, and named rather than buried:** scrubbing is unmeasured after four instrument revisions
(a seeked frame is displayed on arrival, so there is no lead on that path — reassigned to
`scripts/measure_overlay.py`); 231 fps against a requested 240 is 3.6% short, likely encoder ramp;
iOS is entirely untested with no Mac and no device, which D31's amendment makes non-gating.

Oracles: mobile tsc clean, 54 tests, web tsc/lint clean, 121 vitest, analyzer pytest green.

Next: **07 — API Contract and Shared Schema**.

---

## 09 — Media Storage and Artifact Addressing ✅ 2026-08-11

**Media is no longer bolted to this laptop.** `SWINGSAGE_MEDIA_ROOT` was the single hardest blocker
to the analyzer running anywhere else; it now names only the analyzer's working directory, and no
route reads the filesystem for media at all. Decisions in **D33**.

**The plan said rewrite `media_key` into a storage prefix. The better answer was not to store one.**
A key is derived from identity the database already owns — `u/<userId>/s/<swingId>/v/<viewId>/r<n>/`
— so it cannot drift from what it encodes, needs no backfill, and makes "is this artifact where it
should be" a pure function. That leaves `media_key` holding its one real meaning: the analyzer's
folder name. Conflating those two is what made the media unmovable to begin with.

**Three properties are load-bearing, and each is a test.** The owner leads the key, so a storage
policy can express ownership at all (`storage.foldername(name)[2] = auth.uid()`). The revision
separates analysis runs, because object storage has no rename-into-place — a re-analysis writes
`r<n+1>` and only *then* does the row point at it, so a golfer mid-scrub finishes on what they
started with. And the source sits outside the revision, since re-analysis produces new artifacts
from the same upload.

**The analyzer was not touched — publishing is a separate act.** `burnin.py` still writes
`out/<stem>/`; `lib/media/publish.ts` copies that into the store. That satisfies "change where
artifacts land, not what the analyzer produces" more literally than editing the analyzer would have,
keeps the credential-free CLI loop the pipeline's development depends on, and makes the
`analyzer-service` track a deployment rather than a redesign. **Zero diff under `services/analyzer`.**

**Verified over the real network path, not just compiled.** Both buckets are live in `golf-swing`,
private, with source and artifacts split because D29 expires one and not the other. 11 artifacts
published in 6.1s, `analysis.json` read back, and a signed URL answered `Range: bytes=1000-2999`
with **206 `bytes 1000-2999/5496355`** — frame-accurate scrubbing survives the CDN path, which is
the one property this step could not afford to get wrong. Locally the driver hard-links from the
analyzer's output, so publishing all ten fixtures (104 artifacts) cost ~0 extra disk.

Oracles: web tsc/lint clean, **121 vitest** (18 new), Playwright e2e green, analyzer pytest green,
`db:migrate` idempotent.

**Two findings worth carrying forward.** The Free plan caps uploads at **50 MB per file**, below a
270–330 MB phone video — so `media-pipeline`'s on-device compression is a *fit* requirement, not a
bandwidth optimization, and the provisioning script now says `CAPPED BY PLAN` rather than silently
accepting a default that would fail first on a real golfer's upload. And **storage-level RLS is
deliberately not shipped**: the driver bypasses `storage.objects`, so writing policies now would
ship a second inert boundary — the exact mistake D26 and D30's `clubs` grant each cost a debugging
session. It lands with D24's service-role scoping.

**Open against the DoD:** buckets exist in one environment, not the three D10 wants. A preview
project is free; the third needs Pro at $25/mo. Recorded as a deviation, not a decision.

Next: **07 — API Contract and Shared Schema**.

---

## 06 — Swing, Session, and Equipment Model ✅ 2026-08-11

**A swing is no longer a video.** It is a shot that owns one or more **views**, each with its own
clip, its own `analysis.json` and its own score — §7.1, and the thing four later tracks
(`mobile-player`, `swing-ingest`, `dual-device-capture`, `comparison-and-reference`) were blocked
on. Shipped in two halves per D28: the additive equipment/session/organization model (0005), then
this — the half that changes what a swing *is*. Decisions in **D30**.

**The load-bearing move is not the new table, it is where the frame-indexed data went.** `jobs`,
`scores`, `head_markers` and `swing_stages` all moved from the swing onto the view. A frame number
means nothing without the video that counts it, and two cameras on one swing never agree — left on
the swing, a second view would silently overwrite the first's hand-placed corrections. That is now
a test: one swing with a 60fps DTL view and a 120fps face-on view, each holding its own `impact`
frame, and the database refusing both a second view of a kind and a second primary.

**Identity stopped being a folder name.** `swings.id` was literally the analyzer's `out/<stem>`
directory, and `swings.media_path` held an absolute Windows path. Now the id is a uuid the database
mints and the folder name is the view's `media_key` — a key with no root and no separators,
validated before it is joined to anything. Step 09 turns it into an object-storage prefix by
changing values, not columns.

**Ten fixtures, ten scores, 30 jobs and 5 stage marks all came through intact** — asserted, not
assumed: `src/db/multiView.test.ts` walks the real database and fails if any ready view's artifact
is missing from disk, if any swing lacks exactly one primary view, if any `media_key` looks like a
path, or if a swing's denormalized score disagrees with its primary view's scorecard.

**Two smaller calls worth knowing.** Routes still take a *swing* id plus `?view=dtl|face_on`,
because a golfer's URL names a swing rather than a camera; an unrecognised view type is a 400, not
a silent default, and a pre-0006 bookmark is a 404 rather than a 500. And "is this a bundled
reference swing?" became a column — it used to be answered by matching the id against a hardcoded
`["perfect", "pro_2"]`, which only meant anything while an id was a folder name.

**Fixed on the way:** `clubs` had RLS policies from 0005 and no table grant, so they were inert —
0003's `grant ... on all tables` is a snapshot, not a rule.

Oracles: web tsc/lint clean, **103 vitest tests** (13 new), `db:migrate` idempotent, analyzer
pytest green with **zero diff under `services/analyzer`** (a DoD requirement — the `analysis.json`
contract is untouched), and the Playwright end-to-end path green: browser → Next.js → Postgres →
video on disk, through the rebuilt schema.

**Notes:** `lib/jobs.ts` spawns `burnin.py` for a re-analysis **without** `--club-detector
runs/clubhead/weights/best.pt` — a standing trap CLAUDE.md names by hand ("this has actually
happened"). Pre-existing, deliberately not fixed here because it changes analyzer invocation and
this step's DoD requires the artifact contract untouched. Recorded in D30. Also: `docs/CURRENT-STATE.md`
§7 and `.claude/rules/testing.md` were both stale — the latter still claimed no JS/TS test runner
existed — and are corrected.

Next: **09 — Media Storage and Artifact Addressing**, whose first step is provisioning buckets per
environment.

---

## 01 — Architecture Decisions ✅ 2026-08-08

Closed the questions `PROJECT_MAIN.md` §44 left open. **13 decisions recorded as D5–D17** in
`docs/decisions/`, synthesised into a new `docs/ARCHITECTURE.md`.

**The decision that turned out to be forced rather than chosen:** the only dev machine is
Windows with no Xcode, verified this session. iOS binaries cannot be built locally under *any*
framework, so a cloud build service is mandatory rather than a convenience. That, plus the fact
that the rendering rules worth keeping (`usePlayer.ts`, `traceSmoothing.ts`, `overlays.ts`,
`skeleton.ts`, `angleOverlay.ts`) are already TypeScript, settled the client on **React Native
via Expo with EAS Build** — Flutter would discard all of it and still not solve the build
problem.

Research done ahead of the step and recorded in the step file: VisionCamera covers 30–240 fps
capture on both platforms; frame-exact seeking is reachable on both, and Stage 0's existing
GOP of 10 — chosen originally for browser scrubbing — bounds ExoPlayer's decode-and-skip to
≤9 frames. **The unresolved risk is the Android per-frame overlay callback**, which iOS has a
clean analogue for and Android does not confirm. Step 02 now leads with proving it on Android,
and D5 is explicitly provisional until it does.

Other notable calls: the Next.js app becomes the coach/admin surface rather than being retired
(D6), so the existing player keeps a production home. §39's Azure preference is deliberately
**not** followed for media (D8) — splitting storage from the auth system would create a second
authorization path for user video — with a revisit trigger recorded. SLO targets are numeric
(D13), and the analysis p95 target is openly **not yet known to be achievable**: a 520-frame
fixture takes ~5.5 min on this machine, and `analyzer-service` must measure the hosted worker
and revise rather than quietly miss it.

Verification: `services/analyzer/swingsage` untouched (a DoD requirement — a decisions step
that edits the pipeline has the boundary wrong), `tsc --noEmit` clean, `eslint` clean,
pytest green.

Next: **02 — Mobile Client Spike and Workspace**, running Android-first.

## 03 — Supabase Project and Data Platform Migration 🔄 in progress

**RLS is live on a real hosted project and the coach boundary is tested five phases early.**

Project `golf-swing` (`xjcjqwcmwoouxczrrvar`, us-west-2, Postgres 17) — it already existed, empty.
All four migrations applied. `users.id` is now a FK onto `auth.users` with the default dropped, so
an id comes from the auth system and never from the database (D7). RLS **enabled and forced** on
all eight user-scoped tables, 16 policies. Supabase security advisors: **zero findings** — the one
finding before this step, `public.rls_auto_enable()` being callable by `anon`, is revoked in 0004.

**The call worth knowing about: one migration runs on both Supabase and local Postgres.** 0003
shims `auth`, `auth.uid()` and the three request roles, each guarded so nothing is attempted where
the real ones exist. That is what lets the authorization boundary be proven **in CI with no cloud
credentials** rather than only where it is expensive to test. (`create table if not exists
auth.users` was the first attempt and fails on Supabase — it still needs CREATE on the schema.)

**11 RLS tests, covering the coach feature that is five phases away**: approved coach reads;
pending grants nothing; revoked ends access immediately; an approved coach can never write; and
approval for one golfer leaks nothing about another — the mistake a policy written as "is this
user a coach" instead of "is this user THIS golfer's coach" would make. The suite **fails rather
than skips** without a database.

Also: the service-role boundary has a static test over the request surface; the deletion cascade
is mapped in D24 with the storage-side sweeps enumerated as explicit work; and `db:migrate`'s
hardcoded drizzle-kit path — broken by D21's move to `node-linker=hoisted` — is now a plain
`drizzle-kit migrate`.

Oracles: web tsc/lint clean, 84 web tests, 51 mobile, analyzer pytest green.

**Not done, and why the step stays open:** D10 wants a Supabase project **per environment** and
only one exists — creating preview and production costs money and is Taylor's call. And the
analyzer's service role is not yet scoped to specific tables, because what it actually needs is
defined by the `analyzer-service` track. Decisions in D24.

---

## 02 — Mobile Client Spike and Workspace 🔄 in progress

Workspace done, measurements pending — they need hands on a device.

**Done:** `apps/mobile` scaffolded on **Expo 57 / React Native 0.86 / React 19 / TS 6**,
registered in the pnpm workspace (`apps/*` was already globbed), typechecking clean alongside
`apps/web`. `App.tsx` is a spike harness rather than product code: a Device card reading what is
knowable without native modules, and three probe cards ordered by risk rather than convenience —
overlay-sync first, because that is the one step 01's research could not confirm on Android.
Android run instructions are in `docs/RUNBOOK.md` §6.

**Deliberately not done:** `packages/` holds no contract types. Step 07 generates those from
JSON Schema, and hand-writing them now would only create the duplicate that step deletes.

**Blocked on external input, not on work:** all three probes need a development build, since
Expo Go cannot host native modules. That needs an Expo/EAS account, and the measurements
themselves need the phone in hand. The client test harness (also part of this step) lands with
the dev build so it can cover the probe code it exists to protect.

Status stays `in-progress` — the step's Definition of Done is measured numbers per device, and
there are none yet.

### Session 2 — 2026-08-11: the instrument exists and compiles; still no numbers

**The blocker recorded above was wrong on its central claim.** A dev build does *not* need an
Expo/EAS account for Android: this machine already has the Android SDK, NDK and JDK 17, so
`npx expo run:android` builds locally. Taylor chose to wire **both** routes — local as the
day-to-day path, `eas.json` committed because EAS is still the only way to reach iOS.

**Built the thing that makes probe 1 measurable at all.** `apps/mobile/modules/frame-clock` is a
local Expo module over Media3's `VideoFrameMetadataListener` (Kotlin) and
`AVPlayerItemVideoOutput` + `CADisplayLink` (Swift); `expo-video` surfaces neither. Drift is a
**closed loop timed in native code** — native reports the frame about to be rendered, JS draws and
calls back, native scores the callback against the frame actually on the glass. Neither end is a
JS self-report. Bars are D13's: overlay drift p95 = 0 frames, seek error max = 0. Recorded as D21.

`assets/frameclock.mp4` is generated and committed — 600 frames, exactly 60fps CFR, GOP 10, frame
number burned in, plus a bar advancing 1/599 of the width per frame. GOP 10 matches Stage 0, which
is what makes probe 2's worst case (a seek target just *before* a keyframe) reachable at all. A
JS-drawn marker sits over the burned-in bar, so drift is visible by eye as well as counted —
the phone-side analogue of the analyzer's Gate 1 burn-in.

**Verified as far as it can be without a device:** `./gradlew :app:assembleDebug` is **green**,
`:frame-clock:compileDebugKotlin` executed, and the debug APK exists. Compiling is not measuring —
**every probe number is still absent**, and D5 remains provisional on probe 1 exactly as before.
The iOS half has never been compiled; there is no Mac.

**Three environment faults found and fixed on the way**, all pre-existing, all of which broke
*every* Android build on this machine:
- `ANDROID_SDK_ROOT`'s value contains its own name. AGP prefers it over the correct `ANDROID_HOME`
  and fails with "The filename, directory name, or volume label syntax is incorrect".
  **Still needs a manual fix** — it is a Windows user environment variable. Overridden per-build
  meanwhile.
- NDK `27.1.12297006` was an empty directory from an interrupted install in May 2025, and RN 0.86
  asks for that exact version. Stub deleted; Gradle re-downloaded it. Fixed.
- pnpm's symlinked layout makes CMake/ninja loop forever
  (`manifest 'build.ninja' still dirty after 100 tries`). Repo moved to `node-linker=hoisted`.
  Requires deleting every `node_modules` first — a leftover `.pnpm` keeps resolving and
  reproduces the identical failure, which cost two rebuilds to spot.

**Test strategy is now real on both clients**, which was step 7 of this step file. Web gained a
Playwright end-to-end path (`pnpm --filter web test:e2e`) that drives a browser through
Next.js → Postgres → video on disk and asserts the player reaches `HAVE_METADATA` with real
dimensions. Mobile **component rendering now works** — previously recorded in the RUNBOOK as
unusable because `render()` "returned an object with no query functions". That object was a
Promise: RNTL v14 made `render`/`fireEvent` async, and it peer-depends on `test-renderer`, not
`react-test-renderer`. Mobile is 33 tests (logic + components), web 71 + 1 E2E.

**Remaining before this step can close:** the measurements themselves (Android device on USB),
probe 3's camera path, and iOS.
