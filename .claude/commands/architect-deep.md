Architect a solution using the `architect` skill in DEEP mode (multi-agent research).

Invoke the `architect` skill immediately, in deep mode. Everything after `/architect-deep` is
the question/decision to architect. If the argument is empty, ask the user what they want to
architect (one line).

`/architect-deep` is for the heavy decisions — build-vs-buy, multi-model/multi-library
selection, a cross-system ownership redesign, or anything big enough to reshape the plan. It
runs the full fan-out:

1. **Research** — parallel agents, each owning one library/model/topic, grounded in the
   platform's actual `decisions/`/roadmap/`instructions/` docs, returning structured
   findings from current docs/web (not memory).
2. **Debate** — agents steelman opposing stances (e.g. train-our-own-detector vs a hosted
   inference API), each conceding where the other is right.
3. **Synthesis** — one opinionated recommendation across every decision domain, with a
   now-vs-defer sequence.

This spends real tokens and runs as a background workflow. If the user has not opted into
multi-agent orchestration (the word "workflow" or an explicit ask), run the same fan-out
inline with the `Agent` tool instead, then synthesize.

Everything else matches `/architect`: always stress-test the committed plan, land ONE
recommendation with the road not taken and a "gaps you didn't ask about" list, classify the
path forward and gate any handoff on the user's acceptance, record the full result to
`.claude/architecture/`, and offer to record the decision as a new numbered
`docs/decisions/` entry once accepted.

Examples:
- `/architect-deep should we keep building our own club-head detector or adopt a hosted
  pose/object-tracking API`
- `/architect-deep design the analyzer's job-queue and scaling story so batch swing analysis
  handles concurrent uploads at scale`
