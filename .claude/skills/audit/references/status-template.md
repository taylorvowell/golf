# Status File Template

This template produces the `_status.md` file at the root of each audit folder. It's the tracking document — updated as phases progress.

Keep it simple. Markdown table + an event log. No JSON, no YAML — this needs to be trivially editable by hand if the user wants to override something.

---

```markdown
# Status: <audit-slug-YYYY-MM-DD>

| Phase | Title                          | Status      | Started              | Completed            |
|-------|---------------------------------|-------------|-----------------------|-----------------------|
| 1     | <phase title>                  | pending     | —                     | —                     |
| 2     | <phase title>                  | pending     | —                     | —                     |
| 3     | <phase title>                  | pending     | —                     | —                     |

**Audit status:** Plan written — awaiting decision

## Event log

Newest entries at the top. Each entry is one line.

- <YYYY-MM-DD HH:MM UTC> — Audit plan written. <N> phases drafted. Awaiting user decision.
```

---

## Valid status values

- `pending` — phase hasn't been started
- `in-progress` — phase is mid-execution, OR phase verification failed and is awaiting resolution
- `complete` — phase verification passed and a commit was made
- `skipped` — user explicitly skipped this phase (note the reason in the event log)
- `blocked` — phase can't proceed (missing credential, ambiguous decision, etc.) — note details in event log

## Update patterns

**Starting a phase:**
```markdown
| 1 | Move ROT-04's threshold into config | in-progress | 2026-08-07 14:30 UTC | —                     |
```
Event log entry: `2026-08-07 14:30 UTC — Phase 1 started.`

**Completing a phase:**
```markdown
| 1 | Move ROT-04's threshold into config | complete    | 2026-08-07 14:30 UTC | 2026-08-07 15:45 UTC |
```
Event log entry: `2026-08-07 15:45 UTC — Phase 1 complete. Commit: <SHA>.`

**Verification failed:**
```markdown
| 1 | Move ROT-04's threshold into config | in-progress | 2026-08-07 14:30 UTC | —                     |
```
Status stays `in-progress`. Event log entry includes the failure detail:
`2026-08-07 15:10 UTC — Phase 1 verification FAILED. Command: pytest tests. Exit 1. Reason: <one-line diagnosis>.`

**Phase skipped:**
```markdown
| 1 | Move ROT-04's threshold into config | skipped     | —                     | —                     |
```
Event log entry: `2026-08-07 14:30 UTC — Phase 1 skipped. Reason: user wants to defer until the D-number's fixture verification lands separately.`

**Audit closed:**
When all phases are `complete` or `skipped`, append:
- `<YYYY-MM-DD HH:MM UTC> — Audit closed. All phases resolved.`

And update the `**Audit status:**` line to `Closed — <YYYY-MM-DD>`.

## Notes

**Atomicity.** The `_status.md` table and the event log must stay in sync. If you update one, update the other in the same edit.

**Don't delete event log entries.** It's an append-only history. If something needs correcting, add a new entry — don't rewrite old ones.

**Timestamps are UTC, ISO-lite.** `YYYY-MM-DD HH:MM UTC` is precise enough. No need for seconds.
