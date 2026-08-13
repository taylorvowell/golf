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
trap. Per-user fair queuing (flow-control keys), retry/DLQ policy and remote-orphan detection
are later steps of `analyzer-service`.
**See:** ARCHIVE D9, D18.

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
