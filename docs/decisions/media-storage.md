# Media & Storage

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Media lives in Supabase Storage, behind a driver seam

**Decision:** Supabase Storage holds both source uploads and derived artifacts, reached through a
`lib/media` seam with a credential-free local driver and a Supabase driver. Artifacts are
published from the analyzer's working directory.
**Gotchas:** Supabase Free caps uploads at **50 MB/file**, well below a 270–330 MB phone video —
relevant to `media-pipeline`. Range requests are verified over the network path (206 responses).
**See:** ARCHIVE D8, D33.

### Ingest is two-phase and the client uploads directly to storage

**Decision:** A captured or imported clip becomes a swing in two calls, never one.
`POST /api/v1/swings` creates the swing + view and answers with an `UploadTarget`
(`{url, method, headers, expiresIn}`); the client sends the bytes to that target itself;
`POST /api/v1/swings/:id/source/complete` verifies the object landed and enqueues the analysis.
The bytes never pass through the API — a serverless function cannot accept a request body the size
of a phone video, so proxying is not a slow path but an impossible one. `lib/ingest.ts` owns both
phases; `MediaStore.signedUploadUrl` mints the target.
**Gotchas:** A driver that cannot sign returns `null`, and the ingest hands back
`PUT /api/v1/swings/:id/source` on this server instead — that is how the whole capture loop runs
with no cloud account, and **the client never branches on the driver**: it sends the file exactly as
the target describes. That route refuses when the driver *can* sign, so an object never has two ways
to arrive. Supabase signed upload URLs live **2 hours, fixed** — Storage exposes no TTL parameter, so
the value is reported rather than chosen. The stored name is derived (`original.<ext>` from a closed
content-type set), never the client's filename, so nothing in a request body can steer where an
object lands — and completion re-derives it, so there is no pending-upload state to persist.
Completion **verifies** rather than believes: the client uploaded to a different host, so an
unchecked claim becomes a worker failure minutes later that no golfer can act on.
**What this leaves to `media-pipeline`:** transport only — resumable/chunked upload, background
survival, wifi policy, the offline queue. All of it swaps *how* the bytes travel behind
`uploadSwingVideo()`; neither phase has an opinion about the transport.

### A storage key is derived from identity, never stored as an address

**Decision:** Keys are **derived** from a swing's identity at read time. `media_key` was
deliberately *not* rewritten into a stored prefix. The analyzer keeps its own folder layout on
disk; the seam maps between them.
**Gotchas:** A stored path is an address, and an address goes stale the moment anything is
renamed or re-analysed. This is why re-analysis does not break media resolution.
**See:** ARCHIVE D30, D33.

### Storage-level RLS is deferred, deliberately and with a reason

**Decision:** No `storage.objects` policies yet. The media driver holds a credential that bypasses
them, so writing policies now would ship an **inert boundary** — the exact failure that made
database RLS decorative for several steps.
**Status:** Closes when the analyzer service role is scoped, in `analyzer-service`.
**See:** ARCHIVE D24, D42.

### Capture and the local library work offline; analysis requires connectivity

**Decision:** Recording a swing, the local swing library, and playback of already-downloaded
swings all work with **no network**. Analysis requires connectivity and queues until it has it.
**Scope:** A swing recorded with no signal is never lost — the durable retry queue is a
`media-pipeline` deliverable, not an optimisation.
**See:** ARCHIVE D11.

### Raw recordings are kept for 30 days after successful analysis

**Decision:** The normalized CFR clip is the record of truth. The raw phone original is retained
**30 days** after analysis succeeds, then dropped.
**Scope:** Every bucket declares its deletion behaviour when introduced; deletion itself is in
[auth-identity.md](auth-identity.md).
**See:** ARCHIVE D29.

### Transferring ownership of a swing moves its media, always

**Decision:** A storage key leads with the owner's id (`u/<userId>/s/<swingId>/v/<viewId>/…`), so
any change to `swings.user_id` must be accompanied by `MediaStore.movePrefix()` across **both**
buckets. Ownership transfer is a data move, not a column update.
**Gotchas:** The failure is silent and does not look like a bug in the code that caused it — the
swings still list, and every one of them has no thumbnail and no video, because each derived key
resolves to an object nobody ever published there. `db:claim-fixtures` did exactly this once.
**Scope:** Applies to every future owner change — a coach transfer, an account merge, identity
linking (D31). §4.3 deletion already sweeps `u/<userId>` for the same reason.
**See:** ARCHIVE D33, D45, D47.

### Delivered content is keyed under the recipient

**Decision:** A video lesson's media (audio + `lesson.json`) lives under the **student's**
prefix — `u/<golferId>/l/<lessonId>/…` — with the coach as author in the DB row. Delivered
lessons are the student's to keep: student deletion removes them with the student's swings;
coach deletion leaves them intact (the author renders as a tombstone name). Drafts sit
under the same key, hidden by RLS until sent; unsent drafts are purged on relationship end
or coach deletion. Coach drill demo videos are authored content, not delivered content —
they stay under the coach (`u/<coachId>/dr/<drillId>/…`), die with the coach's account, and
tombstone in any feed that referenced them.
**Gotchas:** Storage keys are derived from identity, never stored — which is exactly why
author-keyed lesson media would be wrong: coach deletion would either destroy the student's
lesson library or force a re-homing migration against keys that cannot be rewritten.
**See:** ARCHIVE D60; `.claude/architecture/coach-video-lessons-2026-08-18.md`.
