Advance SwingSage's build's SPINE track, running step-by-step until a stop-condition.

The build is organized as independent tracks under `.claude/ROADMAP.json`; `/build` runs
whichever track is marked `spine: true` (resolved dynamically — run `/roadmap` to see which).
For any other track use `/feature <name>`; for the macro picture across all tracks use
`/roadmap`.

A bare `/build` runs a **whole arc** — it keeps advancing verified steps and stops only at the
first **stop-condition**: a verification failure `/heal` can't fix, a `human-review-required`
next step, a blocker, drift `/heal` can't fix, or track end. Escape hatches: **`/build once`**
(advance exactly one step) and **`/build to NN`** (run through step `NN`).

Invoke the `build-orchestrator` skill. Per step it will:
1. Resolve the spine track from `.claude/ROADMAP.json` and read its `_STATUS.json` to
   determine the current step
2. Verify the previous step's Verification commands still pass — drift detection, **once at
   the start of the run**
3. Load the current numbered step file from the spine track directory
4. Confirm all in-track dependencies are complete; unmet cross-track `dependsOn` — soft
   (`blocking: false`) warns and continues, hard warns and asks
5. Execute the step's `Steps` section sequentially
6. Run the step's `Verification` section
7. If verification passes (and no `human-review-required` flag): update `_STATUS.json`,
   append to `_PROGRESS.md`, then **continue to the next step** (loop)
8. If verification fails: keep the step `in-progress`, report what failed, STOP — do not
   advance

When the run stops, it makes **one commit** covering every step completed in the run
(`/commit`), then reports.

Hard rules the orchestrator enforces:
- Never skip verification
- Never advance without an explicit verification pass
- Advance steps strictly sequentially and per-step atomically; continue until a
  stop-condition; **one commit per run**
- Stop and surface for approval on any `human-review-required` step

Do not execute step files directly. Always go through the orchestrator so status tracking,
atomicity, and verification stay intact.
