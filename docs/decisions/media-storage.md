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
