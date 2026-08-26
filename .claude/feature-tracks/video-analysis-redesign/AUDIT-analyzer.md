# Analyzer Pipeline Internals — Audit (2026-08-26)

Companion to `AUDIT-current-state.md` §6. Working tree, branch
`swing-detection-and-player-rebuild`. Verified against code + artifacts in
`services/analyzer/out/`. **Headline:** `docs/CURRENT-STATE.md` is stale in five material ways
— a hosted Modal GPU worker exists, an audio-impact stage exists, slow-motion retiming exists,
CFR is no longer 60-only, and there are **27** club variants, not 13. And the newer
`.claude/architecture/high-fps-analysis-cost-problem-2026-08-26.md` describes a club gating
rule (§7 head-inside-shaft-box) that **does not exist in the code**.

## 1. Actual stage order (`swingsage/pipeline.py:run`)

1. `video.probe` + `probe_capture_fps` + `retime_factor` (stage `probe`)
2. `video.normalize` ×2 → `normalized.mp4` (short side 1080) + `analysis.mp4` (720) (`normalize`)
3. `source_timing.build` + sidecar — **skipped entirely when a retime was applied** (L341)
4. `audio_impact.heard_impact` on the SOURCE (normalized copies are `-an`) — NEW vs doc
5. `pose.estimate` (MediaPipe localiser, every frame, CPU, silhouette contours ride along) +
   `pose.retry_gaps` (`pose_localiser`)
6. `pose_rtm.estimate` (RTMW-133 → 49 slots, every frame, batch 1, GPU) (`pose`)
7. provisional `events.detect` for grip window → `strip_derived` → `postprocess` (`stage3`)
8. `events.detect` — 8 events, phases, tempo, swing/playback windows (`events`)
9. `club_detect.ClubDetector.run` — YOLO, every frame, batch 16, whole clip held in RAM (`detector`)
10. `club.track` primary (`club`)
11. **11× more `club.track`** (VARIANTS) + `clubpath.viterbi_refine` + **15× `smooth_trace`**
    (TRACE_MODES) → **27 stored solutions** (`variants`)
12. `club.refine_events` — mutates events in place (address/toe_up/impact/mid_ft), rebuilds
    phases/playback_window/tempo (`club`)
13. `face.analyse` (`face`) 14. `checkpoints.build` 15. `metrics.compute`
16. `silhouette.butt_line`+`payload` (no video re-read — reuses step-5 masks)
17. `contract.write_json` analysis + silhouette 18. `scoring.write_coach_report`
19. `render.burn_in` + `render.contact_sheet` (`render`) — IN the critical path

Wrapped in `OutputLock` (`.analysis.lock`, pid+time, stale-pid detect). **`isolation.py` is NOT
a pipeline stage** — `scripts/isolate.py` only (doc's "stage 2c" is wrong); `isolation.json` /
`club_only.json` unreachable on the queue path.

## 2. Video / timeline

- `probe`: one ffprobe; VFR test two-armed (r_vs_avg OR nb_frames/duration).
- **Slow-mo (NEW):** `probe_capture_fps` reads `com.android.capture.fps`; `retime_factor` =
  fps/capture when capture ≥ 1.5×fps; pipeline mutates src fps to capture rate and passes
  `-itsscale` to both normalizes; audio impact time rescaled; **source_timing skipped**.
  Known live defect: client trim remux drops the tag → import normalizes as real time
  (the 2,445-frame incident).
- **`cfr_target_fps` snaps to {240,120,60}** (5 fps tolerance; healthy 240 take probes ~237.6).
  A 30 fps source is upsampled to 60 — duplicated frames (violates plan's no-duplication rule).
- `normalize`: libx264 CRF 18, GOP 10 (scrub latency), rotation baked, `-an`.
- **Frame identity = the normalized frame index, everywhere** (pose/club/events/checkpoints/
  trace_frames). `source_timing.json` (schema 1, demux-only PTS map source↔normalized, pure
  `map_observations`, invariant-complete) is deliberately outside the contract and **has no
  consumer anywhere** — including club tracking whose docstring says it needs it. Absent on
  every retimed clip.
- Dead: `video.crop_scale`, `pose.swing_bbox`, `pose.remap_to_full`.

## 3. Pose

- MediaPipe: `pose_landmarker_heavy.task`, VIDEO mode, num_poses=1, every frame, CPU only,
  conf = min(visibility, presence); silhouette contours inline (+2.0 s/396 frames);
  `retry_gaps` second IMAGE-mode pass over gaps ≥3.
- RTMW via rtmlib: `RTMPose(... backend=onnxruntime, device=pose_device())`, 384×288
  wholebody-133. **No person detector** — boxes from MediaPipe series (`bboxes_from_series`,
  pad 0.22, backfill). **Every frame, batch 1, session constructed INSIDE `estimate()`** — no
  reuse across jobs even on a warm container.
- Confidence is a rescale of SimCC peak magnitudes: `[1.45, 6.17] → [0,1]` (p01→0.30,
  p50→0.76) — not a probability.
- GPU: `SWINGSAGE_POSE_DEVICE` override, else CUDAExecutionProvider probe; `_enable_cuda_dlls`
  imports torch purely for DLL paths (skip → silent CPU). Modal sets cuda; bench refuses CPU
  fallback. YOLO picks cuda if available. MediaPipe/classical club/face/postprocess/metrics/
  render all CPU.
- Models: `service/models.py` MANIFEST (4 assets, sha256+size committed; clubhead private via
  signed URL). Modal Volume symlinked into real loader paths (env overrides alone failed —
  first bench proved it).

## 4. Postprocess & provenance

Status codes per keypoint per frame: `MISSING=0, PROVISIONAL=1, OK=2, INTERP=3` → serialized
as `pose.frames[].st`. Chain: gate (conf>0→PROV, ≥0.5→OK; trust_hands only rtmpose+wholebody)
→ body_height → side-swap fix → bone-length upper bound → grip prior → accel outlier reject →
promote_consistent → cubic-spline interpolate gaps ≤8 (INTERP) → zero-phase One-Euro + savgol.

- Conf truncated (int(c*10000)/10000). `interp` is a frame-level bool; `st` is the real
  per-joint channel.
- **Interpolated keypoints are written with hardcoded conf 0.45. `metrics.MIN_CONF = 0.35`.
  Neither `metrics.py` nor `scoring.py` ever reads `st`. → every interpolated keypoint passes
  the measurement gate and is scored as if measured.** The provenance chain is severed at both
  joints. (Plan D4/WP-016 is therefore a correctness bug fix, not just a feature.)

## 5. Club

- `club.track` (2,652-line module): decodes the ENTIRE analysis.mp4 to a Python list of gray
  frames; with shaft lines on, also full-clip blur + Sobel gx + gy (float32); with background
  model on, MOG2 **twice** over the whole clip. ≈ **10.1 MB/frame resident per call**; called
  **12×** with variants on → also 24 MOG2 full passes/job. A 1,200-frame 240 fps clip ≈ 12 GB
  vs Modal 16 GB — latent OOM, unguarded. `club_detect.run` separately holds all BGR frames
  (2.76 MB/frame).
- Detection: phase-split — shaft_profile (oriented gradients) in top..impact+4, angular_profile
  (motion ray-march) elsewhere; N_BINS=90; detector injection additive Gaussian bumps
  (heads gain 0.8, sticks gain 1.2 — sticks trained better, mAP50 0.976 vs 0.686); global DP
  over bins; second pass re-solve with fitted swing plane (weight 4.0).
- **The green-box/red-gate rule DOES NOT EXIST.** No `red_gate.py`, no `red_gate|green_box`
  string anywhere in the tree. `detector.sticks()` has exactly one consumer (`inject_sticks`,
  additive). Head admission = confidence + grip-radius bounds only, in both `inject_heads` and
  `apply_detector_heads`. The 2026-08-26 brief §7 and the auto-memory entry describing this
  rule are aspirational/wrong. Step 09 must resolve (implement or formally retire).
- Trajectory gating (`smooth_detector_path`): polar about hands, Hampel on unwrapped angle
  (K=3, tol max(6°, 3·1.4826·MAD)), re-unwrap from survivors, np.interp fill, non-measured →
  interp=true conf≤0.35.
- Trace: 3 polylines split on events; coverage from `conf≥0.30 and not interp` (presence-based
  once lied 97%); `trace_enabled:false` under 0.5; smooth_trace rebuilds polylines only;
  downswing never smoothed; `trace_fidelity` (tol 0.008, measured pre-rejection) is the
  falsifiable number; dashing is a client concern (non-consecutive trace_frames).
- **27 variants** stored per artifact: 11 full re-solves + `model_viterbi` (a real sequence-
  level DP over detector candidates in grip-polar space — the seed of the plan's solver;
  milliseconds, no video re-read) + 15 trace-only rebuilds. Player default `model_traj_moving`.
- `refine_events`: needs `det_heads` from `model_traj_raw` (primary solve has
  detector_head_primary=False). Address-first; takeaway rest-guard; Impact snaps to head low
  point (window 10, ≥6 measured, drop ≥0.02·club_px, bounded by neighbors); **Top deliberately
  not refined**; rebuilds phases/playback/tempo on any change.
- Per-frame storage: f, shaft, head, butt, conf, shaft_angle_deg, blurred, interp,
  `from_model`, `from_ball` — three provenances, never conflated. `club.detector` stores every
  raw box unfiltered.
- Ball: `find_ball` (disappearance at impact) + `anchor_ball` — both off by default on the
  primary solve BUT exercised via `model_traj_anchor`/`model_traj_ball` variants in every
  artifact. Known indistinguishable fix/degrade tradeoff (pro_2 vs perfect).
- Historical trap: the TRACE_MODES loop once shadowed `src` → artifacts recorded
  `video.source.path = "model_traj_raw"`; hence `_checked_source`.
- Unreferenced weights at analyzer root: `sam2.1_s.pt` (92 MB), `yolo11s.pt`, `yolo11s-seg.pt`,
  `yolov8s-worldv2.pt`, `runs/clubhead_seg/`.

## 6. Events / impact / audio

- `events.detect`: sustained-energy swing window (1.4 s boxcar), Top = min grip y before speed
  peak, Address = end of LAST quasi-static hold gated on height (longest-hold rule was 48
  frames early once). Tempo implausibility flags (never corrections). Confidence from
  `_sharpness`, clipped [0.35, 0.98].
- **`audio_impact.py` (245 lines, NEW):** 4 kHz Butterworth high-band RMS envelope (5 ms
  windows), rolling-median floor, ratio>4 & attack>2, swish-gain³ (lookback 0.20 s, guard
  0.03 s, cap 2.5), separation 0.35 s; **confidence = 1 − runner_up/best** (separation, not
  strength). Coefficients derived in the open — they ARE the spec the Android `SwingClip.kt`
  twin implements. Scored 5/5 within 250 ms on the 5-clip truth set (median 0, worst 10 ms);
  every other method 3/5 or worse.
- Fusion today is **observational only**: `analysis.json.audio_impact = {frame, time_sec,
  confidence, agrees, delta_frames}`, agree tolerance 0.25 s. Audio never moves Impact
  (measured 121–148 ms record-path latency; video wins on precision). On 7wood-1 they disagree
  by ~40 frames and audio is right.
- Impact stored as `events.impact = {frame, conf}`; club snap raises conf to ≥0.7.
- `checkstrip.py` seeks once then reads consecutively (per-tile seek on H.265 lies).

## 7. Metrics / scoring

- `metrics.per_frame` every frame, CPU numpy; MIN_CONF=0.35 the single gate; 28 angle_fields,
  33 summary keys, two-pass turn angles, ball_direction nullable on purpose.
- `scoring`: v1/v2 both 38 checks, v2 defers 10; distance-from-band falloff; skip = None +
  reason, never 0; DEFAULT_MIN_CHECKPOINT_CONF=0.3 (just below the 0.35 ordering clamp —
  deliberate); slow-motion one-sided test (backswing > 2000 ms); deterministic narrative;
  `rescore.py` genuinely pure (club type read back from prior coach_report).
- **Scoring cannot see provenance** — consumes checkpoints/summary/glossary/tempo only.

## 8. Artifact

Top-level keys: schema_version, video, pose, events, checkpoints, phases, swing_window,
playback_window, playback_pad, audio_impact, address_span, tempo, club, face, metrics,
posture, quality, quality_raw, quality_mediapipe, stage3.
**SCHEMA_VERSION = 10** (9 = playback_pad, 10 = audio_impact); `SCHEMA_FEATURES` dict stops at
9 (small bug — v9 artifact can't be described). Disk artifacts are v9/v10, all 27-variant,
~8.5 KB/frame with variants (1.17–3.42 MB). `video.source.path` verified readable pre-write.
Writer: `contract.write_json` → schema-validate (fatal) → tmp + os.replace; degrades to no-op
without jsonschema; container sets SWINGSAGE_SCHEMA_DIR. source_timing sidecar NOT
schema-validated.

## 9. Worker surface

Three doors, one `pipeline.run`: CLI burnin.py; `service/server.py` (local, sync, 429
single-flight); Modal `modal_app.py` (ingress asgi 120 s spawn-and-ack + Runner L4/1800 s/
retries 2/max 4/scaledown 300 + fetch_models + bench). `gate_delivery` pure. Secrets: QStash
keys + WORKER_PUBLIC_URL + club-weights URL only. Retry strata: QStash (acceptance), Modal
(infra), TransferError taxonomy (retryable set {408,425,429,5xx-ish}; 401/403/404 terminal
with user messages), `_DropAuthAcrossHosts` (R2 307 bug 2026-08-23), PipelineError never
retried, scratch kept on failure. Progress: STAGE_PCT (16 stages, uneven on purpose), 2 s
throttle, terminal posts retried, `done` carries elapsedS.
**stdout is a load-bearing protocol** — `jobs.ts` regex-parses print lines; prints can't
change shape until events replace stdout end-to-end.
**`JOBS_CLUB_VARIANTS` defaults TRUE** (policy.ts) — brief's "disabled in production dispatch"
is wrong; disabling is an explicit env opt-out. 124.6 s vs 676.6 s per job.

## 10. Performance facts

- Decode: OpenCV VideoCapture sequential everywhere; no NVDEC, no shared decode, no cache.
- **18 decode passes per job with variants on; 7 with variants off** (+2 source transcodes +
  audio decode). Not a single frame shared between stages.
- Every-frame stages: MediaPipe (CPU), RTMW (GPU b1, 26.1 ms/f), YOLO (GPU b16), club.track
  ×12, face, metrics (CPU), burn_in (CPU+x264).
- Per-stage wall clock printed, never stored; only `elapsed_s` total is structured; real
  per-stage timing exists only in `modal_app.bench`.
- Measured (L4): 60 fps-class 124.6 s variants-off / 676.6 s on; 240 fps ~460-frame take
  ~110 s (n=1); slow-mo defect clips 30+ min, one 1800 s timeout death at RENDER, ~75 GPU-min
  burned; extrapolated 1,200-frame 240 fps 5–12 min, $0.15–0.25; SLO p95<180 s → 3–6× over.

## 11. Tests / evaluation

- **162 test functions / 17 files** (doc's "80 passed" ~2× undercount; test_jobrun/test_models/
  test_modal_app/test_retime all new). Frozen input: only swing1+swing2, frozen 2026-08-06 —
  predates retime/audio/cfr changes; golden 2026-08-08. `--update-golden` fails on purpose.
- test_hand_labeled skips (labels null); fixture-count xfail 2 vs 10.
- **Golden checkpoints test runs the club-free fallback path** — shaft-defined P2/P6/P8 has no
  snapshot coverage.
- Harnesses: checkclub/checktrace/clubdebug/traceboard/addvariant/injectvariants/rawdet;
  checktop/checkstrip/kpdebug/checkangles/checkorient/checkbutt/checkball/qa; checkaudio
  (+truth — the ONLY ground-truth harness); **`compare_analysis.py`** (recursive artifact
  diff, --tol, exit 1 — exactly the migration instrument); posebench, modal bench.
- No club-head position-error metric exists anywhere.

## 12. Debt list (analyzer)

Structural: 18× decode, 12× club.track (~10 MB/frame each), no oversized-clip guard, timeout
retried as transient, stdout protocol, two job-spec schemas, RTMPose session per job.
Correctness: INTERP scored as measured; source_timing has no consumer and skips on retime;
green-box rule unimplemented; SCHEMA_FEATURES stops at 9; face-on/left-handed untested;
club-free golden path; no position-error metric; one known 40-frame impact miss; slow-mo tag
loss.
Housekeeping: isolation mislabeled as stage; dead code (crop_scale, swing_bbox,
remap_to_full, _settle, ClubFrame.cands, use_path_curve); ~158 MB unreferenced .pt files;
web/player.html stopgap; mobile clubVariants verbatim copy; stale frozen/golden data.
