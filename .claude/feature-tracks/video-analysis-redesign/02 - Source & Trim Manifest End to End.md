# 02 - Source & Trim Manifest End to End

**Phase:** Foundations
**Status:** not-started
**Estimated effort:** 2 sessions

## Overview

**Objective:** an authoritative source/trim manifest travels with every upload (plan D10,
WP-001..004, WP-006), so capture rate, slow-motion factor, and trim boundaries never depend on
a container tag surviving a remux. Kills the 2,445-frame slow-mo bug class permanently.

**Current state:** the phone uploads ZERO metadata — not fps, not captureFps (which
`probeClip` already reads correctly on import), not trim offsets. The MediaMuxer remux drops
`com.android.capture.fps`, so the analyzer's existing retime path (`probe_capture_fps` →
`retime_factor`) never fires on trimmed imports. No preflight, no window sanity check.

**Target state:** client builds a manifest from the ORIGINAL asset before remux (capture fps +
provenance/confidence, presentation fps, slowmo factor, dims, codec, audio presence, audio
candidates as non-authoritative metadata, user_adjusted flag), updates it after remux (actual
boundaries), runs a local preflight on the trimmed output, uploads the manifest beside the
source, and the server validates it in the step-01 guard and hands capture facts to the
analyzer — container tags demoted to fallback.

## Dependencies

- Step 01 (guard exists to consume the manifest).

## Architectural Context

Matrix rows 4–8; conflicts C2, C9, C12. The manifest is the ONE authority for capture-clock
facts (plan's "important authority rule"): the analyzer may use source/capture/timeline facts;
it must ignore any user-adjusted mark for impact. Ownership split with other tracks:
`media-pipeline` keeps resumable/background/wifi transfer; `swing-ingest` keeps golfer-facing
validation UX. Schema lives in `packages/schema` beside the existing contract (TS + JSON
Schema; Python consumes the same file — same pattern as `analysis.schema.json`).

## Files & Areas Touched

- `packages/schema/schemas/source-manifest.schema.json` + generated TS + shape-lock re-lock
- `apps/mobile/src/features/session/` (manifest writer for record path),
  `features/swings/useImportSwing.ts` (import path), `processing.ts` (upload + preflight)
- `apps/mobile/modules/high-speed-camera` (`probeClip` reuse; trim returns actual boundaries)
- `apps/web/src/lib/ingest.ts` (+ manifest upload target `source_manifest.json` under the
  view's `source/` prefix), `source/complete` (require-or-fallback), step-01 guard (validate)
- `services/analyzer/service/jobrun.py` + `swingsage/pipeline.py` (consume manifest capture
  facts; container-tag fallback)
- `services/analyzer/tests/` + mobile unit tests

## Steps

1. **Schema (WP-001).** `source_manifest_version`, `source{container_duration_ms,
   presentation_fps, capture_fps, capture_fps_confidence, capture_fps_source
   (device_metadata|recorder_config|probe|unknown), slowmo_factor, width, height, codec,
   audio_present}`, `trim{requested_real_start/end_ms, pad_real_ms, requested_file_pts_ms,
   actual_remux_start/end_pts_ms}`, `client_detection{audio_candidates[{real_ms,score}],
   method, threshold_version, visual_fallback_used, window_motion_confidence,
   user_adjusted_window}`. Explicitly NO field named as an impact measurement.
2. **Client writer (WP-002).** Record path: capture facts from the recorder's own config
   (achievedFps, dims — stop dropping them at `deliverTake`). Import path: from `probeClip`
   (the captureFps read that already works). After `trimClip`: write actual boundaries
   (extend the native trim to return the first/last written sample PTS).
3. **Preflight (WP-003).** Post-remux probe of the trimmed output: stream exists, dims/codec
   supported, size cap, non-empty boundaries, real-duration envelope (~4–8 s), presentation
   duration consistent with slowmo mapping, estimated real frame count plausible. Contradiction
   with manifest → fail BEFORE upload, regenerate/retrim; toast on unrecoverable.
4. **Audio confidence API (WP-004).** `pickImpactSeed` returns `{seedSec, confidence:
   "confident"|"ambiguous"|"none", candidates}`; thresholds versioned; goes into
   `client_detection`. (The conditional visual fallback WP-005 is NOT built here — see Notes.)
5. **Window sanity check (WP-006).** Cheap: does the selected window contain a motion
   envelope? First implementation may be audio-energy-only (envelope already decoded);
   low-confidence → warn + offer recenter, always allow override. Never uploaded as impact
   evidence.
6. **Upload + ingest.** `createCapture` returns a third target (`source_manifest.json`);
   client PUTs it before `source/complete`; `completeCapture` verifies existence (missing →
   accepted with `manifest: "absent"` recorded, for client-version skew — the fallback the
   removal table names). Step-01 guard validates manifest-vs-probe consistency; contradictions
   are terminal with reason.
7. **Analyzer consumption.** jobrun passes manifest to the pipeline; `retime_factor` and
   `cfr_target_fps` prefer manifest capture facts over container tags; `analysis.json.video`
   gains additive provenance fields (capture_fps_source).
8. **SWISH parity fixtures (C9).** One shared fixture set (short audio clips + expected
   candidates) run by both the Kotlin test and a pytest against `audio_impact.py`.

## Quality Standards / Verification

- `pnpm schema:check` + shape-lock additive; analyzer pytest green; web tsc+lint green;
  mobile tests for writer/preflight math.
- Fixture matrix (plan E0.1): 30 import / 60·120·240 in-app / VFR / 240-capture-30-present
  slow-mo / non-keyframe remux start / missing metadata / conflicting metadata → each yields
  the expected manifest and the expected guard verdict; **zero frame-count/duration
  interpretation mismatch**.
- E2E: a REAL Samsung slow-mo gallery clip, trimmed on device, analyzes at 240-equivalent
  (retime fires) — the exact defect clip class from 2026-08-26.

## Migration Considerations

Manifest-absent uploads (old clients) fall back to container tags + step-01 guard — same as
today, never worse. Fallback removal condition: client version floor raised past the manifest
ship (removal in step 14). No DB schema change (manifest is an R2 object under `source/`).

## Technical-Debt Impact

**Reduces** (single source of truth for capture facts). The container-tag fallback is the one
temporary mechanism — owner: this step; removal: step 14.

## Observability

Guard logs manifest-vs-probe deltas; audio confidence class counted per upload (this telemetry
is the WP-005 go/no-go input).

## Rollback

Server accepts manifest-absent uploads by design → reverting the client writer alone is safe;
reverting ingest keeps old two-target flow.

## Cleanup

Obsolete after this step: nothing yet (tag fallback lives until 14).

## Notes

**WP-005 (conditional visual trim fallback) is deliberately deferred**: build only if the
audio-confidence telemetry from this step shows a weak-audio rate that justifies it, per plan
D9/E1.2 — feature-flagged, weak-audio-only, never on the fast path. Revisit at step 12 time.
