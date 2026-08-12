# Root-cause taxonomy

The diagnostic core of `/improve`. For each friction point, answer the pivotal question — **why didn't Claude start in the right place?** — and classify the answer into one of these seven categories. The category drives the routing (see `routing-matrix.md`).

A single friction point can be a blend (e.g. a wrong-tool detour *caused by* a missing env fact). Tag the dominant cause, and note the secondary one — they may route to different sinks.

| # | Category | What it means | Signals in the thread |
|---|----------|---------------|-----------------------|
| 1 | **Missing environment fact** | Claude lacked a true fact about how *this* project / machine / deployment is wired. The general-world model was fine; the local reality wasn't known. | A fact the user supplied that Claude couldn't have known and that isn't written down (e.g. "Payload runs in local Docker right now, not on Railway"). Claude says "oh, I didn't realize…" after a correction. |
| 2 | **Wrong default assumption** | Claude applied a plausible general-world default that is wrong *here*. The fact may even be discoverable, but Claude's prior overrode it. | Claude assumed the common case ("it's cloud-hosted → check Railway/Supabase") instead of checking. The detour follows the shape of a generic mental model, not this repo. |
| 3 | **Wrong tool / MCP / shell selection** | Claude reached for the wrong instrument — repeatedly or for several turns — when a better-fitting one existed. | Same wrong MCP invoked more than once (Supabase MCP for a CMS issue); PowerShell-vs-Bash thrash; using a CLI by hand where a connected MCP was the intended path; ignoring the MCP routing table. |
| 4 | **Knowledge existed but didn't fire** | The fact *was* already captured — in memory, a `CLAUDE.md` section, a skill, an ADR — but it didn't surface at the moment it was needed. **This is the "why didn't it start there" case, and the most commonly missed.** | The dedupe check (SKILL step 3) finds an existing note/section/skill that covers it. The knowledge was present but buried, mis-scoped, in a skill that didn't trigger, or behind a broken `[[wikilink]]`. |
| 5 | **No procedure / flailing** | There was no playbook for a recurring multi-step situation, so Claude improvised by trial and error. | A sequence of "try X, didn't work, try Y, didn't work" with no reference to a runbook; the resolution was a *procedure* (a series of steps), not a single fact. |
| 6 | **Stale / incorrect knowledge** | Claude followed information that *used* to be true. A doc, memory, ADR, or comment is now wrong and actively misled. | The misleading source can be named (an ADR that's been superseded in practice, a memory note describing a service that moved, a comment that lies). The fix is to correct/retire the source, not add a new one. |
| 7 | **Repeated manual toil** | A multi-step manual action was done several times that a deterministic guard, script, or automation could have prevented or shortcut. | The same correction/cleanup/setup ritual recurs across this session (or is noted as recurring across sessions); a mechanical check would have caught the mistake before it cost time. |

## How to use this taxonomy

- **Push past the symptom.** "The build failed" / "the page spun" is never the category — it's the surface. Keep asking "and why didn't Claude already know to do the resolving thing?" until you land on one of the seven.
- **Category 4 changes everything downstream.** If the dedupe check finds the lesson already exists, the friction is *discoverability*, not *ignorance*. Do not write the fact again. Fix where/how it lives so it fires next time (see the routing matrix's category-4 row).
- **Categories 1 vs 2 are a useful split.** Missing-fact (1) → the fix is to *write the fact down*. Wrong-default (2) → the fix is often to write down the *correction to the default* ("don't assume cloud-hosting; in this repo, check X first"), which is a subtly different, more pointed note.
- **Categories 5 and 7 are the ones that escalate to procedures/automation.** A single fact belongs in memory or a `CLAUDE.md` line. A *series of steps* belongs in a runbook (5). A *mechanical, repeatable guard* belongs in a hook or script (7).
