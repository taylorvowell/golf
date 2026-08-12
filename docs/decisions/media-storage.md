# Media & Storage

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Media lives in Supabase Storage, behind a driver seam

**Decision:** Supabase Storage holds both source uploads and derived artifacts, reached through a
`lib/media` seam with a credential-free local driver and a Supabase driver. Artifacts are
published from the analyzer's working directory.
**Gotchas:** Supabase Free caps uploads at **50 MB/file**, well below a 270–330 MB phone video —
relevant to `media-pipeline`. Range requests are verified over the network path (206 responses).
**See:** ARCHIVE D8, D33.

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

### `filmstrip.jpg` — the scrubber's picture, one artifact rather than N requests

**Decision:** The analyzer writes `filmstrip.jpg` beside `analysis.json`: **one row of 12 clean
frames**, centre-cropped to 3:4, sampled evenly across `playback_window`. It joins the `ARTIFACTS`
manifest, publishes with everything else, and is served by `GET /api/v1/swings/:id/filmstrip`.
`scripts/refilmstrip.py` adds it to a swing analysed before it existed.
**Gotchas:** It carries **no metadata**, and that is the contract — the cell count and cell shape
are constants in `swingsage/render.py`, so a client maps cell `i` onto a frame from the playback
window it already holds. Changing either without changing every client silently misaligns the
scrubber. It is emphatically **not `contact.jpg`**, which burns the skeleton in and stamps a frame
number on every tile: right for reading a swing at a glance in a debug folder, wrong under a
golfer's thumb, where two renderings of the same pose a centimetre apart would disagree. Cell
*centres* sit at evenly-spaced frames, so the picture under the playhead can be up to half a cell
— about 4% of the swing — from the frame the playhead names; it is a preview, and the video above
it is the authority.
**Scope:** One ~30–60 KB fetch and one decode, against twelve of each for individual thumbnails.
This product is used on a course on cellular, and that is the whole argument. A short read repeats
the previous cell rather than going black — a black gap reads as "the swing is missing here",
which is a claim about the golfer's video that a failed seek has no business making.

