# Audit Overview Template

This template produces the `00-overview.md` file at the root of each audit folder. It is the **entry document** — the file an AI coder reads first when picking up an audit later.

Copy the structure below into the new audit's `00-overview.md`, replacing `<bracketed>` placeholders. Keep section names exact — the execution mode and the status file rely on them.

---

```markdown
# Audit: <Target>

| Field            | Value                                  |
|------------------|----------------------------------------|
| Target           | <human-readable description>           |
| Audit date       | <YYYY-MM-DD>                           |
| Audit slug       | <slug>-<YYYY-MM-DD>                    |
| Scope size       | Small / Medium / Large                 |
| Confidence       | High / Medium / Low                    |
| Status           | Plan written — awaiting decision       |
| Phases           | <N>                                    |
| Findings         | <C> critical / <H> high / <M> medium / <L> low |

## TL;DR

<One paragraph, two-to-four sentences. State the biggest architectural finding plainly. If there are no significant findings, say so directly.>

## Scope

**Files audited (<count>):**
- `path/to/file.tsx`
- `path/to/other/file.py`
- ...

**Docs consulted:**
- `.claude/rules/nextjs.md` / `tailwind-v4.md` / `typescript.md` / `testing.md` (whichever apply)
- `apps/web/src/components/ui/kiosk.tsx`
- `.claude/ai-instructions/PROJECT_MAIN.md` (whichever section the target lives under)
- ...

**`docs/DECISIONS.md` entries referenced:**
- D<N> — <one-line decision> — Status: <verbatim Status line>
- ...

**Web research:** Yes / No (list URLs if yes)

## Coverage matrix

A glance-at-once view of which of the 13 axes were checked and what was found.
Status: `✓` clean, `⚠` findings present, `–` not applicable to this audit.

| #  | Axis                                          | Status | Findings |
|----|------------------------------------------------|--------|----------|
| 1  | Next.js 16 / TypeScript correctness             |        |          |
| 2  | Frame-sync & player correctness                 |        |          |
| 3  | Python CV pipeline correctness                  |        |          |
| 4  | analysis.json contract integrity                |        |          |
| 5  | Scoring-config correctness                      |        |          |
| 6  | Test suite integrity                            |        |          |
| 7  | Structural soundness & scalability              |        |          |
| 8  | Componentization / modularization               |        |          |
| 9  | Reuse vs. duplication                           |        |          |
| 10 | Logical placement                               |        |          |
| 11 | Tech debt invoked by the solve                  |        |          |
| 12 | Conventions, naming & DECISIONS.md discipline   |        |          |
| 13 | Latest Next.js/React leverage & suggestions     |        |          |

## Findings

Listed by severity. Each finding has a stable ID (C1, H1, M1, L1, ...) that phase docs reference.

### Critical

#### C1 — <short title>

- **Axis:** <#5 Scoring-config correctness>
- **Source of truth:** <a docs/DECISIONS.md entry / .claude/rules/*.md / kiosk.tsx export / PROJECT_MAIN.md section>
- **Evidence:**
  - [path/to/file.py:42-58](path/to/file.py#L42-L58) — <what is there>
  - [path/to/other.ts:120](path/to/other.ts#L120) — <what is there>
- **Why it matters:** <one sentence on the consequence if unfixed>
- **Recommendation:** <what to do — at a level a Claude could execute>
- **Effort:** Quick / Moderate / Large

#### C2 — ...

### High

#### H1 — ...

### Medium

#### M1 — ...

### Low

#### L1 — ...

## Strategy

<2–5 sentences explaining the overall approach. What's the logical order of attack? What's the unifying fix (if any) that resolves multiple findings at once?>

## Phase index

| Phase | File                                  | Touches                       | Resolves      | Effort   | Status  |
|-------|---------------------------------------|--------------------------------|---------------|----------|---------|
| 1     | [01-phase-1-<slug>.md](01-phase-1-<slug>.md) | <files / domain>              | C1, M2        | Moderate | Pending |
| 2     | [02-phase-2-<slug>.md](02-phase-2-<slug>.md) | <files / domain>              | H1, H2, M1    | Quick    | Pending |
| 3     | [03-phase-3-<slug>.md](03-phase-3-<slug>.md) | <files / domain>              | L1, L2        | Quick    | Pending |

Phases are ordered by **dependency**, not severity. If phase 2 depends on phase 1's refactor, that's noted in phase 2's preconditions.

Track progress in [`_status.md`](_status.md).

## Tech debt introduced by this plan

<Mandatory section. If this plan introduces any new abstractions, new dependencies, transitional API states, or anything else that's debt:>

- **<thing introduced>** — Why it's needed: <reason>. Cleanup plan: <when this debt gets retired, or "accepted permanently">.

<If nothing new is introduced:>

None — recommendations are pure removal/consolidation. No new abstractions, dependencies, or transitional states.

## Open questions for the user

<Use this section when the audit hit something where the audit's recommendation depends on a decision only the user can make. Don't manufacture questions; if you don't have any, omit the section.>

1. **<question>?** — Context: <why this matters>. Default if you don't answer: <what the plan will assume>.

## Scope-adjacent observations

<Use only if during the audit you noticed something concerning that's **outside the audited scope**. Don't draft phase work for these — just note them so the user knows they exist for a future audit.>

- <observation> — Suggest auditing `<other-target>` later.

## AI Coder: Execution Instructions

> **You are an AI coder picking this audit up in a fresh session, or you are the original auditor entering execution mode.** Execute this plan **autonomously, end-to-end, with aggressive self-resolution.** The user has explicitly said: *"I can always go back and revert things if I don't like it. But as it goes, if there is a better way or things missed, by all means, fix it too automatically."*
>
> That means: don't stop for plan defects, scope creep, missed findings, or fixable bugs — adapt and continue. Stop only for things genuinely irreversible or that require human input no Claude can supply.

### The autonomous loop

For each phase in [`_status.md`](_status.md) order, until all reach `complete`:

1. **Read [`_status.md`](_status.md).** Find the first phase with status `pending`.
2. **Pre-flight checkpoint.** If this phase is marked `Touches > 5 files`, a structural refactor, or touching a shared contract (`analysis.json`, `scoring_config`, `lib/usePlayer.ts`), invoke `/checkpoint` first. This is the user's revert path — always create it.
3. **Open the phase's `.md` file.** Check preconditions.
   - If preconditions are unmet but **you can fix them yourself** (run a missing install, recreate a missing file, regenerate a missing checkpoint), do so and continue.
   - Only ESCALATE if preconditions genuinely require something only the user can supply.
4. **Update [`_status.md`](_status.md):** this phase → `in-progress`, set `startedAt`.
5. **Execute the phase's tasks in order.** **Use best judgment within the audit's general subject area:**
   - If you find a **better way** to accomplish the task's goal, take it. Log the deviation.
   - If you discover a **related finding** the audit missed (within the audit's subject area), fix it inline and log it.
   - If you find a **fixable bug** while executing (broken behavior, not just convention), fix it and log it.
   - **Stay within the audit's subject area.** Don't fix things outside the audit's scope — note them as observations and move on.
6. **Run the phase's Verification commands.** If a Verification step is a **Manual check**, that's an inherent escalation — pause and ask.
7. **If verification passes:**
   - Update [`_status.md`](_status.md): this phase → `complete`, set `completedAt`, log deviations and extra fixes in the event log.
   - Invoke `/commit` for this phase.
   - **Move directly to the next phase.** Do not pause. Do not narrate per-phase progress to the user.
8. **If verification fails — up to 3 self-heal attempts allowed:**
   - Attempt 1: apply the obvious fix from the failure output and re-run.
   - Attempt 2: try a different angle (also update a fixture, adjust a config default, fix a related import).
   - Attempt 3: broaden the fix to anything within the audit's subject area that the failure implicates.
   - If verification passes at any attempt, continue.
   - Only after 3 attempts AND when the remaining problem requires an architectural decision (a Plan A vs Plan B choice), ESCALATE.
9. **When all phases reach `complete`:** append `audit closed — <YYYY-MM-DD HH:MM UTC>` to [`_status.md`](_status.md)'s event log, update its `**Audit status:**` line, and give the user a single end-of-execution summary (format below).

### End-of-execution summary

Only this report, at the very end. Do not narrate per phase during the run.

> **Audit executed — `<audit-slug>-<date>`**
>
> **Phases:** N of N complete.
> **Files changed:** N total.
> **Commits:** `<sha1>` Phase 1 title; `<sha2>` Phase 2 title; ...
> **Verification:** `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` ✓ (web phases), `pytest tests` ✓ (analyzer phases).
> **Checkpoints:** `<list, or "none">`.
> **In-flight deviations & extra fixes:** `<bulleted list of judgment calls and extra work taken beyond the formal plan, or "none">`.
> **Escalations during run:** `<none, or brief list>`.
>
> Next steps: review diffs, run `pnpm db:backfill` if any fixture output changed, `/commit-and-audit` if the player UI surface changed.

The **In-flight deviations & extra fixes** section is load-bearing — it's how the user evaluates judgment calls. Be specific. Empty = "ran the plan exactly as written."

### Escalation Triggers — the short list

Stop and ask the user **only** for these. Everything else, adapt and continue.

1. **A Manual check in the phase's Verification section.** Cannot be done autonomously by definition.
2. **Anything touching shared / external / irreversible state without explicit pre-approval.** A DB migration, a force push, removing `analysis.json`'s published shape, changing `scoring_config`'s schema in a way old reports can't reproduce against, modifying `pnpm-lock.yaml`, deleting files outside the audit scope, anything touching a real swing's data in Postgres.
3. **Missing credential or external dependency.** Don't fabricate values; don't skip auth steps.
4. **After 3 self-heal attempts, verification still fails AND the remaining problem requires an architectural decision** — not just more code.

**Things that USED to be escalations and are now self-resolve:**

- Scope creep → expand and continue, log it.
- Critical finding discovered mid-flight (within the audit's subject area) → fix it, log it.
- Plan defect → adapt the approach to achieve the recommendation's goal, log it.
- Fixable bug → fix it, log it.
- Test failure due to brittleness or a phase-anticipated rename → update the test, continue.
- Repairable preconditions → repair them, continue.
- "Better way" observation → take the better way, log it.

### When you escalate (the rare case)

1. Update [`_status.md`](_status.md): current phase stays `in-progress`, capture the escalation reason in the event log.
2. Give the user a focused report: what phase, what triggered, what you tried, what decision you need.
3. **Do not unilaterally roll back.** Stopping is enough. The user decides next steps via the checkpoint.
4. After the user responds, resume autonomous execution from where you paused.

### Hard rules during autonomous execution

- **Use `/commit` per phase, not at the end.** Per-phase commits give clean rollback granularity.
- **Use `/checkpoint` before any phase the overview marks as `Touches > 5 files` or a structural refactor.** No exceptions.
- **Stay within the audit's subject area** when applying in-flight fixes. A scoring audit can fix scoring-adjacent things; it cannot start refactoring the player.
- **Always log deviations and extra fixes in [`_status.md`](_status.md)** event log. Vague entries aren't useful — say what was changed and why.
- **No per-phase chatter to the user.** Silence between phases is correct. The end-of-execution summary (with deviations list) is the report.

## References

- `docs/DECISIONS.md` D<N> — <title> — <one-line relevance>
- `.claude/rules/<file>.md` — <one-line relevance>
- Next.js / React docs — <URL> — <one-line relevance>
- ...
```

---

## Notes on filling out the template

**TL;DR length.** Two to four sentences. Tell the reader the punchline. If the audit found nothing critical, say so — don't pad.

**Coverage matrix.** Every row must be filled in with `✓`, `⚠`, or `–`. The `–` (not applicable) is honest — e.g., a scoring audit won't have findings on the frame-sync axis. Don't mark `–` to avoid investigating; mark it because the axis genuinely doesn't apply.

**Findings IDs are stable.** Once you assign C1, H1, etc., never renumber. Phase docs reference these IDs.

**Phase index sequence.** Default phase order is by dependency (phase 1 unblocks phase 2). If two phases are independent, order them by impact (highest-severity first).

**The "Tech debt introduced by this plan" section is mandatory.** Even if the answer is "None — pure removal." This forces honesty about the cost of the fix.

**Execution Instructions are load-bearing.** Don't strip or summarize them. A future Claude reading this doc in a fresh session relies on those instructions being verbatim — they're the contract that lets the user paste the path and say "execute this plan."
