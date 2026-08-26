# 04 - The mocked instructor screens

**Phase:** Instructor Mode
**Status:** complete
**Estimated effort:** 2–3 days

## Overview

The full first-draft instructor UI, mocked and unplumbed — sample-data view-models behind
named swap seams (the session-mode/coach-surface pattern), so Taylor finalizes UX/UI on
glass before anything is wired. Plan §4a's eight surfaces plus the golfer-side halves of
each loop. The separating surface is the **triage inbox**: swings arrive pre-analyzed and
the queue sorts by what changed.

## Dependencies

- Step 03 complete (the shell these screens mount into).

## Architectural Context

Plan §4a (the revised inventory — read it in full before starting; it encodes the
2026-08-24 gap review) and §7b (the differentiators the screens must foreground).
D60 (`coach-video-lessons-2026-08-18.md`): the conversation is typed rich cards over one
log; a broadcast is N 1:1 entries with a shared `broadcast_id` — never a group thread.
House UI rules bind: only what a golfer/instructor acts on; no diagnostics on product
surfaces; flat, tokens, tap states.

## Files & Areas Touched

- `apps/mobile/src/features/instructor/` — the screens, `mock/` view-models with one
  clearly named seam module per domain (`rosterSeam.ts`, `threadSeam.ts`,
  `progressSeam.ts`, `drillsSeam.ts`, `listingSeam.ts` — each exporting the view-model
  the later track replaces)
- Golfer side: `InstructorChatScreen.tsx` (typed thread + received broadcast),
  swing-report surface (ask-for-review door), drills/feedback/goals attribution stubs
- `apps/mobile/src/features/debug/` — relationship/thread state chips
- `apps/mobile/src/navigation.ts`, shell wiring from step 03

## Steps

1. **Home (triage)** — needs-attention queue (regressed metric, review request, gone
   quiet, compliance drop — each a typed card), analyzed-swing feed (thumbnail + score +
   confidence), instructor spotlight rail (Gold upsell, invite-your-first-student).
2. **Students** — roster list with search, groups/tags, filter/sort (needs-review,
   recency, plan status); cards per §4a; pending requests block; invite door (QR/link
   mock).
3. **Student detail** — full §25.2/§4a.3 set: header (profile + goals + equipment),
   current-plan card, measured-progress charts (canned series), recent swings →
   `SwingPage` review host with review chrome doors (mark reviewed, annotate,
   record-a-lesson — doors only, sheets say what will live there), thread, drills with
   compliance (camera-verified vs self-reported labelled apart), focus-area assignment
   (3-slot rule incl. slots-full state, attribution, golfer-can-decline copy), private
   notes, end-relationship affordance.
4. **Inbox + Broadcast** — conversation list; thread as typed rich cards (message,
   lesson, review request, drill assignment, plan update, shared swing); broadcast
   composer with audience picker (all / a group) and BCC explainer; broadcast history
   rollup; frozen + blocked thread states; report/block sheets.
5. **Drill library** — browsable/searchable authored drills, create flow mock
   (record/upload demo, name, cues, equipment), assign entry, templates/programs door.
6. **Directory listing editor** — full §23.1 fields, §31.5 lifecycle states (draft /
   pending approval / listed / rejected / suspended), request-verification door,
   preview-as-golfers-see-it.
7. **Membership** — Free/Gold/Platinum comparison from `MEMBERSHIP_LIMITS`, paywall
   skeleton, Restore purchases row, instructor-dimension refusal sheet (roster full).
8. **Become an instructor** — door in the personal profile drawer → onboarding sequence
   mock (claim role, listing draft, membership pick, lands in instructor mode).
9. **Golfer-side halves** — typed thread in `InstructorChatScreen` incl. a received
   broadcast rendered as a normal message; ask-my-instructor-to-review door on the swing
   report; received drill/feedback/focus-goal cards with instructor attribution, visually
   distinct from the AI coach (§26.3).
10. **Debug** — relationship/thread state group (pending, invited, declined, frozen,
    blocked) + seam-level toggles for empty/loaded/error states per screen, per the
    forceable-states house rule.
11. `_PROGRESS.md` notes each seam's name and what later track replaces it.

## Quality Standards

- Every screen renders exclusively from its seam's view-model — no screen constructs
  sample data inline; deleting `mock/` must break compilation, not silently blank screens.
- All state forceable from the debug sheet; no state reachable only by editing code.
- Both themes clean on every new screen (instructor screens render in INSTRUCTOR; the
  golfer-side halves in LIGHT/DARK).

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Emulator walk (major feature — sanctioned): every screen reachable, every debug state
  renders, no dead taps.

## Definition of Done

- [ ] All eight instructor surfaces + golfer-side halves reachable and populated from seams
- [ ] Every §4a state (incl. slots-full, frozen, blocked, suspended-listing, roster-full
      refusal) forceable on glass
- [ ] Zero network calls from any new screen (the ApiClient is not imported by mocks)
- [ ] Nothing plumbed: no new API routes, no schema changes, no storage writes beyond
      device-local UI prefs
