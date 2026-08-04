# SwingSage — Status & Handoff

**Last updated:** 2026-08-04

Read this first, then [CLAUDE.md](../CLAUDE.md) for commands and architecture, then
[DECISIONS.md](DECISIONS.md) for *why* things are the way they are (20 entries, several of
them negative results that will save you repeating the work).

---

## 1. Where we are

A working end-to-end pipeline: **upload a clip → normalized video + `analysis.json` → browser
player with skeleton, events, club overlay and metrics.** Two real fixture swings analysed.

| Stage | State |
|---|---|
| 0 — normalize (ffmpeg, VFR→CFR, rotation) | **Done**, robust |
| 2 — pose (MediaPipe localiser → RTMW wholebody 133) | **Done**, excellent |
| 3 — post-processing (gating, priors, smoothing) | **Done** |
| 5 — swing events (8 GolfDB events) | **Done**, verified ±2 frames |
| 6 — metrics (doc 05 Part B) | **Done**, provisional thresholds |
| 4 — club tracking | **Weak** — see §3 |
| 4b — club face | Partial, honest about limits |
| Web app (Next.js) | Player done; **no upload, no DB, no queue** |
| 8 — coach scoring | Not started |
| 6 — simulator ingestion | Not started |
| 7 — AI provider | Not started |

### Measured quality (both fixtures)

| | swing1 (oblique, adult) | swing2 (DTL, junior) |
|---|---|---|
| Pose, all key joints | 94–100% | 98–100% |
| `grip_center` | 100% @ 1.00 conf | 100% @ 1.00 conf |
| Events vs hand-labelled | Top ±2, Impact ±1 | plausible |
| Tempo | 3.38:1 | 1.93:1 |
| Club head path accel p95 (back / down) | 30.8 / 54.2 px | 16.9 / 65.4 px |

---

## 2. What is genuinely good

- **Pose is solved.** RTMW wholebody 133 gives every joint at 94–100%, including the
  far-side limbs MediaPipe lost entirely (left_elbow 10% → 99%). Hands come from real
  knuckles, so `grip_center` is a measured point rather than an inferred one.
- **Events are reliable** and validated against hand reading. Tempo falls out correctly.
- **The web player works** — frame-accurate scrubbing, phase bar with click-to-loop, overlay
  stack, live frame-sync drift meter.
- **The verification harness is the most valuable asset here.** `checkclub.py`, `sweep.py`,
  `dense.py`, `clubdebug.py`. Coverage percentages have overstated club quality **three
  separate times**; only rendering the overlay onto real frames caught it.

---

## 3. The open problem: club head tracking

Four hand-designed approaches were built and measured. **All failed.**

| # | Approach | Result |
|---|---|---|
| 1 | Dense optical flow (head = fastest pixel) | Good address→mid-backswing; fails at Top (club slower than body) and at impact (displacement exceeds flow's search radius) |
| 2 | Track-before-detect over a parametric path | Failed badly — 4-D random search never found the optimum |
| 3 | Morphological lineness (thin bright bar) | Failed — shirt hems, collar and fence rails are also thin bright bars |
| 4 | LSD segments from the hands + monotonic height | **Best classical result** — 8 consecutive frames correct through the early backswing, then candidates dry up (28/111 frames) |

**Root cause, and the lesson:** each method assumes the club is the *most extreme* thing in
some hand-designed measure. In real footage it usually isn't — the body is faster at the top,
the fence is more line-like, the foliage more textured. See DECISIONS D17–D20.

**Second lesson:** we tuned against head-path *smoothness* for several rounds. It cannot
distinguish "smooth and correct" from "smooth and wrong", and a direct AI-vs-CV comparison
showed the tracker was more accurate than the metric implied (D20a). **Build the real metric
before tuning further** — doc 04 §7 specifies it: hand-label the club head every 5th frame on
5 clips, measure position error in pixels.

---

## 4. In flight: learned club detector

This is the live thread. Pick it up here.

**Dataset:** `golf-swing-vnwlh/golf-swing-msiuj` v9 (Roboflow, CC BY 4.0) — 4,399 train
images, classes `clubhead` + `stick`, instance segmentation. Verified genuine: median
clubhead extent **0.013 × 0.024** of the image.

> Do **not** use `club-head-tracking/golf-club-tracking` — despite the name it contains
> three overlapping full-body golfer boxes per image (median 0.42 × 0.59). Already checked.

**Training:** `services/analyzer/scripts/train_club.py`, `yolo11s` @ 640px, 40 epochs.

**Blocker: compute.** ~38 min/epoch on CPU ⇒ ~25 hours. Options:
1. **GPU** — same run is ~20 minutes. Strongly preferred; check for CUDA on the new machine.
2. `yolo11n` @ 640, 20 epochs on CPU ≈ 3–4 hours (overnight). Keep 640px — the club head is
   a small object and dropping resolution hurts exactly what we are detecting.
3. 15 epochs on a ~1,500-image subset ≈ 2 hours, enough to tell whether the approach works.

**Not yet written:** the inference script that runs the trained weights over a clip and emits
head positions into `analysis.json`. That is the next piece of code.

**Roboflow API key** is deliberately not committed. Supply it as `ROBOFLOW_API_KEY` from the
account that owns it; datasets re-download in minutes.

---

## 5. Next steps, in order

1. **Finish the club detector.** Train (GPU if at all possible), write inference, wire into
   `club.py` behind a flag so the classical path remains as fallback (doc 04 §2: never
   detector-only). Record the club model version in `analysis.json` alongside `pose.model`.
2. **Build the ground-truth metric** (doc 04 §7). Without it, every further change is
   unfalsifiable. This is arguably step 0.
3. **More fixtures.** Everything is tuned on two clips; doc 03 §7 wants ≥15. The phase-based
   detector split especially may be overfit. A face-on and a left-handed clip would test the
   handedness mirroring that has never been exercised.
4. **Phase 1 properly** — upload flow, job rows, SQLite, staged progress. Currently
   `burnin.py` is run by hand and the web app reads whatever it finds on disk.
5. **Then Phase 5 coach scoring**, which needs `scoring_config.json` with versioned bands
   (doc 05 C1). Metrics exist but thresholds are provisional and flagged as such.

---

## 6. Setting up a new machine

```bash
# system
winget install Gyan.FFmpeg          # or apt/brew equivalent
# node 22+, pnpm 11+

# analyzer
cd services/analyzer
python -m venv .venv                # Python 3.11-3.14 all fine
.venv/Scripts/python -m pip install mediapipe opencv-python numpy scipy \
    rtmlib onnxruntime ultralytics roboflow

# pose model (30MB, gitignored)
curl -o models/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
# RTMW wholebody weights download themselves on first run, into ~/.cache/rtmlib

# web
cd apps/web && pnpm install && pnpm dev
```

Then `python scripts/burnin.py <video>` to regenerate `out/` — it is gitignored, so the new
machine needs one run per fixture before the web app shows anything.

**Fixture clips live in `instructions/swing/` and ARE committed** — they are the ground truth
for everything above.

---

## 7. Known debt

- `analysis.json` (300–700 KB) is passed to the client as React props. Doc 02's Frame Sync
  section wants a client-side fetch into typed arrays instead.
- `services/analyzer/web/player.html` + `scripts/serve.py` are the superseded stopgap player;
  the Next.js app replaced them. Safe to delete once you are confident.
- No tests at all. Doc 03 §7 wants golden snapshots on 3 fixtures.
- No club-model versioning in `analysis.json`.
- Metric thresholds are provisional (`provisional_thresholds: true`) and must move to a
  versioned `scoring_config.json` before any scoring ships.
- Two dev-environment gotchas, both already handled but worth knowing: `next.config.ts`
  enumerates LAN IPs into `allowedDevOrigins` (without it a phone gets HTML that never
  hydrates), and on Windows use `127.0.0.1` rather than `localhost` (which resolves to `::1`).
