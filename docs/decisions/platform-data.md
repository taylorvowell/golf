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

### The Next.js app is the coach and admin surface, not the golfer surface

**Decision:** The existing web app becomes the coach workspace and admin area. The golfer surface
is the mobile app.
**See:** ARCHIVE D6.

### Job dispatch is Upstash QStash; job state lives in Postgres; the worker host is OPEN

**Decision:** Upstash QStash dispatches analysis jobs and job state stays in Postgres. **The
worker host is an open decision** — Railway has no GPU, and pose inference currently runs on CPU
while only the club detector uses GPU. The first `analyzer-service` step is a CPU-vs-CUDA
measurement, and that measurement chooses the host.
**Status:** OPEN. Decide before the `analyzer-service` track starts.
**See:** ARCHIVE D18, which reopens the Railway half of D9.

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
