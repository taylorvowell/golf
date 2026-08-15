# 02 - Primitives — type, buttons, tags, surfaces, score marks

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Build the reusable component layer under `apps/mobile/src/design/system/` — the pieces every
screen after this is assembled from. Each component reproduces its mockup counterpart exactly
(sizes, radii, weights, letter-spacing, fills) and reads only theme tokens. This is the "never
make new items again" layer Taylor asked for.

## Dependencies
- Step 01 complete (tokens + fonts exist).

## Architectural Context
- Mockup sections: §03 Typography, §05 Components, §06 Scoring, §07 Cards, §08 Lists.
- Icons: the mockup uses lucide outline icons. Add `lucide-react-native` (pure JS over the
  already-shipped `react-native-svg` — no native code, no APK weight beyond JS). This
  supersedes the drawn-View glyphs rule for NEW system components; `design/deck` glyphs
  stay until their surfaces are rebuilt. Rule edit in `.claude/rules/react-native.md` +
  decision entry accompany this step.
- SVG scope: score rings/orbs need arcs (RN has no conic-gradient). The "SVG only in
  design/gauges" rule widens to "SVG lives in design/gauges and design/system only".
- Composition style: variant props (`<Button variant="performance">`), never boolean
  proliferation; every interactive component carries role/label/state accessibility and
  ≥48pt touch targets via hitSlop where drawn smaller.

## Files & Areas Touched
All new under `apps/mobile/src/design/system/`:
- `Text.tsx` — `DisplayText`, `TitleText`, `HeadingText`, `LabelText`, `Eyebrow`, `MetaText`
  wrapping the step-01 type scale (uppercase + tracking on Display/Eyebrow).
- `Button.tsx` — variants `primary` (cobalt), `performance` (aqua, navy text), `secondary`
  (surface2 fill), `ghost`, `danger` (red 9% fill, red text), `icon` (42×42); min-height 42,
  radius 7, font 900/10/+7% uppercase; pressed = translateY(1) + pressed colour.
- `RecordButton.tsx` — the 64px (58px compact) circular record control: glass halo ring,
  navy gradient face (aqua face in dark), plus glyph; used by nav in step 03.
- `Tag.tsx` — `latest` (cobalt fill/white), `best` (aqua 18%), `good`, `issue`, `neutral`;
  min-height 24, radius 4, font 900/8/+9% uppercase. Compact `tag2` metrics variant.
- `Delta.tsx` — pill `▲ +7` / `▼ -5` in good/bad colouring, surface fill, radius 999.
- `Chip.tsx` — meta chip + the dark `progress-top-chip` translucent variant.
- `Input.tsx`, `Segmented.tsx` — field label (Eyebrow face), 44pt input on surface fill,
  focus ring via aqua shadow token; segmented = surface2 track, active segment surface fill
  + cobalt text + shadowSm.
- `Panel.tsx` — the standard information surface (surface fill, radius 11/14, shadowSm/Md)
  and `PanelHead` (label + muted meta row).
- `PerformanceCard.tsx` — the hero gradient card (heroStart→Mid→End via expo-linear-gradient,
  radius 13, shadowLg, decorative radial glow circle top-right rendered as an SVG
  RadialGradient), eyebrow/heading/body slots + action row.
- `ScoreOrb.tsx` — conic ring as SVG arc: `--score` percent, per-score colour, inner surface
  disc, 900-weight centred number, optional small caption; sizes 92/56/40.
- `ScoreRing.tsx` — the translucent dark-surface ring (`log-v2-score`, `trend-ring`).
- `ProgressTrack.tsx` — 3–9px rounded track, aqua→cobalt gradient fill variant and flat
  aqua variant, optional start/mid/end label row (`meter-label` pattern).
- `SwingProfile.tsx` — the orbital scoring board (§06): conic orbit ring (SVG), navy
  gradient core with score, 4 coloured nodes, 3 floating callout cards; `compact` variant.
  Positions/sizes copied from the mockup's px values.
- `SwingTimelineList.tsx` — the connected-marker swing list (timeline rail, gradient dot,
  row grid `24px | 1fr | 62px`, ring score right).
- `CoachCard.tsx` — aqua icon tile, eyebrow/strong/body, priority tag right.
- `StickThumb.tsx` — the stick-figure thumbnail tile (56/48px, gradient fill, svg strokes
  with the mockup's joint/bone/accent/trace colours; path data passed per-instance).
- `WeekStrip.tsx` — 7 day chips, active = cobalt gradient + shadowCobalt, dot = aqua 4px.
- `BrandLogo.tsx` / `BrandMark.tsx` — the real SwingSage logo from
  `assets/brand/swingsage-logo.svg` rendered via react-native-svg: `BrandMark` is the
  ball-and-swoosh alone (replaces the mockup's placeholder `.brandmark` square),
  `BrandLogo` the full lockup. Wordmark paths take a colour prop (white on dark/hero,
  navy on light); the mark's aqua `#42CBCE`/`#3FFFF5` + ball colours stay literal
  (brand art, not theme tokens — same standing as the overlay's web-parity constants).
- `index.ts` — barrel.

## Steps
1. Add `lucide-react-native`; record the decision.
2. Build components in the order listed (Text first — everything uses it).
3. Storybook-less verification harness: a `__DEV__`-only `SystemGallery` screen (navigable
   from Settings in dev builds only) rendering every component in both themes — this is the
   living spec every later page is checked against, and costs nothing in release.
4. Jest: render tests per component pinning the token-driven behaviours a golfer notices
   (variant fills, disabled/pressed states, accessibility roles/labels) — not markup dumps.

## Quality Standards
- Every colour/size/radius in these files traces to a mockup class; a code comment names the
  class it reproduces (`/* .btn-performance */`) so pixel audits are greppable.
- No `border*` except shape-drawing (rings, nodes, the record halo).
- No component reads `palette.ts` directly — theme tokens only.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- SystemGallery screenshots (emulator, light + dark) compared side-by-side against the
  mockup's §05–§08 panels rendered in a browser at the same widths; each component checked
  off against its reference class.

## Definition of Done
- [ ] All listed components exist, exported from the barrel, gallery renders them
- [ ] typecheck + jest green; new tests cover variants + accessibility
- [ ] Gallery-vs-mockup screenshot comparison done and noted in `_PROGRESS.md`
- [ ] Rule edit (SVG scope, lucide icons) landed in `.claude/rules/react-native.md`
