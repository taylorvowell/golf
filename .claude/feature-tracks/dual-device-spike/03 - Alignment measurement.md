# 03 - Alignment measurement

**Phase:** Dual-Device Spike
**Status:** not-started
**Estimated effort:** 1-2 sessions

## Overview

**This is the step the whole track exists for.** Take two clips of the same real swing and
measure, in frames, how far apart they actually are — before correction and after audio
cross-correlation. The output is a number with a sample size, not an impression.

§12.5 asks that a golfer can scrub both views together and land on the same swing position.
This step decides whether that is achievable, and at what error.

## Dependencies

- Step 02 complete (one tap, two files, trial records written).
- **Two physical Android devices** — a `HANDOFF` row. There is no emulator path to this step;
  a synthetic camera feed cannot produce a timing result.

## Architectural Context

- `DESIGN-dual-device.md` — the clock triggers, the audio aligns. Clock-only alignment leaves
  camera *phase* unaligned no matter how good the offset is, which is why this step exists.
- **The ball strike is the correlation event.** It is a large, short, unambiguous transient
  present in both recordings, and it happens for free on every swing. A pre-roll chirp from the
  host is the fallback for a strike that is unusable (wind, an air swing, a mat).
- Measurement lives in **Python, with the analyzer** — `services/analyzer/scripts/` — because
  that is where ffmpeg, the CFR normalization and the existing debug-script convention already
  are (`CLAUDE.md`, "the debug scripts are a first-class asset").
- **This project has already claimed accuracy it did not have** (`CLAUDE.md` standing traps:
  event accuracy "verified ±2 frames" while Address was 48 frames early). The pass criterion is
  declared *before* the trials, the raw per-trial numbers are printed, and the distribution is
  reported — not just a headline.
- Both clips normalize to CFR 60 in the existing ffmpeg stage before anything is compared, or
  the frame numbers mean different things on the two devices.

## Files & Areas Touched

- `services/analyzer/scripts/checksync.py` — new debug script, house style: takes two clips,
  prints the correlation, and **writes an image** showing both audio envelopes with the
  detected event marked, so a wrong lock is visible rather than inferred.
- `spikes/dual-device/` — trial-record parsing and the summary table.
- `docs/CURRENT-STATE.md` §11b — the measured reading, once taken.

## Steps

1. Write `checksync.py`: decode both audio tracks, band-pass to the impact range, normalize,
   cross-correlate, report the offset in ms and in frames at 60 fps, and emit the envelope
   image with the lock marked.
2. Validate the tool before trusting it: take one clip, duplicate it with a **known** synthetic
   offset (ffmpeg), and confirm the tool recovers that offset. A correlation tool that has not
   recovered a known answer is not evidence of anything.
3. Run **at least 10 real trials** — both phones on tripods, real swings, real range or net.
   Vary: same Wi-Fi vs hotspot, near vs far, phones woken vs already awake.
4. For each trial report three numbers: (a) the start-instant delta from step 02, (b) the
   audio-correlated offset, (c) the residual after applying (b) — measured by re-correlating a
   second event in the same clip, so the residual is independent of the value being tested.
5. Record the P2P outcome per trial: direct connection or failed. This is the evidence for
   whether a TURN relay must be paid for.
6. Report the **distribution** — median, p95, worst — not the mean. One 6-frame outlier is the
   result that matters to a golfer, and a mean hides it.
7. Print the raw per-trial table into `_PROGRESS.md`. No summary without the rows behind it.

## Quality Standards

- The tool recovers a **known synthetic offset to within 1 ms** before any real trial counts.
- Every trial is a row: trial id, both devices, network mode, all three numbers, P2P outcome.
- The pass criterion is stated before the trials and not moved afterwards:
  **median residual ≤ 1 frame at 60 fps and p95 ≤ 2 frames, over ≥ 10 trials.**
- Any trial excluded from the summary is listed with the reason. Silent exclusion is the
  failure mode this project has already had.
- No claim from the emulator, ever.

## Verification

- `services/analyzer/.venv\Scripts\python.exe -m pytest tests` (the analyzer oracle; new tool
  gets a test against the synthetic-offset fixture)
- `python scripts/checksync.py <clipA> <clipB>` on a synthetic pair recovers the known offset
- The per-trial table exists in `_PROGRESS.md` with ≥ 10 rows and the envelope images on disk

## Definition of Done

- [ ] `.venv\Scripts\python.exe -m pytest tests` passes with the new synthetic-offset test
- [ ] `checksync.py` recovers a known synthetic offset to within 1 ms
- [ ] ≥ 10 real dual-device trials recorded, with the raw table in `_PROGRESS.md`
- [ ] Median and p95 residual reported in frames at 60 fps, against the stated criterion
- [ ] P2P success/failure recorded per trial, so the TURN question has evidence behind it
- [ ] Envelope images on disk for every trial, so a wrong lock is visible

## Notes

If the criterion fails, that is a **successful spike** — it is exactly the outcome this track
was funded to find, and it lands before the product is built around a promise it cannot keep.
Step 04 records the failure and what changes, not a retry loop.
