# 02 — System Architecture

## Stack Decision

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Next.js 14+ (App Router) + TypeScript + Tailwind** | Fast to build, great video/canvas support, single deploy target |
| Player overlays | **HTML5 `<video>` + layered `<canvas>` (2D)** | Full control of frame-synced drawing; no heavy libs needed |
| Charts | Recharts | Simple trend lines |
| Backend API | Next.js API routes (v1) | Keep one app while single-user |
| **CV Analyzer service** | **Python 3.11 + FastAPI worker** | MediaPipe, OpenCV, NumPy, (optional) ONNX/YOLO all live in Python. This is non-negotiable — do not attempt the CV pipeline in Node/browser for v1 |
| Video processing | **ffmpeg** (invoked by analyzer) | Normalization, frame extraction, thumbnails |
| Job queue | v1: simple DB-backed queue polled by the analyzer; v2: Redis + RQ/Celery | Avoid infra until needed |
| Database | v1: **SQLite** (via Prisma/Drizzle); v2: Postgres | Local-first development |
| File storage | v1: local disk `data/media/{swingId}/...`; v2: S3-compatible | |
| AI | Provider abstraction → **Claude Code CLI locally**, Anthropic API in prod | See doc 07 |

The web app and the Python analyzer communicate over HTTP on localhost in dev
(`web → POST analyzer:/jobs`, analyzer → `PATCH web:/api/jobs/:id` progress callbacks, or
simply shared DB rows + polling — pick the shared-DB approach for v1, it's simpler).

## Processing Pipeline (per swing)

```
upload.mp4
  └─ Stage 0  normalize:   ffmpeg → canonical 1080p(max) 60fps H.264 mp4; probe true fps,
              rotation, duration; extract poster thumbnail
  └─ Stage 1  frames:      ffmpeg → PNG/JPEG frame dump (or decode in-memory with OpenCV;
              in-memory preferred, dump only keyframes to disk for AI/vision use)
  └─ Stage 2  pose:        MediaPipe/RTMPose per frame → raw keypoints  (doc 03)
  └─ Stage 3  pose-post:   filtering, smoothing, interpolation, derived joints (doc 03)
  └─ Stage 4  club:        shaft + head detection per frame, trajectory fit  (doc 04)
  └─ Stage 5  events:      8 swing events + phase spans  (doc 05)
  └─ Stage 6  metrics:     angles, positions, tempo, per-event snapshots  (doc 05)
  └─ Stage 7  ai-review:   (optional, low-confidence spans only) Claude checks keyframe
              images vs. detected skeleton/club and returns corrections  (docs 03/07)
  └─ Stage 8  coach:       scoring engine + Claude narrative  (doc 05)
  └─ writes   analysis.json (+ coach_report.json) to swing folder; marks swing ready
```

Each stage writes `progress` (stage name, pct, message) to the job row. Stages 2–4 are the
slow ones; report per-frame progress (e.g., "pose 412/540 frames").

Target performance (M-series laptop, 8s clip @60fps ≈ 480 frames): Stage 2 ≤ 30s with
MediaPipe, Stage 4 ≤ 20s. Total under ~2 minutes including AI calls. If slower, downscale
analysis frames to 720p (analyze small, render overlays scaled back up — keypoints are
normalized coordinates so this is free).

## Data Model (v1 tables)

```
users(id, handedness, height_cm, created_at)
sessions(id, user_id, date, location, notes)
swings(id, user_id, session_id?, created_at, view enum[dtl,face_on], club, notes,
       video_original_path, video_normalized_path, fps, frame_count, width, height,
       status enum[uploaded,queued,analyzing,ready,failed], failure_reason?,
       analysis_path, coach_report_path, overall_score?, scoring_model_version?)
jobs(id, swing_id, type, status, stage, progress_pct, message, started_at, finished_at, error)
simulator_stats(id, swing_id?, user_id, captured_at, source_image_path, device_guess,
       parsed jsonb, corrected jsonb, confidence jsonb)
impact_images(id, swing_id?, user_id, source_image_path, parsed jsonb, corrected jsonb,
       confidence jsonb)
```

`parsed`/`corrected` follow the schemas in doc 06. Trend queries read from
`corrected ?? parsed`.

## The `analysis.json` Contract (frontend ⇄ analyzer)

This is the single most important artifact. Version it (`schema_version`). Keep it
renderable without any computation on the client beyond coordinate scaling.

```jsonc
{
  "schema_version": 1,
  "video": { "fps": 60, "frame_count": 540, "width": 1920, "height": 1080,
             "view": "dtl", "handedness": "right" },
  "pose": {
    "model": "mediapipe-heavy-0.10", 
    "keypoint_names": ["nose","left_eye", "...", "left_ankle","right_ankle",
                        "neck","mid_hip","spine_mid","left_foot_tip","right_foot_tip"],
    "frames": [
      { "f": 0,
        "kp": [[0.512,0.233,0.98], [0.505,0.221,0.97], "... [x_norm, y_norm, conf] ..."],
        "interp": false }
    ]
  },
  "club": {
    "frames": [
      { "f": 0, "shaft": [[0.51,0.55],[0.47,0.83]], "head": [0.468,0.835],
        "head_conf": 0.91, "shaft_angle_deg": 61.2, "blurred": false, "interp": false }
    ],
    "trace": {
      "backswing": [[0.468,0.835], "..."],
      "downswing": [["..."]],
      "followthrough": [["..."]]
    },
    "face_angle": { "per_frame_available": false, "notes": "see doc 04 §Face Angle" }
  },
  "events": {
    "address": {"frame": 38, "conf": 0.95},
    "toe_up": {"frame": 74, "conf": 0.9},
    "mid_backswing": {"frame": 96, "conf": 0.88},
    "top": {"frame": 121, "conf": 0.97},
    "mid_downswing": {"frame": 133, "conf": 0.9},
    "impact": {"frame": 142, "conf": 0.96},
    "mid_follow_through": {"frame": 151, "conf": 0.9},
    "finish": {"frame": 190, "conf": 0.93}
  },
  "metrics": { "...per doc 05: time-series + per-event snapshots..." },
  "quality": { "overall_pose_conf": 0.91, "club_track_coverage": 0.83,
               "warnings": ["club head low confidence frames 138-145 (motion blur)"] }
}
```

Notes:
- All coordinates are **normalized 0–1** relative to the video frame (x right, y down) so
  the client scales to any canvas size.
- Keypoint array order is fixed by `keypoint_names`; derived joints (neck, mid_hip,
  spine_mid) are appended after the model's native points.
- `interp: true` marks frames whose values were interpolated/smoothed-in rather than
  directly detected — the UI renders these dashed.

## Frame Sync (critical implementation detail)

Frame-accurate scrub + overlay lock:
- Normalize to constant frame rate in Stage 0 (`ffmpeg -vsync cfr -r 60`) so
  `frame = round(video.currentTime * fps)` is exact. VFR phone video WILL break sync if you
  skip this.
- Stepping: set `video.currentTime = (frame + 0.5) / fps` (half-frame offset avoids
  boundary rounding), then draw overlay for `frame` on `seeked` event.
- During playback: use `requestVideoFrameCallback` (Chrome/Safari) to get the presented
  frame's mediaTime and draw the matching overlay; fall back to rAF + currentTime elsewhere.
- Canvas stack: `video` → `canvas#skeleton` → `canvas#club` → `canvas#trace` →
  `canvas#annotations`. Trace canvas only redraws when frame/toggle changes (it draws the
  path up to the current frame so the trace "grows" during playback — full path when paused
  with trace on, or make grow-vs-full a setting).
- Preload `analysis.json` fully; store per-frame data in typed arrays for O(1) lookup.

## API Surface (v1)

```
POST /api/swings                      (multipart video + metadata) → swing, job
GET  /api/swings?filters...           list for log
GET  /api/swings/:id                  detail (incl. analysis + report URLs)
GET  /api/swings/:id/analysis.json    static file
POST /api/swings/:id/reanalyze
GET  /api/jobs/:id                    poll progress
POST /api/simulator-stats             (image) → parse job → parsed record
PATCH /api/simulator-stats/:id        user corrections
POST /api/impact-images               same flow
GET  /api/trends?metric=&club=&from=&to=
```

## Error Handling & Quality Gates

- If pose confidence is catastrophically low (e.g., person not found in >30% of swing-window
  frames): fail with a user-readable reason ("Couldn't track the golfer — make sure the full
  body is visible and well lit") + tips per view.
- If club tracking coverage < 50% of backswing+downswing frames: still succeed, but disable
  the trace toggle with an explanatory tooltip, and exclude club-dependent scores (report
  says "not scored — club not trackable in this video").
- Every AI call (doc 07) validates returned JSON against schema; on failure retry once with
  the validation error in the prompt, then fall back to non-AI defaults. AI is enhancement,
  never a hard dependency for `ready` status (except simulator image parsing, which is
  inherently AI — that flow can fail visibly with "couldn't read this image").
