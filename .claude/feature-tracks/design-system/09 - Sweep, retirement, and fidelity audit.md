# 09 - Sweep, retirement, and fidelity audit

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1–2 sessions

## Overview
Every remaining screen moves onto the system; the legacy layer dies. After this step there
is exactly one visual language in the app and no compatibility shims — the state the whole
track exists to reach, and the reason later pages are "assembled, not designed".

## Dependencies
- Steps 01–08 complete.

## Architectural Context
- Remaining surfaces: Home, Coach, Goals, Profile, Settings, Record entry, auth screens
  (SignIn, DeleteAccount), UpgradeRequired, error states. Each is restyled onto system
  primitives following the mockup's §12 guardrails — no new patterns invented; where a
  screen needs a pattern the mockup lacks, compose from existing pieces and record the
  composition in the decision entry (it becomes precedent).
- Deck (`src/design/deck/`) — the player's fixed-dark control system — is absorbed where
  the report rebuild already replaced it and retained where the capture/after-swing
  surfaces still stand on it. What survives is re-tokened onto the new palette so the app
  has one colour source. Full absorption of capture surfaces belongs to in-app-capture's
  future work, not this step — name what remains.
- The old visual identity is deleted, not stranded: `legacy.ts` aliases, old green/blue
  palette values, superseded components (`TopBar`, `ListRow`, old `SessionCard`,
  drawn nav glyphs) — removed once grep proves no consumers.

## Files & Areas Touched
- All `apps/mobile/src/screens/*` not yet rebuilt; `features/auth`, `features/profile`,
  `platform/` status screens.
- Deletions: `theme/legacy.ts`, superseded design components, dead glyphs.
- `docs/CURRENT-STATE.md` — the mobile app section reflects the new system.
- `docs/decisions/mobile-client.md` — Deck entry edited to describe what remains;
  design-system entry finalized.

## Steps
1. Screen-by-screen migration, cheapest first (Settings, Profile) to hone the idiom, then
   Home (performance card leads it — the mockup's §07 dominant-card rule), Coach, Goals,
   auth, platform states.
2. Delete `legacy.ts`; fix every fallout site properly (no alias resurrection).
3. Grep audits: zero hex literals outside `palette.ts`/overlay web-parity constants; zero
   `border*` outside shape-drawing; zero imports of deleted components; every screen
   consumes safe-area insets.
4. Full-app emulator walkthrough, light + dark: screenshot every screen, check against the
   §12 do/don't list (one dominant card per screen, cobalt=selected, aqua=motion,
   6–14px corners, no pill proliferation).
5. Final suite + docs updates.

## Quality Standards
- The guardrail greps from step 3 pass clean — they are the machine-checkable form of the
  mockup's §12 rules.
- No screen renders diagnostics (the three-tests rule from CLAUDE.md).
- Test count only goes up; behaviour-pinning tests survive restyles.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- The grep audits (documented inline in this step when run) exit clean.
- Full screenshot set attached to `_PROGRESS.md` notes; S25+ visual pass is the standing
  design-verdict HANDOFF row.

## Definition of Done
- [ ] Every screen on the system; `legacy.ts` and superseded components deleted
- [ ] Grep audits clean; suite green
- [ ] `docs/CURRENT-STATE.md` + decision register updated in the same session
- [ ] HANDOFF row updated: S25+ design pass over the finished app (device + verdict = Taylor)
