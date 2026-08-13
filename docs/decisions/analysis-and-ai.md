# Analysis Engine & AI

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).
What the pipeline currently emits is [`../CURRENT-STATE.md`](../CURRENT-STATE.md) §3–5 and
[`../METRICS.md`](../METRICS.md).

### Finding the swing inside a long recording is a future-state feature

**Decision:** Automatic swing isolation — rejecting walking in, setup, practice swings and walking
away, and letting the golfer choose when several are detected — is **deferred**. It stays on the
roadmap as its own track, after ground truth exists.
**Gotchas:** This is **not** the existing 8-event detection, which locates events inside a clip
already known to contain exactly one swing — a materially easier problem, and mistaking one for
the other would silently skip real work. Until it ships, `in-app-capture` must provide a **manual
trim/select fallback**; that fallback is required, not optional.
**See:** ARCHIVE D2.

### The AI provider seam is server-side; the model is deliberately not chosen

**Decision:** Fix the **seam**, not the model. All model access goes through a server-side
provider abstraction, so the model is swappable without touching callers.
**Scope:** AI is for coaching narrative, conversation and parsing images — **never** for producing
geometry. Pose, club, phase and angle maths are deterministic machine vision. AI is an
enhancement, never a hard dependency for a swing reaching a ready state.
**See:** ARCHIVE D16.

### What golfer data may reach a model provider

**Decision:**
- **Never sent:** raw video, raw per-frame keypoint arrays, precise location, email, payment data.
- **May be sent:** derived analysis (scores, findings, checkpoint metrics), golfer-supplied
  profile fields, goals, equipment, club, summarised history. **Extracted keyframe images may be
  sent** where a visual is needed.
- **Required of the provider:** no training on submitted data, and zero or short retention. A
  provider that cannot commit to both is not eligible.
- **User-authored free text** — notes, goals, messages — is **untrusted input**, carried as data
  and never as instructions, and never able to alter system behaviour.

**Scope:** Makes the Apple App Privacy and Google Data Safety declarations answerable rather than
guesswork, and constrains `ai-coach`'s prompt construction from the start.
**See:** ARCHIVE D14.

### Scoring is style-aware; seven universal checks never gate

**Decision:** Every scoring row is either universal `[U]` or style-dependent, gated by the
golfer's swing style (STY-01 Rotator / STY-02 Lifter / STY-03 Slider-Bomber / STY-04 Stacker)
with `[REL]`/`[TGT]`/`[SWP]` modifiers per `PROJECT_MAIN.md` §15.4. **A trait the golfer's style
legitimizes is never presented as a fault.** The seven universal rows — face-to-path, strike,
kinematic sequence order, low point, shaft lean, balance, no-flip — never gate and stay
highest-weighted for every style. Classification is descriptive-first from measured markers;
body-type logic is tie-breaker only; output is primary style + confidence + secondary, and
hybrids widen tolerances rather than force a label. The onboarding self-report is a prior, and
a measured disagreement is surfaced, never silently overridden.
**Gotchas:** Style tags are versioned scoring-config data, never code. The style label is
constant across the bag — the club column gates within it, and a driver/iron disagreement
surfaces as an insight, not two labels. Classification Step 1 needs face-on markers that **no
current fixture provides**.
**See:** ARCHIVE D54; `PROJECT_MAIN.md` §15.4.

### Never fabricate a face-angle number from video

**Decision:** Video yields checkpoint **classifications** (square/open/closed) only. Degrees
require a launch monitor, and manually entered launch-monitor data is the only authoritative
source of face-angle degrees anywhere in the system.
**Scope:** Generalises — a check that cannot be evaluated from the available view abstains and is
marked "not scored". Abstaining beats a confident wrong number, and that is a product position
rather than a limitation.

### Thresholds are versioned configuration, never hardcoded

**Decision:** Scoring thresholds live in a versioned `scoring_config.json`. Every report stores
`scoring_model_version` so old reports stay reproducible. Stage 8 is a pure function of
`analysis.json` + the config, so a scoring change re-runs with `rescore.py` rather than a full
re-analysis.
**Gotchas:** `validate_scoring_config.py` proves a field **exists**, never that it **means** what
the band assumes. Nine rotation checks once shipped reading a quantity that decreases as a golfer
turns, and one of them scored 100 and looked healthy. Before trusting a new check, print its raw
value across all fixtures and confirm the number moves the way the band assumes.

### The scorecard has its own route, separate from the artifact

**Decision:** `GET /api/v1/swings/:id/report` serves `coach_report.json` — Stage 8's whole output,
with no AI in it. Clients fetch it **lazily**, only when someone opens the analysis panel, and a
404 means `--no-scoring` rather than a failure.
**Gotchas:** Separate from `/analysis` because the two have different sizes and lifetimes: the
artifact is megabytes of per-frame geometry the overlay needs immediately, the report is a few
kilobytes nothing needs until asked for. A client that only wants to *explain* a swing should not
download every keypoint to do it — and "analysis must be explainable" is a product
non-negotiable, not a screen. `no-store`, because a re-score rewrites the report in place under
the same revision.
**Scope:** Any surface showing the scorecard must print **coverage next to the headline**: `65
from 41 of 58 checks` and `65 from 6 of 58` are different claims about the same number. The two
reasons a check did not score stay apart — *skipped for this swing* is about the clip, *deferred*
is the config refusing to score a metric it does not trust yet, and merging them reports our gap
as the golfer's.

### The pipeline has one programmatic entry point

**Decision:** The full analysis composition — every stage, the `analysis.json` doc assembly, the
output lock, schema versioning — is `swingsage.pipeline.run(AnalysisRequest, on_event=None)`.
`scripts/burnin.py` is a thin CLI over it; the hosted worker imports it directly instead of
spawning a child process. Failures the pipeline refuses on raise `PipelineError` with a
user-readable reason.
**Gotchas:** **stdout is a protocol** until the worker exists end to end: `apps/web/src/lib/jobs.ts`
regex-parses the printed stage lines for its progress bar, so the `print()` calls inside
`pipeline.run()` may not change shape. The structured `on_event` callback is additive, never a
replacement for those lines. `AnalysisRequest` defaults and the CLI flags are kept identical by
`tests/test_pipeline.py` — add a flag by adding the field first. The club detector still has **no
default weights** in either surface.

### The analyzer environment is pinned to the measured configuration

**Decision:** Runtime deps are exact-pinned in `services/analyzer/requirements.txt` — the
versions the CUDA measurement (D53) and the determinism baseline were taken on. Install is two
commands in order: `pip install -r requirements.txt`, then `pip install --no-deps
rtmlib==0.0.16`. `services/analyzer/Dockerfile` builds the worker image from those pins (code +
deps only; model assets mount as volumes at their repo-relative paths) and the in-container
test suite is the reproducibility oracle. `service/worker.py` is the container entrypoint: a
versioned job-spec JSON → `AnalysisRequest` → `pipeline.run()`, emitting one JSON object per
line — strict validation, unknown fields refuse, club detector never defaulted.
**Gotchas:** rtmlib's metadata hard-requires the CPU-only `onnxruntime` distribution and
`opencv-contrib-python` — installing it *with* deps puts a CPU onnxruntime next to
`onnxruntime-gpu`, recreating the silent-CUDA-fallback incident. The cu126 torch wheels run on
CPU-only hosts too; one faithful image, host-agnostic — a slimmer CPU-only variant is deferred
until the worker-host handoff closes. The club-head weights (`best.pt`) remain a **local-only
asset** with no reproducible fetch path; shipping them to a deployed worker is an open
later-step decision. Upgrading any pin means re-running the fixture fidelity comparison
(`scripts/compare_analysis.py`) before trusting new output.

### Pose runs on CUDA when it is genuinely available

**Decision:** `pose_device()` probes for a usable CUDA provider and returns `cuda` or `cpu`;
`SWINGSAGE_POSE_DEVICE=cpu|cuda` forces it. Measured **2.32x** (70.4 -> 30.4 ms/frame) on a GTX 1080.
**Gotchas:** "Available" is a claim, not a capability — a provider can be listed and still fail to
create, falling back to CPU **without raising**. Always ask a real session `get_providers()`. There
is no CUDA toolkit on this machine: the CUDA 12 + cuDNN 9 DLLs come from **torch's** `torch/lib`, so
importing torch is load-bearing. `onnxruntime-gpu` must match the CUDA major version (**1.22** for
CUDA 12; 1.28 wants CUDA 13). CPU and CUDA agree to **0.94 px** but are **not bit-identical**, so a
golden snapshot is only valid against the device that produced it.
**See:** ARCHIVE D53.
