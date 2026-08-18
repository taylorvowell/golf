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
**Gotchas:** Deleting a session must never delete the swings in it. That is the single most likely
destructive mistake in the whole swing log. Automatic grouping by time window guesses wrong in
both directions and a golfer cannot correct it without knowing the rule — a suggestion is
correctable, an inference is not.
**See:** ARCHIVE D29.

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

### Job dispatch is Upstash QStash; job state lives in Postgres; the worker host is OPEN

**Decision:** Upstash QStash dispatches analysis jobs and job state stays in Postgres — the
queue carries dispatch, never truth. The loop is **built and proven locally** against the QStash
dev server (`pnpm --filter web queue:e2e`): dispatcher (`lib/jobs/dispatch.ts`) → QStash →
worker HTTP server (`service/server.py`) → `pipeline.run()` → artifacts and events back through
`/api/internal/jobs/*`. The queue path sits behind `JOBS_DRIVER=queue`, opt-in and never
inferred, with the spawn path still the local default. **The worker HOST (and production QStash
credentials) remain the open half** — step 01 measured pose 2.32x faster on CUDA, which prices
Railway's missing GPU; the choice is spend and sits with Taylor in `../HANDOFF.md`.
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
**Status:** **Not met.** One project exists. A preview project is free; the third needs Pro at
$25/mo — a spend decision, so it is [`../HANDOFF.md`](../HANDOFF.md)'s, not Claude's.
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
