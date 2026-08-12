# Build & Roadmap

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### One full-product launch; phases are ordered by risk, never by value delivery

**Decision:** SwingSage ships **once**, as the full product. There is no MVP subset and no public
beta. Phases are sequenced purely by **dependency and risk retirement**, and launch is gated on
the `launch-readiness` track passing rather than on a date.
**Scope:** "We could show something earlier" is never a reason to reorder or shrink work. Launch
scope and the single permitted cut candidate (`sharing-and-export`) are declared in
`.claude/ROADMAP.json`'s `launch` block; cutting a differentiator is a decision to record and
argue, never a quiet descope.
**See:** ARCHIVE D4.

### The platform layer is complete before the product layer starts

**Decision:** Identity, the real data model, a versioned API with a generated shared schema, the
entitlement seam, media addressing and the release pipeline are built first, in
`platform-foundation` — which deliberately delivers nothing a user can see.
**Gotchas:** A native app cannot be force-updated. Each of these gets permanently more expensive
after the first store release, so building them later is rework rather than additional work.
**See:** ARCHIVE D3, D27, D28.

### Work is tracked as independent tracks; status is derived, never hand-written

**Decision:** Each track is a self-contained mini-build under `.claude/feature-tracks/<id>/`
(`_STATUS.json` + `_PROGRESS.md` + numbered step files). `.claude/ROADMAP.json` holds
**declarations only**; the status rollup is derived from each track's `_STATUS.json`.
The track with `spine: true` is what `/build` targets; the flag moves as phases complete.
**Gotchas:** Never edit a `_STATUS.json` or `_PROGRESS.md` directly — route through
`progress-tracker`. Never modify a step's `Steps` section in place; append a note. Never advance
without Verification passing.

### Every decision goes in the register; every human task goes in the handoff

**Decision:** A decision is recorded as a **present-tense entry in `docs/decisions/<domain>.md`**,
edited in place when it changes. A task needing Taylor is a **row in `docs/HANDOFF.md`**, which
the session-start probe prints. Neither lives in prose, in a commit message, or in a chat reply.
**Gotchas:** The register replaced a 2,397-line append-only numbered file in which five of 44
entries were superseded and only a careful reader could tell. Do **not** add numbered entries or
"previously we…" notes — that is the failure being undone. See
[README.md](README.md) for the full account.

### Autonomous execution; stop only for money, hardware, credentials and irreversibility

**Decision:** Decide with best judgement and proceed. Dependencies, UX defaults, tooling and
anything reversible in one commit are Claude's to choose, recorded and moved past. Stop for
spending, buying hardware, an interactive login or dashboard setting, deleting user data, or a
production deploy — and for those, add a `docs/HANDOFF.md` row rather than a sentence in a reply.
**Gotchas:** "Run this command" is never a hand-off. Attempt builds, installs, launches, adb
actions and log pulls before handing anything over.
