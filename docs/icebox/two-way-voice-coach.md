# Two-way voice coach (talk back to the coach)

**Status:** ICEBOX · **Filed:** 2026-08-14 · **Source:** focus-mode design session (D57 deliberately scoped voice to speak-only)

**Story.** As a golfer mid-practice, I want to ask the coach a question out loud ("why did
that one sway?", "what should I feel on the next one?") and hear an answer, so the coaching
loop works without touching the phone.

**Shape when revived.** Push-to-talk first (walk to the phone, hold, ask): on-device STT →
AI coach → TTS, ~$0.01–0.02 per exchange — NOT hands-free far-field realtime, which is the
least reliable option outdoors (phone meters away, wind, range noise) and costs per-minute
(OpenAI Realtime ≈ $0.05/min full, $0.016/min mini, verified 2026-08-14). Belongs inside the
**ai-coach track's** provider abstraction, per-tier usage limits, and hard cost ceilings —
never a side-build in focus mode. The speak-only voice bank (D57) is unaffected either way.

**Revive when:** ai-coach track exists and the text coach is proven; then voice is "the coach
gains ears," not a new system.
