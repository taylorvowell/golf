# SwingSage Club-Head Tracking & Tracing — Engineering Design Document

> Deliverable for the research prompt at [`docs/CLUB-TRACKING-RESEARCH-PROMPT.md`](CLUB-TRACKING-RESEARCH-PROMPT.md).
> This is a proposal to review and select from — nothing here is built yet. See that file's
> Part 4/5 for the original goals and required deliverable shape this document answers.

## A. Research Summary

**Bottom line:** No single sensor is bulletproof on a 60fps 720p handheld DTL swing clip; the robust architecture is *batch trajectory optimization* — noisy per-frame candidates (from a detector, mask, point-tracker, or heatmap) fused with physics priors (near-constant club-head radius from `grip_center`, a locally planar/elliptical arc, and a smooth motion model), solved with an offline RTS smoother, then rendered with a centripetal-parameterized spline. That single design directly satisfies goals 3, 5, 6 and 8; the remaining goals (1, 2, 4, 7) are event/rendering concerns layered on top.

### What is physically recoverable — and what is not

The hardest constraint is temporal resolution. Stage 0 runs `ffmpeg -fps_mode cfr -r 60`, but most source is 30fps, so **the real information rate is 30 Hz, not 60 Hz** — every genuine sample is duplicated into 1–3 output frames. Any method that treats all 60 frames as independent observations will hallucinate motion during duplicates. Two consequences: (a) all tracking must operate on *distinct* frames (detect duplicates by frame-difference energy and collapse them), and (b) frame interpolation is the only legitimate way to manufacture intermediate samples, and it must be flagged as inference, not observation.

At 720p a fast swing moves the club head ~90 px/frame through impact — many times the head's own size per frame. This is precisely the regime where per-frame box detectors fail and the object smears into a motion streak. The racquet-sports literature is unambiguous: single-image models like YOLO "cannot leverage temporal information from consecutive frames," so the shuttlecock/ball trackers that dominate this regime — the TrackNet family — are **heatmap-based and consume a stack of consecutive frames** to exploit the trajectory itself as a feature. TrackNetV3 adds trajectory rectification (inpainting occluded/indistinct frames); TrackNetV4 fuses "high-level visual features with learnable motion attention maps through a motion-aware fusion mechanism," using frame-differencing maps to highlight motion regions. This is the single most important transfer to golf: **the club head near impact is the shuttlecock problem.**

Motion blur is signal, not only noise. The Fast Moving Object (FMO) line of work (TbD, DeFMO, "Shape from Blur") models a blurred frame as `I = H*F + (1 − H*M)·B`, where the blur kernel H *is* the intra-frame trajectory — so a single blurred impact frame in principle encodes a short sub-frame arc. In practice these methods assume a known/estimable background and roughly planar motion, and extracting the trajectory is "a challenging multi-instance model fitting task" solved by sequential RANSAC on thresholded blur kernels. The club smearing into the turf (low contrast, shadow, clutter) is exactly the documented failure mode. Usable as a *candidate generator*, not a primary tracker.

Depth is unrecoverable. A single monocular DTL view yields no metric depth; anything requiring true 3D club path or angle of attack in world units is impossible from this input — say so plainly. But the key geometric prior holds: the club head near impact traces a **planar** arc that projects to a 2D ellipse. Lab motion-capture fits the near-impact trajectory to an ellipse with RMSE ~1.2 mm (Ulster study, *J. Sports Sciences* 2018); in our noisy 2D projection the fit will be far coarser, but the *shape prior* (a smooth conic, not an arbitrary squiggle) is strong and correct. Likewise club length is nearly constant, so `|club_head − grip_center|` is a near-constant radius — a powerful, cheap constraint we already have inputs for, since pose (49 keypoints + `grip_center`) runs before club tracking.

### The tracking toolbox, ranked for this problem

- **Point trackers (TAPIR, CoTracker3, LocoTrack).** CoTracker3 offers an offline variant that "processes the entire video simultaneously," tracks bidirectionally and "interpolates trajectories through occlusions," and is extremely data-efficient ("better results using 1,000 times less data" than BootsTAPIR). The catch, from the trackers' own evaluations: "fast motion" is benchmarked at merely 1.5–5% of the frame diagonal per frame, and featureless/blurred surfaces are a named failure mode. ~90 px on a 720p frame is ~10% of the diagonal — beyond the tuned regime. A query point on the head at address will likely survive the (slow) backswing and lose lock through the (fast, blurred) downswing/impact. Best used bidirectionally, trusting the slow segments and letting physics fill the core.
- **Video object segmentation (SAM 2 / SAM 2.1).** Prompt the head on an easy frame, propagate a mask, take the centroid. SAM 2's memory + occlusion head is strong, but the authors note SAM 2 "struggles with accurately tracking objects with very thin or fine details especially when they are fast-moving," and follow-ups (SAM2Plus, HiM2SAM) bolt on Kalman motion models to fix "error propagation and tracking instability in… fast-moving objects, partial occlusions." On a GTX 1080 (8 GB) the large checkpoint is heavy and SAM 2 needs frames pre-dumped as JPEG; the base+/small checkpoints run offline at seconds/frame. A mask centroid is more stable than a box corner under blur.
- **Learned detection (YOLO / keypoint / heatmap).** Highest ceiling but needs labels. Small-object tricks that matter: add a **P2 head** (stride-4) so an 8-px head isn't collapsed to a 1×1 response at P3 (P2 "primarily benefits the 6×6 to 16×16 pixel range, which the P3 head handles poorly"); run **SAHI tiling**/high-res inference; and prefer a **keypoint/heatmap formulation** (head as a single sub-pixel-peak keypoint) over a box. A public Roboflow "golf-club-tracking" dataset (6,750 images, multiple export formats) exists to bootstrap, and **GolfDB** provides "1400 high-quality golf swing videos, each labeled with event frames, bounding box, player name and sex, club type, and view type." A 40-epoch YOLO fine-tune at 640px is ~2 h on the GTX 1080 vs ~25 h CPU — inside budget.
- **Optical flow (SEA-RAFT).** Best current accuracy/speed: SOTA on Spring (3.69 EPE, 0.36 1px), 22.9%/17.8% error reductions, "at least 2.3× faster than existing methods," and explicitly good at preserving small-object motion direction. Not a tracker alone, but excellent for (a) flow-consistency gating of detections and (b) generating high-displacement candidates near impact.
- **VLM grounding (Claude Code CLI, Molmo, Qwen-VL, Florence-2).** Anthropic's guidance is that Claude should not be used "for tasks requiring perfect precision," and that if screenshot/display dimensions don't match "Claude's coordinates will be off"; independent testing shows grounding-VLM accuracy "swings from 15% to 82% depending on exact prompt phrasing," and small objects and very small images (<200 px per edge) degrade further. Open grounding models are better at pointing (Molmo 2, Qwen3-VL) but still prompt-sensitive. Honest conclusion: **never use an LLM for dense per-frame localization.** Use it sparsely — to label a few anchor frames, adjudicate between candidate solutions, or sanity-check a trace. A 200×200 crop is ~54 image tokens; a full 1280×720 frame is ~1,229 — always crop.

### Events and impact

GolfDB/SwingNet detect the 8 events at **76.1% average PCE (91.8% for six of eight, excluding Address and Finish)** — a good coarse prior, not ground truth for impact. Strongest single-view impact cues, in order: (1) **audio transient** — the strike is a sharp broadband click; even 30fps-source clips carry a 48 kHz audio track, locating impact to ~1 ms, far finer than the 16.7–33 ms frame grid; (2) **club-head vertical-velocity zero-cross / hand-path reversal** from kinematics (wearable-sensor literature detects top-of-backswing as "the point where the arm angular velocity magnitude was closest to… zero" and impact as the "acceleration magnitude… maximum"); (3) **ball departure**. Top-of-backswing is a clean velocity reversal; address is the arm-stillness→motion onset. These map directly onto goals 2 and 8.

## B. Seven Tests

Honest framing: there are ~**four genuinely distinct sensing formulations** (heatmap-temporal, segmentation-mask, point-tracking, learned-detector), one distinct **mathematical treatment** (physics/plane batch optimization) that sits on top of any of them, plus **augmentations** (frame-interpolation, LLM adjudication) that change the pipeline enough to evaluate independently but are not standalone sensors. Tests 1–5 are true alternatives; Tests 6–7 are marked as augmentation-led variations. All coordinates normalized 0–1; all mirror for handedness by flipping x→1−x on input and output.

---

### Test 1 — Temporal heatmap tracker (TrackNet-style)
| Field | Detail |
|---|---|
| **Thesis** | Stop detecting per-frame; regress a **heatmap from a stack of 3–5 consecutive distinct frames**, so the trajectory itself is the feature. The only family proven in the many-times-own-size-per-frame regime. |
| **Mechanism** | New `club_heatmap.py`. Collapse duplicate frames first (frame-diff energy) so the stack spans distinct samples. Input N frames + median-background concatenated (TrackNetV3 pattern); U-Net backbone → per-frame Gaussian heatmap; argmax + sub-pixel parabolic peak = position, peak value = confidence; TrackNetV4-style motion attention; trajectory-rectification pass inpaints low-confidence gaps. Positions feed the shared batch smoother (Test 5). |
| **Goals** | 1 ✔ (temporal input rejects off-path spikes), 2 partial (better impact-frame localization; exact impact from audio infra), 3 ✔, 5 ✔ (best-guess through gaps + confidence gating), 8 ✔ (rectification inpaints fast gaps). Not events (relies on shared event stage). |
| **Where** | New `club_heatmap.py` (Stage-4 replacement) + weights in `runs/`. |
| **LLM** | None. |
| **Data/training** | Roboflow golf-club (6,750) + tracker-assisted fixture labels + GolfDB frames; ~2–4k labelled frames; ~2–3 h fine-tune on GTX 1080. |
| **Per-swing** | ~20–40 s. |
| **Effort** | High. |
| **Reversibility** | Delete `club_heatmap.py` + weights; remove one dispatcher branch; variant key `t1_heatmap` becomes unreferenced. |

---

### Test 2 — SAM 2 mask propagation + centroid
| Field | Detail |
|---|---|
| **Thesis** | Treat the head as a **mask**, not a point/box. A centroid degrades gracefully under blur (the smear is still "the object"), and SAM 2 memory tracks through partial occlusion. |
| **Mechanism** | New `club_sam2.py`. Auto-prompt head on address frame (cheap detector / current `club.py` heuristic / one Test-4 LLM anchor); propagate bidirectionally with SAM 2.1 video predictor; per frame take centroid + area; confidence = mask IoU/objectness. Kalman-augment (SAM2Plus pattern) for fast frames. Feed shared smoother. |
| **Goals** | 1 ✔, 2 partial, 3 ✔, 5 ✔ (mask persists through smear; area collapse → skip), 8 partial (memory extrapolates a few frames). |
| **Where** | New `club_sam2.py` (Stage-4 alt); SAM 2.1 checkpoint in `runs/`. |
| **LLM** | None (optionally shares Test-4 anchor). |
| **Data/training** | Zero-shot; frames dumped as JPEG. |
| **Per-swing** | ~1–3 min (base+ checkpoint); CPU fallback impractical. |
| **Effort** | Medium. |
| **Reversibility** | Delete module + checkpoint; remove dispatcher branch. |

---

### Test 3 — Bidirectional point tracking (CoTracker3 offline)
| Field | Detail |
|---|---|
| **Thesis** | Query one point on the head at the *easy* frames and let an **offline bidirectional point tracker** carry it, trusting slow segments and letting physics fill the fast core. |
| **Mechanism** | New `club_points.py`. Query points at address (and finish) via pose geometry (extend grip→head) or an LLM anchor; run CoTracker3 offline (whole-clip, bidirectional); keep visibility/confidence; gate by confidence and hand the fast blurred gap to the batch smoother's radius+arc prior. |
| **Goals** | 1 partial (loses lock through impact — honest limit), 2 partial, 3 ✔ (backswing/early-down), 5 ✔, 8 ✔ (physics fills core). |
| **Where** | New `club_points.py` (Stage-4 alt); CoTracker3 weights in `runs/`. |
| **LLM** | None (optional shared anchor). |
| **Data/training** | Zero-shot. |
| **Per-swing** | ~30–90 s offline. |
| **Effort** | Medium. |
| **Reversibility** | Delete module + weights; remove dispatcher branch. |

---

### Test 4 — Detector + flow candidates, sparse Claude Code anchors/adjudication
| Field | Detail |
|---|---|
| **Thesis** | A fast learned detector proposes head candidates each frame; **SEA-RAFT gates them by flow consistency**; a **few Claude Code CLI calls** label 3 anchor frames (address/top/impact) and adjudicate ambiguous frames. LLM used sparsely, never for dense localization. |
| **Mechanism** | Extend `club_detect.py` (P2-head YOLO or keypoint) → candidates + scores. SEA-RAFT between distinct frames: reject candidates whose local flow disagrees with swing direction/magnitude; advect prior head by flow to generate extra candidates. For ≤3 anchors, crop ~200×200 around predicted head, write JPEG, call `claude -p --output-format json --allowedTools "Read"` for pixel coords; map back to normalized. One adjudication call on detector/flow disagreement. Batch-smooth. |
| **Goals** | 1 ✔ (flow gating kills off-path spikes), 2 ✔ (LLM pins address+impact per goal-2 priorities), 3 ✔, 5 ✔, 8 ✔. |
| **Where** | Extend `club_detect.py` + new `club_flow.py` + new `ai/providers/claude_cli.py`. |
| **LLM** | **Yes.** ~3–5 calls/swing. Per call: one 200×200 crop ≈ 54 image tokens + ~300 prompt/output ≈ <400 tokens; ~2k tokens/swing. Prompt: system "return only JSON"; user = crop path + "Return the club head as {x,y} in pixel coordinates of THIS image, plus confidence 0–1." Schema `{x:int,y:int,confidence:number,present:boolean}`. Cache key = sha256(promptId+variables+image bytes) → re-analysis is free. Failure → one validation retry appending the error, then non-AI fallback = detector+flow estimate. Runs fully with AI disabled. Pre-resize crop and keep ≥200 px/edge so returned coords map 1:1 (Anthropic: coords are relative to the post-resize image). Parse `.result`/`structured_output`; treat any non-`success` subtype as failure. |
| **Data/training** | Detector shares Test-1 labels (~2–4k); flow + LLM zero-shot. |
| **Per-swing** | ~20–40 s CV + ~5–15 s serialized LLM (queue 1–2, ~30 s timeout). |
| **Effort** | High. |
| **Reversibility** | Delete `club_flow.py`, revert `club_detect.py`, delete `ai/providers/`; AI-disabled path is already the fallback, so removal is behaviorally a no-op. |

---

### Test 5 — Physics-constrained batch trajectory optimization (the mathematical alternative)
| Field | Detail |
|---|---|
| **Thesis** | Change the *math*, not the sensor. Take **whatever** noisy candidates exist and solve one **global batch optimization**: head is a point at near-constant radius from `grip_center`, on a locally planar/elliptical arc, with a smooth constant-acceleration motion model — robustly fit via RTS smoother / factor-graph + Huber loss. The cleanest expression of goals 6 and 8. |
| **Mechanism** | New `club_fit.py` (shared). State = position (+vel+accel). Data terms: detections weighted by confidence. Priors: (a) `|head−grip_center|≈r`, r robustly estimated per clip; (b) near-impact points fit an ellipse/conic (swing-plane projection); (c) constant-acceleration smoothness. Solve forward Kalman + RTS backward pass (offline-optimal), Huber/Cauchy loss, RANSAC over trajectory hypotheses to reject outliers. Impact: intersect fitted arc with ball/address-head location, solve sub-frame timing from fitted speed (goal 8); address head anchors impact position (club returns near where it started). |
| **Goals** | 1 ✔, 2 ✔ (arc+timing → sub-frame impact), 3 ✔, 5 ✔, 6 ✔ (batch=final path then render), 8 ✔. Not a sensor — needs candidates. |
| **Where** | New `club_fit.py`, consumed by every Stage-4 variant. |
| **LLM** | None. |
| **Data/training** | None. |
| **Per-swing** | ~1–5 s given candidates. |
| **Effort** | Medium-High (the math is the work; SciPy + a small factor-graph). |
| **Reversibility** | Delete `club_fit.py`; variants fall back to raw candidates + render-time smoothing. |

---

### Test 6 — Frame-interpolation temporal super-resolution (RIFE), then track (augmentation-led)
| Field | Detail |
|---|---|
| **Thesis** | Attack the 30→60 duplication head-on: **interpolate genuine intermediate frames** (RIFE) between distinct source frames so the fast core has real intermediate positions to track, then run any tracker. A variation: it changes the input, not the sensor. |
| **Mechanism** | New `club_vfi.py`. Detect true source rate (duplicate-collapse); RIFE-interpolate 2×/4× between *distinct* frames only (RIFE runs 30+fps for 2× 720p on a 2080Ti; GTX 1080 slower but offline-OK); run Test 1/2/3 on the densified sequence; map positions back to the 60fps grid. Mark interpolated-frame positions lower-confidence — they are inferred — so the batch smoother down-weights them. |
| **Goals** | 1 partial, 2 partial, 3 ✔ (denser → smoother), 8 ✔ (principled gap-fill). Diminishing returns: RIFE itself struggles with the exact large-motion blur we care about. |
| **Where** | New `club_vfi.py` preprocessing feeding Stage 4. |
| **LLM** | None. |
| **Data/training** | Zero-shot (pretrained RIFE). |
| **Per-swing** | +30–90 s. |
| **Effort** | Medium. |
| **Reversibility** | Delete `club_vfi.py`; trackers consume `analysis.mp4` directly. |

---

### Test 7 — LLM-adjudicated two-solution over cheap classical trackers (augmentation-led, LLM)
| Field | Detail |
|---|---|
| **Thesis** | Run **two cheap classical trackers**, write BOTH solutions into the artifact, and use a **single Claude Code call/swing** to pick the smoother/on-path trace and flag failure — leveraging render-time variants so the UI can also flip instantly. LLM as adjudicator, not localizer. |
| **Mechanism** | Two lightweight trackers (current `club.py` heuristic + optical-flow blob tracker) → two candidate traces. Render a strip of ~6 downscaled frames with each trace overlaid; one `claude -p` call: "Which overlay (A/B) follows the club head more smoothly and stays on the swing path? Return {choice,reason,confidence}." Chosen solution = default variant; both remain for instant UI switching. |
| **Goals** | 1 partial, 3 partial (picks smoother of two), 5 partial. Weak on 2/8. Deliberately cheap/robust, not accurate. |
| **Where** | Two trackers in `club.py`/`club_flow.py`; adjudication in `ai/providers/`. |
| **LLM** | **Yes.** 1 call/swing. One montage ~1,000×600 ≈ 800 image tokens + ~400 text ≈ ~1.2k tokens. Schema `{choice:"A"|"B",confidence:number,reason:string}`. Cache-keyed. Failure/AI-disabled → default A. |
| **Data/training** | None. |
| **Per-swing** | ~10–30 s + one LLM call. |
| **Effort** | Low-Medium. |
| **Reversibility** | Delete adjudication call; keep solution A. |

**LLM budget check:** Only Tests 4 and 7 use an LLM (2 of the 4 allowed), both via `claude -p --output-format json`, never the API. Room remains to add LLM anchor-labelling to Tests 2/3 later without breaching the cap.

## C. Smoothing Options

Written by the analyzer into each solution (or applied in `traceSmoothing.ts` from analyzer-supplied points, per goal 6 — "follow the final smoothed path, not smoothing as it goes"). Every test whose output is a poly-line of head positions carries all seven. Each trades fluidity vs fidelity to the measured points.

- **Default — Centripetal Catmull-Rom (α=0.5) through confidence-filtered points.** Mathematically the only Catmull-Rom parameterization "that guarantees that the curves do not form cusps or self-intersections within curve segments" (Yuksel et al.); interpolates the points, visually smooth, cheap. Best general balance; chosen default.
- **Smoothing A — Chord-length Catmull-Rom (α=1).** Hugs points more tightly on uneven spacing but can overshoot/loop — higher fidelity, lower guaranteed smoothness.
- **Smoothing B — Whittaker–Henderson / P-spline, GCV-tuned λ.** Penalized least-squares that *approximates* rather than interpolates, with λ auto-selected by generalized cross-validation. Highest smoothness, deliberately sacrifices exact point fidelity — best for jagged/noisy inputs.
- **Smoothing C — Kalman RTS smoother output (constant-acceleration).** The physically-constrained batch estimate itself as the render curve; smoothness set by process-noise. Most physically plausible; fidelity depends on measurement-noise setting.
- **Smoothing D — Savitzky–Golay pre-filter + centripetal spline.** SG polynomial filter preserves peaks/curvature (the sharp bottom-of-arc) better than a moving average, then spline. Middle ground.
- **Smoothing E — Cubic Bézier fit (Schneider's algorithm).** Fits fewest Bézier segments within an error tolerance → designer-clean, few-control-point curve. Very fluid, moderate fidelity, ideal for the TV-tracer look and cheapest to render as an SVG/canvas path.
- **Smoothing F — PCHIP monotone Hermite.** Shape-preserving, no overshoot between points; the trace never bulges past a measured point. Highest fidelity / least embellishment — the honest debugging option.

Shared render styling (all options): taper ribbon width by club-head speed, gradient color along the path, mild glow/bloom, anti-aliased, drawn progressively synced to `requestVideoFrameCallback` — the Toptracer/broadcast look. **Backswing = blue, downswing = green** (goal 4).

## D. Wiring Plan

### The core problem restated
`reanalyze` spawns a process with exactly four args, all read from the swing's own stored artifact — deliberately, so no request-body value reaches a shell. We must move a `testId` and `smoothingId` from a radio button, through the job, into the analyzer, and back into the artifact **without** interpolating request text into spawn args.

### UI: DebugMenu radio group
Add two `<fieldset>` radio groups (no free text ever): **Test** (Test 1…Test 7) and **Smoothing** (Default, A–F). On change, POST `{ testId:"t4", smoothingId:"default" }` to `reanalyze`, then refresh the player to apply the selection.

### Safe transport (no shell injection)
1. `app/api/swings/[id]/reanalyze/route.ts` now **reads the body** but **validates against a fixed allow-list enum**: `testId ∈ {t1…t7}`, `smoothingId ∈ {default,a…f}`. Anything else → 400. Values are enum tokens, never paths/free text.
2. The route **persists the validated selection into the stored artifact/DB row** (Drizzle), exactly as `view`/`handedness` already are.
3. `jobs.ts` keeps building args **only from stored fields**, now appending `"--test", analysis.selection.testId, "--smoothing", analysis.selection.smoothingId`. Because these are read back from storage *after* enum-validation, the "spawn only passes values the analyzer itself wrote" invariant holds — no request text is ever an arg. `burnin.py` maps the enum token through a Python dict to a code path; the token is never `eval`'d or shelled.

The request only ever *sets* an enum in storage; the spawner only ever *reads* storage.

### Artifact provenance
`analysis.json` gains (append-only): `club_trace.solutions[]`, each `{ testId, smoothingId, points:[{x,y,conf}], phase_spans, continuity, produced_at }`, plus `club_trace.default_solution_id`. Existing consumers ignore unknown fields; the player reads `solutions`.

### Render-time variants vs full re-analysis
- **Instant (render-time):** switching **smoothing** needs no re-analysis — the analyzer writes raw confidence-filtered points per solution and `traceSmoothing.ts` applies A–F on the client (still no CV, just curve construction from analyzer points); better yet, the analyzer precomputes all seven smoothings so the flip is zero-math. **Switching between already-computed test solutions is likewise instant.**
- **Full ~90 s re-analysis:** required only the first time a given **test** is selected for a swing (different sensor → must reprocess video). Thereafter it is cached in `solutions[]` and switching is instant.

### Two-phase rendering + scrub segments (goals 1, 4, 7)
Per solution the analyzer emits exactly two DTL phase spans — **backswing** (address→top) and **downswing** (top→impact) — each with color (blue/green) and frame range. `swingPhases.ts` builds scrub-segment boundaries from these two spans (goal 7). For DTL, **only these two phases render a trace**; nothing before address or after impact draws a club trace. The 8 GolfDB events still publish (metrics/checkpoints/scorecard unchanged); the trace merely consumes address/top/impact from them. `skeleton.ts` gets two trace colors. Handedness mirrors x→1−x; blue/green semantics are handedness-independent.

### One-line continuity vs two-line fallback (goal 3.1)
The analyzer decides continuity. If the top/transition region has sufficient head confidence and point density, it emits **one continuous point list** across both phases (blue → green at the transition frame). If confidence there is very low / points too few, it emits **two separate lists** with a gap flag. The player never decides — it renders 1 or 2 polylines as told, preserving goal 3's continuous-line default with the documented extreme-case exception.

## E. Plan of Attack

### Phase 0 — Shared infrastructure (before any test)
1. **Duplicate-frame collapse + true-rate detection** (in `video.py`/a util) — every test needs distinct-frame indices.
2. **`club_fit.py`** (Test 5 math) — the shared batch smoother/physics layer every sensor feeds. Build first; it is the backbone of goals 6 and 8 and de-risks the weakest sensors.
3. **Evaluation harness / "is the trace good" metric.** Quantify: (a) smoothness (integrated squared curvature/jerk), (b) fidelity to high-confidence detections (RMSE), (c) on-path fraction (RANSAC inlier ratio vs fitted arc), (d) impact-frame error vs audio-derived impact, (e) gap count/length. Report per fixture — this is how the product owner "reviews tests on swings."
4. **Labelling infrastructure** — tracker-assisted annotation: run Test 2 (SAM 2) / Test 3 (CoTracker3) to pseudo-label the 9 fixtures + GolfDB/Roboflow frames, human-correct in a lightweight tool, export YOLO/keypoint labels. Bootstraps Tests 1 & 4 cheaply.
5. **`ai/providers/claude_cli.py`** — the minimal provider spec'd but not yet built: `complete({promptId,variables,images?,maxTokens?}) → {json,raw,provider,ms}`, versioned prompt templates, JSON-schema validation with one retry appending the error, disk cache keyed on sha256(promptId+variables+image bytes), queue of 1–2 concurrent, per-call timeout, non-AI fallback, and a global AI-disabled switch. Command: `claude -p --output-format json --allowedTools "Read"` with image paths in the prompt (the CLI's Read tool loads them; direct base64 attach is unavailable via the CLI). Crop to ≤200×200 (~54 tokens; keep ≥200 px/edge and pre-resize so coords map 1:1). Parse `.result`/`structured_output`; treat any non-`success` subtype as failure.
6. **Stage-4 dispatcher** — dict `{t1:…,…,t7:…}` in `burnin.py`; the `--test`/`--smoothing` enum plumbing; the DebugMenu radio group + route allow-list.
7. **Extend the hermetic 40-test suite** — freeze per-fixture club-candidate JSON and golden traces per test; add invariants: two-phase ordering (address<top<impact), points normalized ∈[0,1], continuity-flag correctness, handedness mirror symmetry (feed mirrored input, assert mirrored output), playback-window containment. Stays video/GPU-free by replaying frozen candidates through `club_fit.py` and the smoothings.

### Phase 1 — Cheap, zero-training sensors first
Test 3 (CoTracker3) and Test 2 (SAM 2) — no labels, immediate signal on all 9 fixtures, and they double as the label-bootstrap tool. Wire both through `club_fit.py`. Ship Test 5 as the always-on math layer.

### Phase 2 — Learned sensors
Label ~2–4k frames (Phase 0.4); train the P2-head detector (Test 4) and heatmap net (Test 1), ~2–3 h each on the GTX 1080. Add SEA-RAFT flow gating and Claude anchor/adjudication (Test 4).

### Phase 3 — Augmentations
Test 6 (RIFE input-densifier toggle); Test 7 (two-solution LLM adjudicator) reusing the provider layer.

### Shared vs per-test
- **Shared:** duplicate-collapse, `club_fit.py`, evaluation harness, labelling tool, `ai/providers/`, dispatcher, artifact schema, the seven smoothings, two-phase rendering, scrub-segment logic, hermetic-suite extensions.
- **Per-test:** the sensor module (`club_heatmap.py`, `club_sam2.py`, `club_points.py`, `club_flow.py`+detector, `club_vfi.py`) and its weights.

## Recommendations

1. **Build Test 5 (physics batch fit) as permanent infrastructure, not an experiment.** It is the cleanest satisfaction of goals 6 and 8, works with any sensor, and rescues every weaker tracker's fast-core failures via the constant-radius + planar-arc + smoothness priors. Everything else plugs into it.
2. **First shippable sensor: Test 3 (CoTracker3 offline) or Test 2 (SAM 2), fed through Test 5.** Zero training, immediate results on all 9 fixtures, and it doubles as the labelling bootstrap. This is the fastest path to a smooth, on-path, gap-filled, 1-continuous-line trace that meets goals 3/5/6.
3. **Escalate to Test 1 (temporal heatmap) only if impact-region accuracy (goals 1/2) is still short** after Phase 1. The shuttlecock literature is clear that a stack-input heatmap tracker is the only family that truly holds through the fast, blurred core — but it costs a trained model, so gate it behind measured need.
4. **Use audio for impact.** Add an audio-transient detector in `events.py` regardless of which sensor wins; it is the single highest-value, lowest-cost improvement for goal 2 and for the goal-8 sub-frame impact fill.
5. **Keep LLM use to Tests 4 and 7 and keep it sparse** — anchor/adjudicate, never localize densely. Cache aggressively so re-analysis costs zero AI calls, and verify the pipeline runs end-to-end with AI disabled before merging.
6. **Ship all tests behind the enum dispatcher + render-time variants from day one**, so the product owner reviews them by flipping the radio button on real swings, and so any losing approach deletes cleanly (one module + weights + one dispatcher branch).

**Benchmarks that change the plan:** if Test 3/2 on-path fraction ≥ ~0.9 and impact-frame error ≤ 1 frame across all 9 fixtures, stop — do not train a model. If either falls short specifically in the downswing/impact window, that is the trigger to invest in Test 1. If flow-gating (Test 4) already removes off-path spikes without the LLM anchors improving impact error, drop the LLM from Test 4 and keep it detector+flow only.

## Caveats

- **30fps-duplicated-to-60fps is the dominant limiter.** Real temporal resolution is often 30 Hz; treat duplicated frames as duplicates or you will fabricate motion. Slow-motion source clips vary this clip-to-clip, so detect the true rate per clip.
- **No depth from one monocular DTL view.** True 3D club path / angle of attack in world units is not recoverable; the 2D projected arc and its ellipse fit are the honest ceiling.
- **~90 px/frame through impact exceeds the tuned regime of point trackers** (benchmarked at 1.5–5% of frame diagonal) and defeats naive per-frame detectors. Expect any single sensor to lose the head for a few frames around impact — the physics fill is not cosmetic, it is load-bearing.
- **The club smearing into the turf** (low contrast, shadow, background clutter) is the documented FMO/segmentation failure mode; blur-kernel trajectory recovery is a noisy RANSAC fit, so treat blur-decomposition as a candidate generator only.
- **VLM grounding is approximate and prompt-sensitive.** Anthropic advises against using Claude "for tasks requiring perfect precision," and independent tests show accuracy swinging from ~15% to ~82% with phrasing; never rely on it for dense localization, and pre-resize crops so returned coordinates map 1:1.
- **Handedness has no left-handed fixture.** The x→1−x mirror is untested against real footage; add the mirror-symmetry unit test (Phase 0.7) so a regression is caught hermetically rather than in production.
- **GolfDB event accuracy (76.1% PCE)** is a coarse prior, not ground truth — do not pin impact from SwingNet alone; corroborate with audio/kinematics.
- **`total_cost_usd` from the Claude CLI is a client-side estimate, not billing truth** — budget LLM cost from token counts (crop ≈54 tokens; ~2k tokens/swing for Test 4) and confirm against the authoritative usage API before production.
- **Source-quality note:** several tracker throughput figures (e.g., RIFE "30+fps for 2× 720p on a 2080Ti," SAM 2 seconds/frame) come from vendor/author claims and community write-ups, not independent GTX-1080 benchmarks; treat per-swing time estimates as order-of-magnitude until measured on the actual dev machine.
