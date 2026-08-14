# goal-progression — Progress Log

Append-only. Each completed step adds an entry with timestamp, summary, and notes worth keeping.

---

## 2026-08-13 — Track created (planning session)

Track authored from Taylor's direction: the coach (AI or human) assigns goals from the top
things the golfer needs to fix, progress accrues as the corrected behavior repeats across
swings, max 3 active, progress shows on the after-swing analysis and the homepage, achievement
is celebrated and the next goal starts.

Spec adopted as `PROJECT_MAIN.md` §16.3 with threading amendments in §8.2, §28.1, §29.
Decision: ARCHIVE D55 + register entry in `docs/decisions/analysis-and-ai.md` (windowed
evidence, abstention never moves progress, max 3, versioned `goal_config`, DB-not-artifact).
Five steps authored. Not started — the track sits behind `priority-engine` and
`history-and-trends` (hard deps); see the ROADMAP.json sequencingNote for why.
