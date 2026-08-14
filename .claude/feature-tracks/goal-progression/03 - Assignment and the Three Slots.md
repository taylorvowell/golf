# 03 - Assignment and the Three Slots

**Phase:** Improvement Tracking
**Status:** not-started
**Estimated effort:** 1–2 days

## Overview

How goals come to exist: the AI proposal from priority output, golfer self-promotion from a
finding, the coach seam, and the hard 3-slot rule with swap/retire/decline. Ends with the full
lifecycle mutable over the API — still no product UI (step 04).

## Dependencies

- Step 02 complete (a proposal without an evaluator behind it is a promise the system cannot
  keep).

## Architectural Context

- §16.3.2: proposal-first, one tap accepts, nothing force-assigned. §16.1's factors decide
  *which* template is proposed — severity, confidence, recurrence across recent swings, style
  legitimacy (already gated upstream), §5.3 aspiration alignment, and dependency order (a
  setup fault outranks a downstream fault it plausibly causes).
- Coach-assigned goals: source recorded, slot occupied, visually attributable (§26.3), golfer
  can decline/end — but creation and permissioning through a real coach relationship arrives
  with `coach-relationships`/`coach-collaboration`. Build the data path (`source = 'coach'`
  works end-to-end in tests), not the coach UX.

## Files & Areas Touched

- `apps/web/src/lib/goals/propose.ts` — priority output → ranked template proposals.
- `apps/web/src/app/api/v1/goals/` — mutations: accept, decline, retire, swap, promote
  (finding → goal).
- `apps/web/src/lib/goals/config/v1.json` — finding-category → template mapping if not
  already expressible.

## Steps

1. **Proposal.** From the golfer's recent analyses' priority output: rank candidate templates,
   exclude templates already active/achieved-and-maintained, exclude templates whose required
   view the golfer has no recent footage for (§16.3.3 — never assign into silent
   unmeasurability; if excluded for view, say so in the proposal payload so the UI can say
   "film face-on to work on this").
2. **Slot enforcement at the API.** Accepting a fourth active goal is a 409 with a typed
   error naming the swap requirement — the rule lives server-side, not in a client check.
3. **Self-promotion.** Any finding with a mapped template can be promoted; unmapped findings
   return "not trackable yet" honestly rather than inventing an unmeasured goal.
4. **Decline semantics.** A declined AI proposal is recorded (do not re-propose the same
   template immediately); a declined coach goal is visible to the coach as declined, never
   silently dropped (schema + event only for now).
5. **Assignment-time backfill.** Accepting a goal immediately evaluates recent history (step
   02's backfill path) so the first render has a meter or an honest "no evidence yet".

## Quality Standards

- Every mutation is authorized, idempotent, and covered in `route-auth.test.ts`.
- Proposal ranking is a pure function with unit tests over synthetic priority fixtures —
  including the view-exclusion case and the 3-slot-full case.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter web test`

## Definition of Done

- [ ] Full lifecycle exercisable over the API alone: propose → accept → evidence accrues →
      retire/swap, plus promote-from-finding — proven by an integration test against the
      local database.
- [ ] Fourth-goal accept returns the typed 409; swap succeeds.
- [ ] `source = 'coach'` path works in tests end-to-end (creation gated on relationship
      arrives with coach-collaboration; noted, not faked).
- [ ] Web oracle green.

## Notes

Do not build a "coach picks a golfer and assigns" screen here under any pretext — that surface
belongs to the coach workspace and its row-level rules. The seam is the deliverable.
