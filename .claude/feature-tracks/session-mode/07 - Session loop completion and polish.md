# 07 - Session loop completion and polish

**Phase:** Session Mode — Wiring
**Status:** not-started
**Estimated effort:** 1 session

## Overview

Close the loop: the in-session swing list, previous-swing door, favorite/delete and end
session all operate on real data; settings toggles that have real behavior behind them are
wired; the whole surface gets its consistency pass. Ends with the track's fresh-eyes review
and the device-pass HANDOFF.

## Dependencies

- Step 06 complete.

## Architectural Context

- Favorite: the contract's additive favourite field exists server-side (`swings.favourite`);
  if the client is still device-local (`useStarred`), this is the moment to wire the real
  field — check the current contract state rather than assuming.
- Delete: server delete exists (`deleteSwing`) — confirm + cache-from-confirmed-response
  discipline; deleting the currently-open swing returns to capture.
- Video replay OFF (session setting): stop navigating to post-swing; swing processes in
  background; capture screen shows a quiet per-swing status chip instead. AI tips/voice
  toggles: store real flags on the session/swing so `practice-loop` and the AI layer read
  them later; no invented behavior now.
- End session with in-flight analysis: the session ends, processing continues, the Swing
  Log shows the truth — never block ending on a queue.

## Files & Areas Touched

- `apps/mobile/src/features/session/**` — real data throughout, replay-off path, status
  chip, edge cases (app backgrounded mid-recording, permission revoked mid-session,
  storage-full failure surfaced readably).
- `apps/mobile/src/features/swings/` — favorite wiring if the contract carries it.

## Steps

1. Swing-list sheet, previous-swing thumb, dock favorite/delete on real swings; view doors
   open real in-session swings.
2. Replay-off flow + capture-screen status chip (glanceable, golfer-worded).
3. Session/swing flags for ai-analysis / tips / voice persisted where the schema has homes;
   note the read-side consumers (practice-loop, ai-coach) in the DESIGN doc.
4. Edge cases: background/foreground mid-recording (camera released and recovered),
   mid-session permission loss, low storage, analyzer down (queued state honest).
5. Sweep: strings, spacing, dark-surface consistency, a11y labels on every control, dead
   stub code deleted, `SystemGallery` additions current.
6. Fresh-eyes review of the track's diff (`fresh-eyes-reviewer`), fix what it finds.
7. File the S25+ end-to-end device pass as a HANDOFF row (capture fps truth, recording
   reliability, real-range legibility) — close on automated oracles with the device pass a
   named shortfall until Taylor runs it.

## Quality Standards

- No stub code paths remain reachable in release builds; `__DEV__`-only affordances stay
  behind `__DEV__`.
- Every failure state on the surface is golfer-worded with a next action.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` (if web touched)
- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- Emulator: full loop incl. replay-off, delete-current, end-with-inflight.

## Definition of Done

- [ ] All oracles pass; fresh-eyes findings addressed
- [ ] Session loop fully real: list, doors, favorite, delete, end session
- [ ] Replay-off and edge cases behave as specced
- [ ] HANDOFF row filed for the S25+ pass; shortfalls named in `_PROGRESS.md`

## Notes

What this track leaves for others, restated so nothing silently drops: focus card + quick
feedback + spoken feedback (`practice-loop`), capability messaging + manual trim
(`in-app-capture`), resumable upload (`media-pipeline`), auto-stop impact detection
(icebox), entitlement gating of session types (`billing-iap` reads the seam).

**Aligned to the capture spec package (2026-08-20):** two spec items join this step's sweep —
a short **Undo after deleting a take** on the review screen (spec §01.6.2: the file survives
until the undo window expires; today Delete is immediate) and an **orphaned-take cleanup**
sweep for recordings stranded in cache by a crash mid-review (spec §02.12). Filmstrip
thumbnails on the review track remain a named deviation (skinning-pass upgrade), not this
step's work.
