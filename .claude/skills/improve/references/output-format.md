# Output format

What `/improve` shows in chat and writes to the ledger. The chat output is a findings view — a coverage table, a tight plan, and a one-line result. No loose prose recap of the session; the table *is* the recap.

## 1. The coverage table

One row per friction finding. If the run found nothing worth acting on, skip the table and say so in one line ("No material friction this session — nothing to capture.").

| # | Friction (what slowed us) | Root cause | Already known? | Sink | Action |
|---|---------------------------|-----------|----------------|------|--------|
| 1 | Tried Supabase then Railway before learning Payload runs in local Docker | 3 wrong-tool + 1 missing-fact | Partly — `feedback_payload_not_supabase_db` covers the Supabase half | memory `project_*` + discoverability | New note for the local-Docker fact; confirm existing note's `How to apply` |
| 2 | … | … | … | … | … |

Column notes:
- **Root cause** — the category number(s) from `root-cause-taxonomy.md`, with a 1–3 word label.
- **Already known?** — the dedupe result: `No` (net-new), `Partly — <slug/section>`, or `Yes — <slug/section>` (pure discoverability, category 4).
- **Sink** — where it's routed (memory / CLAUDE.md §section / runbook / ADR / hook→update-config / skill→skill-creator / discoverability).
- **Action** — the specific write or hand-off, in a few words.

## 2. The plan (auto vs. gated)

Right after the table, split the actions into what you'll do now vs. what needs the user's go-ahead. Keep it to a few lines:

```
Applying now (local, reversible):
- memory/project_payload_local_docker.md (+ MEMORY.md index line)
- ledger entry

Needs your OK (committed / automation):
- CLAUDE.md › ## MCP Servers — add a Payload-vs-Supabase routing row
- (hook) hand off to update-config: SessionStart note "Payload runs in local Docker"  ← only if you want it to fire every session
```

Then apply the "applying now" items immediately (no confirmation), and ask once for the gated batch. A single "yes" applies the whole gated batch — don't prompt per item. If the user declines a gated item, still record the *finding* in the ledger with a note that the heavier sink was declined (so it isn't re-proposed blindly next run).

## 3. The win line

Close with one line stating the net improvement and where the trail is:

```
Captured 2 lessons → 1 memory note + 1 CLAUDE.md routing row; logged to .claude/improvements/LOG.md. Next time a Payload 500 appears, the right tool fires first.
```

## 4. The ledger entry

Append to `.claude/improvements/LOG.md`, newest on top, one block per finding you acted on (including discoverability-only fixes and findings where a gated sink was declined). Use today's date from the session context.

```markdown
## <YYYY-MM-DD> — <short friction title>
- **Symptom:** <what slowed us down, 1 line>
- **Root cause:** <category #> — <why Claude didn't start there>
- **Routed to:** <sink> → <path or hand-off>   (e.g. `memory/project_payload_local_docker.md`, or `update-config: SessionStart hook`)
- **Session:** <originSessionId or "unknown">
```

The ledger holds the *trail*, not the knowledge — it points at the sink that holds the actual fact. Its two jobs: give the user one place to see every improvement across runs, and serve as the dedupe lookup at the start of the next `/improve` (step 3 of the workflow). Keep entries terse; the depth lives in the sink the entry points to.
