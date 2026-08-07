Advance an isolated SwingSage feature track, running step-by-step until a stop-condition.

Usage: `/feature <name>` (e.g. `/feature upload-flow`)

A bare `/feature <name>` runs a **whole arc** — it keeps advancing verified steps and stops
only at the first **stop-condition**: a verification failure `/heal` can't fix, a
`human-review-required` next step, a blocker, drift `/heal` can't fix, or track end. Escape
hatches: **`/feature <name> once`** (advance exactly one step) and **`/feature <name> to NN`**
(run through step `NN`).

Invoke the `feature-orchestrator` skill with the resolved feature directory
`.claude/feature-tracks/<name>/`. Per step it will:
1. Read `<featureRoot>/_STATUS.json` to determine the current step
2. Verify the previous step's Verification commands still pass — drift detection, **once at
   the start of the run**
3. Load the current numbered step file from `<featureRoot>/`
4. Confirm all dependencies are complete (against this feature's status, not the spine's)
5. Execute the step's `Steps` section sequentially
6. Run the step's `Verification` section
7. On pass (and no `human-review-required` flag): update `_STATUS.json`, append to
   `_PROGRESS.md`, then **continue to the next step** (loop)
8. On fail: keep the step `in-progress`, report what failed, STOP

When the run stops, it makes **one commit** covering every step completed in the run
(`/commit`), then reports.

Sub-commands:
- `/feature <name>` — run from the current step until a stop-condition (canonical)
- `/feature <name> once` — advance exactly one step, then stop
- `/feature <name> to NN` — run through step `NN` (inclusive), then stop
- `/feature <name> status` — read-only summary
- `/feature <name> verify` — re-run current Verification without advancing
- `/feature <name> reset` — reset current step to not-started (destructive — confirm first)
- `/feature <name> skip --reason="..."` — mark skipped (requires reason)
- `/feature <name> blocker` — escalate via blocker-protocol

Hard rules the orchestrator enforces:
- Never skip Verification
- Advance steps strictly sequentially and per-step atomically; continue until a
  stop-condition; **one commit per run**
- Atomic `_STATUS.json` + `_PROGRESS.md` writes
- Stop and surface for approval on any `human-review-required` step
- Each track's state is INDEPENDENT of every other track's; unmet cross-track `dependsOn`
  (declared in `.claude/ROADMAP.json`) — soft (`blocking: false`) warns and continues, hard
  warns and asks; never a hard block

Available tracks: anything declared in `.claude/ROADMAP.json` (`tracks[].id`), with a
directory under `.claude/feature-tracks/<name>/`. Whichever track has `spine: true` in
`ROADMAP.json` is the one `/build` targets (resolved dynamically — run `/roadmap` to see
which); all others run via `/feature <name>`. For the macro picture across all tracks use
`/roadmap`. To add a track: scaffold it by hand (see `.claude/ai-instructions/00 - README.md`)
or let the first run author it lazily.
