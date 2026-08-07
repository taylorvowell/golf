Re-run the Verification section of the current SwingSage build step.

Operates on the active track — the **spine** track (`spine: true` in `.claude/ROADMAP.json`) by default. For a specific track use `/feature <name> verify`.

Invoke the `step-verifier` skill on the step indicated by the active track's `_STATUS.json` `currentStep` field.

The skill will:
1. Read the current numbered step file
2. Extract its `Verification` section
3. Run every command sequentially, capturing exit codes and output
4. For manual checks, ask the user (do not assume pass)
5. Report a structured pass/fail summary — which checks passed, which failed, and what to investigate

Hard rules:
- Every command in Verification runs — none are skipped
- A single non-zero exit, timeout (>60s), or unexpected output fails the step
- Manual checks (e.g., "confirm the overlay looks right at Address") require explicit user confirmation

Use this command when:
- The current step is `in-progress` and you want to know if it's ready to mark complete
- Drift is suspected (a previously-complete step may no longer pass)
- Before manually advancing past a step the orchestrator left `in-progress`

This command does NOT mutate `_STATUS.json`. It only reports. The orchestrator is what advances the build after verification.
