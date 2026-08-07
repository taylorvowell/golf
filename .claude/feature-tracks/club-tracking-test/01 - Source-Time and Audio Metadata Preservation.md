# 01 - Source-Time and Audio Metadata Preservation

**Phase:** Phase 0 — Ground truth and shared infrastructure
**Status:** complete
**Estimated effort:** 1 day

## Overview

Stage 0 today converts every upload to CFR 60 fps and throws away the evidence of what the
camera actually recorded: `video.probe()` runs ffprobe with `-select_streams v:0` (audio is
invisible to it), `normalize()` passes `-an` (audio destroyed in every derivative), nothing
reads per-frame PTS, and no source-frame → normalized-frame mapping exists anywhere. Both
inspected fixtures are VFR sources (6iron-1: 59.28 → 60 upsample; perfect: 30.02 → 60 with
every frame duplicated) being silently rewritten with no record kept.

The 12-test plan (§3.1, §6) makes this the first shared-infrastructure item: **the effective
frame rate is the source observation rate, not the CFR output rate.** Every downstream test —
especially Tests 9 (source-time forensic fusion), 11 (VFI densification), and 12 (audio
impact) — needs to distinguish a genuine camera observation from a duplicated CFR sample, and
Test 12 needs to know whether audio exists and at what sample rate.

This step captures source timing at Stage 0 and persists it as a **sidecar artifact**
(`out/<stem>/source_timing.json`), the same pattern as `silhouette.json`. It deliberately does
**not** touch `analysis.json` — that is a player contract change and belongs to step 06's
`clubTracking` experiment-schema step (which is human-review-required). Per plan §6, the
frontend is not required to consume source timing at all.

## Dependencies

- None (first step of the track).

## Architectural Context

- Plan §6 "Stage 0 source-time amendment" and §3.1: preserve original demux timestamps
  *before* CFR conversion; duplicate-image detection is only a legacy fallback, not the
  primary method — so this step reads PTS from ffprobe packets and does no image differencing.
- Plan §5.1 `SourceObservation` is the data shape: `source_frame`, `source_pts_s`,
  `normalized_frames`, `is_duplicate_group`.
- `swingsage/video.py:27-41` `VideoInfo` stays **untouched** — all new probing lives in a new
  `swingsage/source_timing.py` so the blast radius on the existing pipeline is zero. The
  existing `probe()` call sites and the `video` block in `analysis.json` are unchanged.
- Sidecar precedent: `silhouette.json` (D48) — separate artifact, atomic tmp + `os.replace`
  write (`burnin.py:864-867` pattern).
- Backfill precedent: `scripts/resegment.py` (D48) adds Stage 2b to an already-analysed
  folder. This step adds `scripts/retiming.py` doing the same for source timing, reading the
  source path from `analysis.json`'s `video.source.path` (verified at write time per D53).
- Audio itself is NOT extracted here — only metadata (presence, sample rate, codec). The
  original upload remains on disk (`video.source.path`) for Test 12 to read waveforms from.
- Log the decision as **D54** in `docs/DECISIONS.md` (append-only, next free number).

## Files & Areas Touched

- `services/analyzer/swingsage/source_timing.py` — new module (probe + pure mapping + serialization)
- `services/analyzer/scripts/burnin.py` — Stage 0 addition: write the sidecar (no `analysis.json` change, no schema bump)
- `services/analyzer/scripts/retiming.py` — new backfill script (`--dry-run` supported)
- `services/analyzer/tests/test_source_timing.py` — new hermetic tests
- `docs/DECISIONS.md` — append D54

## Steps

1. **Create `swingsage/source_timing.py`** with:
   - `@dataclass SourceObservation`: `source_frame: int`, `source_pts_s: float`,
     `normalized_frames: list[int]`, `is_duplicate_group: bool` (plan §5.1).
   - `@dataclass SourceTiming`: `nominal_fps: float`, `avg_fps: float`, `time_base: str`,
     `start_time_s: float`, `duration_s: float`, `has_audio: bool`,
     `audio_sample_rate: int | None`, `audio_codec: str | None`,
     `distinct_observation_count: int`, `observations: list[SourceObservation]`, plus
     `to_dict()` / `from_dict()`.
   - `probe_packets(path) -> tuple[list[float], dict]`: one ffprobe call with
     `-show_entries packet=pts_time,stream=...` (JSON output, **no** `-select_streams` so the
     audio stream is visible); returns sorted video-packet PTS seconds and the parsed stream
     metadata. Parsing lives in a pure helper `_parse_probe(probe_json: dict)` so it is
     testable without ffprobe.
   - `map_observations(pts: list[float], out_fps: float, out_frame_count: int) ->
     list[SourceObservation]` — **pure function**, the hermetic-test surface. Each normalized
     frame `n` (timestamp `n / out_fps`, matching ffmpeg CFR semantics) maps to the source
     frame most recently presented at that time; every normalized frame in
     `[0, out_frame_count)` is assigned to exactly one observation; `is_duplicate_group` is
     true iff `len(normalized_frames) > 1`. PTS are re-based against `start_time` so the first
     observation starts at 0.
   - `build(path, out_fps, out_frame_count) -> SourceTiming` composing the above, and
     `write_sidecar(timing, out_dir)` doing the atomic tmp + `os.replace` write of
     `source_timing.json`.
2. **Wire into `burnin.py` Stage 0** (right after the two `normalize()` calls, ~`:284`):
   build from the *source* file with the *normalized* fps/frame_count, write the sidecar.
   A probe failure must degrade, not crash: warn and skip the sidecar (quality gates degrade,
   they don't crash). Do not modify the `doc` dict or `SCHEMA_VERSION`.
3. **Create `scripts/retiming.py`** mirroring `resegment.py`'s shape: iterate `out/*/`
   folders containing `analysis.json`, read `video.source.path` + `video.fps` +
   `video.frame_count`, skip (with a warning) sources that no longer exist, write
   `source_timing.json`; `--dry-run` prints what it would do.
4. **Write `tests/test_source_timing.py`** (hermetic — no ffprobe, no video):
   - 30 → 60 fps: every observation is a duplicate group of exactly 2 normalized frames.
   - Exact 60 → 60: all 1:1, `is_duplicate_group` false everywhere.
   - 59.94 → 60 (NTSC-ish) and jittered-VFR PTS: partition invariants hold.
   - Invariants for all cases: `normalized_frames` partition `[0, out_frame_count)` exactly
     (every frame appears exactly once, in order); observations sorted by
     `source_pts_s`; `distinct_observation_count == len(observations)`.
   - `_parse_probe` against canned ffprobe JSON dicts: audio present (has_audio +
     sample rate + codec extracted), audio absent (`has_audio` false, nulls), rotation/VFR
     fields ignored gracefully.
   - Round-trip: `SourceTiming.from_dict(t.to_dict()) == t`.
5. **Backfill the committed out/ folders**: run `retiming.py` (not dry-run) so every existing
   `out/<stem>/` gains `source_timing.json`; spot-check `perfect` (expect ~2 normalized frames
   per observation) and `6iron-1` (expect mostly 1:1 with occasional duplicates).
6. **Append D54 to `docs/DECISIONS.md`**: source timing captured at Stage 0 into a sidecar,
   PTS-from-packets primary (duplicate-image detection deliberately not built — fallback
   only, per plan §6), audio metadata recorded while `-an` still strips audio from
   derivatives, `analysis.json` untouched by design until the step-06 schema change.

## Quality Standards

- `map_observations` is pure (no I/O, no subprocess) and is the only place mapping logic
  lives — `retiming.py` and `burnin.py` share `build()`/`write_sidecar()`, never reimplement.
- Sidecar written atomically (tmp + `os.replace`), matching the `silhouette.json` pattern.
- A missing/unreadable source in `retiming.py` warns and continues; it never fabricates
  timing from the normalized derivative.
- New tests follow the existing no-golden invariant style (`test_invariants.py` pattern);
  no frozen-input regeneration, no golden files.

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — full suite green (28 existing + new source-timing tests), no
   golden diffs (nothing in the deterministic stages changed).
2. `python scripts/retiming.py --dry-run` — lists every `out/*/` folder with a readable
   source, errors on none.
3. `python scripts/retiming.py` then
   `python -c "import json; t=json.load(open('out/perfect/source_timing.json')); obs=t['observations']; assert t['distinct_observation_count']==len(obs); ns=[n for o in obs for n in o['normalized_frames']]; assert ns==list(range(len(ns))); import statistics; assert statistics.median(len(o['normalized_frames']) for o in obs)>=2"`
   — the 30 fps fixture really shows duplicate groups and the partition invariant holds on
   real data.
4. `python -c "import json; t=json.load(open('out/6iron-1/source_timing.json')); assert t['has_audio'] in (True, False); assert t['nominal_fps']>0"` — sidecar shape sane on the 59.28 fps fixture.

## Definition of Done

- [ ] `pytest tests` exits 0 with the new `test_source_timing.py` collected and passing.
- [ ] `out/<stem>/source_timing.json` exists for every committed out/ folder whose source
      file is still present, written by `scripts/retiming.py`.
- [ ] `out/perfect/source_timing.json` shows median duplicate-group size ≥ 2 (30 fps source).
- [ ] `burnin.py` calls the same `build()`/`write_sidecar()` path (code inspection — a full
      burnin re-run is NOT part of this step's verification, to avoid the D38-adjacent trap of
      regenerating fixture club traces without `--club-detector`).
- [ ] `analysis.json`, `SCHEMA_VERSION`, and the golden snapshots are byte-identical to
      before this step.
- [ ] `docs/DECISIONS.md` has an appended D54 with Status: ACTIVE.

## Notes

- ffmpeg CFR mapping semantics: output frame `n` sits at `t = n / out_fps`; the source frame
  shown there is the latest one with (re-based) `pts <= t + epsilon`. Use a half-frame
  epsilon (`0.5 / out_fps`) to avoid boundary flapping — same rounding-dodge philosophy as
  the player's `(frame + 0.5) / fps` seek.
- The legacy duplicate-image-detection fallback (plan §6, for sources whose container lies
  about PTS) is intentionally NOT built here. Build it only when a real clip needs it, as
  part of the test that needs it (likely Test 9 or 11).
- Audio waveform extraction is Test 12's job (step 15); it reads the original upload via
  `video.source.path`. If the upload flow later deletes originals, THAT step must revisit
  preserving audio — noted here so the constraint isn't lost.
