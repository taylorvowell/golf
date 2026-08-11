---
paths:
  - "services/analyzer/tests/**"
  - "apps/web/**/*.test.{ts,tsx}"
---

# Testing Discipline

- **Analyzer (Python):** `services/analyzer/tests` is the only real automated suite today — 28 tests, ~0.5s, run via `services\analyzer\.venv\Scripts\python.exe -m pytest tests`, no video/GPU/`out/` needed. It replays the deterministic stages over *frozen* pose/club input (`tests/data/*.input.json.gz`), so it's hermetic. Three kinds of check, and don't conflate them: **golden snapshots** (`test_stages.py`) prove nothing *changed*, not that it's *right*; **contract invariants** (`test_invariants.py`) need no golden file and hold regardless of fixture count; **hand-labelled tests** (`test_hand_labeled.py`) are the only ones that prove correctness, and they currently skip — `tests/fixtures.json:hand_labeled` is null for both fixtures. Don't present a green golden-snapshot run as proof of correctness.
- **Web (TypeScript):** Vitest (`pnpm --filter web test`, `src/**/*.test.ts`) and Playwright (`pnpm --filter web test:e2e`, `e2e/`) are both configured. Three kinds again, and don't conflate them: **pure-logic suites** (frame windows, trace smoothing, score display) are hermetic; **database suites** (`src/db/rls.test.ts`, `src/db/multiView.test.ts`) need `DATABASE_URL` and are written to **FAIL rather than skip** without one — a security or data-integrity test that silently skips still reports green; the **e2e spec** drives a real browser through Next.js → Postgres → video on disk, so a green run means the whole chain works and a red one can mean any link in it.
- **Gates before calling web work done:** `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web test`. Add `pnpm --filter web test:e2e` when the change touches the player, the media routes or the swing schema — it needs Docker Postgres up and at least one analysed swing.
- Regenerate frozen analyzer test input deliberately (`scripts/make_test_data.py --all`) when pose/club inference genuinely changes — that's the point at which you decide whether the new numbers are better, per root `CLAUDE.md`'s golden-snapshot discipline.
