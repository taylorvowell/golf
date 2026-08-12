# Decisions Register

The **living record of what SwingSage currently does** — grouped by domain, written in the
present tense. It answers *"what do we do, and what are the rules?"* — never *"what did we
consider, and why did we reverse it."* There is no history here: when a decision changes, the
entry is **edited in place** so the register always reflects what is true now.

## Why it was restructured (2026-08-12)

This replaces a single 2,397-line append-only file of 44 numbered entries. That file recorded
decisions faithfully and was still a failure, for a reason worth stating so it is not rebuilt:

**Five of its 44 entries were actively wrong and only a careful reader could tell.** D34 said all
three frame-exactness probes failed; D35 said the instrument was biased; D36 said sync works at
99.2%. D38 said 240fps was unreachable; D39 overturned it. D25 chose email OTP; D31 replaced it.
D26 said RLS was inert; D42 closed it. D9 chose Railway for the worker; D18 reopened it. Knowing
what was true required reading all 44 in order and reconciling them — so nobody did, including
Claude, which is how a hand-off asked for an OAuth client that already existed.

An append-only log optimises for *provenance*. A working agent needs *current state*. Both are
below: the register is current state, the archive keeps provenance.

## The files

| File | Covers |
|---|---|
| [platform-data.md](platform-data.md) | Postgres, Drizzle, RLS, the swing/session/equipment model, API versioning and the shared schema, job dispatch, environments, SLOs |
| [auth-identity.md](auth-identity.md) | Sign-in providers, one-identity model, sessions, account lifecycle and the deletion cascade |
| [mobile-client.md](mobile-client.md) | Expo/RN choice, EAS, native modules, measured device capability, the overlay and skeleton rules on mobile |
| [media-storage.md](media-storage.md) | Object storage, key derivation, artifact publishing, offline behaviour, retention |
| [analysis-and-ai.md](analysis-and-ai.md) | What the analyzer is responsible for, what is deferred, the AI provider seam, and what golfer data may reach a model |
| [commerce-entitlement.md](commerce-entitlement.md) | Billing platform and the entitlement record |
| [build-and-roadmap.md](build-and-roadmap.md) | How the build is sequenced, tracked and verified |
| [ARCHIVE-numbered.md](ARCHIVE-numbered.md) | **Frozen.** The original D1–D44 entries with their full context, rationale and rejected alternatives. Never appended to again. Cite it for *why*; never read it for *what is true*. |

## Entry format

Each decision is one `###` entry:

```
### <Decision title>
**Decision:** <what we do, present tense — "Media lives in Supabase Storage.">
**Scope:** <where it applies — omit if obvious from the file>
**Gotchas:** <only if operationally important — omit otherwise>
**See:** <ARCHIVE D-number for the rationale, and/or a deep spec>
```

## How to keep it fresh

- **New decision?** Add an entry to the relevant domain file. Keep it tight.
- **Decision changed?** **Edit the existing entry in place.** Do not add a "previously we…" note
  and do not add a new numbered entry — that is the failure mode this restructure exists to end.
- **No history, no alternatives, no dates** in the register. If the rationale is genuinely useful
  later, it belongs in the archive entry or in `.claude/architecture/`.
- **Superseded means deleted here**, not annotated. The archive holds the trail.
- Deep detail (contracts, data models, long-form design) lives in
  [`../CURRENT-STATE.md`](../CURRENT-STATE.md) and `.claude/architecture/`; operational how-to
  lives in [`../RUNBOOK.md`](../RUNBOOK.md); machine and account facts live in
  [`../ENVIRONMENT.md`](../ENVIRONMENT.md); outstanding human tasks live in
  [`../HANDOFF.md`](../HANDOFF.md). The register points at those and never duplicates them.
