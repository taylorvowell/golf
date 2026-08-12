# Routing matrix — which sink, and exactly how to write it

Pick the sink from the root-cause category, then escalate only if the escalation criterion is met.
The bias is toward the **cheapest sink that will actually fire**, and in this repo "fires" is a
real test: the session-start probe is injected, everything else is read on demand.

## The sinks, ordered by how reliably they surface

| Sink | Surfaces when | Cost to add |
|---|---|---|
| **`scripts/env-probe.mjs`** | **Every session, before the first tool call** (SessionStart hook) | Code — keep it read-only, fast, no secrets |
| **`docs/HANDOFF.md`** | Every session — the probe prints its `OPEN`/`BLOCKED` rows | One table row |
| **`CLAUDE.md`** | Every session — loaded as project instructions | A line or a bullet |
| **auto-memory** (`MEMORY.md` + a file) | When the index line matches the task | One small file |
| **`docs/ENVIRONMENT.md`** | Read on demand; the probe points at it | A table row |
| **`docs/decisions/<domain>.md`** | Read on demand | An entry, or an in-place edit |
| **`docs/RUNBOOK.md`** | Read on demand | A section |
| **a skill's `description`** | When the trigger words match | An edit |
| **a hook** | Deterministically, on the matched tool | `update-config` |

## Category → sink

| # | Category | Primary sink | Escalate to | Escalation criterion |
|---|---|---|---|---|
| 1 | **Missing environment fact** | `docs/ENVIRONMENT.md` if fixed; **`env-probe.mjs`** if live | + a `CLAUDE.md` line | The fact is load-bearing enough that being wrong about it wastes a whole session |
| 2 | **Wrong default assumption** | `CLAUDE.md` — write the *correction to the default*, not the fact | a `.claude/rules/*.md` file | The correction is path-scoped (only matters when editing certain files) |
| 3 | **Wrong tool / shell selection** | `CLAUDE.md` routing line | a skill `description` edit | An existing skill should have fired and its trigger words are too narrow |
| 4 | **Knowledge existed but didn't fire** | **Placement / injection — never new content** | `env-probe.mjs` or a hook | The fact must never be missed again. Move it from read-on-demand to injected |
| 5 | **No procedure / flailing** | `docs/RUNBOOK.md` section | a new skill | The procedure has branches and judgement, not just ordered steps |
| 6 | **Stale / incorrect knowledge** | **Correct or delete the misleading source** | — | Never add a new note next to a wrong one. Fix the wrong one |
| 7 | **Repeated manual toil** | a script | a hook via `update-config` | The check is mechanical and should block rather than remind |

## Write formats

**`env-probe.mjs`** — three rules it must keep: read-only (starts nothing, changes nothing), fast
(parallel, short timeout, ~3s total budget), and **no secrets ever** (report set/empty/missing,
never a value). Print a short line; if it needs a document's contents, parse the document and print
only the rows that matter, the way `handoffs()` reads `docs/HANDOFF.md`.

**`docs/HANDOFF.md`** — one row under the `PROBE-READS-BELOW` marker:
`| OPEN | <what> | <why it needs a human> | <notes> |`. Status is `OPEN` / `BLOCKED` /
`DONE <date>` / `DROPPED`. A `DONE` row is **never deleted** — it is the answer to "did we already
do this?".

**`docs/ENVIRONMENT.md`** — a row in the right table. Fixed facts only; if it is live, teach the
probe instead. A recorded live fact is a stale fact.

**`docs/decisions/<domain>.md`** — present tense, current state:
```
### <Decision title>
**Decision:** <what we do now>
**Gotchas:** <only if operationally important>
**See:** ARCHIVE D<n>
```
If it changes an existing entry, **edit that entry in place.** Never append a second one.

**`CLAUDE.md`** — put it in the section a reader would already be in. Prefer one pointed sentence
over a paragraph; the file is loaded every session and every line costs context forever.

**auto-memory** — a file under the project memory dir with `name` / `description` /
`metadata.type` frontmatter (`user` | `feedback` | `project` | `reference`), plus a one-line
pointer in `MEMORY.md`. For `feedback` and `project`, include **Why:** and **How to apply:**.

**Ledger** (`.claude/improvements/LOG.md`) — newest on top, format in `output-format.md`.

## What NOT to route

- A one-off bug, a typo, a cosmetic choice.
- How a framework works — it has its own docs.
- A narration of what was done — that is the commit.
- Anything that would become a **second copy** of a fact that already exists somewhere. Two copies
  drift, and the one that is wrong is the one someone reads.
