---
name: improve
description: Turns friction from the current session into a durable improvement to Claude's own knowledge — finds the root cause of why Claude started in the wrong place and routes the lesson into the sink that will actually fire next time (env-probe, docs/ENVIRONMENT.md, docs/HANDOFF.md, docs/decisions/, CLAUDE.md, a runbook, a hook, auto-memory, or a new skill). Trigger on /improve, "learn from this session", "why didn't you know that", "make sure you remember this next time", "are no notes being recorded", or right after a session with wrong leads, re-derived facts, or repeated corrections. Writes local sinks automatically; gates committed changes behind one confirmation; never auto-commits. Not for code review (/audit) or deliberate decision documentation.
---

# Improve

You are about to make Claude permanently better at working in *this* project by mining the
session you are in for the friction that just happened. Taylor invokes `/improve` after a session
went slower than it should have — Claude chased a wrong lead, re-derived a known fact, asked for
something already done, or had to be corrected. Your job is to find **why Claude didn't start in
the right place** and put that lesson somewhere it will actually fire next time.

## Why this skill exists

SwingSage already has places where lessons persist: the session-start probe, `ENVIRONMENT.md`,
`HANDOFF.md`, the decisions register, `CLAUDE.md`, the runbook, and auto-memory. The problem has
never been a missing knowledge store. It is that in the heat of a session the lesson never gets
written down — or gets written somewhere it will not surface at the moment it is needed.

**The canonical failure, and the reason this skill was ported:** Claude asked Taylor to create a
Google OAuth client he had created days earlier. Both client ids, the bound package and the SHA-1
were in `docs/ENVIRONMENT.md` the whole time, and the session-start probe even printed a line
telling Claude to read that file before touching a vendor dashboard. The knowledge existed and did
not fire. That is category 4, and it is the category people miss.

So this skill is **a diagnostic plus a router**, not a new knowledge base.

Three failure modes to avoid:

1. **Treating a symptom as the lesson.** "The OAuth ask was wrong" is a symptom. The lesson is
   *why Claude wrote a hand-off without reading the file that records hand-offs.*
2. **Duplicating knowledge that already exists.** Often the fact was captured and simply did not
   surface. Writing it a second time makes it worse — now two copies drift. When the knowledge
   exists, the fix is **discoverability or injection**, not new content.
3. **Writing committed changes without consent.** Auto-memory and the ledger are cheap to revert —
   write those freely. `CLAUDE.md`, `docs/`, hooks and new skills are load-bearing — present them
   and apply on one confirmation. Never auto-commit.

## The workflow

### 1. Gather evidence from the current thread

Two lenses:

- **Detour lens** — one problem, many wrong turns. Identify the original symptom, the dead ends,
  the move that finally resolved it, and the gap between the first action and the resolving one.
- **Repetition lens** — the same class of mistake repeated. A fact re-derived that a note already
  held, a file grepped narrowly three times instead of read once, a command retried with tweaks, a
  correction Taylor had to give twice, an ask for something already done.

Zero findings is a valid result. Do not manufacture friction.

### 2. Root-cause each finding

Ask: **why didn't Claude start there?** Classify with `references/root-cause-taxonomy.md`. Read it
now if you have not — the category drives the routing, and **category 4 (knowledge existed but
didn't fire) is the one that gets missed**, and is the dominant category in this repo.

### 3. Dedupe check — before proposing any write

Search the existing sinks:

- `scripts/env-probe.mjs` — is this a *live* fact the probe should discover?
- `docs/ENVIRONMENT.md` — machine, device, account, vendor facts
- `docs/HANDOFF.md` — is this task already a `DONE` row?
- `docs/decisions/*.md` + `ARCHIVE-numbered.md`
- `CLAUDE.md` (root and `apps/mobile/AGENTS.md`) — section by section
- `docs/RUNBOOK.md`
- the auto-memory `MEMORY.md` index and the files it points at
- the `description` fields of existing skills — the lesson may belong to a skill that is not triggering
- `.claude/improvements/LOG.md` — a past run may already cover it

If the lesson already exists, **reclassify as category 4** and fix *placement or injection*, not
content.

### 4. Route each finding to a sink

Use `references/routing-matrix.md`. Read it before writing so the writes are right first time.

**The strongest sink in this repo is the probe.** `scripts/env-probe.mjs` runs as a SessionStart
hook, so anything it prints is in context before the first tool call. A fact that must never be
missed belongs there — or in a file the probe reads and prints, which is how `docs/HANDOFF.md`
works. Prefer injection over a document nobody opens; that distinction is the whole lesson of the
OAuth failure.

### 5. Present the coverage table, then apply

Follow `references/output-format.md`: coverage table, then the plan split into auto-applied vs
awaiting-confirm, then a win line.

- **Auto (no confirmation):** auto-memory files (+ the `MEMORY.md` index line) and the ledger entry.
- **Gated (one confirmation for the batch):** `CLAUDE.md`, anything under `docs/`,
  `scripts/env-probe.mjs`, hooks, and new skills. Present them together; apply on a single "yes".
  Never prompt per item.

Never run `git commit`. Leave repo edits in the working tree.

### 6. Append the ledger entry and close

Append to `.claude/improvements/LOG.md` for **every** finding acted on, including
discoverability-only fixes and ones where a gated sink was declined. The ledger is the single
cross-sink trail and the dedupe source for the next run.

## Hand-off rules

`/improve` never hand-writes a hook or a new skill — each surface has an owner:

- **New/changed hook** (`.claude/settings.json` PreToolUse/PostToolUse/SessionStart) → describe it
  and invoke `update-config`.
- **New skill** → write a one-paragraph brief and invoke `skill-creator`.
- **Changing a recorded decision** → edit the entry in place in `docs/decisions/<domain>.md`.
  Never add a second entry; never add a "previously we…" note.
- **A task that needs Taylor** → a row in `docs/HANDOFF.md`, never a sentence in a reply.
