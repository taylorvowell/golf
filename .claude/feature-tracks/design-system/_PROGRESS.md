# design-system — Progress

Track created 2026-08-14 from Taylor's directive: the app's theme and pages must match the
reference mockups in `.claude/ideal-swing-design-system.html` **exactly** — the Swing Log
mockup 100% pixel-perfect, including the scroll behaviours (sheet sliding over the layer
beneath, the sticky pill nav hiding at the top of the report, the full-video controls
appearing in that state). The Progress page ships as a placeholder UI on the same system.
This track builds the reusable React Native design system all future pages are made from,
and supersedes mobile-app-shell step 03 (the deferred styling pass).

## Named deviations from "exact" (declared up front, each logged in docs/decisions/)

- **Font**: Bahnschrift is a Windows-licensed font and cannot be bundled in an app.
  Barlow Semi Condensed (Google Fonts, OFL) is the DIN-family stand-in for display type;
  Inter ships for body type instead of resting on system fallbacks.
- **Backdrop blur**: RN has no backdrop-filter. Glass surfaces use near-opaque theme fills
  (the mockup's glass is already 88–98% opaque, so the visual difference is minimal).
  `expo-blur` stays out until a screen proves the fill isn't enough.
- **conic-gradient score rings** render as SVG arcs (`design/gauges` heritage) — identical
  appearance, different primitive.
- **Brand wordmark**: SETTLED same day — Taylor supplied the real logo and its wordmark
  reads *Swingsage*. Every "Ideal Swing" string in the mockups renders as **SwingSage**;
  the master lockup lives at `apps/mobile/assets/brand/swingsage-logo.svg` and step 02
  builds `BrandLogo`/`BrandMark` from it (full colour on dark/hero, navy-tinted wordmark
  on light).

## Log

## 05 - Swing Log rebuilt to the reference
**Completed:** 2026-08-14 22:55 UTC
**Phase:** Ideal Swing Design System
**Summary:** `SwingLogScreen` is now the mockup's hero screen on the step-04 scaffold
(parallax .22/72, initial offset 170, overlap 74): hero backdrop with brand eyebrow, 30/900
title, the `.log-v2-more` cobalt profile door, latest-session eyebrow + deterministic headline
+ meta line + `ScoreRing` average + aqua track; sheet with `.log-v2-sheet-head`, the real
`WeekStrip`, `LatestSessionCard` (`.latest-wrap`/`.session-mini` with the cobalt LATEST label,
avg box, first-frame thumb, start/improvement/best gradient line, and the session's swings as
the compact timeline), and `.log-v2-session` rows for older sessions. New pure selectors
(`sessionStats`, `sessionTitle`, `weekMap`, `heroHeadline`) carry the derived numbers — 8 new
unit tests. All screen invariants survive: network-failure-never-empty, expired-session
distinction, unscored-never-zero, swing routing (testIDs kept). 40 suites / 363 tests green.
**Named deviations (deliberate, layout-preserving):** swing rows show the whole latest
session, not the mockup's 2 placeholder rows; subtitles are deterministic delta strings ("+11
vs session avg"), not AI copy; older-session rows open that session's newest swing (the old
accordion is gone — the mockup has no accordion); the after-swing preview door is now
`__DEV__`-only; swing titles are the real labels, not "Swing N".
**Notes:** Emulator-verified light + dark, rest + hero-open (screenshots this session);
failure states covered by the updated tests inside the new layout. `SessionCard.tsx` deleted
(orphaned by the rebuild — nothing else imported it).

---

## 04 - The slide-up scaffold — sheet over backdrop
**Completed:** 2026-08-14 22:20 UTC
**Phase:** Ideal Swing Design System
**Summary:** Built `SheetOverBackdrop` — the scaffold behind all three reference screens.
Absolute-fill backdrop under an `Animated.ScrollView` (transparent spacer + radius-30
`bgElevated` sheet with negative-margin overlap); parallax = `min(scrollY × factor, cap)`
downward via one native-driver interpolation (Log .22/72, Report .18/64 — the mockup's JS
verbatim); "open" fires on crossing `scrollTop < 60` with 12px hysteresis and only ever flips
state on crossings; `backdropOverlay` (interactive chrome while open, 0→1/24→0 over 280ms) and
`stickyFooter` (floats at the bottom, slides away 118px while open) are generic slots. Plus
`SheetHandle` and `HeroBackdrop` (hero gradient + aqua glow + ring circle, content-agnostic).
4 new tests pin the state machine (threshold, hysteresis both directions, initial offset,
content reachability) — 40 suites / 356 tests green.
**Notes:** Emulator-verified in the gallery instance: resting state shows the sheet riding the
hero with the pill dock floating; scrolling the inner sheet to its top reveals the full
`HeroBackdrop` and the dock slides away — matching the mockup's `.video-open` behaviour
(screenshots `scaffold-rest.png`/`scaffold-open.png` this session). fps/jank readings are
S25+ work, as the step names. The scaffold is data-free; Swing Log (05), Report (06–07) and
Progress (08) are instances.

---

## 03 - Navigation chrome — wave nav and session pill nav
**Completed:** 2026-08-14 22:00 UTC
**Phase:** Ideal Swing Design System
**Summary:** Built `WaveNav` (glass bar + the mockup's 96px-circle/122×24-ellipse bump under a
raised compact RecordButton, five slots, 900/7 uppercase labels, cobalt active) and
`SessionPillNav` (radius-999 glass dock, five semantic-coloured items, 62px aqua `+` with the
inner navy ring). `TabBar.tsx` is now a thin adapter onto `WaveNav` — same routes, same
tabPress contract, Record still a stack door; the existing TabBar tests pass **unchanged**.
Added `navVisibility` context (screens publish `hidden` from scroll state only — the amended
chrome rule) and the translateY+opacity slide (native driver), proven live from the gallery's
dev toggle. lucide icons swap in for the drawn glyphs on this surface.
**Notes:** Emulator-verified light + dark: tabs navigate, Record opens the capture modal, the
dark bar flips to the bgElevated surface with the aqua record face exactly as the mockup's
dark override says. Jest needed `moduleNameMapper` → lucide's CJS build (its `.mjs` ESM entry
is outside jest-expo's transform, and its `exports` map blocks subpath resolution — mapped via
`<rootDir>/../../node_modules/...`). Rule + decision amendments for scroll-driven chrome
hiding and lucide/SVG scope were already in place from the track's creation; verified current.

---

## 02 - Primitives — type, buttons, tags, surfaces, score marks
**Completed:** 2026-08-14 21:40 UTC
**Phase:** Ideal Swing Design System
**Summary:** Built the full component layer under `src/design/system/`: Text (6-step scale),
Button (6 variants incl. icon), RecordButton (glass halo + navy/aqua gradient face), Tag,
Delta, Chip, Input, Segmented, Panel/PanelHead, PerformanceCard (hero gradient + SVG radial
glow), ScoreOrb/ScoreRing (SVG arcs for the conic rings), ProgressTrack, SwingProfile (the §06
orbital board with nodes + floating callouts, standard + compact), SwingTimelineList,
CoachCard, StickThumb, WeekStrip, and BrandLogo/BrandMark rendered from path data extracted
verbatim out of `assets/brand/swingsage-logo.svg` (`brandPaths.ts`, script-generated). Added
`lucide-react-native` (pure JS over the shipped `react-native-svg`). A `__DEV__`-only
SystemGallery screen (Settings → Developer) renders every primitive as the living spec.
15 new render tests pin variant fills, up/down colouring, selection/disabled state, and
accessibility roles/labels — 39 suites / 352 tests green, typecheck green.
**Notes:** Gallery verified on the emulator in BOTH themes against the mockup's §03–§08 CSS
(every value in the components carries its source class in a comment — the audit is greppable).
Mockup hairline borders became fills per the borderless rule; conic-gradients are SVG arcs;
`.brandmark` placeholder replaced by the real mark. The dark record button correctly flips to
the aqua face. pnpm on this machine corrupts `node_modules/eslint-module-utils` on `pnpm add`
(ENOENT `*_tmp_*`) — fix: delete the dir, edit package.json by hand, plain `pnpm install`.

---

## 01 - Tokens, fonts, and the theme rewire
**Completed:** 2026-08-14 21:20 UTC
**Phase:** Ideal Swing Design System
**Summary:** Rewrote `palette.ts` (mockup hexes verbatim: navy/cobalt/aqua/lavender ramps +
light/dark surface sets) and `themes.ts` (new `IdealTokens` interface incl. hero gradient stops,
glass, and spreadable `shadowSm/Md/Lg/Cobalt/Aqua` RN shadow styles). `legacy.ts` aliases the old
token names onto the new palette so all 38 suites pass untouched. Added
`design/system/typography.ts` (Barlow Semi Condensed + Inter weight maps, six-step TYPE scale)
and `brand.ts` (`BRAND = "SwingSage"`). Fonts (`expo-font`, `@expo-google-fonts/*`) +
`expo-linear-gradient` added; fonts load in `App.tsx` behind the splash with error-degrade.
Prebuilt `--clean` and rebuilt the emulator dev client. Verified on emulator: light bg exactly
`#F2F5FB`, dark bg exactly `#07101F`, dark card exactly `#101C32` (pixel-sampled), Barlow
renders visibly condensed vs system 900 (temporary App.tsx probe, reverted). Typecheck + 337
tests green.
**Notes:** Metro was wedged (accepting connections, never responding — 3 GB node) and its
restart bound the dev client to a virtual-adapter IP (172.31.112.1); `adb reverse tcp:8081
tcp:8081` + the 127.0.0.1 server row is the reliable emulator path. Gradle still dies on the
malformed `ANDROID_SDK_ROOT` (known ENVIRONMENT.md fault) — `unset ANDROID_SDK_ROOT` before any
`expo run:android`. Dark theme's cobalt is one step lighter (#3F57DA) per the mockup token
table; `COLORS` (fixed dark player palette) deliberately untouched — Deck absorption is steps
02+/09.

---
