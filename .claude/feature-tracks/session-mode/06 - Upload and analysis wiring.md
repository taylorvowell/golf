# 06 - Upload and analysis wiring

**Phase:** Session Mode — Wiring
**Status:** not-started
**Estimated effort:** 1-2 sessions

## Overview

A recorded swing flows into the real pipeline: swing + view created, the clip uploaded, an
analyzer job enqueued, the analyzing bar driven by true job state, and completion swapping
the local clip for the analyzed swing — phase markers, scores, report sheet and the
"analysis complete" moment, for real.

## Dependencies

- Step 05 complete (swings attach to real sessions).

## Architectural Context

- **This is the dev-grade path, not `media-pipeline`.** Resumable chunked upload, background
  survival, wifi policy and the offline queue stay with that track; this step does a direct
  authenticated upload suitable for the LAN dev loop, behind a seam (`uploadSwingVideo()`)
  the media pipeline later replaces. Name that shortfall in `_PROGRESS.md`.
- The analyzer worker's queue loop is proven locally (`analyzer-service` steps 01–04); jobs
  carry the `kind` discriminator — session swings enqueue `kind: swing`. The worker HOST is
  an open HANDOFF decision; locally, jobs process via the existing local loop.
- Analyzing stages must be honest (§32, D61): map real job states (uploading → queued →
  running stages → done/failed). No fake percentages; a stalled queue shows queued, not
  progress.
- Failure handling follows the quality-gates rule: analyzer failure → user-readable reason
  + filming tips, swing kept as video-only, retry available. AI narrative absence never
  blocks readiness.
- Session type gates the pipeline: `video_only` skips analysis entirely (no job);
  `practice_drills` analyzes but stays quarantined (step 05's flag).
- Frame sync: once the artifact lands, playback swaps from the local file to the served
  clip + artifact through the normal report flow (CFR-normalized). The local clip is the
  pre-analysis stand-in only.

## Files & Areas Touched

- `apps/web/src/app/api/v1/` — swing/view create for a captured clip, upload endpoint (or
  storage-direct with signed target — pick the pattern `lib/media` already supports),
  job enqueue, job/swing status polling shape for the client.
- `apps/mobile/src/features/session/` — `uploadSwingVideo()` seam, `useSwingProcessing`
  (poll job state → analyzing-bar stages; backoff; survives leaving the screen),
  completion → refetch swing/report → drive the `presented` sheet entrance; failure states.
- `apps/mobile/src/features/swings/useSwings.ts` — new swing enters the list cache from the
  confirmed create response.

## Steps

1. Server: create-swing-from-capture route (swing + dtl view + media key), upload receipt →
   enqueue `kind: swing` job; status endpoint the client can poll cheaply.
2. Client: on stopRecord → create + upload in background while the post-swing screen plays
   the local clip; `useSwingProcessing` drives `AnalyzingBar` from real states.
3. Completion: refetch; artifact-backed playback replaces the local clip; phase markers
   appear; "Analysis complete" overlay + sheet slide-up fire only if the golfer is still on
   that swing's screen.
4. Failure: readable reason + filming tips (reuse help-sheet content), swing remains
   watchable, retry re-enqueues; entitlement/AI-off paths short-circuit to video-only.
5. Session swing-list sheet + previous-swing thumb read real statuses.

## Quality Standards

- Upload and polling survive screen navigation (session-scoped, not screen-scoped); a
  popped screen aborts nothing that matters and leaks nothing that doesn't.
- Every fetch has a timeout and abort path (ApiClient discipline); polling backs off.
- No confidence-free claims: "analyzing" states come from the job record, done comes from
  the artifact actually being fetchable.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`
- End-to-end on the local stack (analyzer venv + local queue loop + web API + emulator):
  record → analyzing stages progress → markers + score appear → sheet slides up.

## Definition of Done

- [ ] All oracles pass
- [ ] A recorded swing reaches a ready state end-to-end locally, session-attached
- [ ] Analyzing bar reflects real job states incl. queued and failed
- [ ] Video-only skips the pipeline; drills stay quarantined
- [ ] Failure path is readable, recoverable, and never loses the video

## Notes

The direct-upload seam and its named shortfalls (no resumability, no background survival,
no wifi policy) are `media-pipeline`'s to close — log the seam in `docs/decisions/`
media-storage register when built.
