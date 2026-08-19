# Achievements — the gamification layer

**Directed by Taylor, 2026-08-19 (D62).** SwingSage celebrates milestones: points and ranks,
one-time badges, and small "confetti moment" toasts for wins like the first session or a new
personal best. This amends PROJECT_MAIN §16.3.5's "not a badge economy" line — see the D62
amendment there for how the two coexist.

## Principles

1. **Celebrate effort and firsts, not just skill.** A beginner earns things on day one
   (first swing analyzed, first session finished, showing up two days in a row). Skill-gated
   badges exist, but the ladder never requires being good to feel progress.
2. **Every award is explainable.** A badge names exactly what was done ("First swing scored
   80+"), and an unearned badge says how to earn it. Same product rule as the analysis engine:
   nothing mysterious, nothing fabricated.
3. **Awards derive from real measured events only.** The evaluator reads the same server-side
   facts the product already trusts (analyzed swings, sessions, scores, goal transitions).
   Abstained/low-confidence swings never earn a quality badge — the honesty rules thread
   through here too.
4. **Scarcity keeps it fun.** Routine XP accrues silently in the ledger; a *toast* fires only
   for badges, rank-ups, and personal bests. Never toast "+10 XP" for a normal swing —
   celebration fatigue kills the whole system. At most one confetti moment per trigger event;
   extras queue.
5. **The focus-goal celebration outranks everything.** §16.3.5's goal-achieved moment stays a
   singular full-screen event owned by `goal-progression`. When both fire on the same swing,
   the goal moment plays first; badge toasts queue behind it.
6. **Supportive, never shaming.** A broken streak resets quietly. No guilt copy, no decay
   mechanics, no comparison against strangers. (A coach-group leaderboard is a possible
   post-launch idea — icebox, not here.)

## The pieces

### XP and ranks

- Actions earn XP: an analyzed swing, a completed session, a day's first practice, a personal
  best, a goal achieved, badges themselves.
- Total XP maps to a **rank ladder** — golf-flavored, ~8 tiers, e.g. *Rookie → Range Regular →
  Ball Striker → Shot Shaper → Flusher → Tour Grinder → Sage*. Names/values live in the config,
  not code.
- Rank-up is a celebration moment (toast + confetti). XP itself accrues silently.
- Rank + progress-to-next render on Profile (the trophy room, step 04).

### Badges

One-time achievements, tiered (bronze/silver/gold) rather than endlessly multiplied:

- **Firsts** — first swing analyzed, first session, first goal achieved, first face-on +
  DTL pair, first coach connected, first shared swing.
- **Volume** — 10 / 50 / 100 / 500 analyzed swings; 5 / 25 / 100 sessions.
- **Streaks** — 2 days in a row, a 5-practice week, a 4-week streak.
- **Quality & improvement** — new personal-best score; 10-swing average up 5 points; first
  "clean" on a check that used to be a top fault; every scored check ≥ 80 in one swing.

Definitions (id, copy, category, tier, icon, XP, trigger predicate + params) live in a
**versioned config** (`achievement_config/v1.json`), the same discipline as `scoring_config` —
never hardcoded, and earned rows record the config version that awarded them.

### Ceremony levels

| Level | What | Owner |
|---|---|---|
| Full-screen moment | Focus-goal achieved (§16.3.5) | `goal-progression` |
| Toast + confetti (top toaster, NOT the bottom sheet) | Badge earned, rank-up, personal best | this track (built, step 01) |
| Silent ledger | Routine XP | this track |

### The trophy room (Profile)

Rank + XP meter, badge grid (earned lit, unearned dimmed with "how to earn" copy), recent
wins. Step 04.

## Architecture

- **Awarding is server-side and deterministic.** A pure evaluator runs when a swing reaches
  `ready` and when a session closes: load user counters → evaluate predicates against the new
  event → insert `user_achievements` rows + bump XP, idempotent (unique on
  `user_id, achievement_id`; counter updates transactional with the triggering event). No AI
  anywhere in the award path; AI may later write flavor copy as an enhancement only.
- **Tables** (apps/web owns, RLS golfer-owned, coach read via the existing boundary):
  - `user_achievements(user_id, achievement_id, config_version, earned_at, evidence_swing_id?, seen_at)`
  - `user_progress(user_id, xp, counters jsonb, updated_at)` — rank is derived from XP + config,
    never stored.
- **Delivery piggybacks on responses the client already fetches** — swing/session payloads
  carry `newly_earned: Achievement[]` (unseen rows). The client queues them into the
  celebration surface, then acks (`seen_at`) — server-recorded once-ness, the same rule
  §16.3.5 uses for goal celebration idempotence. Unacked awards replay until seen, so a
  killed app never eats a celebration. Push delivery of "you earned X while away" belongs to
  `notifications` (§29), not here.
- **Client**: `apps/mobile/src/features/achievements/` — the `CelebrationProvider` queue is the
  single mouth for all toast-level celebrations app-wide (goal toasts can route through it
  later). Toast + confetti are pure UI; nothing is computed on the phone.
- **Entitlements:** achievements are free-tier — an engagement layer, never gated.

## Steps

- **01 — Celebration surface + debug trigger** (built 2026-08-19): provider/queue, toaster,
  confetti, debug-menu actions.
- **02 — Definitions config + award engine (server):** `achievement_config/v1.json`, schema
  types, tables + RLS, the evaluator wired to swing-ready and session-close.
- **03 — Delivery + ack:** `newly_earned` in payloads, ack endpoint, client wiring
  fetch→queue→ack.
- **04 — Trophy room:** Profile rank/XP/badge grid.
- **05 — Tuning + real moments:** which events toast vs ledger, streak definitions against
  real usage, notifications handoff.
