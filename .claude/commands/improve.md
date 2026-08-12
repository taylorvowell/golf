Turn friction from this session into a durable improvement, using the `improve` skill.

Find where this session was slower than it should have been — a wrong lead, a fact re-derived that
was already written down, an ask for something already done, a correction Taylor had to give twice
— then diagnose **why Claude didn't start in the right place** and route the lesson into the sink
that will actually fire next time.

Invoke the `improve` skill. It will:

1. Mine this thread through the detour lens and the repetition lens.
2. Root-cause each finding against the seven-category taxonomy — pushing past the symptom.
3. **Dedupe** against every existing sink (`env-probe.mjs`, `ENVIRONMENT.md`, `HANDOFF.md`,
   `docs/decisions/`, `CLAUDE.md`, the runbook, auto-memory, skill descriptions, and the ledger).
   If the knowledge already exists, the fix is **placement or injection**, never a second copy.
4. Route each finding to a sink, preferring the ones that are *injected* at session start over the
   ones that are read on demand.
5. Show a coverage table, apply the local writes immediately, and ask **once** for the batch that
   touches committed files.
6. Append every finding to `.claude/improvements/LOG.md`.

It never runs `git commit` — repo edits are left in the working tree for `/commit`.

Zero findings is a valid result. Do not manufacture friction.

ARGUMENTS: optional focus (e.g. `/improve the mobile build loop`). With no argument, mine the
whole session.
