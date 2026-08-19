# 04 - Verdict and the build plan

**Phase:** Dual-Device Spike
**Status:** not-started
**Estimated effort:** half a session

## Overview

Turn the measurement into a decision and a plan, then delete the harness. The spike's stated
deliverable is "a measured answer and a decision entry" — this step produces both and authors
`dual-device-capture`'s step files from what was actually learned rather than from what was
assumed here.

## Dependencies

- Step 03 complete, with its per-trial table.

## Architectural Context

- The spike is **throwaway** (`.claude/ROADMAP.json`). Code that survives it does so by an
  explicit decision recorded here, not by being left in the tree.
- Decisions go to `docs/decisions/` as present-tense current state; the *why* and the numbers
  go to `ARCHIVE-numbered.md` (`docs/decisions/README.md`).
- The measured reading goes to `docs/CURRENT-STATE.md` §11b — that file is facts only.
- Roadmap status is derived from `_STATUS.json` and never hand-written into `ROADMAP.json`.

## Files & Areas Touched

- `docs/decisions/` — the entry: transport, signaling, the two-layer sync, and what the residual
  actually was.
- `docs/decisions/ARCHIVE-numbered.md` — the reasoning and the trial table.
- `docs/CURRENT-STATE.md` §11b — the measured alignment reading.
- `.claude/feature-tracks/dual-device-capture/` — `_STATUS.json`, `_PROGRESS.md`, and step files.
- `spikes/dual-device/`, `apps/mobile/src/features/spike/` — deleted, or promoted deliberately.
- `docs/HANDOFF.md` — TURN row opened only if step 03's P2P evidence says it is needed.

## Steps

1. Write the decision entry: what the transport is, what the signaling is, what the two-layer
   sync is, and **the measured residual with its sample size**. If the criterion failed, the
   entry says so and states what the product does instead.
2. File the trial table and reasoning in `ARCHIVE-numbered.md`; put the reading in
   `CURRENT-STATE.md` §11b.
3. Decide TURN on step 03's evidence. If P2P failed in real conditions, open a `HANDOFF` row for
   the relay (it costs money — that is Taylor's call, not Claude's). If it did not, record that
   TURN is deferred and why.
4. Author `dual-device-capture`'s step files, informed by the spike. The expected shape, subject
   to what was learned:
   - **Sync sheet on the capture screen** — right rail beside the DTL/Front toggle; QR + code;
     waiting state; connected-device card.
   - **Camera-device UI** — join by scan or code, assigned-angle display, no record control,
     leave.
   - **Remote control** — angle assignment, zoom (reusing the probed-range slider), flip; the
     host's controls rendered from the peer's reported capabilities.
   - **Coordinated capture** — shared countdown, both record, both stop.
   - **Association and upload** — both files land on one Swing, each with its view and its
     `view_offset_ms`.
   - **Dual-view playback** — the player scrubs both views against the stored offset.
   - **Partial-capture recovery** — §12.6, as a rendered state on every failure path.
   - **App Links** — the system-camera scan, behind the two `BLOCKED` HANDOFF rows.
5. Delete the spike harness and the `react-native-webrtc` import site if the verdict is no-go;
   keep the dependency only if the build track will use it, and say which.
6. Update `.claude/ROADMAP.json` only if a *declaration* changed (scope, dependency, launch
   status) — never to write progress.

## Quality Standards

- The decision entry states a number and a sample size. "It works well" is not a verdict.
- A failed criterion is recorded as a result, not softened.
- Nothing spike-only remains in `apps/mobile` after this step.
- `dual-device-capture`'s step files each carry a runnable Verification section, per the
  template in `.claude/ai-instructions/00 - README.md`.

## Verification

- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test` (proves the harness
  deletion did not break the app)
- `grep -r "spikes/dual-device" apps/` returns nothing
- `.claude/feature-tracks/dual-device-capture/_STATUS.json` parses and lists every authored step
- `/roadmap` renders without a consistency warning

## Definition of Done

- [ ] Decision entry in `docs/decisions/` with the measured residual and sample size
- [ ] Trial table in `ARCHIVE-numbered.md`; reading in `docs/CURRENT-STATE.md` §11b
- [ ] TURN either decided as deferred with evidence, or opened as a `HANDOFF` row
- [ ] `dual-device-capture` scaffolded with step files carrying real Verification sections
- [ ] Spike harness deleted; `pnpm --filter mobile exec tsc --noEmit` and tests still pass
- [ ] `/roadmap` renders clean

## Notes

A no-go verdict is a legitimate and valuable outcome. §12 is a stated differentiator, so a
failure here is a product conversation with Taylor — recorded, argued, never a quiet descope
(`CLAUDE.md`, "Protect the differentiators").
