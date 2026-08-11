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
