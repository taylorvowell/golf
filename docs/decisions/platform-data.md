# Platform & Data

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Supabase Postgres with Drizzle; RLS is the authorization boundary

**Decision:** Supabase hosts Postgres and identity. **Drizzle stays** as the query layer and
migration tool. Row-level security — not application code — is the authorization boundary,
including for coach access to golfer data.
**See:** ARCHIVE D7, D24.

### The application connects as a non-superuser, and every query goes through `withUser()`

**Decision:** The app connects as `swingsage_app` — NOINHERIT, no superuser, no BYPASSRLS, not a
member of `service_role`. Every query runs inside `withUser()`: a transaction that sets
`request.jwt.claims` and `set local role authenticated`, both reverting on commit. `withUser`
asserts four properties against the live connection and **refuses to serve** otherwise. There is
no ambient `db` export — data modules take the transaction as their first argument.
**Gotchas:** RLS on a superuser connection is decorative; policies exist and are silently
bypassed. That was true here for several steps. `app.ensure_profile()` is SECURITY DEFINER, takes
its identity from `auth.uid()` internally, and lives in a schema PostgREST does not serve — it was
callable by `anon` over REST while it sat in `public`.
**See:** ARCHIVE D42, which closes the gap D26 opened.

### A swing owns views; identity is a uuid and a storage key is never an address

**Decision:** A swing is a uuid and owns one or more `swing_views` (down-the-line, face-on).
Storage keys are **derived** from identity at read time, never stored as an address.
**See:** ARCHIVE D30, D33.

### Sessions organize swings; they never own them

**Decision:** A session is created **manually** by the golfer, with the app *suggesting* one when
swings cluster in time and place. `swings.session_id` is nullable and mutable with
`on delete set null` — a swing exists without a session and moves freely between them. A session
carries a **session focus** — proposed by the coach at the explicit start from goals, priorities
and the previous session (`PROJECT_MAIN.md` §8.2) — which concentrates per-swing analysis
emphasis and quick feedback for that session, and persists across sessions until improvement is
sustained.
A session row carries `name` and `session_type` (`swing_analysis` | `practice_drills` |
`video_only`, CHECK-constrained text, defaulting to `swing_analysis`). The row is minted on the
**first recorded swing**, never on entering session mode — opening the camera and walking away
leaves nothing behind. `name` is **null until the golfer renames it**: the app's own "Session 4"
is a number it counted, and storing it would make every session look renamed to the swing log,
which keeps its date title precisely when the name is null. `session_type` **locks once the
session has swings** (server-enforced, 409 `type_locked`) — every swing in it was captured under
one promise, and a late flip rewrites what the golfer's history claims about swings already hit.

**Quarantine** — `practice_drills` and `video_only` swings never feed a durable number. It is
enforced in the client's aggregation (`sessionize`/`sessionStats`/`logStats`, the home screen's
`latestSessionStats`, and the progress window), not by a database constraint: the rows are still
the golfer's own data and must stay readable, countable and visible. Excluded means **absent**,
never zero — a quarantined session still counts as a session and still shows its swings, and
simply contributes no average, no best and no trend point.

**Gotchas:** Deleting a session must never delete the swings in it. That is the single most likely
destructive mistake in the whole swing log. Automatic grouping by time window guesses wrong in
both directions and a golfer cannot correct it without knowing the rule — a suggestion is
correctable, an inference is not. Time inference does not go away when session rows arrive: every
swing recorded before session mode has no `session_id`, so the log groups by id where there is
one and by the two-hour gap where there is not.
**See:** ARCHIVE D29, D61.

### Frame stills are extracted on demand and cached as revision-addressed artifacts

**Decision:** `GET /api/v1/swings/:id/frame?f=<n>` (or `?checkpoint=<P-code>`, resolved through
the artifact's own `checkpoints` table) serves one exact frame of `normalized.mp4` as a JPEG.
The still is extracted with ffmpeg (`-ss frame/fps` — exact because the clip is CFR) and written
to `stills/f<n>.jpg` under the **revision prefix** (`stillKey()` in `lib/media/keys.ts`), so it
is immutable, swept by the deletion cascade and `movePrefix`, and extracted at most once. The
`?poster=1` variant of `/thumb` crops cell (0,0) of the 6×4 contact sheet server-side (sharp) —
grid geometry is the analyzer's business, never the client's. First consumers: the mobile home
screen's photography (hero, sliders), its you-vs-pro strip (two swings frozen at the same
coaching position), and the player's stage placeholder (`/frame?f=0` — pixel-for-pixel the
decoder's first paint, so the poster-to-video handoff is seamless; the tiled contact sheet it
replaced is now served only where a whole-swing scan is wanted).
**Gotchas:** Extraction failing (no ffmpeg on the host, no `normalized.mp4`) is a **404, not a
500** — to a client it is the same permanent "no such image" as a pre-route swing, and UI built
on it must remove itself rather than show half a comparison. The long-term shape is the analyzer
pre-rendering checkpoint stills at publish time onto these same keys, which turns the route into
a pure cache hit — the web host then needs no ffmpeg at all (relevant when the worker host
decision lands).

### The API is versioned in the path and the contract is generated from one schema

**Decision:** Four rules, each enforced by something that fails rather than by convention:
1. Every route is under `/api/v1/`; a route test fails on anything unversioned.
2. `packages/schema` holds JSON Schema for `analysis.json`, `coach_report.json`, `silhouette.json`
   and every API body. TypeScript is **generated** from it and both clients import it.
3. The analyzer validates against the **same** schema files before writing (`swingsage/contract.py`).
4. Evolution is **additive only** — `schemas/shape-lock.json` locks 526 nodes, and a removal,
   retype, new-required field or dropped enum value fails the suite.

Plus `GET /api/v1/client` and a **426 UpgradeRequired** path, enforced in `proxy.ts` and rendered
as a terminal screen on mobile.
**Gotchas:** A native client cannot be force-updated. `analysis.json` reached `schema_version: 9`
while the web client shipped in the same commit; every one of those changes would have been an
outage on a store build.
**See:** ARCHIVE D41.

### Deleting a swing is owner-only, media first, one cascading row delete

**Decision:** `DELETE /api/v1/swings/:id` removes one swing end to end: every object under
`swingPrefix(userId, swingId)` in **both** buckets first, then one `delete` from `public.swings`
whose FK cascades take views, jobs, scores, markers and stages. The response is the contract's
`SwingDeletion` (`swingId`, `mediaObjects`), never a 204 — a partial deletion must be
distinguishable from a complete one. The mobile client (`deleteSwing` in `useSwings`) updates its
cached list only from the confirmed response and notifies every mounted log, because the log stays
mounted under the stack while the player deletes.
**Gotchas:** **Owner only, never a coach** — read access is owner-or-coach everywhere else, and
this route deliberately does not reuse `requireViewAccess`; RLS's owner-only `swings_write` backs
it up. 404 covers "no such swing" and "not yours" alike. Media before rows is `deleteAccount`'s
order for `deleteAccount`'s reason: a failed sweep loses nothing and retries, the other order
orphans unenumerable bytes. Confirmation lives in the client; a flag on the wire would be theatre.

### The Next.js app is the coach and admin surface, not the golfer surface

**Decision:** The existing web app becomes the coach workspace and admin area. The golfer surface
is the mobile app.
**See:** ARCHIVE D6.

### Job dispatch is Upstash QStash; job state lives in Postgres; the worker runs on Modal

**Decision:** Upstash QStash dispatches analysis jobs and job state stays in Postgres — the
queue carries dispatch, never truth. The loop is **built and proven locally** against the QStash
dev server (`pnpm --filter web queue:e2e`): dispatcher (`lib/jobs/dispatch.ts`) → QStash →
worker HTTP server (`service/server.py`) → `pipeline.run()` → artifacts and events back through
`/api/internal/jobs/*`. The queue path sits behind `JOBS_DRIVER=queue`, opt-in and never
inferred, with the spawn path still the local default. **The worker host is Modal** — a
signature-verified HTTP endpoint QStash pushes to, serverless GPU with scale-to-zero and
per-second billing, which is the honest shape for a job that runs ~76s a few times an hour and
is idle the rest of the time. **Scheduled work uses QStash schedules, never a second scheduler.**
Only the production credentials remain, in `../HANDOFF.md`.
**Gotchas:** The worker sees only URLs and a signed per-job token — no DB or storage
credential; the web app stays the single owner of media addressing, and internal-route writes
run under the enqueuing user's identity (no elevation on a request path, D26). A
`PipelineError` is an answer: the worker acks it 200 so QStash never retries a deterministic
refusal; only infrastructure failures 5xx into the retry schedule. `WORKER_CLUB_DETECTOR` must
be set explicitly (path or `none`) — the club detector is never defaulted, per the standing
trap.
**See:** ARCHIVE D9, D18.

### Queue policy: fairness, dead letters, orphans, backpressure

**Decision:** The queue path polices itself; every threshold is env-tunable with defaults in
`lib/jobs/policy.ts` (pure, DB-free, unit-tested), never inline. Four mechanisms:
**Fairness** — every publish carries QStash flow control keyed by the enqueuing user
(`user:<id>`, `JOBS_FLOW_PARALLELISM`, default 1 concurrent delivery), so a burst queues
behind itself, never in front of other users. **Dead letters** — every publish names a
failure callback (`/api/internal/jobs/<id>/failure`); when QStash exhausts retries (3, its
exponential backoff) the route settles job + view `failed`, writes the reason into
`jobs.error` (its first writer), and records the `dlqId` in the job log. Its credential is
the job token recovered from the dead message's own body (`sourceBody`) — the `body` field
(the destination's response) is never trusted for identity, and the web side still holds no
QStash signing key. **Orphans** — the events route stamps `jobs.last_event_at` on every
worker post; `reconcile()`'s queue branch settles `running` rows silent past
`JOBS_QUEUE_HEARTBEAT_TIMEOUT_S` (default 900 — must survive the club stage's multi-minute
quiet stretch on CPU) and `queued` rows older than `JOBS_QUEUE_PENDING_TIMEOUT_S` (default
3600 — the backstop behind the failure callback). **Backpressure** — enqueue refuses,
user-readably, once the actor holds `JOBS_MAX_ACTIVE_PER_USER` (default 3) active queue jobs,
counted by swing ownership join, not RLS visibility (which would count coach-readable rows).
**Gotchas:** Refusals (`PipelineError`, acked 200) never retry and never dead-letter — only
infra failures reach the DLQ, so the failure callback firing always means infrastructure.
Every done event self-reports `elapsedS` (true pipeline seconds) into the job log — telemetry,
never a golfer-facing surface.
**Capacity model (measured 2026-08-18, this machine, feeding the SLO row below):** a 5.4s
60fps clip (322 CFR frames) took **341s end-to-end** on CPU pose + GTX 1080 club detector —
worker single-flight ⇒ ~10.5 jobs/hour/worker. Step 01 measured CUDA pose 2.32× (70.4 →
30.4 ms/frame); pose is roughly half the wall clock, so a CUDA host projects to ~4.5 min/job
(~13/hr) and the p95 < 180s SLO still fails on a single worker of this class — meeting it
needs a faster host class and/or horizontal workers behind per-user flow control, which is
exactly the sizing question the worker-host HANDOFF decision (spend) must answer.
**See:** ARCHIVE D9, D18, D26.

### The analysis bottleneck is the club-trace variants, not pose

**Decision:** Per-stage wall clock is measured, not assumed: **273.5s** for a full run, of which
the `variants` stage — **eight full club re-solves kept so a human can compare club solutions on
real pixels** — is **72%**, and the two pose passes together are **11%**. `variants` is a
development instrument (`AnalysisRequest.club_variants`, default `True`); a production job sets it
`False` and the job drops to ~76s with no new hardware. Pose on CUDA is worth a further ~18s, so
the ORDER is **variants first, host second**.
**Gotchas:** This corrects the attribution in the capacity model below — the 4.5-6.8 min/job figure
was real, but reading it as "pose is slow, therefore buy a GPU" was wrong by roughly a factor of
six. Never turn `club_variants` off for FIXTURE runs: comparing solutions on real pixels is exactly
what it exists for, and club quality has been overstated three separate times by trusting a number
instead of looking at the frame.
**See:** `.claude/architecture/swing-analysis-speed-2026-08-18.md` — the full per-stage table, the
end-to-end latency budget and every remaining lever. ARCHIVE D18, D53.

### Model assets have committed hashes and a stated source; a worker without them refuses to start

**Decision:** Every model file the pipeline loads is declared in
`services/analyzer/service/models.py` with a `sha256`, a size and a source, and is fetched at
container start by `service/entrypoint.sh` — never baked into an image layer, because these
files are retrained and overwritten locally and a layer would version them silently. Public
assets (the MediaPipe landmarker, the MMPose RTMW/RTMPose onnx) carry their URL literally.
The one private asset, the fine-tuned club-head `best.pt`, carries an env var name instead
(`SWINGSAGE_CLUB_WEIGHTS_URL`) and is published through the media store the web app already
owns: `pnpm --filter web models:publish` hashes it, uploads it to the `swing-models` bucket
under a **content-addressed** key, and prints both the hash and a signed URL. D26 is intact —
the worker still holds no storage credential and knows nothing about buckets. A hash is
verified on the temp file **before** the atomic rename, so a partial download can never become
the file the pipeline loads, and `service/server.py` runs the same check before binding its
socket: a worker that cannot analyse must never accept a job.
**Gotchas:** `SWINGSAGE_MODEL_GROUPS` (default `pose,club`) states which assets a deployment
needs — an asset is never quietly dropped because it happened to be absent. A `club_detector`
path that is not on disk is now a `SpecError` at spec-parse time rather than a failure after
the pose passes have burned five minutes, which is the worker-side half of the standing
never-default-the-club-detector rule. Retraining the detector is deliberately a two-line
commit: the manifest hash changes in the same commit as the re-publish, or the check fails.
`SWINGSAGE_SKIP_MODEL_BOOTSTRAP=1` is the opt-out for running the test suite in the image.

### Three environments, each with its own Supabase project

**Decision:** local / preview / production, each with its own Supabase project, storage buckets
and secrets.
**Status:** **Partly met.** One project exists (`golf-swing`, the local/dev one); `swingsage-prod`
is created in the production-stack pass. Supabase Free allows **2 active projects**, so dev +
production fit. **The preview project is what forces Supabase Pro** — it is the third, and it is
also the cheapest reason to upgrade. Until then, preview deployments point at the production
project's schema on a separate branch, which is a real (and named) shortfall, not a design.
**See:** ARCHIVE D10.

### SLO targets

**Decision:** The initial targets, instrumented by `observability-and-slos` and load-tested by
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

**Gotchas:** The p95 target is **not currently met and is not known to be achievable** — a
~520-frame fixture takes ~5.5 minutes on this machine. Real per-swing cost and latency on the
hosted worker is an explicit `analyzer-service` deliverable; these numbers get revised there with
measurements rather than quietly missed. Overlay drift is the one target with no tolerance.
**See:** ARCHIVE D13.

### Notifications are one table every channel fans out from; emission has one door

**Decision:** §29's backbone is `public.notifications` (migration 0013) — the source of truth
push, email and the in-app bell all project from. Emission is ONLY `app.notify()`, a
`SECURITY DEFINER` function, because emission crosses users (a coach action notifies a golfer)
and an insert policy cannot express that safely; the table has no INSERT policy at all.
Grouped delivery (D60's collapsing conversation messages) is a data-model property: a partial
unique index on `(user_id, group_key) where read_at is null` folds repeat events into one open
row whose `count` grows; reading closes the group. The inbox is PERSONAL — owner-only RLS, no
`has_coach_access` — and the client's only write is `read_at`, enforced by a column-level
grant. The kind list is one enum, mirrored between the table check and
`api.schema.json#/definitions/notification`, grown additively and always together. API:
`GET /api/v1/notifications` returns list + unread count in one answer;
`POST /api/v1/notifications/read` acks by ids or all (body, never an `/:id` route).
**Gotchas:** 0008's default privileges hand `authenticated` full write on every new table —
0013 must revoke back down (the RLS suite caught the ack policy exposing every column).
`app.notify` is safe only while the `app` schema stays out of PostgREST's exposed list.
Delivery channels (steps 03/05) fan out FROM rows, never mint their own.
**Emitting one, from any feature:** inside a `withUser` transaction, call
`notify(tx, { userId, kind, title, body?, data?, groupKey? })` from `@/lib/notifications` —
never an INSERT, never a second helper. `userId` is the RECIPIENT (not the actor: a coach
commenting notifies the golfer). `kind` must already be in the enum — growing it means editing
`api.schema.json#/definitions/notification`, the table's check constraint and the mobile glyph
map together, in one change. `title`/`body` are the final copy the inbox renders; the client
never writes copy for a row. `data` is the deep-link payload the destination screen reads
(`{ swingId }`, `{ conversationId }`) and is schema-open by design. `groupKey` is what makes
repeat events COLLAPSE while unread — pass a stable per-thread key (`conversation:<id>`) for
anything that can arrive in bursts, and omit it for one-off events. Emission never decides
delivery: push and email fan out from the row, so an emitter never calls a channel.
**See:** `.claude/feature-tracks/notifications/01 - The Notification Backbone.md`;
`apps/web/src/db/notificationsRls.test.ts`;
`apps/mobile/src/features/notifications/` (the read surface).

### Coaching conversations are one feed; messages are immutable, referenced objects carry state

**Decision:** Coach↔golfer communication is a **conversation substrate**: `conversations` +
`conversation_participants` + `messages`, where every exchange — text, a video lesson, a
review request, a drill assignment, a plan update, a shared swing — is a typed message
entry rendered as a card in one chronological feed. The lesson list, the review queue and
the message thread are filtered views over this log, never separate systems. Messages are
immutable after insert (soft-delete tombstones only); workflow state (a review request's
open/answered) lives on the referenced object and the card renders it live. The schema is
generic N-participant user-to-user; conversation creation is gated on an approved
`coach_links` relationship, and relationship end freezes the thread read-only for both
sides. Per-participant `last_read_at` provides unread counts. Delivery is push-driven
refresh via the notifications system; Supabase Realtime on the messages table is the
designed live-update seam. Report (admin-visible row) and block (freezes the thread) live
in the substrate — a UGC store-review requirement.
**Scope:** `lessons` hang off a **swing view** (the event log is frame-indexed, and
everything frame-indexed hangs off a view); `review_requests` carry the open/answered
state; `lesson_drills` joins attachments. `drills` carries `author_type system|coach` +
nullable `author_id` (+ RLS) — coach drills are one authorship dimension on the one drill
model, always plain class (never coach-authored check specs).
**Gotchas:** The job `kind` discriminator is `swing | drill | demo | lesson_finalize` — the
latter three are short CPU-only work in the fast lane, never queued behind swing
club-tracking. Plain-drill completion is a self-report: coach roll-ups label it
self-reported and never mingle it with camera-verified rep counts.
**See:** ARCHIVE D60; `PROJECT_MAIN.md` §26.4, §27;
`.claude/architecture/coach-video-lessons-2026-08-18.md`.

### Production infrastructure is stood up once, now — there is no local-tunnel interim

**Decision:** SwingSage runs on its production vendors from the moment it leaves the LAN, and
the roster below is the whole roster — **any vendor not on this list is not in the system.**

| Concern | Vendor | Why this one |
|---|---|---|
| Auth + Postgres | **Supabase** — Free now, **Pro ($25/mo) at launch** | Once media moved to R2, Pro buys exactly three things: no 7-day idle pause, daily backups, and more than 2 active projects. None binds before there is user data or a preview environment, and **the upgrade is in-place** — same project, same URL, same keys, no migration. **Upgrade trigger: the third environment, or the first real golfer's swings.** PITR is a further paid add-on and is NOT needed. |
| Object storage | **Cloudflare R2** | Zero egress. Same Cloudflare account as DNS, so no new vendor. |
| DNS + domain + CDN | **Cloudflare** (free + ~$12/yr) | |
| API + coach/admin web | **Vercel** — Hobby now, **Pro ($20/mo/seat) at launch** | Native host for `apps/web`. Hobby's bar is *revenue* — ads, payments, client work, a monetized product — and a pre-launch project with no store listing and no payment flow is none of them. Its caps (100 GB transfer, 1M edge requests, 1M invocations, 4 CPU-hours/mo) are far above solo-dev volume, and custom domains, SSL, previews and Fluid compute are all included. **Upgrade triggers: the store listing goes live, or a route needs Pro's 800s function ceiling (only coach-chat SSE will).** |
| Analyzer worker | **Modal** | Serverless GPU, scale-to-zero, per-second billing. ~$0.02/swing at L4. |
| Job dispatch + schedules | **Upstash QStash** | pay-as-you-go, ~$0 at launch volume |
| App builds + push | **Expo EAS** (free) | Used from the FIRST build so the signing SHA-1 never changes. |
| LLM | **Anthropic** via **Vercel AI Gateway** (BYOK) | See [analysis-and-ai.md](analysis-and-ai.md) for the per-job tiers. |
| Media models (TTS, image, video) | **Replicate** | Never in the coaching-text path. |
| Crash + error tracking | **Sentry** — **DEFERRED** (Taylor, 2026-08-22) | `@sentry/react-native` (Expo config plugin, EAS source maps) + `@sentry/nextjs` when it lands. Still **launch-blocking**: crash-free sessions is an SLO with no other instrument. Deferring is safe because adoption is one SDK + one DSN with no rework — unlike the EAS signing identity, nothing about waiting is irreversible. Re-opens in `observability-and-slos`. |
| Product analytics | **PostHog** — **DEFERRED** (Taylor, 2026-08-22) | §37's product-event funnel, pseudonymised, when it lands. Its error tracking is NOT used — Sentry's RN support is materially better. Re-opens in `observability-and-slos`. |

**$0/mo fixed today** — every vendor sits on a free tier. **~$45/mo at launch**, when Supabase and Vercel go paid together. Plus ~$12/yr for the domain, ~$0.02 per swing analysed, and Anthropic per use.

**Upgrade before the store listing is live, never after.** Vercel enforces its commercial-use line by suspending the project, and both upgrades are in-place — no migration, no key changes — so there is no reason to be late.

**Secrets live in the platforms that run the code** — Vercel environment variables, EAS secrets,
Modal secrets, each scoped to its own runtime. There is **no secrets vendor**; a central vault is
a team-scale pattern that here would add a vendor, a sync step and a new single point of failure.
Three environments (dev / preview / production) stand.

**Vercel functions and the Supabase project are pinned to the same region.** Set it at project
creation — it is a `vercel.json` line now and a migration later.

**Transactional email is deferred.** Sign-in is Google, Apple and phone OTP over Twilio Verify, and
Supabase's built-in mailer covers the residual at launch volume. Resend when that stops being
true, not before.

**Scope:** Answers the long-open worker-host question (ARCHIVE D18, D53): **Modal**. It is
the right shape for what was actually built — the worker is a signature-verified HTTP
endpoint QStash pushes to, single-flight, from an 8.4GB image, running ~76s a few times an
hour and idle the rest of the time. Serverless GPU with scale-to-zero and per-second
billing bills that pattern honestly, where a rented GPU VM bills 24/7 for ~2% utilisation.
An L4 is sufficient; a 2016 GTX 1080 already gave 2.32× on pose (D53).

**Gotchas:** **Railway is not the API host and is not in the system.** Vercel's 4.5 MB request-body
cap is the usual reason a video product leaves Vercel, and it does not apply here — ingest is
two-phase and the client sends bytes straight to storage, so the API never carries a video body.
Every remaining route is short, and Fluid compute's 800s Pro ceiling covers the coach-chat SSE
stream; the multi-minute work is on Modal by design. Railway would add a second compute vendor and
idle billing for nothing the design needs. **OpenRouter is likewise rejected**: a router sits in
the prompt path and becomes a data processor subject to the no-training / short-retention rule,
satisfiable only in a ZDR mode that shrinks the model pool — while Vercel already sees every
prompt, so AI Gateway adds none. It also charges 5.5% where the gateway charges zero.
Another explicitly rejected alternative was hosting the API while tunnelling to the
analyzer on the developer's desktop GPU — cheaper, and available the same day, but it is
precisely the interim build the standing infrastructure constraint exists to forbid, and it
makes a range session depend on a PC being awake. **EAS is used from the first build for the
same reason:** an EAS build is signed by an EAS-managed keystore whose SHA-1 differs from a
local build's, and the signing identity is permanent from the first store upload, so
switching build routes later means re-registering every OAuth client. The
`com.swingsage.spike` → `com.swingsage.app` rename happens in the same pass, for the same
irreversibility reason. **Media lives in R2, not Supabase Storage**, and the argument
that briefly said otherwise was wrong on the facts. It claimed Supabase Storage carried
"the storage half of the authorization boundary" via `storage.foldername(name)[2] =
auth.uid()`. It does not, and `supabaseStore.ts` says so in its own header: the driver holds
`SUPABASE_SECRET_KEY`, a credential **not subject to the `storage.objects` policies**, so
authorization rests entirely on `requireViewAccess` in the route. There are no storage
policies — the key scheme is built so there *could* be, deliberately unwritten because
shipping a policy while a bypassing credential does the reading is the inert-boundary
mistake D26 already cost this project once. So the live model is private bucket +
service credential + route-resolved ownership + short-lived signed URL, which is **exactly**
what R2 does. Nothing is given up, and the economics are decisively better for a video
product: R2 charges **zero egress**, against $0.09/GB past 250GB. R2 also needs no new
vendor — it is the Cloudflare account already being opened for DNS. **The remaining gap is not
infrastructure:** `media-pipeline` is unbuilt, so a swing is still a ~300MB upload; the
production answer is the analysis-proxy-first lever, not a hosting change.

**See:** ARCHIVE D9, D10, D18, D53; `docs/HANDOFF.md` (the production-stack row);
`production-credentials.local.txt` (gitignored, the fill-in-once sheet);
`.claude/architecture/swing-analysis-speed-2026-08-18.md`;
`.claude/architecture/production-vendor-stack-2026-08-22.md`.
