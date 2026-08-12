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
