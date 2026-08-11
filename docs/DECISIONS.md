# Decisions

Append-only log of decisions taken while building toward
[`.claude/ai-instructions/PROJECT_MAIN.md`](../.claude/ai-instructions/PROJECT_MAIN.md).

**Started fresh on 2026-08-08.** The previous log (57 entries, D1–D57) covered the
proof-of-concept phase and was deleted with the rest of the pre-pivot documentation. Whatever
from it is still true about the running system is stated as plain fact in
[`CURRENT-STATE.md`](CURRENT-STATE.md), not as history. Do not cite D-numbers — none resolve.

## What belongs here

One numbered entry per decision that a future reader could otherwise reasonably second-guess:

- a deviation from `PROJECT_MAIN.md`, or a place it left the choice open and we closed it
- a vendor, model, framework or protocol choice
- a threshold, contract, or schema change
- a negative result — something tried and abandoned, so it isn't retried

Not: routine implementation choices already constrained by an existing convention, and not a
changelog of ordinary work (git history covers that).

## Rules

- **Append only.** Never delete or renumber an entry — source comments may cite it by number.
- **Every entry carries a `Status:` line**: `ACTIVE` / `SUPERSEDED by Dnn` / `NEGATIVE RESULT —
  do not retry` / `HISTORICAL` / `OPEN`. When a decision is overruled, the new entry supersedes
  it and the old one is *marked*, not removed.
- Environment and version facts belong in `CURRENT-STATE.md`, not here.

## Format

```
## D1 — <short title>

**Date:** YYYY-MM-DD
**Status:** ACTIVE
**Context:** what forced a choice.
**Decision:** what we chose.
**Alternatives:** what we did not choose, and why.
**Consequences:** what this now constrains or unlocks.
```

---

## D1 — Native in-app purchase is the billing platform; Stripe is dropped

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` §30 names Stripe as the requested billing platform and §39 lists
it as a required/preferred component, while the same section requires subscription behavior to
be "compatible with the distribution requirements of the iPhone and Android applications".
Apple and Google both mandate their own in-app purchase system for digital subscriptions sold
inside an app, and both take a revenue share. As written the two requirements are not
simultaneously satisfiable for in-app purchase, so the roadmap could not proceed to any
entitlement work without closing this.

**Decision:** Use the platforms' native in-app purchase — StoreKit on iOS, Google Play Billing
on Android. **Stripe is removed from the stack entirely**, not kept as a web-side alternative.
This is a product-owner decision that overrides §30's and §39's naming of Stripe.

**Alternatives:**
- *Web-first Stripe checkout, app reads entitlement.* Avoids store revenue share, but the
  purchase happens outside the app, which is a materially worse signup funnel for a
  mobile-first product and sits inside store rules that restrict steering users off-platform.
- *IAP in-app plus Stripe on web, entitlement unified server-side.* Preserves §39 literally,
  but means two billing integrations, two webhook surfaces, two sets of lifecycle edge cases
  (refunds, grace periods, upgrade proration) and one reconciliation layer between them —
  substantial permanent complexity for a product with no web purchase flow today.

**Consequences:**
- The entitlement engine is fed by store transactions and server-side receipt validation, not
  by Stripe webhooks. `entitlements-and-billing` builds against StoreKit / Play Billing.
- Store revenue share is accepted as a cost of the mobile-first requirement (§2.1).
- §30.3's lifecycle cases (upgrade, downgrade, cancellation, expiry, failed payment, restored
  entitlement, promotional access) must be handled through store subscription semantics, which
  differ from Stripe's — notably *restore purchases* becomes a first-class flow, and
  administrator-granted complimentary access must be granted server-side rather than through
  the billing provider.
- Entitlement state stays authoritative on our server so the app never trusts a client-reported
  purchase, and so admin-granted access works without a store transaction.
- If a web purchase path is ever needed (for example, coach tiers bought on desktop), it is a
  new decision that supersedes this one — not an assumption to quietly re-add.

---

## D2 — Automatic swing detection in long recordings is deferred to a future phase

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` §11 requires the app to find the actual golf swing inside a
longer recording, distinguishing it from walking into frame, setup, practice movement and
walking away, and §9.3/§9.4 build hands-free and long-recording capture on top of that ability.
Nothing in the current system does this. The existing 8-event detection locates events *inside
a clip already known to contain exactly one swing* — a materially different and much easier
problem, and mistaking one for the other would have silently skipped real work.

**Decision:** Accept §11 as a **future-state feature**. It stays on the roadmap as the
`swing-isolation` track but moves out of the near-term arc into a dedicated Future Capability
phase, with `lifecycle: "future"`.

**Alternatives:**
- *Build it inside the capture phase as §42's grouping implies.* It is an unsolved CV problem
  on this project's data, with no hand-labelled ground truth to evaluate against, and it would
  gate the entire capture phase behind open-ended research.
- *Drop it from the roadmap.* It is a real product requirement and the hands-free workflow is
  weaker without it; deleting it would lose the dependency analysis.

**Consequences:**
- **Capture needs a manual fallback.** §9.3 hands-free recording and §9.4 long-recording
  support must ship with the golfer trimming or selecting the swing themselves. The
  `in-app-capture` track owns that fallback, and it is not optional — without it, a hands-free
  recording produces a clip the analyzer cannot use.
- Trim/selection UI built for the fallback is also what §11 later needs for its
  "choose the correct one when several are detected" case, so the work is not wasted.
- `analysis-ground-truth` becomes a prerequisite in practice: automatic isolation cannot be
  evaluated without labelled recordings containing non-swing motion.
- Until this ships, uploaded and recorded clips are assumed to contain one swing, and that
  assumption should be stated to the user at capture time rather than discovered on failure.

---

## D3 — The platform layer is built before the product layer, not alongside it

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** An architecture and production-readiness review of the first roadmap draft found
that it sequenced the product well but under-built the platform. Four gaps would each have
forced rework rather than additional work, and all four are far cheaper before a native binary
is in users' hands than after:

1. **Entitlements were scheduled in phase 6 but gate features built in phases 2–5.** §14.1
   requires overlays to respect entitlements and §30.1 explicitly forbids hard-coding gating
   into isolated screens. The original ordering guaranteed the retrofit §30.1 warns against.
2. **No API versioning, and native apps cannot be force-updated.** `analysis.json` is already
   at `schema_version: 9` — nine breaking changes, all free because the only client shipped in
   the same commit. That stops being true at the first store release.
3. **No shared schema.** `schemas/` and `packages/` did not exist; contract types were
   hand-written TypeScript against a Python producer, about to gain a second TS client.
4. **Video upload had no design.** The phone originals in this repo are 270–330 MB, and the
   users are on cellular at a driving range.

The review also found three requirement sections with no owning track (§22 launch data,
§31 admin area, §35 sharing/export), notifications scheduled five phases after the event that
needs them, observability and analytics arriving after five phases of features, no SLO targets
anywhere, no client test strategy at all (`apps/web` had zero tests against the analyzer's 80),
and the multi-device sync feasibility risk left unretired until the final phase.

**Decision:** Restructure so the platform layer is complete before the product layer starts.
The spine track grows from 8 steps to 10, gaining **API Contract and Shared Schema** (07) and
**Entitlement Engine** (08). The foundation phase gains four parallel tracks —
`media-pipeline`, `observability-and-slos`, `notifications`, and the existing
`analyzer-service` scoped to include a capacity and cost model with per-user fair queuing.
`entitlements-and-billing` splits into the foundation-phase engine and a phase-6 `billing-iap`.
Three new tracks cover the unowned sections, and a `dual-device-spike` retires §12's
feasibility risk in phase 3 instead of phase 8.

**Alternatives:**
- *Ship the product layer first and harden later.* Viable for a web product where every client
  updates on refresh. It is not viable here: the store-release cycle makes several of these
  permanently expensive, and §38 asks for a real production product rather than a prototype.
- *Fold the new work into existing tracks as extra steps.* Keeps the track count down but hides
  platform work inside feature tracks, which is how it gets cut under pressure.

**Consequences:**
- The foundation phase is deliberately large and delivers no user-visible value. That is the
  cost of C1–C4 above, paid once.
- 18 tracks became 25, and every §1–§41 requirement now has exactly one owning track (§1 is the
  aspirational goal statement and correctly has none).
- Features written from phase 2 onward must call the entitlement seam and consume generated
  contract types from day one, even while entitlement returns "allowed" for everything.
- `mobile-player` no longer waits on `swing-ingest` — the seven analysed swings already on disk
  let the largest piece of UI risk be retired in parallel.
- `billing-iap` depends on `analysis-ground-truth`: this project does not charge for scores it
  cannot independently verify.
- SLO targets are set in step 01 and instrumented by `observability-and-slos`, so "production
  ready" becomes falsifiable rather than a matter of opinion — the same correction this project
  already had to make when club tracking was being tuned on smoothness with no position-error
  metric to falsify it.

---

## D4 — One full-product launch; phases ordered by risk, not by value delivery

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** The roadmap's phase order implicitly assumed staged delivery — golfer core first,
differentiators later, commerce last — which is the right shape when each phase ships to users
and earns feedback. The product owner is not doing that: SwingSage launches once, as the full
product, with quality and differentiation as the gating concerns rather than time-to-first-user.

That inverts two things. Value-delivery order stops being a reason to sequence anything, since
nothing ships before everything ships. And the differentiating features stop being "later" work
that can absorb schedule pressure, because launching without them is launching an undifferentiated
product.

**Decision:** Sequence purely by **dependency and risk retirement**, and gate the launch on a
quality bar rather than a date.

- **Multi-phone synchronized capture (§12) moves from the last phase into the capture phase**,
  immediately after its feasibility spike. It is the stated differentiator and the hardest
  unsolved problem in the product; leaving it last would put the launch date at the mercy of it.
- **Coach Platform moves ahead of Subscriptions**, because a whole second persona carries far
  more unknowns than billing does, and billing depends on knowing everything it gates.
- **A new Launch Readiness phase and track** becomes the gate between built and shipped: store
  submission with its mandatory Apple App Privacy and Google Data Safety declarations, a
  security review of the full surface, load testing *against* the SLOs rather than merely
  defining them, §41 accessibility verification in real outdoor conditions, a closed beta, and
  the legal surface.
- **Launch scope is every track except `swing-isolation`** (deferred by D2). `sharing-and-export`
  is named as the single cut candidate if the date is at risk — §35 itself says it need not be in
  the first release — and cutting it is a recorded decision, not a silent descope.
- **The three differentiators are named in `ROADMAP.json` so they cannot be value-engineered
  away**: multi-phone capture; the confidence-honest analysis engine that abstains rather than
  fabricates; and AI coach plus human coach in one product.

**Alternatives:**
- *Staged release with a public beta.* Cheaper and lower-risk, and explicitly not what the owner
  wants. It also weakens the differentiation case, since a first release without multi-phone
  capture is a swing-video app like several others.
- *Keep the differentiator last and accept the schedule risk.* This is the default outcome of
  most roadmaps and the reason differentiating features are the ones most often cut.

**Consequences:**
- There is no intermediate release to hide an unfinished feature behind. Every launch-scope
  track must actually be finished.
- The capture phase becomes the largest and riskiest in the plan. That is deliberate: it is
  better to discover the sync problem is harder than expected in phase 3 than in phase 8.
- `launch-readiness` depends on six tracks, so it is a genuine gate rather than a checklist —
  it cannot start until the product is functionally complete.
- Apple App Privacy and Google Data Safety declarations require exact answers about data
  collection, sharing and retention, which makes D3's deletion-cascade decision and the
  `ai-coach` data-processing position hard launch prerequisites rather than good practice.

---

## D5 — Mobile client: React Native via Expo, with EAS cloud builds

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` §44 leaves the mobile framework to the roadmap; §2.2 says
performance beats code-sharing purity where they conflict; §2.3 makes ≥60 fps capture
non-negotiable. Two facts settle this more than any framework benchmark does.

First, **the only dev machine is Windows** — verified, no Xcode toolchain. iOS builds are
impossible locally regardless of framework, so a cloud build service is mandatory, not a
convenience. Expo's EAS Build provides hosted macOS builders; choosing bare React Native or
Flutter does not remove this requirement, it just means sourcing it separately.

Second, the rendering *rules* worth keeping are already TypeScript and hard-won: `usePlayer.ts`
(frame sync), `traceSmoothing.ts` (nine endpoint-exact methods), `overlays.ts`, `skeleton.ts`,
`angleOverlay.ts`, `swingPhases.ts`. React Native keeps them as logic and shares types with the
web surface through `packages/schema`; Flutter means re-expressing all of it in Dart with no
sharing against the coach/admin web app.

Research (recorded in step 01's file) found the capability questions answered: VisionCamera
exposes 30–240 fps capture on both platforms, and frame-exact seeking is reachable on both —
zero-tolerance seek on iOS, decode-and-skip from a sync point on Android, bounded by Stage 0's
existing GOP of 10.

**Decision:** React Native, managed through **Expo with config plugins and development builds**
(not Expo Go, which cannot host the native modules this needs), built and submitted via **EAS
Build / EAS Submit**.

**Alternatives:**
- *Flutter.* Better raw rendering predictability via Impeller, and genuinely strong at custom
  painting. Rejected because it discards every line of existing player logic, shares nothing
  with the web coach surface, and does not solve the Windows/iOS build problem anyway.
- *Fully native (Swift + Kotlin).* Best possible capture and playback control, and the only
  option with no framework risk on the per-frame callback. Rejected as roughly double the
  surface area for a single-developer build, against a §45 success definition spanning 20
  capabilities.
- *Bare React Native.* Same language benefits, but hands back EAS's build/submit/update
  pipeline, which is the part that makes a Windows-only machine viable.

**Consequences:**
- Expo Go is unusable from the start; development requires a **dev build** installed on the
  device. That is the Android testing path and belongs in `docs/RUNBOOK.md` once step 02
  creates the app.
- Native modules are expected, not exceptional — at minimum for the per-frame overlay callback.
  The Expo config-plugin system is how they are wired without ejecting.
- iOS builds always go through EAS. Budget for it; it is on the critical path for step 10.
- ~~**This decision is provisional until step 02's spike passes on Android.**~~ **Resolved by
  D19**: Android exposes the per-frame callback via Media3's `VideoFrameMetadataListener`, so
  the feasibility question that would have reopened this entry is closed. The spike now measures
  drift rather than deciding whether the framework survives.

---

## D6 — The Next.js app becomes the coach and admin surface, not the golfer surface

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` is mobile-first for golfers (§2.1), but coaches review swings,
annotate frames, manage a roster and write plans (§25–§28), and administrators manage
professional swings, drills, scoring configuration and coach approval (§31). Those are
desk-shaped tasks on large screens. Meanwhile a working, frame-accurate player already exists
as a Next.js app, and the roadmap risked treating it as legacy.

**Decision:** The existing Next.js app stops being the golfer surface and becomes the **coach
workspace + admin area + marketing/support** surface. `SwingWorkspace` / `SwingStage` and the
overlay system are retained as the coach's swing-review UI rather than deleted.

**Alternatives:**
- *Retire the web app; everything on mobile.* Would force coaches to do roster management,
  annotation and plan authoring on a phone, and throws away a working player.
- *Keep it as a second golfer surface too.* Doubles the golfer feature surface for no stated
  requirement — §2.1 is unambiguous that golfers are mobile-first.

**Consequences:**
- The player's existing frame-sync and overlay work keeps a production home immediately, and
  the mobile port becomes a second implementation of shared rules rather than a migration.
- `coach-relationships` and `coach-collaboration` build on an app that already exists.
- The admin surface (§31) has a natural home, which is why `admin-surface` is a web track.
- Golfer-facing routes in `apps/web` reduce to a marketing/redirect shell as the mobile app
  takes over. Not urgent, but it must not drift into a maintained second golfer client.

---

## D7 — Supabase Postgres with Drizzle retained; RLS is the authorization boundary

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §4.1 requires Supabase for accounts. Supabase *is* Postgres, and this project
already has a Drizzle schema with real migrations and `user_id` foreign keys on every
user-scoped table. §24.3 and §34.2 make coach access to golfer data a data-access rule.

**Decision:** Use Supabase as the Postgres host and identity provider. **Keep Drizzle** as the
query and migration layer; the existing schema and migrations move rather than get rewritten.
The app's `users` row is keyed to the Supabase `auth.users` id — one identity, no shadow table.
**Row-level security is the authorization boundary**, not a UI check, and the analyzer worker
gets a scoped service role that bypasses RLS and is unreachable from request handling.

**Alternatives:**
- *Move to the Supabase client and PostgREST.* Tighter RLS integration and less code, but
  discards working migrations, loses type-safe query composition, and couples every server
  module to one vendor's client.
- *Enforce access in application code only.* Simpler to write, and one missed `where` clause
  from showing a golfer another golfer's video. Rejected outright.

**Consequences:**
- Coach access, sharing and admin visibility become policy questions with one enforcement point,
  testable before the features exist — which is why step 03 writes those tests against a
  synthetic relationship.
- The service-role boundary is a security-critical seam, called out in step 03.
- Local development keeps a Docker Postgres for pipeline work; only auth-dependent paths need
  the hosted project.

---

## D8 — Media lives in Supabase Storage, addressed by stable keys

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** Media is on local disk behind `SWINGSAGE_MEDIA_ROOT`, the hardest blocker to the
analyzer running anywhere else. §39 prefers Azure "for additional cloud needs". Video playback
needs HTTP range requests or frame-accurate scrubbing breaks — the product's #1
perceived-quality feature.

**Decision:** **Supabase Storage** for both source uploads and derived artifacts, with stable
keys derived from swing/view identity rather than folder names, and signed URLs for playback.

**Alternatives:**
- *Azure Blob + CDN.* The literal reading of §39's Azure preference, and the better answer at
  scale. Rejected for now because signed-URL issuance would then live outside the auth system
  that decides who may see a swing, adding a second authorization path for the most sensitive
  asset in the product — video of users.
- *Railway volumes.* Simplest migration, but not object storage: no lifecycle rules, no CDN
  path, and it re-creates the local-disk coupling on someone else's disk.

**Consequences:**
- §39's Azure preference is deliberately not followed here. It is a *preference*, and §39 itself
  subordinates preferences to non-negotiable capabilities — here, one authorization path for
  user video.
- **Revisit trigger, recorded so it is not forgotten:** if egress cost or playback latency
  becomes material, move artifacts behind a CDN or to object storage with cheaper egress.
  Stable keys make that a routing change rather than a data-model change.
  **Quantified 2026-08-10** in [`SCALE-10K-MAU.md`](SCALE-10K-MAU.md): at 10,000 MAU the
  egress alone is ~7.5 TB/month, which is ~$675/month on S3-priced egress and **$0 on
  Cloudflare R2**. R2 — not Azure Blob — is the concrete migration target, and the trigger
  is monthly egress above ~$200.
- Range-request support must be verified in step 09 against real scrubbing, not assumed.

---

## D9 — Upstash for dispatch, Railway for the worker; job state stays in Postgres

**Date:** 2026-08-08
**Status:** SUPERSEDED IN PART by D18 — the Upstash dispatch and Postgres job-state halves
stand; the choice of Railway as the analyzer worker host is reopened.

**Context:** §39 names Upstash and Railway. §38 requires that one user's workload cannot degrade
everyone else's. A working job protocol already exists — stage, progress_pct, message, durable
in Postgres, with orphan settlement — designed for one local worker.

**Decision:** **Upstash QStash** dispatches analysis jobs to a **Railway**-hosted analyzer
container. **Job state remains in Postgres**; the queue carries dispatch, not truth. Fair
queuing is a per-user concurrency cap enforced at enqueue time.

**Alternatives:**
- *Queue as the source of truth.* Fewer moving parts, but the existing protocol, the progress UI
  and orphan settlement all read a durable row, and clients need to recover state after
  reconnecting.
- *Railway-native background workers only.* Fewer vendors, but no backpressure or retry
  semantics without building them.

**Consequences:**
- The existing job protocol survives the network boundary largely intact.
- A per-user concurrency cap is the concrete form of §38's isolation requirement, and belongs to
  `analyzer-service` along with the capacity and cost model.
- GPU availability on Railway must be confirmed early — the club detector and pose model are the
  cost driver, and a CPU-only worker changes the latency SLO materially.

---

## D10 — Three environments; Infisical holds every secret

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §38 lists safe configuration and secrets handling as a product expectation; §39
names Infisical. Today configuration is `.env` files on one machine.

**Decision:** **local / preview / production**, each with its own Supabase project, storage
buckets and queue namespace. **Infisical** is the only source of secrets; nothing secret is
committed, printed in logs, or reachable from a client bundle. The mobile app receives only
public configuration — anything secret stays server-side, which is also why the AI provider and
receipt validation are server-only (D16, D17).

**Consequences:**
- Preview environments need their own storage and database, so seeding and teardown must be
  cheap.
- A mobile binary embeds configuration at build time, so environment switching is a build
  concern, handled through EAS build profiles.

---

## D11 — Offline-first capture and library; analysis requires connectivity

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** Golfers record at ranges and on courses, where signal is worst. §33 lists lost
connections and interrupted uploads as first-class failure cases. Analysis is server-side CV and
cannot run on the device.

**Decision:** **Capture, the local swing library, and playback of already-downloaded swings work
fully offline.** A local store on the device holds swing records and pending uploads; uploads
queue and retry. **Analysis requires connectivity**, and its pending state is explicit in the UI.

**Alternatives:**
- *Online-required throughout.* Much simpler, and directly contradicts where the product is
  used. A golfer who records six swings out of signal must not lose them.
- *Full bidirectional sync of all data.* Correct eventually, disproportionate now; the coach,
  messaging and plan surfaces are read-mostly and can require connectivity.

**Consequences:**
- The device is a source of truth for un-uploaded swings, so local storage pressure and
  retention need handling — a phone holds only so many 300 MB clips.
- Conflict resolution is deliberately avoided by keeping offline writes append-only: new swings
  and edits to local-only swings, never offline edits to server-owned records.
- This is a `media-pipeline` responsibility, and is why that track exists separately from
  `swing-ingest`.

---

## D12 — EAS Build and Submit; OTA updates for JavaScript only

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** The dev machine is Windows with no Xcode, so iOS binaries cannot be produced
locally. §38 wants reliable delivery; step 07 introduces a minimum-supported-client policy.

**Decision:** **EAS Build** produces signed binaries for both platforms and **EAS Submit**
delivers them to TestFlight and Play internal testing. **`expo-updates` OTA is permitted for
JavaScript-only changes**; anything touching native code, permissions or a native module version
requires a store release.

**Consequences:**
- OTA weakens but does not remove step 07's version-skew problem: a JS fix ships in hours, a
  native fix waits for review. The minimum-supported-client check must therefore key on the
  **native** build number, not the JS bundle.
- An OTA channel per environment maps onto D10's build profiles.
- Store review latency is a release-calendar fact, not an incident.

---

## D13 — SLO targets

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §38's expectations are entirely qualitative. Without numbers, "production ready" is
unfalsifiable — the exact failure this project already made when club tracking was tuned on
smoothness with no position-error metric to falsify it.

**Decision:** the initial targets, instrumented by `observability-and-slos` and load-tested by
`launch-readiness`:

| Metric | Target |
|---|---|
| Analysis end-to-end (upload complete → result ready), p95 | **< 180 s** |
| Analysis end-to-end, p99 | < 300 s |
| Analysis failure rate (excluding video rejected as unsuitable) | **< 2 %** |
| Upload success rate, including resume | **> 99 %** |
| API p95, excluding analysis | < 500 ms |
| Crash-free sessions | **> 99.5 %** |
| Overlay drift during scrub | **0 frames** — it is exact or it is a bug |

**Consequences:**
- The p95 target is **not currently met and is not yet known to be achievable**: a ~520-frame
  fixture takes ~5.5 minutes on this developer machine. Establishing real per-swing cost and
  latency on the hosted worker is an explicit `analyzer-service` deliverable, and these numbers
  are revised there with measurements rather than quietly missed.
- Overlay drift is the one target with no tolerance, because it is the product's stated #1
  perceived-quality feature and the existing pipeline already achieves it.

---

## D14 — What golfer data may reach a model provider

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §17.2 wants the AI Coach grounded in profile, goals, handedness, equipment, history
and coach plans. §34 makes this personal data, and the store privacy declarations required at
launch need an exact answer.

**Decision:**
- **Never sent:** raw video, raw per-frame keypoint arrays, precise location, email, payment
  data.
- **May be sent:** derived analysis (scores, findings, checkpoint metrics), profile fields the
  golfer supplied, goals, equipment, club, and summarised history. **Extracted keyframe images
  may be sent** where a visual is needed.
- **Required of the provider:** no training on submitted data, and zero or short retention. A
  provider unable to commit to that is not eligible.
- **User-authored free text — notes, goals, messages — is untrusted input**, carried as data and
  never as instructions, and never able to alter system behaviour.

**Consequences:**
- Makes the Apple App Privacy and Google Data Safety declarations answerable rather than
  guesswork.
- Constrains `ai-coach`'s prompt construction from the start rather than after a review.
- The no-training requirement narrows provider choice; the model itself is deliberately still
  open (D16).

---

## D15 — Deletion cascade

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §4.3 promises users understand what deletion removes; §34.1 gives them control;
§30.1 makes retention tier-driven. Every track from here creates user data, so the obligation
has to exist before they do.

**Decision:** account deletion must reach, and be verifiable across: database rows (FK cascade),
**object storage** (source video and every derived artifact), **AI conversation history**,
**coach-visible copies** (access revoked; coach-authored annotations retained only where the
coach owns them, detached from the golfer's identity), **analytics** (pseudonymised, not retained
against the user), and **backups** (removed within a stated, published window rather than claimed
to be instant).

**Consequences:**
- Every new table or bucket must declare its deletion behaviour when introduced. Enforced by
  step 03's schema work and audited by `production-readiness`.
- "Deleted everywhere immediately" is not truthfully claimable while backups exist, so the
  privacy policy states the window instead of over-promising.
- Tier-driven retention (§30.1) reuses the same machinery on a schedule rather than an event.

---

## D16 — AI provider seam is server-side; the model is not chosen here

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** §44 explicitly leaves the AI model and provider to the roadmap, and §17 requires
grounded, personalised conversation. Choosing a model now would fix a fast-moving decision months
before the `ai-coach` track needs it.

**Decision:** fix the **seam**, not the model. All model access goes through a server-side
provider interface in `services/ai`. **The client never calls a model provider directly** — that
would expose keys, remove cost control, and make per-tier usage limits unenforceable. Every
response is validated against a schema, retried once on failure, then falls back to deterministic
output. Model selection belongs to `ai-coach`, constrained by D14.

**Consequences:**
- Entitlement checks and cost ceilings have exactly one place to live.
- The existing deterministic coach narrative is the fallback path, so an AI outage degrades the
  product rather than breaking it — consistent with quality gates degrading, not crashing.

---

## D17 — Entitlement is ours; store receipts are evidence, not truth

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** D1 made billing native in-app purchase. §30.3 requires the full subscription
lifecycle and §31.4 requires admin-granted access, which no store transaction represents.

**Decision:** the **entitlement record is our own**, stored server-side and authoritative. Store
receipts are **validated server-side** and treated as evidence that updates it. A client-reported
purchase is never trusted. Admin grants, promotional access and comped accounts are first-class
grant types requiring no store transaction.

**Consequences:**
- Entitlement survives a store outage, a failed receipt refresh, and a platform migration.
- The same seam serves both stores, so `billing-iap` adds sources rather than branching feature
  code.
- Downgrade overflow (§43's open question about stored swings exceeding a shrunken plan) is
  expressible whichever answer the product picks, because retention reads entitlement rather than
  store state.

---

## D18 — Analyzer worker hosting is reopened; Railway has no GPU

**Date:** 2026-08-10
**Status:** OPEN — decide before the `analyzer-service` track starts

**Context:** D9 named Railway as the analyzer worker host and flagged "GPU availability on Railway
must be confirmed early". It was confirmed, and the answer is **no**: Railway does not offer GPU
outside its Enterprise plan, and its own documentation says the platform is not yet well-equipped
for GPU compute.

Checking what the pipeline actually uses turned out to matter more than the platform question:

- **RTMW pose inference already runs on CPU.** `pose_rtm.py` passes `device="cpu"`, and the
  installed onnxruntime exposes only `CPUExecutionProvider` — the CUDA provider is not installed.
- **Only the YOLO club detector uses the GPU**, via torch cu126.

So the ~5.5 minutes per ~520-frame clip measured on the dev machine is dominated by **CPU-bound
pose**, not GPU work. Railway's missing GPU is therefore much less damaging than it first looked
— but it also forecloses the largest easy speedup available, because installing
`onnxruntime-gpu` and moving pose to CUDA is untried and is the obvious lever for D13's
**p95 < 180 s** target, which is already recorded as not known to be achievable.

**Options, to be decided with a measurement rather than a preference:**
1. **CPU-only on Railway.** Keeps D9 and the vendor list intact. Requires the club detector on
   CPU too, and almost certainly misses the 180 s p95 — so D13 would have to be revised
   honestly rather than quietly missed.
2. **A GPU host for the worker, Railway for everything else.** Azure is the §39-preferred cloud
   for "additional cloud needs", so Azure GPU compute is the option that satisfies the stated
   preference; Modal, RunPod, Fly.io and Northflank are the obvious alternatives.
3. **Optimise first, then choose.** Install `onnxruntime-gpu`, move pose to CUDA, and re-measure
   on the dev machine's GTX 1080. That gives a real CPU-vs-GPU ratio for *this* pipeline and
   turns the hosting choice into arithmetic instead of a guess.

**Leaning toward 3 then 2**, because the ratio is currently unknown and every option above is
being argued from an unmeasured assumption — the same failure this project has already made
once, tuning club tracking on smoothness with no position-error metric.

**Consequences:**
- **Do not sign up for Railway yet.** Its role is no longer settled.
- The `analyzer-service` track gains an explicit first step: measure CPU vs GPU pose inference
  on the current pipeline, then choose the host.
- D13's analysis-latency SLO cannot be validated until this is settled, and may need revising
  downward in honesty rather than being missed silently.

---

## D19 — Every web-player overlay is reproducible on iOS and Android; the frame lock needs one native module

**Date:** 2026-08-10
**Status:** ACTIVE — supersedes the open risk in D5, which is no longer provisional on feasibility

**Context:** D5 chose React Native + Expo but was explicitly provisional, because step 01's
research confirmed an iOS path for the per-frame overlay callback and could **not** confirm the
Android equivalent. That was the one finding that would have reopened the framework choice, so it
was checked against the actual platform APIs before building anything on it.

**Findings, from the Expo SDK reference and the Media3 API:**

*Playback and seeking — better than assumed.* `expo-video` exposes `SeekTolerance` with
`toleranceBefore` and `toleranceAfter` **both defaulting to 0** on Android and iOS, so
frame-exact seeking is the default rather than an opt-in. Android additionally has
`ScrubbingModeOptions` — `scrubbingModeEnabled`, `useDecodeOnlyFlag`
(`MediaCodec.BUFFER_FLAG_DECODE_ONLY` on API 34+), `allowSkippingMediaCodecFlush`,
`increaseCodecOperatingRate`, `enableDynamicScheduling` — which is purpose-built for exactly this
product's interaction: many rapid seeks while dragging. Combined with Stage 0's existing GOP of
10, decode-and-skip on seek is bounded to at most 9 frames. `VideoTrack.frameRate` also reports
the track's true frame rate, which §2.3 needs in order to refuse to silently degrade.

*The frame lock — the actual risk, and it resolves.* `expo-video`'s `timeUpdate` event fires on
an interval (`timeUpdateEventInterval`), **not once per presented frame**. Used as-is, the mobile
player would get the web player's *rAF fallback* behaviour rather than its
`requestVideoFrameCallback` guarantee. But both platforms expose the real thing natively:

- **Android:** Media3's `VideoFrameMetadataListener.onVideoFrameAboutToBeRendered()` delivers the
  frame's presentation time in microseconds *and* the wallclock time it is intended to display
  at, in nanoseconds — arguably a stronger signal than the web API, since it arrives before the
  frame is shown.
- **iOS:** `AVPlayerItemVideoOutput` driven by a `CADisplayLink`, as already established.

Neither is surfaced by `expo-video`, so this requires a small Expo native module. That is the
"native modules are expected, not exceptional" consequence D5 already recorded, not a new cost.

*Overlay drawing — no gaps.* `@shopify/react-native-skia` is an Expo SDK package and covers every
shape the web canvas draws: `Path` with `fillType="evenOdd"` for the silhouette and isolation
rings, `DashPathEffect` for the dashed chords across unmeasured trace gaps, per-segment paths for
the red-backswing/blue-downswing trace, and text for the angle readouts. It is Skia — the same
engine behind Chrome's canvas — and it renders on the UI thread through Reanimated worklets, so
overlay updates do not queue behind JavaScript.

**Decision:** The mobile port is confirmed feasible with no feature loss. Build the player on
**`expo-video` + `@shopify/react-native-skia`**, with a **native module exposing the per-frame
callback** on both platforms. D5 stands and is no longer provisional on this question.

**Consequences:**
- **The ~2,000 lines of pure geometry port unchanged** — `traceSmoothing`, `overlays`,
  `skeleton`, `angleOverlay`, `swingPhases`, `playbackWindow`, `viewbox`, `swingSync` are pure
  functions producing coordinates, and the 71 tests already written against them become the
  oracle for the port. Only the thin drawing layer (canvas 2D calls) is rewritten against Skia.
- **Step 02's spike changes character**: from "is the overlay lock possible on Android" to
  "measure the drift the native module actually achieves". The question is now quantitative.
- `surfaceType` needs attention on Android. The default `surfaceView` is faster and lower-power,
  but Expo's own docs flag z-ordering problems with overlapping video views; `textureView`
  composites conventionally. Which one an overlay-on-video layout needs is a spike measurement,
  not a guess — and it may trade power for correctness.
- D13's **0-frame overlay drift** target is now the acceptance criterion for the native module
  rather than an aspiration.

---

## D20 — The shoulder/hip orientation overlay is drawn as a rigid rod, not a fixed-length line

**Date:** 2026-08-10
**Status:** ACTIVE

**Context:** A new player overlay ("Shoulder + hip lines") draws a red bar through the shoulder
pair and another through the hip pair, extended about 100% of the pair's span past each joint so
body rotation reads at a glance without the stick figure.

**The trap:** down the line — which is every fixture we have — both pairs turn side-on to the
camera through impact and their *projected* span collapses. On swing1 the hips span 9px at impact
against an 882px body. At that separation the two keypoints sit inside each other's noise.
Frame-to-frame change in a pair's angle, pooled over all ten fixtures:

| span ÷ body height | n | median | p90 | max |
|---|---|---|---|---|
| <1% | 63 | 13.3° | 62.9° | 89.9° |
| 1–2% | 506 | 0.8° | 6.1° | 73.1° |
| 2–3% | 765 | 0.5° | 2.5° | 59.6° |
| 4–6% | 1766 | 0.1° | 1.3° | 32.8° |
| >10% | 7265 | 0.1° | 0.3° | 5.6° |

**Rejected first attempt:** extend by `max(span, one foot)` so the bar never gets short, and
abstain entirely below 1.5% of body height. It removed the wild rod, but it was wrong twice over.
The floor held the bar at near-constant length through the whole swing, so it stopped reading as
an object attached to the body and read as a label pinned over it — the rotation cue was gone.
And the abstain made the hip bar vanish for a few frames around impact, which is the moment a
coach is looking hardest.

**Decision:** Extend by a **multiple of the projected span with no floor**, and cap each end with
a **ball**. The bar then behaves as a rigid rod skewered through the body: it foreshortens as the
golfer turns away from the lens, stretches back out as they come square, and collapses to its two
end balls when the axis points straight at the camera. The noise problem solves itself — the
frames whose direction is untrustworthy are exactly the frames drawn shortest, so a 60° error
moves a 27px stub instead of swinging a foot-long bar across the picture. Nothing is fabricated
and nothing is hidden: position, direction and length are all measured, and the "collapsed to a
ball" state is a true reading of "this axis is pointing at you".

**Also decided:** below 3% of body height the bar draws dimmed (the angle is real but soft), and
the confidence-based dim sits at **0.4**, not the obvious 0.5. RTMW's confidences on these
fixtures cluster around 0.55, so a 0.5 rule dims 24% of frames and flips state on 1.7% of frame
steps — a rod strobing about once a second, which reads as a rendering fault rather than as a
confidence signal. At 0.4 it dims 1.0% of frames.

**Consequences:**
- `scripts/checkorient.py` is the Gate 1 view and prints the span percentage and the dim decision
  per frame. Its thresholds are mirrored in `apps/web/src/components/SwingStage.tsx`; changing one
  without the other silently desyncs the debug view from the player.
- Check it on **consecutive frames through impact**, not on the event sheet — the behaviour that
  matters is the collapse and re-lengthening, and the eight events sample straight past it.
- Untested against a **face-on** clip, where both pairs stay broad and the bar should never
  collapse. There is still no face-on fixture (CLAUDE.md), so this is asserted from geometry only.
- **The bars moving "before" the golfer is amplification, not lag** (verified 2026-08-10 with the
  frame-stamp test below, which came back in sync). A rod tip travels **2.6×** as far as the joint
  it hangs off, so setup movement that is invisible on the stick figure is obvious on the bars.
  Measured on swing1: through the approach the shoulder joint wanders a 30px envelope and the rod
  tip an 80px one. Averaging the endpoints over a centred window changes tip motion by 0.01px per
  frame — the movement is real and coherent, not jitter, so there is nothing to filter. The only
  lever is `ORIENT_EXTEND`.
- `scripts/stampframes.py` burns ffmpeg's own frame number into a copy of `normalized.mp4`, and
  the "Sync test → Frame stamp" overlay prints the index the canvas painted beside it. This is the
  only frame check in the project that does not compare our work against our own idea of the
  frame. Verified in sync at 0.25x.

---

## D21 — The frame lock gets its own native module, measured by a closed loop, not by self-report

**Date:** 2026-08-10
**Status:** ACTIVE

**Context:** D19 established that both platforms expose a real per-frame callback and that the
frame lock therefore needs one small native module. Step 02 has to turn that from a documented
claim into a number, on hardware.

**Decision:** `apps/mobile/modules/frame-clock` is a local Expo module wrapping Media3's
`VideoFrameMetadataListener` on Android and `AVPlayerItemVideoOutput` + `CADisplayLink` on iOS.
`expo-video` surfaces neither, so this is a peer of it rather than a wrapper. Media3 is pinned to
**1.9.0**, the version `expo-video` resolves — two media3 versions on the classpath fail at
runtime, not at build time.

**The part that matters is how it measures.** Drift is a **closed loop timed entirely in native
code**: the player reports the frame about to be rendered → JS draws its overlay and calls
`markOverlayCommitted(frame)` back → native compares that against the frame actually on the glass
at the instant the call lands. Neither end is a JS self-report, so the result cannot be flattered
by a coalesced timer or a slow clock. The alternative — having JS timestamp its own work — was
rejected because it measures the thing doing the measuring.

**Stated bars, taken from D13 rather than invented here:** overlay drift **p95 = 0 frames** and
seek error **max = 0 frames**. Exactly zero, not "small". A half-frame-late overlay is what a
viewer perceives as the drawing sliding off the golfer, and the project would rather learn now
that the overlay must be drawn natively than ship a player that is nearly synced. Percentiles are
**nearest-rank on both platforms**, so every number reported is one that was actually observed and
the two platforms' columns mean the same thing.

**Also decided:**
- **Both build routes, not one.** Local `npx expo run:android` is the day-to-day path and needs no
  Expo account — this machine already has the Android SDK, NDK and JDK 17, which contradicts step
  02's original note that a dev build was blocked on EAS. `eas.json` is committed alongside it
  because EAS remains the *only* route to iOS (D5/D12).
- **The reference clip is generated and committed** (`assets/frameclock.mp4`, 600 frames, exactly
  60fps CFR, GOP 10, frame number burned in), with `scripts/make-frame-clip.mjs` to regenerate it.
  GOP 10 matches Stage 0, which is what makes probe 2's worst case — a seek target just before a
  keyframe — reachable at all. The burned-in number makes drift checkable by eye, the same
  principle as the analyzer's Gate 1 burn-in.
- **`surfaceType` is a measurement, not an assumption.** Android's default `surfaceView` is faster
  and lower-power; `textureView` composites conventionally and is the documented fix for
  z-ordering with overlapping views. The spike defaults to `textureView` because the layout is
  overlay-on-video, and the choice is switchable so the power cost can be measured rather than
  guessed.
- **pnpm switches to `node-linker=hoisted`** (root `.npmrc`). React Native's Android build cannot
  use the symlinked layout: `expo-modules-core` compiles C++ through CMake + ninja, which resolves
  the same source through both its symlinked and its real `.pnpm/…` path, decides the manifest is
  stale, regenerates, and dies on `ninja: error: manifest 'build.ninja' still dirty after 100
  tries`. This is **not** the path-length problem it resembles — Windows long paths are already
  enabled on this machine, and the `CMAKE_OBJECT_PATH_MAX` warnings alongside it are a symptom of
  the same duplicated prefix. The cost is real and accepted: a hoisted tree is npm-shaped, so pnpm
  no longer catches a package importing something it never declared. The alternative was that no
  Android build works at all, which would block every mobile track in the roadmap.
  *Trap for later:* switching the linker requires deleting every `node_modules` first. A leftover
  `node_modules/.pnpm` keeps resolving and reproduces the identical failure.

**Consequences:**
- **No probe has been run yet, and that is the important caveat.** The Android half is *compiled*
  — `./gradlew :app:assembleDebug` is green, `:frame-clock:compileDebugKotlin` executed, and the
  debug APK exists — but compiling is not measuring. No Android device was attached during this
  session, so every number is still absent. D5 stays provisional on probe 1 exactly as it was
  before this work, and nothing here should be read as evidence that the frame lock holds.
- **The iOS half has never been compiled.** There is no Mac. Treat `ios/FrameClockView.swift` as
  unverified source until an EAS build runs.
- Probe 3 (60fps capture) still has no camera path and is not measurable yet. It is third by
  design: probes 1 and 2 carry the risk that could invalidate D5.
- Two pre-existing machine faults were found while getting Android to build — a malformed
  `ANDROID_SDK_ROOT` and a corrupt NDK 27.1.12297006 install. Both broke *every* Android build on
  this PC, not just this one. See `docs/RUNBOOK.md` §6; the environment variable still needs a
  manual fix.
- **There is no jitter to filter.** Measured over each fixture's stillest pre-address window
  (body moving 0.04–0.69px/frame), the rod tip travels 0.16–1.69px/frame at `ORIENT_EXTEND` 0.5 —
  below visibility. Centred mean and median filters on the angle series, windows ±2 to ±7, change
  the approach angle rate by 0.00–0.03°/frame, because the movement is a smooth ramp and not
  noise: swing1's shoulder angle runs 138.6° → −160° monotonically from f125 to f175 while the
  span grows 43 → 195px. The golfer really is turning through the approach. `ORIENT_EXTEND` is
  therefore the only honest lever, and it was halved to 0.5 for that reason.

---

## D22 — The mobile skeleton drops the knuckle line; hands are read as wrist angle only

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** The web player draws a knuckle line (pinky knuckle → index knuckle) per hand, whose
rotation is forearm roll. Porting the skeleton to mobile put the question in front of a real swing
on a real phone, and the call was made there: **drop it, and read the hands as wrist angle only.**

**Why:** those two keypoints come from RTMW's hand block, which is the least reliable part of the
pose at golf-swing distance. A hand spans a few dozen pixels in a down-the-line clip, so the two
knuckles sit well inside each other's noise — the same geometry that made the shoulder/hip rods
swing wildly in D20 when a pair's projected span collapsed. A forearm-roll cue computed from that
is a confident wrong number, and this project's stated position is that abstaining beats
fabricating.

**What is kept:** the wrist **angle**, which is what the knuckle line was standing in for and what
a coach actually reads. It is the joint between `elbow → wrist` and `wrist → grip_center`, both of
which are drawn and both of which rest on far more reliable keypoints.

**Consequences:**
- `apps/mobile/src/spike/pose.ts` exports `OMITTED_BONES` and a test asserts those bones are
  absent, so the line cannot creep back in with a future copy from the web player.
- **The web player still draws it.** That divergence is deliberate and recorded here rather than
  left to be discovered as an unexplained difference between two renderers. The web player is the
  coach/admin surface (D6), not the golfer-facing client, so it is not urgent — but if the
  reasoning holds there too, it should follow.
- No scoring check reads these keypoints, so nothing measured changes. This is a rendering
  decision only.

---

## D23 — The overlay stays in TypeScript. Drawing it natively is rejected on cost, not on merit

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** Step 02's first real measurement on an S25+ found the JS-state overlay sits **~3.8
frames (≈64ms) behind the video during playback** — median -3.82, p95 4.82, 30/30 samples behind,
measured from device screenshots by `scripts/measure_overlay.py`. That fails D13's stated bar of
p95 = 0. A native-drawn overlay was built to see whether zero was reachable.

**Decision:** **Do not draw the overlay natively.** The native path (`OverlayCanvas.kt`) is removed
rather than left dormant. The overlay stays a single TypeScript implementation.

**Why — the cost was under-weighted when it was built:** drawing natively means writing every
overlay feature **twice, in Kotlin and Swift**: not just the skeleton but the club trace and its
nine smoothing variants, angle arcs, silhouette, butt line and isolation. That logic already exists
as tuned TypeScript, and *"the rendering rules worth keeping are already TypeScript"* was a stated
reason for choosing React Native in **D5**. Drawing natively discards that benefit for the overlay,
doubles every future overlay change permanently, and does so on a project with no Mac to compile
half of it.

**The reframing that decided it:** the lag exists **only while the picture is moving**. The instant
scrubbing stops, JS catches up and drift goes to zero — so a golfer studying a position sees a
perfectly aligned skeleton, and the 64ms is visible only mid-drag and during playback. The
question was never "is 3.8 frames bad" but "does anyone read a *moving* overlay", which is a
product judgement, not a measurement. Taylor made that call.

**Alternatives, and the one still open:**
- *Native draw.* Rejected above. Its zero drift was also only ever **claimed by construction and
  never measured** — the overlay View and the video surface composite through different paths on
  Android, so it might not have been zero at all.
- *UI-thread JS (Skia or a Reanimated worklet).* **Not rejected.** It removes the per-frame bridge
  while keeping the drawing logic in TypeScript, written once. This is the next thing to try if the
  lag turns out to matter, and it should be tried before native is reconsidered.
- *Accept the lag.* The current state. Costs nothing and is correct at rest.

**Consequences:**
- **D13's p95 = 0 overlay-drift target does not hold for playback as written.** It is met at rest
  and missed in motion by ~4 frames. That target needs restating with the at-rest / in-motion
  distinction rather than being quietly missed — this entry is the record that it is knowingly
  unmet, not forgotten.
- The native overlay is recoverable from git (commit `187d09b`) if this is revisited.
- `scripts/measure_overlay.py` and both spike clips remain, so any future strategy can be judged
  by the same instrument rather than by its own self-report.

---

## D24 — Step 03 outcome: RLS is live, and the coach boundary is tested five phases early

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** D7 chose Supabase Postgres with Drizzle retained and made **row-level security the
authorization boundary**. Step 03 had to make that real on a hosted project.

**What now exists** (project `golf-swing`, `xjcjqwcmwoouxczrrvar`, us-west-2, Postgres 17):

- All four migrations applied. `users.id` is a foreign key onto `auth.users` with the default
  dropped — the id comes from the auth system, never from the database, so it is impossible to
  insert a user row that looks valid and can never be logged into.
- RLS **enabled and FORCED** on all eight user-scoped tables, 16 policies. FORCE matters: without
  it the table owner is exempt, and "it worked when I ran it as postgres" is how a missing policy
  stays hidden.
- `private.has_coach_access()` is `SECURITY DEFINER` with `search_path = ''` and an **internal**
  `auth.uid()` check, so a caller can only ever ask "may *I* see this golfer", never about someone
  else. It lives in `private` precisely so PostgREST does not expose it — confirmed by Supabase's
  own advisor, which flags exposed definer functions and did not flag this one.
- Supabase security advisors: **zero findings.** The one finding before this step was
  `public.rls_auto_enable()` being EXECUTE-able by `anon`; migration 0004 revokes it.

**The decision worth recording: one migration runs on both Supabase and local Docker Postgres.**
Migration 0003 creates an `auth` schema shim, an `auth.uid()` that reads the same GUC Supabase's
does, and the `anon`/`authenticated`/`service_role` roles — each guarded so that **nothing is
attempted when the real ones are present**. `create table if not exists auth.users` was the first
attempt and it fails on Supabase: CREATE TABLE IF NOT EXISTS still needs CREATE on the schema, so
it errors before reaching the "if not exists" part.

That shim is not a convenience. It is what lets the authorization boundary be **verified in CI
with no cloud credentials**, which is the difference between a policy that is tested and one that
is only tested where it is expensive to test.

**Coach access is test-covered now, five phases before the feature.** `src/db/rls.test.ts` proves,
against a synthetic relationship: an approved coach reads the linked golfer's swings; a pending
request grants nothing; revocation ends access immediately; an approved coach can never *write*;
and approval for one golfer leaks nothing about another. That last case is the mistake a policy
written as "is this user a coach" rather than "is this user THIS golfer's coach" would make.

**The suite fails rather than skips without a database.** A security test that silently skips
still reports green, which is worse than not having it.

**Deletion cascade in schema terms (D15, item 4c):**

| Data | Mechanism |
|---|---|
| `auth.users` → `public.users` | FK `on delete cascade` |
| `users` → `sessions`, `swings`, `coach_links` (both sides) | FK `on delete cascade` |
| `swings` → `jobs`, `scores`, `head_markers`, `swing_stages` | FK `on delete cascade` |
| `sessions` → `swings.session_id` | `on delete set null` — a swing outlives its session |
| Object storage (source video, every derived artifact) | **explicit sweep required** — no FK reaches it |
| AI conversation history | **explicit sweep**, once `ai-coach` exists |
| Coach-authored annotations | **retained, detached from golfer identity** per D15 |
| Backups | window-bound, not instant; stated in the privacy policy rather than over-promised |

Deleting one `auth.users` row therefore removes every database trace of a golfer. **Everything
outside Postgres needs a deliberate sweep**, and enforcement plus the retention scheduler belong
to `production-readiness`. Every new table or bucket must declare its deletion behaviour when it
is introduced.

**Consequences and what is deliberately not done:**
- The service-role boundary is checked by a **static** test (`src/db/service-role.test.ts`) that
  greps the request surface for service-role credential names. It cannot prove absence — a
  sufficiently indirect construction slips past — but it catches the realistic mistake, which is
  someone importing the key into a route because it was convenient. A runtime check would only
  notice after the credential is already in the request path.
- **The hosted project has no `DATABASE_URL` in the repo and no secret manager yet.** Migrations
  were applied through the Supabase MCP rather than `drizzle-kit migrate` against the hosted
  database. D10's Infisical decision is unimplemented, so production migration remains a manual
  step until it is.
- `pnpm db:migrate`'s hardcoded `node_modules/drizzle-kit/bin.cjs` path broke under
  `node-linker=hoisted` (D21) and is now a plain `drizzle-kit migrate`, with `.env` loaded inside
  `drizzle.config.ts` via Node 22's built-in `process.loadEnvFile`. Still no dotenv dependency.

---

## D25 — Passwordless sign-in is an emailed CODE, not a magic link

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** §4.1 requires passwordless authentication. Step 04's file says "magic link and/or OTP
per step 01's decision" — but **step 01 never recorded one**, so the choice was still open when
step 04 needed it.

**Decision:** email **OTP** — a six-digit code typed inside the app. Not a magic link.

**Why:** a magic link forces an app-switch on the primary platform. Leave the app, open a mail
client, tap a link, and hope the correct app reopens — with deep links that break and links that
open in the wrong browser. For a mobile-first product (§2.1) that is the single biggest drop-off
in onboarding. A code is the same email and the same `signInWithOtp` call, except the user never
leaves the screen. The input carries `autocomplete="one-time-code"`, so iOS and Android offer the
code straight from the notification and the mail app is never opened at all.

There is also no separate sign-up: `signInWithOtp` creates the account on first use. One screen,
one field, no password to choose or forget.

**Alternatives:**
- *Magic link.* Rejected above. Still viable on desktop web, but not worth two flows.
- *Google / Apple social.* Better UX still — one tap. Deferred rather than rejected: Google needs
  an OAuth client, and **Apple is mandatory on iOS if any other social provider ships** (App Store
  guideline 4.8) which pulls the $99/yr developer account forward from step 10. Add both together,
  later, with OTP remaining as the no-account fallback.
- *Phone/SMS OTP.* Per-message cost and worse for account recovery.

**Consequences:**
- **The Supabase email template must contain `{{ .Token }}`.** The stock "Magic Link" template
  contains only `{{ .ConfirmationURL }}`, so out of the box a user receives a link and the code
  field cannot be completed. This is a dashboard setting and is not reachable from the MCP.
- Sign-out uses `scope: "local"`, deliberately: §4.2 requires one account signed in on several
  phones at once because multi-phone capture (§12) depends on it, and a global sign-out would end
  the other device's session.
- The seeded-admin identity is **deleted, not disabled**, per step 04. A one-shot claim hands the
  ten pre-auth development fixtures to the first account that signs in, then removes the admin
  row, so the fixtures stay usable without a fallback identity surviving.

---

## D26 — The RLS boundary is not yet enforced in the running app; ownership is checked in code meanwhile

**Date:** 2026-08-11
**Status:** ACTIVE — with a named gap that must close

**Context:** A security audit of the step 04 login work found two critical defects, both in code
written the same night, and both invisible to review and to a green test suite.

**Finding 1 — RLS is inert in the application.** The app connects to Postgres as `swingsage`,
which is a **superuser**. Superusers bypass row-level security entirely; `FORCE ROW LEVEL
SECURITY` does not apply to them. The app also never sets `request.jwt.claims` or `set role
authenticated`, so `auth.uid()` would be NULL even if the policies did apply. The eleven RLS tests
in `src/db/rls.test.ts` pass because they impersonate correctly — they prove the *policies* are
right, not that the *product* uses them.

This is the most dangerous shape a security bug can take: it looks more secure than what it
replaced, and the tests agree with you.

**Finding 2 — seven of ten API routes had no authentication at all**, including
`/api/swings/[id]/video` (footage of a user), `/analysis`, and `/reanalyze` (an unauthenticated
trigger for GPU work). Identity had been wired into the three routes that already carried the old
seeded-admin shim; the rest were never enumerated. The runbook actively instructs browsing the dev
server from a phone over the LAN, so this was live exposure, not a theoretical one.

**Decisions taken now:**

1. **Every swing-scoped route goes through `requireSwingAccess`**, which checks *ownership*, not
   merely sign-in — "is someone signed in" would let any account read any swing by id. It answers
   **404, not 403**, for an unauthorized swing: confirming that an id exists and belongs to
   somebody is itself a disclosure.
2. **`src/app/api/route-auth.test.ts` enumerates the route files and fails the build** on any that
   does not resolve identity, plus any `[id]` route that checks sign-in without ownership. This
   caught two more routes (`markers`, `stages`) the moment it was written, which is exactly the
   class of miss that produced the incident.
3. **An app-boundary allowlist** (`AUTH_ALLOWED_EMAILS`). Signup is open by construction — public
   project, publishable key in the client bundle — so account creation is separated from
   permission to use the application, and enforced server-side on every identity resolution.
4. **The legacy-fixture claim is gated** behind `CLAIM_LEGACY_FIXTURES`. Giving every fixture to
   whoever signs in first is a privilege grant, and on a LAN-exposed dev server "first" is not
   necessarily the owner.

**The gap that remains, stated plainly:** ownership is currently enforced in *application code*,
which is precisely what D7 rejected. That is acceptable only as a bridge. The fix is architectural:

- create a **non-superuser** application role and connect as it;
- wrap every request in a transaction that does `set local role authenticated` and
  `set local request.jwt.claims`, so `auth.uid()` is real and the 0003 policies actually fire;
- **delete the ambient `db` export** so a query cannot be written outside that helper — if
  bypassing the seam is possible, it will eventually happen;
- then `requireSwingAccess`'s SQL becomes defence in depth rather than the only defence.

Until that lands, **the database is not the authorization boundary D7 says it is**, and this entry
is the record that the gap is known rather than forgotten.

**Also outstanding:** OTP expiry still defaults to one hour for a six-digit code (dashboard
setting, should be 5-10 minutes).

---

## D27 — Function before identity: the foundation steps are resequenced, and two dependencies were overstated

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** Step 04 (auth) was underway and the remaining foundation steps run in a strictly
linear chain: 04 → 05 → 06 → 07/09 → 08 → 10. Taylor asked to get the product more functional
before finishing logins. Auditing the chain to see whether that was even possible turned up two
dependencies that are **stated as hard and are not**.

**Finding 1 — step 06 does not depend on step 05.** 06 (Swing/Session/Equipment model) declares
"Step 05 complete (profiles exist; equipment and swings attach to a real golfer)". What it
actually needs is *a user id to attach rows to*, which step 03 already provides: `users` exists,
every user-scoped table already carries a `user_id` FK, and RLS references it. Roles, onboarding
and profile UI are not prerequisites for a data model. As written, this put the **core domain
model of the product behind two steps of identity plumbing** for no technical reason.

**Finding 2 — step 04 does not depend on step 02 completing.** 04 lists "Step 02 complete (mobile
workspace exists to host the sign-in flow)". The workspace exists. Step 02's open item is device
*measurements*, blocked on hardware that has not been bought. As written, authentication looked
blocked by a phone purchase.

**Decision:** resequence to **06 → 09 → 07**, then return to 04 → 05 → 08 → 10.

Rationale: 06 (the real swing/session/equipment model) and 09 (media addressing) are the two
remaining steps that make the product *do* anything, and both are as un-retrofittable as the
identity work — D3's "build the platform first" argument applies to them just as strongly. This
is a reorder **within** the foundation phase, not a move to product-before-platform, so D3 and
D4 stand.

**Consequences:**
- A **development identity** (`DEV_USER_EMAIL`) resolves every request to one user so features
  can be built ahead of sign-in. Step 04 warns that "a fallback identity that still exists will be
  used by accident", which is correct, so it is built to make accidents impossible: no default,
  a warning on every resolution, and **the app throws at module load if it is set in a production
  build**. Deleted, not disabled, when 04 completes.
- **Step 04 is left in-progress with a known security gap (D26): RLS is inert because the app
  connects as a superuser.** Deferring auth also defers that fix, and the app is LAN-reachable per
  the runbook. Acceptable while the data is ten development fixtures; it must not survive contact
  with a real user's video.
- Step 09's dependency on 06 is real and unchanged — media addressing needs stable swing identity.
- 07, 08 and 10's dependencies are real and unchanged.

---

## D28 — Step 06 is split: the additive model now, the multi-view restructure separately

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** Step 06 asks for eight things at once, and one of them is not like the others. §7.1's
restructure — a Swing owning several **views**, each with its own video and its own analysis
artifact — changes what a swing *is*. Every query in `lib/swings.ts`, the media routes, the player
and the analyzer's `out/<id>/` convention all assume one swing means one video.

**Decision:** ship the **additive** model now and do the multi-view restructure as its own change.

Delivered in migration 0005: the §6 equipment inventory (`clubs`), §8 session fields (goal,
representative swing), §7.2 swing fields (club link, ball, coach-reviewed, analysis version) and
§7.3 organization (favourite, tags, with a GIN index). Every one is additive — no existing column
changes meaning, and the app kept serving throughout.

**Why split rather than push through:** a half-finished identity change to the central table is
the worst possible place to stop, and it is the kind of change that cannot be verified in pieces.
Splitting keeps the tree green and makes the risky half a focused, reviewable change instead of a
rider on six safe ones.

**Two decisions inside the additive half worth recording:**
- **`swings.club` (free text) is kept alongside `club_id`.** The ten analysed fixtures carry a
  typed-in club name and no inventory row; dropping the column would lose it. Rule: `club_id` wins
  when set, `club` is the fallback, nothing needs backfilling to keep working. Step 06 asks for
  exactly this preservation.
- **`clubs.analyzer_club_type` is stored, not derived.** It feeds `--club-type driver|irons`, and
  storing it means the analyzer never has to learn that an equipment table exists — its input
  stays a flag. Deriving it at analysis time would couple the CV pipeline to the product schema.

**Outstanding for step 06:** §7.1 multi-view, §7.2's storage-independent swing identifier (today
`swings.id` is still the analyzer's `out/<stem>` folder name), and §43's questions about session
creation and raw-recording retention. Step 09 (media addressing) depends on the identifier work,
so those two should be done together.

---

## D29 — §43's swing-data questions: sessions are manual, swings move freely, raw video is kept for 30 days

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** Step 06 item 8 requires answering the §43 questions the data model forces. These are
being answered **before** the multi-view restructure rather than after, because each one changes
what that schema has to look like — deciding them afterwards would mean migrating swing identity
twice.

**1. Sessions are created manually, with the app proposing one.**
Automatic grouping by time window guesses wrong in both directions: a range session interrupted by
a coffee break becomes two, and two evenings at the same course become one. Both are annoying in a
way the golfer cannot correct without understanding the rule. So a session is created by the
golfer, and the app *suggests* one when swings cluster in time and place — a suggestion is
correctable, an inference is not.

**2. A swing can move between sessions, and exists without one.**
`swings.session_id` stays nullable and mutable, with `on delete set null` (already the case).
Sessions are an **organizing layer over swings, not an owner of them** — deleting a session must
never delete the swings in it, which is the single most likely destructive mistake in the whole
swing log. A swing recorded before its session exists gets attached later.

**3. Raw recordings are retained for 30 days after successful analysis, then dropped.**
The normalized clip is the record of truth, but it is a *derived* artifact: it has been trimmed,
and a bad trim is only recoverable from the original. Until automatic swing isolation exists (D2
defers it, so `in-app-capture` ships a manual trim), a mis-trimmed swing is a realistic and
unrecoverable loss if the raw is gone immediately.

30 days covers noticing and re-trimming, and bounds the cost: raw phone video is 270-330MB per
swing against a normalized clip an order of magnitude smaller, and
[`SCALE-10K-MAU.md`](SCALE-10K-MAU.md) already makes storage and egress the dominant line item.
Retaining raw indefinitely would multiply the largest cost in the product to insure against a
rare, user-correctable mistake.

**Consequences:**
- The swing model needs a raw-artifact reference with its own lifecycle, distinct from the
  normalized clip — so step 09's addressing must treat "the original" as a first-class artifact
  that can disappear while the swing remains valid.
- The 30-day sweep is machinery `production-readiness` owns, alongside tier-driven retention
  (§30.1), which reuses the same mechanism on a schedule rather than an event.
- A swing whose raw has expired must say so rather than offering a re-trim that cannot work.
- Deleting a session is a safe operation by construction, which is worth keeping true.

---

## D30 — A swing owns views; identity is a uuid and a storage key is never an address

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** D28 split step 06 and left the hard half: §7.1's restructure, where a Swing holds a
down-the-line view, a face-on view, or both, each with its own video and its own analysis
artifact. Before this, one `swings` row *was* one video, and `swings.id` *was* the analyzer's
`out/<stem>/` folder name — so the database key was a disk path, and a second camera was not
representable at all. Four later tracks (`mobile-player`, `swing-ingest`, `dual-device-capture`,
`comparison-and-reference`) are blocked on this.

**Decision:** migration 0006 introduces `swing_views` and moves swing identity to a uuid.

- **A `swings` row is the shot** — one golfer, one club, one moment. It keeps owner, session,
  club, ball, handedness, notes, tags, favourite, coach-reviewed and the primary view's
  denormalized score.
- **A `swing_views` row is one camera's recording of it** — the clip, its storage key, its raw
  original (D29), its frame geometry, its status, its analysis version and its own score. At most
  one view per (swing, view type), so "the face-on view of this swing" is a well-defined thing.
- **Everything frame-indexed moved onto the view**: `jobs`, `scores`, `head_markers`,
  `swing_stages`. This is the load-bearing part. A frame number means nothing without the video
  that counts it, and two cameras on one swing never agree — leaving these on the swing would let
  the second view silently overwrite the first's hand-placed corrections.
- **`media_key` is a key, not a path.** No root, no separators, validated before it is joined to
  `MEDIA_ROOT`. Step 09 turns it into an object-storage prefix by changing values, not columns.
  The old `swings.media_path` held an absolute machine-local path and is gone.

**Three consequences worth writing down, because each was a decision:**

- **Routes still take a swing id, plus `?view=dtl|face_on`.** A golfer's URL names a swing, not a
  camera. `db/views.ts:resolveView` is the one place that turns the pair into a view, and it
  falls back to the primary view, then to the oldest — a swing whose `is_primary` flag was
  somehow never set must still open rather than 404 with its video sitting right there. An
  unrecognised view type is a **400**, not a silent default: quietly serving down-the-line for
  `?view=overhead` would look like the parameter worked. A pre-0006 bookmark
  (`/swing/perfect`) is a 404 rather than a 500, because a uuid column cannot be compared against
  a folder name.
- **The swing-level score is the primary view's, stated rather than averaged.** Averaging two
  cameras' scores would invent a number neither analysis produced — the same reason this project
  refuses to state a face-angle degree from video.
- **"Is this a bundled reference swing?" became a column** (`swings.reference_label`). It used to
  be answered by matching the id against a hardcoded `["perfect", "pro_2"]`, which only worked
  while an id was a folder name. `lib/proSwings.ts` is now a catalogue keyed by storage key that
  the backfill reads once; every other consumer asks the row. This is the minimal honest form of
  §20's professional library, which `comparison-and-reference` builds on top.

**What is NOT done here, deliberately:** no UI switches between views. The step file says to
resist building the log, filters and session views, and a view switcher belongs to
`mobile-player`. The capability is proven by `src/db/multiView.test.ts` — a swing with a 60fps
DTL view and a 120fps face-on view, each addressable by name, each holding its own `impact`
frame, with the second view of a kind and the second primary both refused by the database.

**Also fixed on the way:** `clubs` had RLS policies from 0005 but no table grant, because 0003's
`grant ... on all tables in schema public` is a snapshot rather than a rule. A policy decides
which rows a role may touch, never whether it may touch the table at all, so those policies were
inert. 0006 grants both `clubs` and `swing_views`.

**Found and left alone:** `lib/jobs.ts` spawns `burnin.py` for a re-analysis **without**
`--club-detector runs/clubhead/weights/best.pt`, which CLAUDE.md names as a standing trap —
omitting it silently regenerates the trace on the weaker classical path and overwrites the better
artifact. It is a real bug and it predates this step; fixing it changes analyzer invocation, and
this step's Definition of Done requires `analysis.json`'s contract to be untouched. Recorded here
so it is not rediscovered by accident.

---

## D31 — Sign-in becomes phone, Google and Apple; email OTP is demoted to a temporary path

**Date:** 2026-08-11
**Status:** ACTIVE — supersedes D25's provider choice, not its reasoning

**Context:** Taylor directed that sign-in offer **phone number, Google and Apple, and only those
three**, on mobile-friendliness grounds. D25 chose emailed OTP and deferred social sign-in; that
deferral was about cost and sequencing, not about email being the better mobile experience — D25
itself calls one-tap social "better UX still".

**Decision:** the target sign-in surface is **phone OTP + Sign in with Apple + Google**. Email OTP
survives only as the development and transition path and is **deleted, not disabled**, once all
three are live — the same rule step 04 applied to the seeded admin, for the same reason.

**Every account carries an email address regardless of how it signed in.** This is a recovery and
delivery attribute, not a fourth login method. D25's stated objection to phone auth was account
recovery, and it is correct: a golfer who changes carrier loses a phone-only account permanently.
Google and Apple both supply an address at sign-in (Apple's may be a Hide My Email relay, which is
deliverable and therefore sufficient); phone sign-up asks for one. §29 notifications and §27 coach
messaging need an address anyway.

**Consequences, in cost order:**
- **Apple pulls $99/yr forward from step 10.** Sign in with Apple needs an Apple Developer Program
  membership to issue the Service ID and key. It is not optional once Google ships — App Store
  Review Guideline 4.8 requires an equivalent privacy-preserving option alongside any third-party
  login, and Sign in with Apple is the one that qualifies.
- **Phone is the expensive provider and the one with a registration gate.** Supabase brokers SMS
  through Twilio/MessageBird/Vonage/Textlocal; none has a free production tier. US delivery
  additionally requires A2P 10DLC brand and campaign registration, which is a business-verification
  step with a lead time, not just a fee. Budget ~$0.012–0.013 per message all-in plus a monthly
  campaign fee. **This is the piece to schedule earliest and ship latest.**
- **The flow is buildable for free today.** `SMS_TEST_OTP` maps fixed phone numbers to fixed codes,
  so the entire phone path — screens, session handling, identity reconciliation — is developed and
  tested with no provider and no spend. Only real delivery needs Twilio.
- **Identity linking becomes a real requirement, not a nicety.** The same person signing in with
  Google and later with Apple must land on one account. Apple's relay address defeats
  match-by-email, so linking is explicit rather than inferred.
- Google is free but needs OAuth client IDs created interactively in Google Cloud Console
  (separate clients for iOS, Android and web; Android needs the signing-key SHA-1).
- §4.2's multi-device requirement is unchanged and still governs: sign-out stays `scope: "local"`.

**What did not change:** D25's reasoning about magic links stands — nothing here reintroduces an
app-switch. All three providers keep the user inside the app.

### Amendment, same day — Android first; Apple is sequenced behind a working Android build

Taylor has no Apple hardware to sign anything with, so **Sign in with Apple is deferred until the
Android client is complete and working**, and Android is the priority platform for every sign-in
surface built meanwhile. This is a sequencing decision, not a scope cut: D31's Guideline 4.8
reasoning is unchanged and Apple remains mandatory before any iOS submission. iOS is testable
on demand in the meantime, but nothing is gated on it.

**Order of work, therefore:** Google (free, Android-native) → phone on test OTPs (free) → Apple
(when there is a working Android build and the $99 membership is bought) → real SMS delivery
(when A2P 10DLC registration clears). Email OTP survives until Google and phone are both live on
Android, then goes.

**The development phone number is a reserved test number, not Taylor's real one.** A test OTP
never sends an SMS, so the number needs only to be well-formed — using a number from the reserved
`+1 555 555 01xx` testing range gets an identical flow with no personal data in a config file and
nothing to scrub later. Taylor's real number matters on exactly one day: the day real delivery is
switched on.

**This forces the local Supabase stack, and that is the right outcome anyway.** Test OTPs are a
CLI/self-hosted feature (`[auth.sms.test_otp]` in `supabase/config.toml`, `SMS_TEST_OTP`
self-hosted). A **hosted** project has no test-number setting — phone login there requires a real
SMS provider. So the free phone path runs against `supabase start`, which the repo does not have
yet (there is no `supabase/` directory) and which step 09 wants regardless for its
credential-free local media path. One piece of setup, two steps unblocked.

**Guard rail:** whenever a test OTP is configured, set `SMS_TEST_OTP_VALID_UNTIL` alongside it so
it expires by date rather than by someone remembering. A test credential that merely *should* be
removed before production is the same class of mistake as the fallback identity D27 built to throw
at module load.

---

## D32 — One way in for everyone; what differs for coaches is onboarding and listing, never authentication

**Date:** 2026-08-11
**Status:** ACTIVE

**Context:** Taylor asked for a simplified flow for standard users and "a different flow for coaches
signing up, and even logging in", with an account that can be upgraded to coach later. The
instinct is right and the requirement is real; the question is *which layer* forks. Getting that
wrong is expensive in a way that is invisible until it isn't.

**Decision:** **authentication is one system with one identity.** There is no coach sign-in and no
coach sign-up. Three things fork instead, in increasing order of friction:

1. **Sign-in — does not fork at all.** One screen, three buttons (phone, Google, Apple per D31),
   no role question. Nobody should have to know what they are before they can log in.
2. **Onboarding — forks, and defaults to golfer.** Everyone lands in the golfer flow and reaches a
   swing fast. §4.4's role choice is offered but never blocks; a coach "just exploring" is a normal
   account that has not claimed the coach role yet, and claiming it later costs nothing.
3. **Appearing in the coach directory — a reviewed application, and the only real gate.** §23.1
   carries credentials, certifications and verified status; §31.5 makes listing approval,
   visibility, verification and suspension administrative functions. That is an application with an
   admin decision attached, not a signup path.

**The load-bearing split is between holding the coach role and being listed.** Holding the role is
free and instant — it unlocks the coach workspace with an empty roster, which is exactly what an
exploring coach needs. Being discoverable by strangers is what requires review. So the friction
lands at the point where someone else's golf video becomes reachable, and nowhere earlier.

**Why not a separate coach sign-in, explicitly:**
- §3 opens with "a single account may have one or more roles" and §3.3 requires personal golfer
  activity and coaching activity to be separated **"without requiring separate accounts"**. Two
  auth paths produce two identities, and Taylor's own upgrade-later requirement then becomes a data
  migration rather than a row change.
- It is *more* resistance, not less. A separate coach login forces a user to classify themselves
  before they have an account, and a coach who taps the golfer button and is told "no account
  found" has had the worst possible first experience.
- Session handling, RLS policy and the entitlement seam would each need a second shape. The RLS
  work already shipped in step 03 keys off *roles and relationships*, which stays correct under
  this decision and would not survive the other one.

**Consequences:**
- Roles are a set on one account (§3.3), never an account type. Step 05 already requires this; this
  decision makes it load-bearing rather than incidental.
- **A coach is a golfer too, by default.** Coaches film their own swings, and §3.3 anticipates
  exactly this. The golfer surface is never hidden from a coach account.
- Role checks stay server-side and in RLS policy (step 05's quality standard), so "upgrade" is a
  role grant with no re-authentication and no new session.
- The coach application and its admin review belong to `admin-surface` (§31.5) and
  `coach-relationships` (§23), both phases away. Step 05 builds only the role model and the
  public/private profile split those will need — step 05's own note already forbids more.
- **Open, deliberately:** whether an unlisted coach may be attached by direct invite from a golfer
  who already knows them, bypassing the directory. It is the natural least-resistance path for a
  real coach's existing clients and it needs a decision before `coach-relationships`, not now.

---

## D33 — A storage key is derived from identity, not stored; the analyzer keeps its folders

**Date:** 2026-08-11
**Status:** ACTIVE — amends D30's prediction about `media_key`

**Context:** Step 09 had to get media off `SWINGSAGE_MEDIA_ROOT`, the single hardest blocker to the
analyzer running anywhere but this laptop. D30 predicted the mechanism: rewrite `swing_views.media_key`
from the analyzer's `out/<stem>` folder name into an object-storage prefix, "changing values, not
columns".

**Decision:** the values were not changed either. A storage key is **derived** from identity the
database already owns — `users.id` / `swings.id` / `swing_views.id` / `artifact_revision`, assembled
in `apps/web/src/lib/media/keys.ts` — and never stored.

**Why deriving beat storing.** A stored key is a second source of truth for something the row
already encodes, and it can drift: a wrong value is a silently unreachable swing, and nothing in the
schema can catch it. A derived key cannot disagree with the identity it encodes, needs no backfill,
and makes "is this artifact where it should be" a pure function rather than a lookup. The step's own
words were "stable keys derived from swing/view identity" — *derived* turned out to be the whole
instruction.

That leaves `media_key` holding exactly one meaning, which it always really had: **the analyzer's
working-directory name.** `burnin.py` has never heard of this database and still writes `out/<stem>/`.
Conflating that folder with the product's addressing is what made the media unmovable in the first
place, so the two are now separate concepts with separate names.

**The scheme** (`infra/storage/README.md` has the full table):

```
swing-artifacts:  u/<userId>/s/<swingId>/v/<viewId>/r<revision>/<artifact>
swing-source:     u/<userId>/s/<swingId>/v/<viewId>/source/<filename>
```

- **The owner leads** so a Supabase Storage policy can express ownership at all — a policy can only
  reason about path segments, and `storage.foldername(name)[2] = auth.uid()` is the door this keeps
  open.
- **The revision separates analysis runs.** Object storage has no rename-into-place, so a
  re-analysis writes `r<n+1>` alongside `r<n>` and only then does the row point at it. A golfer
  mid-scrub finishes the session on the artifacts they started it with. That is an *ordering*, not a
  lock, and it is what makes the step's "does not orphan or overwrite artifacts another session is
  reading" true rather than aspirational.
- **The source sits outside the revision** — re-analysis produces new artifacts from the same
  upload, so a source that moved with the revision would be copied for nothing and hand D29's 30-day
  expiry several objects to chase instead of one.

**Two buckets, not one**, because D29 expires the raw upload after 30 days while its artifacts live
as long as the swing. A single bucket needs a single retention rule, and the only rule satisfying
both is the longer one — which would quietly keep every raw upload forever and break D29 without
anything appearing to go wrong.

**Publishing is a separate act from analysing.** `burnin.py` still writes `out/<stem>/` exactly as
before — the pipeline is untouched and the CLI workflow the analyzer's development depends on needs
no cloud anything. `lib/media/publish.ts` then copies that directory into the store. This is what
step 09 meant by "change where artifacts land, not what the analyzer produces", and it is also what
makes the `analyzer-service` track a deployment rather than a redesign: a hosted worker publishes
from its own scratch directory through the same function.

**Consequences:**
- **Cloud is opt-in.** `MEDIA_DRIVER` selects the driver and is never inferred from the Supabase
  env vars, because this environment has those set for *auth* while its media is local — inference
  would point every read at a bucket that does not exist and report it as a missing swing.
- The local driver **hard-links** from the analyzer's output, so publishing ten fixtures cost ~0
  extra disk (verified: link count 2, 104 artifacts published). It falls back to a copy across
  volumes.
- Video playback on the cloud driver is a **307 to a signed URL**, so range requests are answered by
  the CDN. Proxying every seek's byte range through Next.js would put a round trip in front of the
  one interaction this product is judged on. The URL TTL is six hours, chosen to outlive a viewing
  session rather than as a security parameter — a URL that expires mid-scrub breaks seeking in a way
  indistinguishable from the frame-sync bugs this project spends its effort avoiding.
- `multiView.test.ts`'s artifact assertion was deliberately re-aimed: it used to check the file was
  on disk under `out/<stem>/`, and now checks it is **published at the revision the row says is
  current** — a view marked ready but never published is the failure this move could introduce, and
  from the database side it looks identical to a healthy row.

**Deferred, loudly:** storage-level RLS policies. The driver holds a credential that bypasses
`storage.objects`, exactly as the hosted worker will need to, so media authorization still rests on
`requireViewAccess` in the route — where it rested when media came off local disk, so no regression,
but not the end state. Writing policies while a bypassing credential does the reading would ship a
second inert boundary, and this project has already paid for that twice (D26's superuser connection;
D30's `clubs` policies with no table grant behind them). It lands with D24's "scope the analyzer's
service role to specific tables", which is the same problem.

**Verified, not merely written:** both buckets exist in `golf-swing` and the cloud path was exercised
end to end — 11 artifacts published in 6.1s, `analysis.json` read back, and a signed URL answering
`Range: bytes=1000-2999` with **206 `bytes 1000-2999/5496355`**. Range requests survive the network
path, which is the one property this step could not afford to get wrong.

**Found while provisioning, and it matters to `media-pipeline`:** the Free plan caps uploads at
**50 MB per file** — a project-level setting, not a bucket one, which is why a 2 GB bucket limit was
refused. A phone swing video is 270–330 MB, so the source bucket cannot hold one today. Nothing
uploads from a device until `media-pipeline`, so this blocks nothing now, but it makes that track's
on-device trim and compression a *fit* requirement rather than a bandwidth optimization. The
alternative is Pro, which raises the ceiling to 500 GB. Recorded so it is not discovered late.

**Also outstanding:** buckets exist per *environment* only in the sense that one environment exists.
A preview Supabase project is free (the Free plan allows 2 active projects per organization, and
`golf-swing` is the only active one), so this is a deviation from D10 waiting on a decision, not on
money.

---

## D34 — Step 02's probes measured on a Galaxy S25+: all three frame-exactness probes FAIL, and one of them was reporting a false PASS

**Date:** 2026-08-11
**Status:** ACTIVE — resolves D5's "provisional on probe 1" to **not confirmed**, for a reason that
is about architecture rather than about the platform

**The measurements**, on `SM-S936U1` (Galaxy S25+, Android 36), pulled from logcat by
`apps/mobile/scripts/pull-probe-results.mjs` rather than read off the screen:

| Probe | Reported | Honest | Distribution |
|---|---|---|---|
| 1 · overlay locked to presented frame | ~~PASS~~ | **FAIL** | n=229 · p50 **−1** · p95 0 · max 1 · **10.5% exactly locked** · JS lead p95 48.6 ms |
| 2 · frame-exact seeking | FAIL | FAIL | n=20 · p50 1 · max 1 frame |
| 2b · overlay locked while scrubbing | FAIL | FAIL | n=136 · p50 0 · p95 **12** · max 12 · 55.9% exactly locked |
| 3 · sustained 60 fps capture | — | unanswered | still `blocked-dev-build` |

### Probe 1 was passing a run in which the overlay was correct 24 times out of 229

`judgeOverlayDrift` gated on `stats.p95 <= 0`, and `FrameStats.percentile` sorts **signed**
samples. A run sitting mostly at −1 therefore produced a p95 of 0 and passed — while the very same
detail line said `p50 −1` and `10.5% exactly locked`.

A signed percentile cannot express "how far off are we", because early and late cancel instead of
accumulating. `judgeSeekError` never had the bug; it always used `Math.abs`. **The two judges
disagreeing about that was the entire defect**, and the tests never caught it because every case
they exercised had a positive p95.

This is the standing trap in CLAUDE.md, in a new domain: *a check that scores well is not evidence
the check works*. Nine rotation checks once shipped reading a quantity that moved the wrong way and
one of them scored 100. Same shape, different file. The gate is now `exactShare >= 1` and the
reported value is the share NOT locked, so the number cannot read as healthy while the overlay is
adrift. The real S25+ distribution is now a regression test.

### The failure is the architecture the WEB player already abandoned

`SpikeScreen` marks the overlay committed inside a `useEffect` on `overlayFrame` — that is, when
React commits state. `apps/web/src/lib/usePlayer.ts` documents exactly what that costs, from having
paid it:

> *"the commit and its effects land after the browser has already painted the video frame they
> describe. The canvas then catches up on the next paint and the overlay sits permanently one frame
> behind the picture."*

`p50 = −1` is that sentence as a number. The web fix was to paint **synchronously inside
`requestVideoFrameCallback`** from the presented index (`onPresentedFrame`), bypassing React state
for the canvas alone, so "the canvas and the picture now agree by construction".

**So probe 1 has not yet tested whether Expo/React Native can hold frame sync on Android.** It
tested whether driving an overlay through a React state commit can, and reproduced the known answer
to the frame. That distinction is the difference between "the mobile framework choice is wrong" —
which would change the whole mobile plan — and "we drove it wrong".

### What is genuinely learned

- **Seek (probe 2) is a real `expo-video` finding**, independent of the overlay path: seeking lands
  consistently **one frame late** (p50 1, max 1, n=20). Stage 0's GOP 10 bounds it, but the bar is
  zero. Note n=20 is below `THRESHOLDS.minSamples` (120) and `judgeSeekError` does not apply the
  too-few gate that `judgeOverlayDrift` does — a second inconsistency between the judges, and the
  seek verdict should be re-measured with more targets before it is treated as settled.
- **Scrub (probe 2b) at p95 12 frames** is the most alarming number, and it conflates seek accuracy
  with overlay paint, so it cannot be attributed until probe 1 is re-run on the corrected
  architecture.
- **D5 remains provisional**, and is now provisional on a *sharper* question: can a synchronously
  painted overlay hold zero drift on Android under Expo 57 / RN 0.86?

### Decision

Re-run probes 1 and 2b with the overlay painted synchronously from the native frame callback rather
than through a React commit, before `mobile-player` is designed. That is one more spike iteration
and it is worth it: the alternative is building the largest single piece of UI risk in the product
on an unknown, having already built the instrument that can answer it.

Probe 2 additionally needs more seek targets to clear `minSamples`.

---

## D35 — The overlay was never late; the instrument was subtracting the decoder's lead

**Date:** 2026-08-11
**Status:** ACTIVE — supersedes D34's reading of probe 1, which was measured on a biased instrument

**The run that settled it** (S25+, Android 36, after D34's ceiling probe landed):

| Probe | paint | n | p50 | exactly locked | JS lead p95 |
|---|---|---|---|---|---|
| 1 · overlay | `react-state` | 261 | **−2** | 0.4% | 49.2 ms |
| 1b · ceiling | `sync-ack` | 301 | **−3** | 0.7% | 49.1 ms |

**Removing React entirely made the number WORSE.** That is the signature of a measurement bias
rather than a rendering cost — a real cost cannot go up when work is removed. The ceiling probe
D34 added to separate "the platform cannot" from "our renderer is too slow" answered a third
question instead: *the instrument is wrong*.

**What it was really measuring.** `onFrameRendered` fires ~49 ms before the frame it names reaches
the glass — about **three frames at 60 fps**, and `leadTimeMs` p95 says exactly that. JS acked
immediately; `markOverlayCommitted` then compared against `onScreenFrame()`, which is what is
displayed *at the instant of the ack* — three frames older. An overlay drawn immediately and
perfectly early therefore scored **−3**. The `react-state` path scored −2 because the React commit
delay was **partially cancelling the lead**, which is why the broken architecture looked better.

The negative numbers were never lateness. They were earliness, with a minus sign.

**This is the third version of the same mistake, in the third direction.** `FrameClockView`'s own
comment records v1: comparing against the newest *queued* frame, which inflated drift by the lead
and "read p95 = 2 frames against a measured lead of ~33ms — the bias *was* the result". v2 fixed
that by comparing against what is on screen, and thereby introduced the mirror image. Both versions
answered "how far apart are these two numbers right now", when the question is **"was the overlay
ready in time?"**

**Decision:** `markOverlayCommitted(N)` now looks up frame N's own scheduled display time and
compares it against the clock. Committed before N was due → **0, locked**; committed after →
counted in frames late. Early is zero, because a lead is a budget to draw in, not an error.

**What this means for D5, stated carefully because the measurement has been wrong three times:**
a JS-driven overlay has a **~49 ms budget** on this device — roughly three frames at 60 fps — to
draw in before the frame it describes is displayed. That is a large budget and it is the number
that decides whether the web player's architecture ports. **It is not yet evidence that the overlay
is locked**; that requires re-running probes 1 and 1b on the corrected instrument. D5 stays
provisional until it does.

**Unchanged by this**, because they are measured independently of the overlay path:
- **Seek is one frame late, consistently** — now on 128 samples, over the `minSamples` bar of 120,
  with the GOP worst cases included. `expo-video`/media3 with `SeekParameters.EXACT` lands on N+1.
  That is a real finding and it stands.
- **Scrub p95 12 frames** stands as measured, but it conflates seek error with overlay paint and
  cannot be attributed until probes 1 and 1b re-run clean.

**Requires a rebuild** — this is Kotlin, not JS. The iOS half needs the mirror change and still
cannot be compiled here (no Mac), so it is written but unverified, exactly as D31's amendment
allows for Android-first.

---

## D36 — Overlay sync on Android WORKS: 99.2% frame-locked. Seek is one frame late. Scrub is unresolved.

**Date:** 2026-08-11
**Status:** ACTIVE — resolves D5's core question; supersedes D34/D35's provisional readings

Measured on `SM-S936U1` (Galaxy S25+, Android 36), driven from this machine over wireless
debugging, on the instrument corrected in D35.

| Probe | Result | n | Verdict |
|---|---|---|---|
| 1 · overlay during playback, React state | **99.2% locked**, p50 0, p95 0, max 1 | 250 | works |
| 1b · ceiling, synchronous ack, no drawing | **99.0% locked**, p50 0, p95 0, max 2 | 301 | works |
| 2 · frame-exact seek | p50 **1**, max 1 | 128 | one frame late, consistently |
| 2b · scrub, seek-then-react | 0.0% locked, p95 25 | 126 | not measurable — see below |
| 2c · scrub, draw-then-seek | 2.0% locked, p95 25 | 50 | not measurable — see below |
| 3 · 60 fps capture | — | — | unbuilt; needs a camera dependency |

### The headline: D5 survives, and the web player's architecture ports

**A JS-drawn overlay holds the presented frame 99.2% of the time on Android**, with a **~49 ms
lead** — about three frames at 60 fps — as the budget to draw in. Two things follow, and both are
design inputs for `mobile-player`:

- **React state is not the bottleneck.** The ceiling probe removed React and the renderer entirely
  and scored *no better* (99.0% vs 99.2%). The synchronous-paint discipline `usePlayer.ts` needs on
  the web is not required here; the lead absorbs it.
- **Plain rotated `View`s are fast enough.** `Skeleton.tsx` warned that if the JS strategy failed
  on cost, the renderer was a suspect and "the retest is Skia before concluding that JS drawing
  cannot keep up". It did not fail. **Skia is not needed**, and that probe is cancelled rather than
  deferred.

The residual ~1% is a handful of samples at 1–2 frames out of 250–301. Under a bar of exactly zero
these still read FAIL, and that is left standing rather than softened: the bar was set deliberately
in D13 and moving it to accommodate the first measurement that nearly clears it is how a threshold
stops meaning anything. Whether 99.2% is shippable is a `mobile-player` judgement made with eyes on
a real swing, not a number to re-legislate here.

### Seek lands one frame late, consistently

p50 1, max 1, over 128 samples including every GOP-offset worst case, with
`SeekParameters.EXACT` set explicitly. It is not jitter and not a GOP artifact — it is a constant
off-by-one, which means it is **correctable**: `mobile-player` can request `N−1`, or offset the
overlay by one frame on the seek path. Verify the compensation rather than assuming it.

### Scrub is unresolved, and the instrument is why

Four revisions in, scrubbing still cannot be measured honestly. The current confound: the sweep
passes back and forth over the same frames, so `markOverlayCommitted` matches a **stale schedule
entry from an earlier pass** and scores a fresh commit against a display time from seconds ago.
That is why 2c reads p50 13 while doing the ideal thing, and why only 50 of ~153 seeks scored at
all — during a fast scrub most target frames are never decoded, because a newer seek cancels them.

**Deliberately stopped here.** The instrument has been wrong in three different directions already
(D35), each time convincingly, and a fourth attempt to measure scrubbing by closed loop is worse
value than the alternative: `scripts/measure_overlay.py` reads the drawn marker and the burned-in
bar out of the *same screenshot*, after compositing, which is the one measurement that cannot be
argued with. Scrub belongs to that tool and to `mobile-player`'s own verification, not to this
spike.

**What is genuinely known about scrubbing:** a seeked frame is displayed essentially on arrival, so
there is **no lead** on the scrub path — unlike playback's 49 ms. Any mobile scrub design must
therefore commit the overlay for a target it already knows, rather than react to a frame event.
That is a real constraint and it survives the measurement problem.

### Consequences

- **D5 is no longer provisional on probe 1.** Expo 57 / React Native 0.86 holds frame-locked
  overlay during playback on Android. It remains unverified on iOS, where no hardware exists.
- Step 02's remaining gaps are probe 3 (capture, needs `react-native-vision-camera`) and scrub,
  which is reassigned rather than blocked.
- The `frame-clock` module has earned its keep and should NOT be deleted with the rest of the
  spike: `mobile-player` needs the same frame callback, and `expo-video` still does not expose one.

---

## D37 — Capture: 60fps holds and is verified from the file; 120 and 240 exist in silicon and silently degrade to 60

**Date:** 2026-08-11
**Status:** ACTIVE

Five recordings on the S25+, every one measured by decoding the file rather than by asking the
camera:

| requested | decoded frames | duration | **achieved** |
|---|---|---|---|
| 60 | 411 | 6.902 s | **59.55** |
| 60 | 270 | 4.502 s | **59.98** |
| 120 | 594 | 9.920 s | **59.88** |
| 240 | 590 | 9.920 s | **59.48** |
| 240 | 597 | 9.953 s | **59.98** |

**60 fps holds.** 1920×1080, sustained across a full ten seconds, at or fractionally above the
59.5 bar. §2.3's floor is met on this device.

**120 and 240 return 60 without an error.** That is the silent degrade §2.3 names, and it is the
entire reason this probe judges the artifact instead of the request: every clip *claimed* to be
what was asked for, and only the decoded frame count said otherwise.

### The hardware is not the limit — the library is

`adb shell dumpsys media.camera` reports `CONSTRAINED_HIGH_SPEED_VIDEO` in the back camera's
capability set, plus a populated `android.control.availableHighSpeedVideoConfigurations`
(int32[50] — ten configurations). The silicon does high-speed capture; Samsung's own slow-motion
mode uses it.

VisionCamera v5's `device.supportsFPS()` answers **false** for 120 and 240, and reports `[60]` as
the full set. It configures an ordinary `CameraCaptureSession`, and Android exposes high frame
rates only through `CameraConstrainedHighSpeedCaptureSession`, which v5 does not surface.

**So the finding is:** *this device can shoot 240; this library cannot ask it to.* That is a
`in-app-capture` problem with three known options — contribute high-speed session support
upstream, drop to a Camera2/CameraX path for capture alone, or accept 60 — and it is recorded now
rather than discovered when the capture screen is being built.

**Why it matters beyond spec compliance:** impact is over inside a single frame at 60 fps. That is
part of why `analysis.json` carries no impact face angle, why the club detector is weakest exactly
where the swing is fastest, and why `checktrace.py` exists at all. 240 fps would ease every one of
those. It is not a nice-to-have; it is the highest-leverage capture decision in the product.

### Two instrument bugs found and fixed while measuring this

- **The recordings were pulled with `adb shell`,** which allocates a PTY and translates newlines on
  Windows. Every file was corrupted — and ffprobe still parsed enough header to return a
  plausible-looking duration while `-count_frames` failed. A corrupted artifact that still answers
  questions is worse than one that fails outright. `adb exec-out` now, everywhere binary moves.
- **All three rates wrote to one probe id,** so the puller's last-wins rule silently discarded the
  60 and 120 results and reported only 240. Three measurements taken, one kept. Ids are now
  `capture@60` / `capture@120` / `capture@240`, each judged against its own request.

Both are the same class of mistake this project keeps paying for: a measurement that looks healthy
and is not.

### D37 amendment, same day — the device offers 1080p120 and 1080p240, and CameraX 1.5 can reach them

Decoding `android.control.availableHighSpeedVideoConfigurations` (tuples of width, height, minFps,
maxFps, batchSize) on the S25+ back camera:

```
1920×1080  30–120        1920×1080  120–120
1920×1080  30–240        1920×1080  240–240
1920×824   30–120
```

Both 120 and 240 at full 1080p, in hardware. The block is entirely the session type: VisionCamera
v5 opens an ordinary `CameraCaptureSession`, and these configurations are reachable only through
`CameraConstrainedHighSpeedCaptureSession`. No parameter crosses that gap.

**CameraX 1.5 added a high-speed API** — `SessionConfig` plus `HighSpeedVideoSessionConfig`,
covering 120/240/480 — and its frame rate is *guaranteed on successful configuration* rather than
hinted, with support queried via `CameraInfo.getSupportedFrameRateRanges(SessionConfig)`. That is
the practical route.

**One trap, recorded before it is stepped in:** CameraX's `setSlowMotionEnabled` must be **false**.
Set true, CameraX re-times the high-speed stream and writes a standard **30 fps** file — a 240fps
capture would reach the analyzer as 30fps, every derived frame index would be wrong, and the file
would look perfectly healthy. That is D37's silent degrade one layer deeper, and it is the exact
shape of failure this project has paid for repeatedly.

**Preferred route:** a small native Expo module wrapping CameraX high-speed video, built in
`in-app-capture`. `frame-clock` already proves the pattern — a local Expo module in Kotlin, driven
from JS — so the ground is known. Camera2 directly is the fallback; upstreaming into VisionCamera
is not, because it puts a launch-blocking capability outside our control.

**Why this is worth real effort rather than accepting 60:** impact is over inside a single frame at
60fps. That is part of why `analysis.json` carries no impact face angle, why the club detector is
weakest exactly where the swing is fastest, and why the trace refuses to draw through the strike on
`pro_2`. 240fps eases all three at once. It is the highest-leverage capture decision in the product.
