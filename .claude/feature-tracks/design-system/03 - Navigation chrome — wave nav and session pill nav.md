# 03 - Navigation chrome — wave nav and session pill nav

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Build the two navigation surfaces and swap the wave nav in as the app's real tab bar. The
wave nav is the mockup's signature: a glass bar whose surface bulges up under a raised
circular Record button, five slots (Home · Swings · ⬤ · Progress · Coach). The session pill
nav is the floating action dock used on swing pages. Both must support the hide/show slide
used by the report screen.

## Dependencies
- Step 02 complete (RecordButton, icons, tokens).

## Architectural Context
- Mockup: `.wave-mini`/`.wave-preview` (bar + bump geometry), `.session-pill-nav` (§10).
- The current `TabBar.tsx` already has the right route structure (Home, SwingLog, Record
  door, Progress, Coach) — this is a reskin of that contract, not a navigation change.
  Record stays a stack door, never a tab (existing decision holds).
- The bump: two stacked surface-colour ellipses behind a circular cutout illusion, exactly
  as the mockup builds it (`.base::before` 96–112px circle + flatter ellipse) — layered
  Views suffice; no SVG needed.
- Hide/show: the bar owns an Animated translateY (0 ↔ 118%) driven by a prop; the scaffold
  in step 04 supplies the signal. **Amended rule**: chrome may hide only as a deterministic
  function of scroll position (mockup behaviour, Taylor 2026-08-14) — never tap-to-hide,
  never on a timer. Rule + decision edits land with this step.
- Glass: near-opaque theme fill (`glass` token) — no backdrop blur (named deviation).

## Files & Areas Touched
- `apps/mobile/src/design/system/WaveNav.tsx` (new) — presentational bar: items with lucide
  icons (house, list, chart-no-axes-column-increasing, sparkles), active = cobalt, labels
  900/7px uppercase; centre `RecordButton`; safe-area bottom inset consumed inside.
- `apps/mobile/src/design/system/SessionPillNav.tsx` (new) — radius-999 glass dock, 5
  equal pill items (End session / Delete / Favorite / Swings / Latest with their semantic
  colours), 62px aqua `+` button absolute right with the inner 2px navy ring; hideable the
  same way.
- `apps/mobile/src/design/TabBar.tsx` — becomes a thin adapter: React Navigation props →
  `WaveNav`. Old drawn glyphs unused here after this (deleted in step 09 if nothing else
  holds them).
- `apps/mobile/src/design/system/navVisibility.ts` (new) — tiny context: screens publish a
  `hidden` boolean/Animated value; the tab bar subscribes. Default visible.

## Steps
1. Build `WaveNav` standalone with static props; pixel-match in the SystemGallery against
   the mockup's nav preview (bar height 67–84, bump circle ~96–112, item font/colour).
2. Build `SessionPillNav` the same way.
3. Wire `TabBar.tsx` → `WaveNav`; run the existing TabBar tests, update expectations that
   pinned old visuals (labels/routes/a11y stay identical).
4. Add the visibility context and the slide animation (translateY + opacity, native driver).
5. Emulator pass: all four tabs navigate, Record opens capture, bar sits above the system
   nav bar on 3-button navigation.

## Quality Standards
- Navigation behaviour byte-identical to today (same routes, same tabPress contract).
- The bump renders correctly over any content colour (it is surface-on-surface, no border).
- Labels/icons match mockup naming: Home, Swings, Progress, Coach.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Emulator screenshots (light + dark) of the bar vs the mockup nav section, and a
  screen-recorded hide/show slide triggered from a dev toggle in the gallery.

## Definition of Done
- [ ] WaveNav is the shipped tab bar; TabBar tests green (updated deliberately, not blindly)
- [ ] SessionPillNav in gallery, hide/show animation proven
- [ ] Rule amendment (scroll-state chrome hiding) landed in rules + decisions
- [ ] Screenshot comparison noted in `_PROGRESS.md`
