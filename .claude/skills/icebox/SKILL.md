---
name: icebox
description: Captures future / nice-to-have / post-launch feature ideas into the single backlog at docs/icebox/, elaborating brief ideas into structured user-story entries. Trigger on /future, /icebox, "in the future", "after launch", "someday", "nice to have", "down the road", "post-launch", or any feature idea the user explicitly wants deferred. Also /future list, /future develop <id>, /future done <id>. If it's AMBIGUOUS whether the user wants it built NOW or filed for LATER, ASK before filing — never assume.
---

# Icebox — the single future-feature backlog

You maintain **one backlog of not-yet-built ideas** at `docs/icebox/` (one markdown file per idea, `ICE-NNN-slug.md`,
plus a derived `README.md` index). This is the funnel for everything the user wants *eventually* but not now —
"nice-to-haves", "after launch", deferred-with-a-trigger items, raw sparks of an idea. There is **no separate
"future-features" list** — this directory is it.

**Lifecycle (deliberately simple):** `idea captured → (user decides to develop it) → built → removed from the
backlog`. An item lives in `docs/icebox/` only while it is *not yet built*. When the user says "let's develop the X
feature from the backlog," that item graduates into real build work (a track, or a direct change); when it ships, its
file is **deleted** (the backlog only holds the undone).

## When this triggers

- `/future <idea>` or `/icebox <idea>` — capture.
- Natural language with a future marker: "in the future…", "after launch…", "add to icebox / the backlog",
  "someday…", "nice to have…", "down the road…", "post-launch…", "make a future feature where…".
- `/future list` / `/icebox list` — render the backlog.
- `/future develop <ICE-NNN>` — hand the item to the build system (see Develop, below).
- `/future done <ICE-NNN>` — remove an item that has shipped.

## The disambiguation guard (do this FIRST — the user asked for it)

Before filing anything, decide: is this **current** work or a **backlog** item?

- **File it (backlog)** when there is an explicit future marker (the trigger phrases above), or the user clearly
  frames it as not-now.
- **ASK first** when it's ambiguous — e.g. the user describes a feature with no time framing ("we should let users
  compare two swings side by side", "add a new overlay"). Ask one tight question: *"Want me to file this in the
  backlog (future / nice-to-have), or is this for the current build (I'll scope it into a track)?"* Do **not**
  assume, and do **not** start building a current feature under the guise of capturing an idea.
- If they say it's current → hand off (build-orchestrator / feature-orchestrator / normal work), don't file.

## Capture flow (write-then-refine — low friction)

The user may write very little. **Your job is to fill in the blanks** so the entry is clear to a future reader (human
or agent) with zero chat context. Steps:

1. **Check for a duplicate** — read `docs/icebox/README.md` (the index). If the idea already exists, update that
   entry instead of creating a second one; tell the user.
2. **Assign the next id** — `ICE-NNN`, zero-padded, one higher than the max existing id in `docs/icebox/`.
3. **Elaborate into the entry format** (below). Infer and write:
   - 1–3 **user stories** ("As a `<role>`, I want `<capability>` so that `<benefit>`").
   - **Why it matters**, tied to what actually makes it valuable here — better pose/club tracking accuracy,
     coaching/scorecard quality, player UX (frame sync, overlays), or production readiness (see CLAUDE.md's
     Non-Negotiable Constraints and `instructions/08-ROADMAP.md` for phase priorities).
   - A **first-pass sketch** of the likely shape + where it'd live in code — clearly marked *sketch, not a
     commitment*. Reuse existing primitives/tracks where you can name them (e.g. `lib/overlays.ts`'s overlay
     catalogue, `metrics.angle_fields`, the `scoring_config/<version>.json` pattern).
   - **Dependencies / prerequisites**, including non-obvious ones (e.g. anything storing a hand correction pulls
     in the `head_markers` Postgres schema per D45; anything club-detector-related pulls in GPU/training concerns
     per D21b; anything touching scoring pulls in `scoring_config` versioning; anything AI-generated pulls in the
     `AIProvider` abstraction and the mock-fallback requirement).
   - **Open questions** — the decisions the idea defers.
   - **Effort** (S/M/L/XL, rough) and **Serves** (the relevant area — e.g. "pose tracking", "club tracking",
     "scoring", "player UX", "AI provider", "infra").
4. **Write the file** `docs/icebox/ICE-NNN-slug.md` immediately (write-then-refine — don't make the user wait).
5. **Regenerate the index** — `node scripts/icebox/derive.mjs` rebuilds `docs/icebox/README.md` from the entries'
   frontmatter. (If that script doesn't exist yet in this project, rebuild the index by hand from the same
   frontmatter fields until it does — don't skip regenerating it.)
6. **Show a tight summary** (id + title + the elaboration you added, especially any dependency you surfaced) and
   **offer to refine**: "captured ICE-NNN — want to tweak the scope / stories / anything?"

## Entry format (`docs/icebox/ICE-NNN-slug.md`)

```markdown
---
id: ICE-NNN
title: Short title
status: idea            # idea | designing | building | (removed when done)
effort: M               # S | M | L | XL
serves: pose tracking   # the relevant area this idea serves
captured: YYYY-MM-DD
---

# ICE-NNN — Short title

**One-liner.**

## User stories
- As a <role>, I want <capability> so that <benefit>.

## Why it matters
<rationale; tie to accuracy, coaching/player quality, or production readiness>

## Sketch (first-pass, NOT a commitment)
<likely shape + where it'd live in code; name reusable primitives/tracks>

## Dependencies / prerequisites
- <including non-obvious ones — e.g. head_markers schema (D45) for hand corrections>

## Open questions
- <decisions this defers>

## Notes
<unblock trigger if it's a deferral; known code seam; source — e.g. "from chat 2026-08-07">
```

## Sub-commands

- **`list`** — read `docs/icebox/README.md` and render it (id · title · status · effort · serves · one-liner).
- **`develop <ICE-NNN>`** — the user wants to build it. Read the entry, then route into the build system: if it's a
  cohesive 3+-step epic, scaffold a **track** (see the `roadmap` skill's "Adding a track" section) seeded from the
  entry; if it's a small change, do it directly. Set the entry `status: building` while in flight. **Do not delete
  it yet.**
- **`done <ICE-NNN>`** — the work shipped. **Delete** `docs/icebox/ICE-NNN-slug.md`, regenerate the index, and
  confirm. (The backlog only holds the undone; history lives in git + the track that built it.)

## Hard rules

- **Never file an ambiguous current-vs-future request without asking.** This is the whole point of the guard.
- **Elaboration is a first-pass sketch, not a commitment** — label it so. Don't over-specify; capture the intent +
  the obvious shape + the open questions.
- **One backlog, one entry per idea.** Check the index before creating; update rather than duplicate.
- **Remove on ship.** A built feature must not linger in the backlog — `/future done <id>` deletes it.
- **The index is derived.** Don't hand-edit `docs/icebox/README.md`; regenerate it after any add/remove/status
  change.
- **Don't build from a bare capture.** Capturing an idea ≠ building it. Building happens only via `develop`, normal
  work, or an explicit user go-ahead.

## Relationship to the rest of the system

- `docs/icebox/` is the **pre-track funnel**; tracks (`.claude/feature-tracks/`) are scheduled work. An idea becomes
  a track via `develop` → the `roadmap` skill's "Adding a track" procedure. `/roadmap` covers tracks; this skill
  covers the not-yet-scheduled backlog.
- Decision record: if the icebox mechanism itself needs a durable design decision noted (not an individual idea —
  those live as `ICE-NNN` entries), append a new numbered entry to `docs/DECISIONS.md` (never renumber or delete
  existing entries).
