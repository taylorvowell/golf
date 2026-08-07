Architect a solution using the `architect` skill (fast / inline mode).

Invoke the `architect` skill immediately. Everything after `/architect` is the question/
decision to architect. If the argument is empty, ask the user what they want to architect (one
line).

`/architect` is the **fast, high-level** mode: ground in the relevant `DECISIONS.md` entries/
roadmap/`instructions/` docs + a few targeted external checks, then decide. For a build-vs-buy,
multi-model/multi-library selection, or a decision big enough to reshape the plan, use
**`/architect-deep`** (multi-agent research + adversarial debate + synthesis).

Examples:
- `/architect should the club-head detector move to a hosted GPU inference endpoint or stay
  batch-only on the analyzer's local GPU`
- `/architect where should re-scoring live when a scoring_config threshold changes — inside
  the analyzer job or a Postgres-side function`
- `/architect how do we version analysis.json so a future pipeline change stays backward
  compatible with stored artifacts`

Do not start grepping or reading files before invoking the skill — its own workflow grounds
itself and decides research breadth. Going in cold wastes context.

The skill: uses its own best judgment (it decides, it doesn't interrogate), always
stress-tests the current/committed plan even when it looks fine, lands ONE opinionated
recommendation with the road not taken and a "gaps you didn't ask about" list, classifies the
path forward (just-a-decision vs `/feature` track vs a bigger multiphase plan) and asks before
handing off, records every call durably to `.claude/architecture/` so you can revisit and
continue the thought, and offers to record the decision as a new numbered `docs/DECISIONS.md`
entry once you accept. It does NOT write code or plan a build before you accept the
recommendation.
