# Improvements Ledger

Append-only trail of `/improve` runs. **Newest on top.** One block per finding acted on.

Each entry records *what slowed us down*, the *root cause*, and *where the fix was routed* — it
points at the sink (a probe line, a `CLAUDE.md` section, a `HANDOFF.md` row, a memory note, a
hook, a new skill) rather than holding the knowledge itself. Two jobs: one place to see every
improvement across sessions, and the dedupe lookup `/improve` reads at the start of each run so
the same lesson is not learned twice.

Format:

```markdown
## YYYY-MM-DD — short friction title
- **Symptom:** what slowed us down (1 line)
- **Root cause:** <category #> — why Claude didn't start there
- **Routed to:** <sink> → path or hand-off
- **Session:** originSessionId or "unknown"
```

<!-- entries below this line -->

## 2026-08-12 — asked Taylor to create a Google OAuth client he had already created

- **Symptom:** A hand-off told Taylor to visit the Google Cloud Console and create an Android
  OAuth client. He had created the web and Android clients days earlier, populated
  `apps/mobile/.env`, and enabled the provider in Supabase. His reply: *"are no notes being
  recorded???"*
- **Root cause:** **4 — knowledge existed but didn't fire.** Both client ids, the bound package
  and the SHA-1 were in `docs/ENVIRONMENT.md` under a `## Google OAuth` heading, and the
  session-start probe printed *"read it before … checking a vendor dashboard"*. The file was
  grepped three times for narrow strings (`spike`, `probe`, `8790`) and never read. Secondary
  cause: **1 — missing fact**, in that "the Console work is DONE" was a *state* nobody owned;
  there was no register of human tasks at all, so every session re-derived the outstanding list
  from prose and got it wrong.
- **Routed to:** injection, not documentation —
  `docs/HANDOFF.md` (new; every human task is a row with `OPEN`/`BLOCKED`/`DONE`, and the four
  already-done Google/env rows are recorded as `DONE`) →
  `scripts/env-probe.mjs` (new `handoffs()` reads that file and prints every open row at session
  start, so the outstanding list arrives in context the way the phone's LAN address does) →
  `CLAUDE.md` › *How this project is run* (never ask for anything that is not an `OPEN` row;
  never re-ask a `DONE` row; mark a row `DONE` in the same turn Taylor says he did it; read
  `ENVIRONMENT.md` before naming any credential, id, port, package or vendor setting).
- **Session:** abf4bc8a-2f57-4296-b5d3-251057a6580e

## 2026-08-12 — "what is currently true" was not extractable from the decisions log

- **Symptom:** `docs/DECISIONS.md` had grown to 2,397 lines across 44 append-only numbered
  entries. Nobody read it, including Claude, so decisions were re-derived or missed.
- **Root cause:** **6 — stale/incorrect knowledge.** Five of the 44 entries were superseded by
  later ones (D25→D31, D26→D42, D9→D18, D34→D35→D36, D38→D39) and telling which required reading
  all 44 in order and reconciling them. An append-only log optimises for provenance; a working
  agent needs current state.
- **Routed to:** `docs/decisions/` — seven present-tense domain files edited in place, plus
  `ARCHIVE-numbered.md` (the original 2,397 lines, frozen, with a header saying it is provenance
  and must not be read for current state). 40 files referencing the old path were rewritten.
  Modelled on the SummitTape register at `../summit-frontend/docs/decisions/`.
- **Session:** abf4bc8a-2f57-4296-b5d3-251057a6580e

## 2026-08-12 — no mechanism existed to capture a lesson at all

- **Symptom:** Taylor asked *"what can we do so that you have knowledge of what was done in
  previous build steps"* — there was no answer, because nothing in the repo turned session
  friction into a durable change.
- **Root cause:** **5 — no procedure.** SwingSage had every knowledge *store* SummitTape has and
  none of its *capture* ritual.
- **Routed to:** `.claude/skills/improve/` + `/improve` command + this ledger (ported from
  SummitTape and re-pointed at SwingSage's sinks), and `CLAUDE.md` › *Documentation discipline —
  before ending a turn*, which requires stating what was documented in every non-trivial turn.
- **Session:** abf4bc8a-2f57-4296-b5d3-251057a6580e
