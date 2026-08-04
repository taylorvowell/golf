# 05 — Swing Phase Detection & The Golf Coach Scoring Engine

## Part A — Swing Event Detection (Stage 5)

### The 8 canonical events (industry/academic standard — GolfDB)
Address (A) → Toe-Up (TU) → Mid-Backswing (MB, lead arm parallel) → Top (T) →
Mid-Downswing (MD, lead arm parallel) → Impact (I) → Mid-Follow-Through (MFT, shaft
parallel) → Finish (F). Phases are the spans between events (backswing = A→T,
downswing = T→I, etc.). These exact 8 events are what GolfDB (1,400 labeled swing videos)
defines and what its baseline model SwingNet (MobileNetV2+LSTM) detects at ~76% within-
tolerance accuracy — useful context and a ready dataset.

### Primary approach: heuristics from our own pose + club data (recommended)
We already compute high-quality wrist and club-head trajectories; events fall out of them
robustly and deterministically:

1. **Swing window**: largest sustained motion-energy burst (already found for auto-trim).
2. **Address**: last quasi-static span (grip_center velocity < ε for ≥15 frames) before the
   backswing motion begins; event frame = last frame of that span.
3. **Top**: global extremum of grip_center vertical position within the window, refined as
   the zero-crossing of grip vertical velocity (up→down). Extremely reliable.
4. **Impact**: max club-head speed frame near the ball; refine by head-position closest to
   calibrated ball position; cross-check with grip_center velocity peak. (If club tracking
   is weak: min wrist-height + max wrist-speed near address-hand-position works well.)
5. **Toe-Up**: during backswing, first frame where shaft is horizontal (shaft_angle ≈ 0°/
   parallel to ground). Fallback (no shaft): lead wrist passes trail-hip height.
6. **Mid-Backswing**: lead arm (shoulder→wrist) parallel to ground during backswing.
7. **Mid-Downswing**: same condition during downswing.
8. **Mid-Follow-Through**: shaft parallel to ground after impact (fallback: wrists at
   lead-hip height moving up).
9. **Finish**: motion energy decays below threshold with hands above shoulders (else last
   frame of window).

Each event gets a confidence from how cleanly its criterion resolved (sharp vs. mushy
extremum, agreement of primary + fallback signals). Enforce ordering constraints
(A<TU<MB<T<MD<I<MFT<F); if violated, re-solve the offending event with fallbacks; if still
inconsistent, flag for the AI assist (send 3–5 candidate frames to Claude: "which frame is
Impact?").

### Optional secondary: SwingNet
Keep as a cross-check/ensemble later (PyTorch impl is public, weights trainable from
GolfDB). Not needed for v1 given we have pose+club signals SwingNet lacks; revisit if
heuristics underperform on fixtures. Also: GolfDB is a labeled event dataset — use a
handful of its clips as extra fixtures to validate our heuristic detector.

### UX contract
Events → `analysis.json.events`; phase bar in the player; per-phase loop playback
(loop [event_i, event_j] frame range); event thumbnails in the coach report.

---

## Part B — Metrics (Stage 6)

Two shapes of data, both stored under `analysis.json.metrics`:
1. **Time series** (per frame): spine_angle, shoulder_tilt, hip_tilt, head_x/y (vs address),
   knee_flex L/R, grip_speed, clubhead_speed_px (px/frame; convert to relative units),
   shaft_angle, wrist_hinge_proxy, mid_hip_x (sway), hip_depth (DTL).
2. **Event snapshots**: every metric sampled at each of the 8 events + deltas vs. Address.

Plus composite metrics:
- **Tempo ratio** = (T−A frames)/(I−T frames). Amateur/pro reference ≈ 3:1. Also absolute
  backswing/downswing durations in ms (true fps-aware).
- **Sway/slide/early-extension flags** (thresholded excursions of head/mid_hip).
- **Plane consistency** (DTL): RMS deviation of downswing shaft angle vs. address shaft
  plane; and classic "shaft above/below plane at MD".
- **X-factor proxy** (face-on, labeled estimated): shoulder-line vs. hip-line separation at Top.

All thresholds live in a versioned `scoring_config.json` — never hardcode in code.

---

## Part C — The Golf Coach (Stage 8)

### C1. Deterministic scorecard
Categories (view-dependent):

| Category | View | Example checks (each check: measured value, target band, weight) |
|---|---|---|
| Setup & Posture | both | spine angle 30–45° from vertical (DTL); knee flex 15–25°; stance width 1.0–1.4× shoulders (FO); arm hang under shoulders (DTL) |
| Takeaway | both | face/shaft checkpoint at TU; head still ≤2% sway |
| Backswing & Top | both | lead arm relatively straight at T; estimated shoulder turn band; no reverse spine; sway ≤ threshold (FO) |
| Transition & Tempo | both | tempo ratio 2.5–3.5; no over-the-top shaft jump (DTL, first 5 downswing frames) |
| Downswing & Plane | DTL-weighted | plane deviation band; hip depth retained (no early extension) |
| Impact | both | head behind ball (FO, driver); shaft lean band (DTL, irons); hips open proxy |
| Follow-Through & Balance | both | full finish, hands high, mid_hip stacked over lead foot ≥1s |

Scoring: each check → 0–100 via distance-from-band with soft falloff; category = weighted
mean of its checks (skip checks whose inputs are low-confidence — renormalize weights and
note "n/2 checks measurable"); overall = weighted mean of categories. Letter grades
A/B/C/D per band. Club-type aware targets (driver vs. iron differ, e.g. shaft lean at
impact) — `scoring_config.json` keyed by club class. Store `scoring_model_version`.

### C2. AI narrative & review (Claude — doc 07)
Input to the model: the full metrics/event snapshot JSON + scorecard + 8 event keyframe
images (rendered with skeleton+club overlay). Prompted role: experienced golf coach.
Output (strict JSON schema):
```jsonc
{ "summary": "3-6 sentences",
  "top_priorities": [ {"issue","evidence_frames":[..],"why_it_matters","fix"} , x2 ],
  "drill": {"name","how_to","reps"},
  "positives": ["..." x2],
  "score_adjustments": [ {"category","proposed_delta","reason"} ]  // bounded ±10, applied only with flag
}
```
`score_adjustments` lets the AI catch things the numeric checks misread (e.g., pose glitch
inflated a penalty) — apply only within bounds and mark adjusted scores in the UI. The
narrative must reference concrete measured numbers (the prompt includes them) — no generic
platitudes. Evidence frames become deep links into the player.

### C3. Trends (Swing Log)
Per-metric time series across swings (filter by club/view): overall score, category scores,
tempo ratio, sway, plus simulator stats (club speed, ball speed, smash, carry). Rolling
personal bests; simple regression arrow (improving/flat/declining over last N). A periodic
"progress note" can be AI-generated from the trend JSON (nice-to-have, Phase 7).
