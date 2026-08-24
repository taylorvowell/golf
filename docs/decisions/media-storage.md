# Media & Storage

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Media lives in Cloudflare R2, behind a driver seam

**Decision:** Cloudflare R2 holds both source uploads and derived artifacts, reached through a
`lib/media` seam with a credential-free local driver and an S3-API driver. Artifacts are
published from the analyzer's working directory. The live authorization model is **private
bucket + service credential + route-resolved ownership + short-lived signed URL** — the driver
holds a credential that bypasses any bucket policy, so authorization rests entirely on
`requireViewAccess` in the route, not on storage-level rules.
**Gotchas:** R2 charges **zero egress**, which is the whole argument for a video product —
Supabase Storage bills $0.09/GB past 250 GB and would dominate the bill by mid-year-one. R2 is
the **same Cloudflare account** already opened for DNS, so it adds no vendor. Range requests are
verified over the network path (206 responses).
**Status:** The decision is R2; `apps/web/src/lib/media/` currently ships `localStore.ts` and
`supabaseStore.ts` and **no R2 driver**. `r2Store.ts` behind the existing `MediaStore` interface
is the outstanding build item — the seam is exactly what makes it a driver swap and not a
migration.
**See:** ARCHIVE D8, D33, D64; `.claude/architecture/production-vendor-stack-2026-08-22.md`.

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
**What the phone sends is the TRIMMED clip**, never the take it was cut from. The take is a
30-second recording; the swing is the five seconds around the strike the golfer marked, and
uploading the source would cost minutes of a range's data to analyse footage of somebody walking
back to the ball. `uploadSwingVideo()` in `apps/mobile/src/features/session/processing.ts` is the
seam, and the whole run lives at module scope rather than in a screen — the golfer walks back to
the ball while it uploads, and a hook would abort it the moment they left the post-swing screen.
**A video-only session still uploads.** `POST .../source/complete` takes `analyze: false`, which
stores the clip and leaves the view at `uploaded` with no job (answering `{status: "idle"}`, the
contract's own word for "no run was ever started"). Skipping ingest entirely would leave the only
copy of the swing in a cache directory the app sweeps. `analyze` defaults to **true**, so a client
that has never heard of video-only cannot accidentally store a swing nobody will measure.
**What this leaves to `media-pipeline`:** transport only — resumable/chunked upload, background
survival, wifi policy, the offline queue. All of it swaps *how* the bytes travel behind
`uploadSwingVideo()`; neither phase has an opinion about the transport. Today's transport is one
`PUT` of the whole file with no resumability and no background survival — named here so it is a
known shortfall rather than a discovered one.

### Analysis runs on the queue in production and as a child process locally

**Decision:** `startCaptureAnalysis` picks from `JOBS_DRIVER`: `queue` publishes to QStash for the
hosted worker, anything else spawns `burnin.py` as a child of the web server. Both write the same
`jobs` row, so the client polls one shape (`GET /api/v1/swings/:id/reanalyze`) and renders progress
identically. The client maps the job's own stage names onto the five it shows a golfer and **never
interpolates between them** — a queue nobody is draining reads "Queued" for as long as that is
true.
**Gotchas:** The spawn path needs the uploaded clip as a file this machine can open, which is what
`MediaStore.localPath` answers — the cloud driver returns null, and that null is what stops a
production deployment quietly assuming its objects are local. Re-analysis and first analysis share
one spawn implementation because everything after "which file, which angle, which hand" is
identical, and the parts that make it safe (publishing to the NEXT revision before the row moves,
marking the view failed rather than leaving it analysing) are exactly what a second copy drifts on.
Both now pass `--club-detector` when `WORKER_CLUB_DETECTOR` names one; omitting it silently
regenerates the trace on the weaker classical path.
**How it is verified:** `pnpm --filter web capture:e2e` runs the whole loop on this machine through
the same functions the phone calls.

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

### The video route serves the uploaded original until the normalized clip exists

**Decision:** `/api/v1/swings/[id]/video` serves `normalized.mp4`; while that artifact has not
been published yet, it falls back to the view's uploaded original in the source bucket. A swing
is watchable from the moment its upload lands — the analyzer is not a gate on playback.
**Scope:** Nothing frame-accurate is promised over the original (it may be VFR and has no
artifact), and nothing is drawn on it. The client bakes the swing's status into the source URI
(`?src=upload` while unanalysed), so the player re-prepares onto the normalized copy when the
swing turns ready rather than looping the raw clip under an overlay.

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
