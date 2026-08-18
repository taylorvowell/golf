# Swing analysis speed and timing — the measured latency budget, and every lever on it

**Date:** 2026-08-18 · **Mode:** measurement + latency design · **Status:** MEASURED and
recorded; the *decisions* it implies are NOT yet taken — see "Status of each lever" ·
**Spec:** PROJECT_MAIN §32 (analysis processing experience), §33 (failure handling), §38
(production readiness / SLOs), §2.4 · **Origin:** Taylor, 2026-08-18 — *"why does it take so
long to analyze the swing? I thought it would be under 30 sec"*.

This is the reference for **how long a swing takes, where the time actually goes, and what
each available lever is worth.** Come back here before optimising anything, and before
quoting an analysis time.

---

## 0. The headline

The pipeline takes **273.5s** on a real fixture. **72% of it is a development instrument**
that no golfer ever sees. Pose — the thing the worker-host GPU decision was resting on — is
**11%**.

The assumption that started this ("under 30 seconds") was never measured. The measured
number was 4.5–7 minutes, and the reason was not the reason everyone assumed.

---

## 1. Measured per-stage breakdown

**How it was taken:** `swingsage.pipeline.run()` on `fixtures/pro_2.mp4` with
`--club-detector runs/clubhead/weights/best.pt`, timestamping every `stage_started` event.
322 analysed frames, 1080×2146 source at 60fps. Pose on **CPU**; club detector on the
GTX 1080. Windows desktop, 2026-08-18.

| Stage | Seconds | % | What it does |
|---|---:|---:|---|
| **variants** | **197.5** | **72.2** | **Eight full club re-solves** for human comparison |
| club | 27.9 | 10.2 | Per-frame detections → a tracked club through the swing |
| pose_localiser | 16.6 | 6.1 | MediaPipe over every frame; also supplies RTMW's per-frame box |
| pose | 14.8 | 5.4 | RTMW 133-point whole-body, every frame |
| render | 5.2 | 1.9 | Burn the skeleton in, encode `overlay.mp4`, contact sheet |
| detector | 4.8 | 1.8 | Fine-tuned YOLO club head + shaft, every frame |
| normalize | 2.9 | 1.0 | **Two** ffmpeg re-encodes → CFR 60fps (playback + analysis copies) |
| contract | 2.2 | 0.8 | Validate and write `analysis.json` |
| face | 0.8 | 0.3 | Face-angle checkpoint classification |
| probe | 0.5 | 0.2 | Header read; VFR detection |
| stage3 | 0.2 | 0.1 | Side-swap repair, bone-length rejects, interpolation |
| metrics | 0.1 | 0.0 | Every angle, rotation, tempo number |
| events, checkpoints, scoring, silhouette | ~0.0 | 0.0 | — |
| **Total** | **273.5** | | |

**Reproduce it:** time the `stage_started` events off `pipeline.run()`. There is no stored
timing artifact — if this becomes a routine question, that is the thing to add (a
`stage_timings` block would belong in the job log, not in `analysis.json`, which is the CV
contract and not a performance record).

### The two numbers that matter

- **`variants` is a development instrument.** It performs eight full club re-solves so a
  human can compare club solutions on real pixels, because no ground-truth metric exists yet
  to pick a winner. `AnalysisRequest.club_variants`, default `True`. A production job setting
  it `False` goes **273s → ~76s**, on the current hardware, for free.
- **Pose is 31.4s of 273.5s (11%).** CUDA is 2.32× on pose (D53, measured on the same
  GTX 1080), so a GPU host saves ~18s. **The flag is worth eleven times the GPU.** Sequence
  the flag first.

---

## 2. The end-to-end user latency budget

Analysis is not the only wait. Measured/derived where noted; upload assumes ~25 Mbps up.

| Phase | Step | User waits? | Today | With every lever below |
|---|---|:---:|---|---|
| Record | Capture | | — | — |
| Upload | On-device trim + compress | ✔ | **not built** (`media-pipeline`) | ~3s |
| | Transfer | ✔ | 274–314 MB ≈ **95–100s** (real fixture sizes) | proxy ~5 MB ≈ **3s** |
| Queue | Wait for a worker | ✔ | 0s alone; single-flight, ~10.5 jobs/hr/worker | ~0s |
| Analyze | The 16 stages above | ✔ | **273s** | **~60s** |
| Playback | First frame | ✔ | `normalized.mp4` 5.5 MB ≈ 1–2s | 1–2s |
| | Scrub / overlays | | local, frame-exact | local |
| | **Record → watching** | ✔ | **~6.5 min** | **~1.5 min** |

**The upload is the same order of magnitude as the analysis**, and it is the half that is not
built. `fixtures/raw/` is 274–314 MB per clip; the normalized playback copy is 5.5 MB and the
analysis copy is 3.0 MB. Compressing before upload is a ~30× transfer win and is the largest
single item in the whole budget.

---

## 3. The levers

### 3.1 Take work off the critical path

| Lever | Worth | Why it is safe |
|---|---|---|
| `club_variants: false` for production jobs | **−197s** | Dev instrument; no golfer sees it. Run on demand when the comparison view is opened |
| Upload a small **analysis proxy first**, full-quality original in the background | −90s of user wait | Analysis never reads the 1080p copy — it runs on `analysis_short_side`. Playback needs the big one, and playback is later |
| `render` (`overlay.mp4`) → background job after "ready" | −5s | The mobile player draws overlays on canvas from `analysis.json`; the burn-in is for verification and sharing |
| Run `detector` **concurrently** with pose | −3 to −5s | Detection reads frames only. Club *tracking* needs pose + events; detection does not |
| Pose on CUDA | −18s | D53. Do it **after** the above, not instead of them |

**Never turn `club_variants` off for fixture runs.** Comparing club solutions on real pixels
is exactly what it exists for, and the standing trap is that club quality has been overstated
three separate times by trusting a number instead of looking at the frame.

### 3.2 Publish in waves instead of one lump

The single biggest *perceived* win, and it needs almost no new machinery.

| Wave | Lands at | What the golfer gets |
|---|---|---|
| **0** | **0s** | Their own clip, from local storage — the swing appears in the log immediately, marked "Analyzing", and is **watchable at full quality with no server round trip** |
| **1** | **~26s** | Skeleton over the swing; phase-labelled scrubber (Address/Top/Impact/Finish); body angles — hip turn, shoulder turn, spine angle, knee flex; body-based scores. Impact frame as a still |
| **2** | **~57s** | Club trace; club-dependent scores; coach narrative; overall score |
| bg | after | `overlay.mp4`, full-res original, variants |

**Why it is cheap:** `analysis.json` is already **revision-addressed** — the player holds `r3`
while `r4` is written — so publishing twice is the existing mechanism, not a new one. And a
club-less analysis is already a **supported, handled state**: the standing rule is "club
coverage low → still succeed, disable the trace, exclude club-dependent scores marked *not
scored*". **Wave 1 is that degraded state, published on purpose.** The player was already
hardened for absent blocks (platform-foundation step 07).

**The honesty rule, and it is not optional.** Only publish a value early if it will not
change. Club-dependent rows read **"measuring…"**, never a provisional number, and the overall
score appears only at wave 2. A number that moves teaches the golfer not to trust the numbers,
which costs more than the wait it saved — §2.4 and the confidence discipline both bind here.

### 3.3 Get the events (impact and the stages) out early

`events.detect()` reads **four joints**: `grip_center` (derived from the wrists),
`left_wrist`, `right_wrist`, `mid_hip`. Nothing else. All four exist in MediaPipe's 33-point
output, so **event detection does not need the RTMW pass at all**. Detection itself costs
<0.1s — the whole cost is getting pose in front of it.

On the fixture the swing is **89 frames of 322** (Address 88 → Top 125 → Impact 140 →
Finish 177, `swing_window` [119, 180]). The pipeline poses **3.6× more frames than the swing
occupies**.

| Path | Events available at | Status |
|---|---|---|
| Today — waits for the full RTMW pass | ~31s | Measured |
| Events off the **MediaPipe pass only** | ~17s | Inputs are code-certain; the output must be diffed against the current detector |
| **Coarse-to-fine**: MediaPipe every 4th frame to find the window (~4s), then dense inside it (~6s) | ~10s | Design |
| **Audio transient** for impact alone | ~5s | Hypothesis |

Add ~5s in front of each for upload-proxy + probe + normalize.

**Audio is worth investigating and is not yet a claim.** The pipeline already probes audio
(`has_audio`, sample rate, codec in the `source_timing` sidecar) and ignores it. A strike is a
sharp transient sampled at 44kHz against video's 60fps, so it is *more* precise than the frame
grid. Range noise, wind and the next bay over are the risk, so it would ship carrying a
confidence and defer to the pose-based detector on disagreement — the same shape as the
existing landmark-disagreement fallback in `events.py`.

**Impact is the most-looked-at frame in the product.** Landing it at ~10s turns the wait from
a progress bar into the product.

---

## 4. Validation gate — binding on every item in §3.3

**No accuracy number in this project is independently verifiable yet.** There are no
hand-labelled event frames. Event accuracy was once claimed "verified ±2 frames" while Address
was 48 frames early, and the current detector's own `top` confidence on this very fixture is
**0.43**.

So any faster event path must be **diffed frame-by-frame against the current detector across
all ten fixtures** before it is allowed to be the one users see, and a disagreement is a
finding to investigate rather than a tolerance to widen. A faster wrong answer is worse than a
slower one, because it arrives with more confidence.

---

## 5. Status of each lever

Nothing here is decided except where noted. This document is the analysis; the decisions
belong in `docs/decisions/` and the work belongs to the named tracks.

| Lever | Owning track | Status |
|---|---|---|
| `club_variants: false` in production | `analyzer-service` | **Proposed, awaiting Taylor** |
| `render` off the critical path | `analyzer-service` | Proposed |
| `detector` concurrent with pose | `analyzer-service` | Proposed |
| Pose on CUDA | `analyzer-service` step 07 | Blocked on the worker-host handoff row (spend) |
| Analysis-proxy-first upload | `media-pipeline` | Not started — sequence it in rather than retrofit |
| Two-wave publish | `analyzer-service` + `mobile-player` | Proposed; needs a decisions entry if accepted |
| Events off MediaPipe only | `analyzer-service` | Proposed, gated on §4 |
| Coarse-to-fine pose window | `analyzer-service` | Proposed, gated on §4 |
| Audio impact cross-check | `analyzer-service` | Hypothesis, gated on §4 |

**See:** `docs/decisions/platform-data.md` (the variants finding, and the capacity model this
corrects); ARCHIVE D18 and D53 (worker host, CUDA measurement); `docs/HANDOFF.md` (the
worker-host row).
