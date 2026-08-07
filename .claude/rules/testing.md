---
paths:
  - "services/analyzer/tests/**"
  - "apps/web/**/*.test.{ts,tsx}"
---

# Testing Discipline

- **Analyzer (Python):** `services/analyzer/tests` is the only real automated suite today — 28 tests, ~0.5s, run via `services\analyzer\.venv\Scripts\python.exe -m pytest tests`, no video/GPU/`out/` needed. It replays the deterministic stages over *frozen* pose/club input (`tests/data/*.input.json.gz`), so it's hermetic. Three kinds of check, and don't conflate them: **golden snapshots** (`test_stages.py`) prove nothing *changed*, not that it's *right*; **contract invariants** (`test_invariants.py`) need no golden file and hold regardless of fixture count; **hand-labelled tests** (`test_hand_labeled.py`) are the only ones that prove correctness, and they currently skip — `tests/fixtures.json:hand_labeled` is null for both fixtures. Don't present a green golden-snapshot run as proof of correctness.
- **Web (TypeScript):** there is no JS/TS test suite yet (no Vitest, no Playwright installed). Don't assume one exists or write a test file expecting a runner that isn't configured — if a task genuinely needs frontend test coverage, that's a setup task in its own right, not an assumed prerequisite.
- **Gates before calling web work done:** `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` (no test runner to add to that chain yet).
- Regenerate frozen analyzer test input deliberately (`scripts/make_test_data.py --all`) when pose/club inference genuinely changes — that's the point at which you decide whether the new numbers are better, per root `CLAUDE.md`'s golden-snapshot discipline.
