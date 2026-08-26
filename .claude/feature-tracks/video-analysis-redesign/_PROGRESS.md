# video-analysis-redesign — Progress Log

Append-only.

## 2026-08-26 — Track created; step 00 (Audit & Reconciliation) COMPLETE

- Read the full planning package `.claude/swingsage_video_analysis_plan_v2/` (15 docs +
  reference brief).
- Ran four parallel code audits (mobile pre-upload; server ingest/jobs/worker/artifacts;
  playback/frame-identity/corrections; analyzer internals) against the working tree on
  branch `swing-detection-and-player-rebuild`.
- Persisted: `AUDIT-current-state.md`, `AUDIT-analyzer.md`, `MATRIX-current-vs-target.md`
  (50-row matrix, conflicts C1–C12 with resolutions, migration architecture, removal table).
- Authored steps 00–14. Ordering: safety quick wins (01) → manifest (02) → frame identity +
  corrections provenance (03) → ground truth & evaluation (04) → telemetry (05) → shared
  decode refactor (06) → coarse pass + planner (07) → provenance/direct-only scoring (08) →
  club v2 (09) → events/impact fusion v2 (10) → progressive + deferred render (11) → runtime
  optimization (12) → reliability (13) → legacy removal & docs trueing (14).
- Headline audit findings that reshaped the plan:
  - Much of the plan's pre-upload and infra architecture already exists and is deployed
    (audio-first seed, lossless remux, user-mark isolation, two-phase R2 ingest, Modal L4
    worker, revision-immutable artifacts, retry taxonomy) — marked KEEP, not rebuilt.
  - Live bugs the plan didn't know about, front-loaded into steps 01–03: interpolated
    keypoints scored as measured (conf 0.45 > MIN_CONF 0.35, `st` never read downstream);
    imports run the ATTACK audio detector via a null fallback; slow-mo imports get a lying
    fps; JOBS_CLUB_VARIANTS defaults true in production (676.6 s vs 124.6 s); capture path
    has no admission control; corrections have no fps/revision provenance.
  - `source_timing.json` already builds the plan's frame manifest and has zero consumers —
    step 03 upgrades it rather than adding a second system.
  - `clubpath.viterbi_refine` is already a candidate-sequence DP — step 09 extends it.
  - The green-box head/shaft gate documented in the brief and auto-memory DOES NOT EXIST in
    code — step 09 resolves (implement as solver evidence or retire).
  - 27 club variants (not 13), 18 decode passes/job, ~12 GB residency on a 1,200-frame clip
    vs 16 GB worker — step 06 is the enabling refactor.
- Plan recommendation explicitly REJECTED: manifest-driven client seeking (matrix #19) —
  both platforms measure 100%-exact with current rules.
- Track overlap resolved (C12): step 04 delivers `analysis-ground-truth`'s club/event GT
  scope (that track reconciles); `media-pipeline` keeps transfer durability; `swing-ingest`
  keeps ingest UX.
