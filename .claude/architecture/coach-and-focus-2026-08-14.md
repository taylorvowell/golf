# The Coach and the focus system — one persona, two layers — 2026-08-14

**Status:** ACCEPTED 2026-08-14. Recorded as **ARCHIVE D58** + register entry in
`docs/decisions/analysis-and-ai.md`; spec amendment in `PROJECT_MAIN.md` §17; Coach-surface
ownership added to `mobile-app-shell`'s declaration in `ROADMAP.json`.

## The question

Taylor: should focuses live "in coach"? And architect the coach further so coach + focus
cohere — assuming, for now, the coach is 100% AI.

## Mode

Audit/first-principles, integrated with two standing constraints taken as real: AI is an
enhancement never a hard dependency (CLAUDE.md), and deterministic-first (priority engine,
goal evidence, drill mappings are code, not model output).

## Scope note on "100% AI"

Treated as an **architecture-sequencing assumption, not a descope**. "AI coach and human
coach in one product" is a named launch differentiator in `ROADMAP.json`; §16.3.2 already
defines three assignment sources (AI / human coach / self) into the same 3 slots, and
coach-platform tracks sit in phase 6 behind ai-coach in phase 4 — the system was already
sequenced to run AI-only first. Nothing here cuts the human coach; if that is ever intended,
it is its own recorded decision.

## Verdict

**Yes in the product, no in the system.** The Coach becomes the product's single guidance
persona, and the focus surfaces present as *the coach's guidance* — but focus state stays
exactly where D55/D56 put it: in the deterministic goal system. Two-layer rule:

> **The Coach is a persona over deterministic systems, never a system that owns state.**
> Deterministic engines decide the facts; the coach persona delivers them. AI writes the
> coach's *words*, never the coach's *facts*. The only path from AI output to durable state
> is a golfer's tap (accepting a proposal) — never a model write.

## The layer model (coach = 100% AI today)

| Layer | What it is | Owns | Availability |
|---|---|---|---|
| **L0 — the engines** | Priority model, goal evaluator + evidence windows, area stats, drill mappings, session-focus selection, template copy, the D57 voice bank | All state, all numbers, all verdicts | Always — this is the floor the product stands on |
| **L1 — narrative AI** | Rewrites L0 output into coach prose: proposal explanations, session summaries, celebration lines, weekly recaps | Nothing — schema-validated text over L0 facts, falls back to L0 templates | Enhancement (ai-coach track's provider seam + cost ceilings) |
| **L2 — conversational AI** | §17 chat, grounded in the golfer's swings, goals, focus history, session context | Nothing durable | Enhancement |

Information flows L0 → L1/L2 only. L1/L2 may *cite* state; they may not *create* it. A
narrative line that names a streak the evidence model didn't produce is a bug, same class as
a fabricated face angle.

## What "focuses in coach" concretely means (product IA)

One **Coach surface** (tab/home presence — exact navigation belongs to `mobile-app-shell`'s
design pass) that gathers what today would be scattered:

| Coach surface element | Backed by |
|---|---|
| Active focus goals + meters ("what we're working on") | goal-progression (§16.3.4 home surface, relocated under the persona) |
| The next proposal, in coach voice | priority engine → L1 wording |
| The Focus page — browse all areas (§16.3.7) | goal-progression catalog |
| "Train this focus" → focus session (§8.4) | practice-loop |
| Chat with the coach (§17) | ai-coach (L2) |
| Session summaries + weekly recap | L0 aggregates → L1 wording |

And the same persona appears **contextually**: the after-swing verdict, the spoken D57 lines
(the bank *is* the coach's literal voice — one voice, one tone across text and audio), the
session focus card, the celebration. The golfer experiences one coach everywhere; the system
underneath stays four tracks and three layers.

## Why the state must NOT move into the AI coach

- **Degradation:** AI down or capped ⇒ goals, meters, verdicts, Focus page, spoken feedback
  all still work (L0). If the coach system owned focus state, AI-down would mean no
  coaching — violating the hard rule.
- **Falsifiability:** "you fixed it" must trace to evidence windows over scoring-config
  checks, never to model output. D55/D56's whole design depends on this.
- **Cost:** L0 is free per session; the coach persona adds AI cost only where narrative
  genuinely adds value, inside ai-coach's ceilings.
- **The human-coach future:** a human coach later assigns into the *same* slots with
  attribution (§16.3.2, §26.3). If focus state lived inside the AI coach, adding the human
  would be a migration; as designed, it's a second author of the same objects — and the
  persona layer must keep AI guidance and human guidance visibly distinct (§26.3), which is
  also why the AI coach persona never pretends to be human (the §8.5 disclosure already
  covers voice).

## Road not taken

- **Focus system owned by the ai-coach track** — breaks degradation, falsifiability, and the
  human-coach seam; loses the four-track ownership just recorded in D56. Rejected.
- **Keep focus surfaces fully separate from the coach** (a "Stats"-flavored Focus tab) —
  functionally identical data, but forfeits the persona coherence that makes proposals,
  spoken verdicts, and chat feel like one coach; and Taylor's instinct ("seems aligned") is
  right at the presentation layer. Rejected.
- **A new "coach" roadmap track** — unnecessary: ai-coach (L1/L2), goal-progression,
  practice-loop, and mobile-app-shell (IA/navigation) already own every piece; the persona is
  a design-system + copy concern inside their existing scopes. Rejected.

## Gaps folded in

1. **Persona consistency across deterministic and AI text** → one authored *coach persona
   spec* (name, tone, vocabulary, what it never says) used by BOTH the L0 template/bank copy
   and the L1/L2 prompts — lives with the goal templates in versioned config, so the coach
   sounds identical whether AI wrote the sentence or not.
2. **Attribution when humans arrive** → every guidance object already carries a source
   (`ai | coach | self` on goals per step 01's schema); the persona layer renders source, so
   flipping on human coaches changes rendering, not architecture.
3. **Chat grounding** → L2 reads the same read-model the surfaces do (goals, evidence, area
   stats) — no separate "coach memory" store to drift; conversation history is its own
   ai-coach concern.
4. **Proposal boundaries** → the coach may *propose* (goal, drill, session focus) but every
   proposal is L0-derived and one-tap-acceptable; the model never auto-assigns. Already
   §16.3.2's posture; restated here as a persona rule.

## Path forward

**Just a decision** (product IA + a persona rule over already-recorded systems). On
acceptance: ARCHIVE **D58** + register entry ("The Coach is a persona over deterministic
systems"), a short PROJECT_MAIN §17 amendment naming the persona layer and the Coach surface,
and a line in `mobile-app-shell`'s declaration (navigation owns the Coach surface). The
coach persona spec itself is authored when ai-coach or the Focus surfaces first build.
