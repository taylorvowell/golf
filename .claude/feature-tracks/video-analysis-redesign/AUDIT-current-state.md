# Video-Analysis Redesign — Current-State Audit

**Date:** 2026-08-26. Branch `swing-detection-and-player-rebuild`, working tree including
uncommitted changes. Traced from code by four parallel audit agents, not from docs —
`docs/CURRENT-STATE.md` (snapshot 2026-08-09) is stale on upload/ingest/hosted-worker facts and
must not be trusted for those areas.

**Purpose:** the reconciliation record between the planning package
`.claude/swingsage_video_analysis_plan_v2/` (the TARGET, written without codebase access) and
the repository as it actually is. Read this before any step of this track. The
current-vs-target matrix lives in `MATRIX-current-vs-target.md`; the step files implement the
migration.

**Audit coverage status:**
- §3 Mobile pre-upload path — COMPLETE
- §4 Server ingest / jobs / worker / artifacts — COMPLETE
- §5 Playback / overlay / frame identity / corrections — COMPLETE
- §6 Analyzer pipeline internals — COMPLETE (see AUDIT-analyzer.md if split out; else below)

---

## 1. The planning package, digested

15 docs + 3 reference docs. Core decisions (D-numbers are the PLAN's, not docs/decisions/):

- **D1 — user trim mark is trim-only.** Never impact prior/evidence/label/scoring input. Server
  rediscovers impact independently.
- **D2 — playback fps ≠ inference fps.** Per-subsystem observation cadence; 240 fps playback
  does not imply 240 Hz pose.
- **D3 — immutable source-frame identity.** Source-frame manifest (source_frame_id, source_pts,
  real_capture_time, playback_frame_id/pts) built before analysis; all outputs reference stable
  frame IDs.
- **D4 — provenance vocabulary:** `model | tracked | propagated | derived | manual_correction |
  missing`; scoring rules can demand `direct_only: true` → forced direct inference on exact
  event frames.
- **D5 — impact is multimodal** (audio + club/ball + club motion + ball transition + body phase),
  calibrated fusion, no single witness authoritative.
- **D6 — club = 5-keypoint club pose** (grip, shaft-mid, hosel, head-A, head-B) from
  high-res crops + sparse full-frame region detector (~every 5th native frame when locked,
  dense on reacquisition) + sequence-level solver over retained candidate sets (top K=3–5).
  CADDIE-inspired; strides/points frozen only after benchmark on own footage.
- **D7 — missing club geometry stays missing.** Solvers select among observed candidates; never
  manufacture points. Dashed-gap rendering is affirmed as-is.
- **D8 — analysis_ready ≠ presentation render.** Burn-in/contact-sheet/share media move after
  the interactive result.
- **D9 — pre-upload stays audio-first;** sparse visual motion fallback is conditional (weak/no
  audio only), feature-flagged, adopt only on measured benefit.
- **D10 — authoritative source/trim manifest** (capture fps, presentation fps, slowmo factor,
  trim boundaries requested + actual, client detection info) survives remux; container tags are
  not trusted. Local post-remux preflight validates before upload; server re-validates.

Server DAG target: S0 verify/guard → S1 frame manifest → S2 coarse pass (~30 Hz pose, ROI,
event neighborhoods) → adaptive refinement planner (explicit per-subsystem frame sets, stored
in artifact) → S3 body refine (≤60 Hz active swing + forced scoring frames) / S4 club refine
(native-rate crops) / S5 ball windows → S6 event native refinement + impact fusion → S7 metrics
→ S8 silhouette (setup frames only) → S9 scoring → analysis_ready → S10 presentation render.
Progressive revisions: coarse_ready → body_ready → club_ready → analysis_ready. Stage
checkpoints to R2; resume without re-running completed expensive stages. Retryable vs terminal
failure classes; workload guard before GPU.

Ground truth is a prerequisite, not cleanup: club 5-pt annotation schema + golden set (label
every native frame in club-critical interval) + dev set + golfer-disjoint holdout; event labels
(frames + ms, dual-annotated subset); trim-system labels on raw pre-trim clips; golden-set CI
with machine-readable diffs and hard gates (frame-identity mismatch = 0, propagated-as-direct
= 0, high-confidence catastrophic impact miss = 0).

Performance: optimize order = stop wrong work → ROI/crops → intra-clip batching → decode near
GPU → FP16/TensorRT → warm strategy → INT8 last. Cost KPI = dollars/accepted view (≤ $0.06 for
240 fps initially). All cadence/model/runtime/GPU choices are EXPERIMENTS (11_experiment_plan)
with gates, not constants.

Migration: independent feature flags (no monolithic switch), shadow mode for body/club/impact,
keep 49-keypoint contract via adapter, artifact revisions immutable, rollback = version
pointers. Explicit removal condition for every temporary mechanism.

Measured baseline (reference/current_problem_brief_2026-08-26.md — production, Modal L4):
pose 26.1 ms/frame; ~450–500-frame 60 fps job 124.6 s end-to-end (variants off), 676.6 s
variants on; ~460-frame 240 fps take ~110 s; slow-mo defect clips (~2,445 frames) 30+ min,
hit 1800 s timeout, ~75 GPU-min burned across 4 jobs; 60 fps cost $0.03–0.05; extrapolated
240 fps (~1,200 frames) 5–12 min and $0.15–0.25 — 3–6× over the p95<180 s SLO.

---

## 2. Current-state system map (end-to-end, as deployed)

```
RECORD (S25+, Android only)                      IMPORT (gallery)
  high-speed-camera ladder → true 240fps MP4       expo-image-picker → cache copy
  audio-only (SWISH) impact candidates             probeClip: captureFps/videoFps/durationMs
  SwingReview: golfer marks ONE instant            ImportConfirm (confirm-first) / SwingReview
        ↓ mark → reviewWindowAround() ONLY (mark itself discarded, never uploaded)
  trimClip: MediaMuxer lossless remux, SEEK_TO_PREVIOUS_SYNC start, +0.1s pad
        ↓  (NO manifest, NO fps/slowmo/trim metadata accompanies the upload)
  POST /api/v1/swings {view, handedness, contentType, sessionId}
        → rows minted, signed R2 PUT URLs (source + poster)
  PUT bytes phone→R2 direct;  POST /swings/:id/source/complete {analyze}
        → store.exists() verified → startCaptureAnalysis
        ↓ JOBS_DRIVER=queue
  publishJob: INSERT jobs(queued) → QStash publishJSON (retries 3, flowControl user-key)
        ↓ signed delivery
  Modal ingress (CPU, 120s) verifies QStash sig → Runner.run_job.spawn (L4, 1800s, retries 2,
      max_containers 4, scaledown 300s, models from hash-verified Volume)
        ↓ jobrun.py: GET /api/internal/jobs/:id/source (307→signed R2, auth dropped x-host)
  pipeline.run(): normalize(CFR@capture rate 240/120/60) → source_timing → pose(RTMW, EVERY
      frame) → silhouette → postprocess → events → club(every frame) → face → checkpoints →
      metrics → scoring  [+ overlay.mp4, contact.jpg render IN the critical path]
        ↓ PUT /api/internal/jobs/:id/artifacts/<name> (streams through Vercel fn) → r<n>/ keys
  POST events {done} → isPublished verified → markViewReady → scores sync → status=ready
        ↓
  client polls GET /swings/:id/reanalyze?view= (1.2s→5s backoff, 12min give-up)
  playback: web canvas+rVFC ((f+0.5)/fps), mobile frame-clock/media3 (f/fps),
      one CFR file = analysis input AND playback asset; corrections merged by raw frame index
```

Key numbers: `analysis.json` schema_version 10; artifact revisions `r<n>` immutable,
publish-then-flip; job token HMAC 6 h; heartbeat sweep 900 s / pending 3600 s (poll-driven
only); JOBS_CLUB_VARIANTS defaults **true** (the 5.4× dev shape — live cost bug).

---

## 3. Mobile pre-upload path (COMPLETE)

Corrections to assumptions: native modules live at `apps/mobile/modules/` (high-speed-camera,
frame-clock, shutter-remote — **all Android-only**; frame-clock alone has iOS).
`SystemGalleryScreen` is the `__DEV__` design gallery, not import.

### Capture
- `HighSpeedCameraView.kt` (~1100 lines): one CameraDevice, constrained-high-speed session,
  **attemptLadder** — fixed ranges ≤240 descending, each tried with-preview then without, 4 s
  main-thread watchdog per rung (HAL fails silently). Achieved rate resolved back to JS
  (measured 231 fps @1080p, D39). JS always requests 240 (`MAX_FPS_REQUEST`); no user picker.
- Recorder sets `setVideoFrameRate == setCaptureRate` → **true 240 fps container, never a
  slow-mo container**. slowMoFactor always absent on record path (correct).
- Bitrate `w*h*30*0.15*sqrt(fps/30)` — unvalidated guess (open HANDOFF row). Audio: mono AAC
  44.1 kHz 128 kbps; audio is the only impact signal (2-surface limit in HFR session).
- `stopRecording → {path, fps, durationMs, bytes}`; `deliverTake` forwards only
  `{path, fps, durationMs}` → `SwingClipRef {path, fps, durationMs, slowMoFactor?}`.
- Dead: `onCaptureConfig` (emitted, zero subscribers), `camera2Capabilities()`/
  `Camera2HighSpeed.kt` (zero call sites), `rates[]`.

### Import
- `probeClip` (MediaMetadataRetriever): `captureFps` ← `com.android.capture.fps` (0 = unstamped),
  `videoFps` ← frame_count*1000/duration. `useImportSwing.confirm()`: if captureFps>videoFps →
  `fps = captureFps`, `slowMoFactor = captureFps/videoFps`. Unreadable duration → upload whole
  clip, skip review.
- **The phone already probes the slow-mo capture rate correctly on import — it just never sends
  it** (see gaps).

### Audio impact detection (on-device)
- `SwingClip.kt`: 9 methods, shipped default **SWISH** (band-HP 4 kHz Butterworth envelope,
  rolling-median floor, ratio>4 & attack>2 gates, pre-impact swish gain^3, edge time prior
  0.15→1.0 over min(5 s, 25%), separation 0.35 s, limit 3). Scores are **ordering-only within
  one clip** — no absolute confidence concept exists. Empty list is a normal answer.
- Selection: `pickImpactSeed` = last candidate ≥ 0.6×best (two-strikes rule); fallback
  `duration − 6 s`.
- Truth set: 5 clips, one golfer, one indoor bay (`services/analyzer/scripts/audio_truth.json`)
  — rejects methods, certifies nothing.
- **The identical SWISH algorithm is hand-duplicated in
  `services/analyzer/swingsage/audio_impact.py`** (server witness) — ~10 constants copied with
  no shared home.

### Trim UI & mark semantics
- `SwingReview.tsx`: golfer marks ONE instant (impactSec), paused picture, warped scrub axis
  (`scrubWarp.ts`: edges 3 s→5% each, fine 5 s around the DETECTOR's anchor→45%), filmstrip via
  `clipThumbnailsAt`, template phase bands (nominal tour tempo, not measurement).
- `reviewWindowAround(at)` = 2.5 real-s pre-roll, 5 real-s window, ×slowMo, +0.1 s pad →
  `trimClip`. **The mark is then discarded — never stored, never uploaded.** Plan D1 is already
  satisfied, by construction.
- Import path has confirm-first (`ImportConfirm`); record path goes straight to scrubber (no
  confirm pass) — asymmetric by design so far.

### Trim implementation
- `SwingClip.trim`: MediaExtractor+MediaMuxer container-level copy (lossless, ms-fast), start
  snapped `SEEK_TO_PREVIOUS_SYNC` (up to one GOP early, never late), end not aligned,
  orientation hint re-applied, both tracks share one PTS origin. Failure policy differs by
  path: record → save whole take; import → abort with reason, nothing uploaded.
- **The remux drops `com.android.capture.fps`** — the root cause of the 2,445-frame slow-mo
  incident. Trimmed slow-mo reaches ingest as an ordinary ~30 fps clip.

### Upload & processing state
- `processing.ts` (module-level store, survives navigation, RAM-only): POST /swings → poster
  PUT (fire-and-forget, `clipThumbnailsAt([0.05,0.5,1.5])`) → video PUT (3 attempts, backoff,
  retryable-status set) → POST source/complete → poll reanalyze GET (1.2 s ×1.35 → 5 s, 12 min
  give-up). Phases uploading|queued|running|done|failed; `STAGE_HINTS` substring-maps analyzer
  stage strings monotonically; progressPct verbatim from job, never derived.
- Metadata sent: view, handedness, contentType, sessionId, analyze. **NOT sent: fps, capture
  rate, slowMoFactor, trim offsets, duration, dimensions, byte size, impact mark, record-vs-
  import flag (deliberate: "a swing is a swing"), device info.** Everything re-derived
  server-side from the bytes.

### Pre-upload gaps vs plan (the live bugs)
1. **Imports run the wrong detector** — `detectImpacts(path, 3, undefined, true)` → Kotlin
   null → `Method.parse(null)` → **ATTACK** fallback, not SWISH. Comment claims same detector.
   One-line fix.
2. **Slow-mo imports get a lying frame clock** — `fps = captureFps` (240) stamped on a 30 fps-
   clock container; corrupts SwingReview seeks, SavedImport.fps, LocalClipPlayer loop math.
   Native doc comment warns against exactly this.
3. Trimmed-clip `durationMs` is arithmetic (endSec−startSec), not container truth (PREVIOUS_SYNC
   makes the file longer). Only LocalClipPlayer re-reads truth.
4. Poster sample times are FILE seconds — wrong window on slow-mo imports.
5. **Untrimmed take deleted before upload acceptance** (inline TODO names step 06 as owner).
6. No source/trim manifest, no post-remux preflight, no window sanity check, no visual
   fallback (plan §01 items 3–6) — none exist.
7. Pipeline state RAM-only: app kill mid-upload → orphan server row; `PendingSwingScreen.retry`
   hardcodes `analyze:true, fps:0`, can detach swing from session.
8. Tunables hardcoded that plan/spec name remote-config: CANDIDATE_FLOOR, REVIEW_WINDOW_S,
   PRE_ROLL_SEC, SAVE_PAD_S, all 9 detector thresholds, scrub-warp constants.
9. Entire pre-upload path Android-only (module declares platforms:["android"]; no ios/ dir).
10. Dual-sync is a 13-line stub; `FpsControl.tsx` name vestigial; `standIn` `__DEV__` stub
    plays another swing's footage in PostSwingView.

---

## 4. Server ingest / jobs / worker / artifacts (COMPLETE)

### Ingest (two-phase, deployed)
- Phase 1 `POST /api/v1/swings` → `createCapture` (`lib/ingest.ts`): INSERT swings + swing_views
  (mediaKey = view id, D33), rawMediaKey NULL, returns signed upload targets. Phase 2
  `source/complete` → `completeCapture`: owner-only, key re-derived (`rawKeyFor`), 
  `store.exists()` verified, raw_expires_at = +30 d, then `startCaptureAnalysis` unless
  `analyze:false`. Errors are golfer-readable 400s.
- **R2 layout — separation by BUCKET, not prefix** (`lib/media/keys.ts`, pure):
  `swing-source`: `u/<uid>/s/<sid>/v/<vid>/source/original.mp4|.mov|poster.jpg` (outside
  revision prefix — re-analysis reuses source). `swing-artifacts`:
  `u/<uid>/s/<sid>/v/<vid>/r<n>/<name>` for analysis.json, coach_report.json,
  source_timing.json, silhouette.json, isolation.json, club_only.json, normalized.mp4,
  analysis.mp4, overlay.mp4, framestamp.mp4, contact.jpg + `stills/f<frame>.jpg`.
  `swing-models`: `<asset>/<sha256>.<ext>`. `segment()` regex-validates every id.
- Drivers: `MEDIA_DRIVER` local|supabase|r2, opt-in never inferred; r2Store canRedirect,
  presigned PUT 2 h, playback URL 6 h; localStore signals via nulls.

### Jobs & dispatch
- `JOBS_DRIVER` spawn (local dev; stdout-regex progress scraping, `STAGES` 11 tuples) | queue.
- `publishJob`: job token HMAC-SHA256 {jobId, viewId, actorId, targetRevision, exp 6 h} →
  INSERT jobs(queued) BEFORE dispatch → QStash publishJSON (retries 3, flowControl
  `user-<actorId>` parallelism JOBS_FLOW_PARALLELISM=1, failureCallback). Spec schema 2:
  four URLs + token + {view, handedness, club_detector, club_variants}.
- Internal surface (4 routes, all `requireJobAccess`, RLS as actor, no elevation): 
  `GET source` (307→signed), `PUT artifacts/[name]` (key computed server-side from
  targetRevision; 1 GiB cap; 409 terminal), `POST events` (progress/done/failed; done verified
  via isPublished before flip), `POST failure` (QStash DLQ callback; token recovered from
  sourceBody). Route-auth test enforces the surface.

### Modal worker (deployed, proven)
- `service/modal_app.py` app `swingsage-analyzer`: ingress (CPU, 120 s, QStash sig verify,
  spawn-and-ack) / `Runner.run_job` (**L4**, 8 vCPU, 16 GB, timeout 1800 s, Modal retries 2,
  max_containers 4, scaledown_window 300 s, SWINGSAGE_POSE_DEVICE=cuda) / fetch_models /
  bench (refuses if CUDA fell back to CPU). Models from hash-verified Volume symlinked to real
  loader paths. Secret carries only QStash keys + WORKER_PUBLIC_URL + club-weights URL —
  **worker holds zero DB/storage credentials**.
- `jobrun.py`: download with `_DropAuthAcrossHosts` (auth stripped on cross-host 307 — R2
  rejected the stray bearer, 2026-08-23); `TransferError` taxonomy retryable vs terminal with
  user_message; `PipelineError` = answer, never retried; artifact PUT 600 s with retries,
  analysis.json load-bearing; `_EventForwarder` throttled 2 s, terminal posts retried; scratch
  kept on failure.
- Four retry layers, stratified: in-worker transfer (3×), QStash (3×, acceptance-only on
  Modal), Modal (2×, infra death), orphan sweep (poll-driven).

### Job lifecycle
- `jobs` table: id, view_id, type, status queued|running|done|failed, stage, progress_pct,
  message, log jsonb (ring 200), runner spawn|queue, target_revision, last_event_at.
  Mirrored `swing_views.status` uploaded→queued→analyzing→ready|failed.
- Orphan settlement **only on poll** (`getJob → reconcile`): spawn via `.analysis.lock` +
  artifact mtime; queue via `queueOrphanVerdict` (heartbeat 900 s / pending 3600 s). Writes
  best-effort (`.catch(()=>{})` ×6 — genuine DB failures invisible).
- `markViewReady`: read-back through store, updates fps/frame_count/dims/artifact_revision,
  syncs scores. `markViewFailed` emits the one `analysis_failed` notification.

### Debt (server)
1. **Two disagreeing stage vocabularies**: `jobs.ts STAGES` (11, regex) vs `jobrun.py
   STAGE_PCT` (16, names). Pipeline print() format frozen by the spawn scraper (worker.py
   docstring admits it).
2. Two worker HTTP doors (`server.py` stdlib sync vs Modal ASGI) — documented divergence.
3. `swing_views.analysis_version` dead column (never read/written). `jobs.error` vs `message`
   inconsistently populated. Status default 'uploaded' on rows with no upload (no 'pending').
4. Drizzle meta/ snapshots stop at 0002 while journal runs to 0021 — `drizzle-kit generate`
   will misbehave.
5. **Artifact uploads stream through a Vercel function** (`req.arrayBuffer()`, 1 GiB cap) —
   ~30 MB normalized.mp4 buffered in memory per upload; the single largest scaling liability.
   Signed direct-to-R2 upload is a named "deploy-step optimization".
6. **isolation.json / club_only.json / framestamp.mp4 unreachable on the queue path** —
   pipeline.run never produces them (CLI scripts only), yet routes serve them → permanent 404
   on queue-analysed swings.
7. Orphan sweep poll-driven only — an unwatched job spins forever.
8. **JOBS_CLUB_VARIANTS defaults true** (676.6 s vs 124.6 s) — production pays 5.4× unless env
   overrides; "awaiting Taylor" in policy.ts.
9. **Capture path has NO admission control**: `startCaptureAnalysis` checks driver before the
   already-running guard → no per-view single-flight on queue path; JOBS_MAX_ACTIVE_PER_USER
   only enforced on reanalyze. Double source/complete → two QStash messages for one view.
10. **No workload guard before GPU** (the 2,445-frame incident path is open: nothing refuses an
    oversized clip; a deterministic timeout is retried by Modal as if transient). No stage
    checkpoints — every retry restarts from zero.
11. Observability: zero structured logging/metrics/tracing in the job path; `jobs.log` jsonb
    (200 lines) is the only sink; the one metric is `pipeline elapsed`; DLQ id written to job
    log only, no alerting. p95 latency is unanswerable without string-scanning logs.
12. `r2Store.movePrefix` page-delete semantics risky mid-failure; artifact PUT content-type
    unvalidated (route overrides).

Proven-deployed vs code-only: Modal + R2 + QStash prod + Vercel all deployed and proven
(queue:e2e, capture:e2e); `server.py` + Dockerfile local/dev shapes; supabase media driver
superseded (models:publish only); spawn driver local-only by construction.

---

## 5. Playback / frame identity / corrections (COMPLETE)

### Two players, zero shared runtime
- **Web** (`usePlayer.ts` 407, `SwingStage.tsx` 1126): seek `(f+0.5)/fps`, `presentedFrame =
  round(mediaTime*fps)` (deliberately different from timeToFrame), rVFC re-registering,
  `present()` waits for `expectedDisplayTime` (compositor-early fix, exact at 0.25×),
  pendingSeek coalescing, ONE canvas (draw order: silhouette→outline→trace→club→detector
  boxes→skeleton→rods→butt→angles — CURRENT-STATE §6's stated order is wrong), playbackPad
  freeze-hold applied in video-time.
- **Mobile** (`useFramePlayer.ts` 522 + `frame-clock` Kotlin): seek `frame/fps` ONLY in Kotlin
  (`SeekParameters.EXACT`; media3 resolves forward — D40; frames.ts refuses to compute
  targets), one-seek-in-flight coalescing + 1500 ms timeout, scrub path bypasses via
  `setScrubbingModeEnabled` fire-and-forget 33 ms, window loop done in JS without pausing,
  View-tree overlay (order: trace→club→orient→skeleton→angles — differs from web), memoized
  whole-clip passes, `markOverlayCommitted` for native drift scoring. Speeds 1/½/¼/⅛ native
  rate — a 240 fps take at ¼ shows every sensor frame.
- **Five byte-locked copy-pasted files** (traceSmoothing, playbackWindow, skeleton,
  clubVariants, model — ~1,300 lines) guarded by a tripwire test that fires only AFTER
  divergence. Two different comparison-alignment algorithms (web `swingSync.ts` hand-path
  arc-length vs mobile `align.ts` P1–P10 checkpoints + nudge-fingerprint reject + audio-
  disagree Impact drop) — same two swings align differently per client.
- `ReferencePane` follower (no clock, seek-on-mapped-change); `/sync-profile` lean payload
  (564–584 B measured) exists for comparison — **mobile only; web comparison still fetches the
  whole reference analysis.json (22 MB problem solved once, on one client)**.

### Frame identity facts
- `cfr_target_fps` snaps to {240,120,60} (5 fps tolerance); one CFR file is BOTH analysis
  input and playback asset; `analysis.video.fps` is the single fps source on web; mobile reads
  `swing_views.fps` row for first paint then artifact — two sources for one number, agreeing
  only because one run writes both.
- `frames.fpsDisagrees()` (container-vs-declared guard) exists and is **unwired** — the only
  detector for "every frame index wrong while components look right".
- **playback_pad applied on web only** — mobile exports it and ignores it, so short clips
  don't hold the equalized lead-in/run-out that side-by-side depends on.
- **The mobile frame-sync instrument is built and unrendered**: seekSweep/exactness/
  overlayDriftFrames all live in code with zero callers; §11b's "shipped this time" is false
  in this tree. No hot-path perf claim currently possible (rules file says so).
- No 240 fps clip confirmed end-to-end (HANDOFF row OPEN); all stored fixtures 60 fps.

### Corrections
- `head_markers` (view_id, frame, x, y — unique per view+frame) and `swing_stages` (view_id,
  stage, frame — unique per view+stage), normalized coords, batch PUT (web), merged at render
  time on both clients (mobile read-only; no mobile write UI). The project's only hand-labelled
  club-head truth.
- **Corrections carry no fps/revision provenance.** Re-analysis under a different
  cfr_target_fps (60→240) silently relocates every marker/stage frame (0.6 s → 2.4 s class
  error). Nothing detects or migrates. Directly collides with the plan's source-frame-identity
  requirement — fixing frame identity WITHOUT migrating corrections corrupts the only hand
  truth we have.
- Artifact caching: mobile module-level caches (analysis 6-slot FIFO, sync-profile unbounded,
   30 s fetch timeout); web none (`no-store` everywhere except silhouette/isolation/club-only/
  frame at 86400). The 13.7 MB/2781 ms lean-payload problem for the PRIMARY artifact is
  untouched.
- `?src=upload` cache-key trick on /video is load-bearing and near-undocumented; poster route
  new in-tree (fixes the contact-sheet-as-thumbnail defect).
- Web SwingWorkspace "New Swing"/"Delete swing" modals are stubs claiming no DB/upload exist —
  both false now.

---

## 6. Analyzer pipeline internals (COMPLETE)

Full report: **`AUDIT-analyzer.md`** (same directory). The decision-shaping facts:

- **18 video-decode passes per job with variants on (7 off); zero frame sharing between
  stages.** `club.track` runs 12× (each a full decode + 2 MOG2 passes + full-clip Sobel
  gradients, ~10 MB/frame resident) — a 1,200-frame 240 fps clip ≈ 12 GB vs the worker's
  16 GB: latent OOM, unguarded.
- **27 club variants stored per artifact** (11 full re-solves + `model_viterbi` + 15
  trace-only), not the doc's 13. `clubpath.viterbi_refine` is already a sequence-level DP over
  detector candidates — the seed of the plan's solver.
- **Per-keypoint provenance already exists** (`pose.frames[].st`: MISSING/PROVISIONAL/OK/
  INTERP) **but the chain is severed**: interpolated points get hardcoded conf 0.45 >
  metrics.MIN_CONF 0.35 and neither metrics nor scoring reads `st` → interpolated geometry is
  scored as measured today. Plan D4 is a bug fix, not just a feature.
- **`source_timing.json` already builds the source↔normalized PTS map** (pure, invariant-
  complete) — and has zero consumers, is outside the contract, and is skipped on retimed
  clips. The plan's frame manifest should be an upgrade of this module, not a second system.
- **Slow-mo retiming exists server-side** (`probe_capture_fps` + `retime_factor` + -itsscale,
  audio rescaled) — it just never fires on trimmed imports because the client remux drops the
  tag. `cfr_target_fps` snaps {240,120,60}; 30 fps sources are upsampled to 60 (duplicated
  frames — violates the plan's no-duplication rule).
- **The green-box/red-gate head-in-shaft-box rule does not exist in code** (no red_gate.py,
  no gating logic; sticks only feed the profile additively). The 2026-08-26 brief §7 and the
  auto-memory entry are aspirational. Step 09 resolves.
- Audio impact module (server twin of the Kotlin SWISH) exists with the project's only ground
  truth (5/5 within 250 ms); fusion today is an agree-flag only, audio never moves Impact.
- stdout is a load-bearing protocol (spawn driver regex-parses prints); JOBS_CLUB_VARIANTS
  defaults TRUE (676.6 s vs 124.6 s — live production cost bug); render (overlay.mp4 +
  contact.jpg) sits inside the critical path; per-stage timing printed, never stored.
- 162 test functions; frozen inputs (2 clips, 2026-08-06) and goldens (2026-08-08) predate
  retime/audio/cfr changes; golden checkpoint tests exercise the club-free fallback path only;
  `compare_analysis.py` is the ready-made migration parity instrument.

---

## 7. Plan requirements ALREADY satisfied by the codebase (KEEP list, so far)

| Plan item | Where it already exists |
|---|---|
| D1 user mark never reaches server | Mark discarded on device; nothing uploaded. Stronger than plan (plan's manifest sends candidates as non-authoritative metadata; today nothing at all). |
| Audio-first pre-upload fast path | SWISH detector + candidate selection + warped scrubber, sub-second, shipped |
| Lossless remux, keyframe-safe start | SwingClip.trim, SEEK_TO_PREVIOUS_SYNC |
| Real-seconds slow-mo math on device | reviewWindowAround/scrubWarp/swingStages all ×slowMo |
| Signed direct-to-R2 upload, verified complete | createCapture/completeCapture, store.exists() |
| Immutable revision-addressed artifacts | r<n> keys, publish-then-flip, never overwrite |
| Idempotent worker surface | alreadyTerminal short-circuit, 409 on terminal, pinned targetRevision |
| Retryable-vs-terminal failure taxonomy (transfer layer) | jobrun.py TransferError; PipelineError never retried |
| Delivery retry ≠ stage retry separation | QStash acceptance-only on Modal; Modal infra retries; documented strata |
| Progress = real milestones, no fake %s | processing.ts verbatim progressPct, monotonic stage mapping |
| Corrections outside immutable artifacts, merge at render | head_markers/swing_stages + both clients |
| Dashed honest gaps, no invented curves | trace chord rendering, trace_enabled honored client-side |
| Confidence truncation, MIN_CONF shared | packages/schema contract.ts, both clients |
| 49-keypoint append-only contract + shape lock | packages/schema + shape-lock.json |
| Scale-to-zero + warm window | Modal scaledown_window=300, max_containers=4 |
| Audio witness with hand truth | audio_impact.py + audio_truth.json + checkaudio.py |
| Job state in Postgres, client polling | jobs table + reanalyze GET |

## 8. Confirmed divergences the track must resolve (feeds MATRIX + conflict analysis)

1. No source/trim manifest anywhere (plan WP-001..003) — AND the slow-mo remux tag loss makes
   this the highest-priority correctness item. The phone already probes captureFps on import;
   ingest just never asks.
2. No workload guard / no checkpoints / deterministic timeouts retried (WP-007, 011, 012).
3. Every-frame pose+club at capture rate = the 240 fps cost problem (WP-014..017; the plan's
   central decoupling). Today frame identity == normalized CFR index everywhere (clients,
   corrections, artifacts) — any frame-identity change ripples into corrections (no
   provenance) and both players.
4. Provenance vocabulary today is only `interp: true` — no model/tracked/propagated/derived
   split, no direct_only scoring gates (WP-016/017/033).
5. Impact is club-low-point + audio agree-flag — no fusion, no evidence breakdown, one known
   40-frame miss (WP-030..032).
6. Club is head-detector+classical-shaft+13-variant solve — no 5-pt club pose, no candidate
   retention, no sequence solver, no positional ground truth (WP-020..027). Green-box gate rule
   (head counts only inside same-frame shaft box) is a memory-recorded standing rule.
7. Render (overlay.mp4, contact.jpg) sits in the analysis critical path (WP-036 / plan D8).
8. Variants default-on in production dispatch (cost bug, "awaiting Taylor" — also an open
   HANDOFF row on the club-trace winner verdict that would let variants die entirely).
9. Observability far below plan §10 (WP-013, 044).
10. Progressive revisions don't exist (single terminal artifact) (WP-034/035).
11. Ground truth: only audio strike truth (5 clips) + hand-placed head_markers exist; no event
    frames, no club positions, no golden-set CI (WP-020/021/042; overlaps planned track
    `analysis-ground-truth`).
12. Existing planned tracks overlap: `analysis-ground-truth` (GT), `media-pipeline` (upload
    durability), `swing-ingest` (product flow) — the track files must divide ownership
    explicitly, not duplicate.
