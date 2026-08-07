Restore the SwingSage build to a previously-created git checkpoint.

Invoke the `checkpoint` skill in ROLLBACK mode. It will:
1. List the 10 most recent `checkpoint-<trackId>-step-*` tags, sorted newest first, showing each tag's track, step number, and timestamp
2. Ask the user to pick one (by tag name or list index; `latest` is accepted as shorthand)
3. Show every commit that will be discarded via `git log --oneline <tag>..HEAD`, plus any uncommitted changes
4. Require explicit confirmation before proceeding — no implicit yes
5. Run `git reset --hard <tag>`
6. Update `_STATUS.json` via `progress-tracker` to mark every step completed *after* the checkpoint's step number as `not-started`, and set `currentStep` back to the checkpoint's step
7. Append a `_PROGRESS.md` rollback entry recording which tag was restored and which commits were discarded
8. Report the new HEAD, the new current step, and confirm the build is ready to resume

Hard rules the skill enforces:
- Never auto-rollback — always require explicit user confirmation
- Always preview what will be lost before resetting
- Never force-push or modify remote history from this command

When to use:
- A build step left the working tree in a broken state and the cleanest recovery is to restore a prior known-good state
- After a destructive operation (migration, mass refactor) revealed a problem only after partial application
- The user wants to revisit an earlier point in the build sequence intentionally

Destructive — discards work. Only run when you're confident a checkpoint restoration is the right move.
