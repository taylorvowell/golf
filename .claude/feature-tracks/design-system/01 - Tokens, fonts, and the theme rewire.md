# 01 - Tokens, fonts, and the theme rewire

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Replace the green/blue theme with the Ideal Swing palette and semantic tokens, byte-for-byte
from the mockup's `:root` / `html[data-theme="dark"]` blocks, and bundle the real fonts.
Nothing visual is rebuilt yet — this step makes every later step a matter of *using* tokens,
never inventing values. The app must still build, run, and pass its suite at the end.

## Dependencies
- None (first step).

## Architectural Context
- Source of truth for every value: `.claude/ideal-swing-design-system.html` lines 12–87
  (light + dark token blocks) and the token table (§13 Tokens).
- The existing provider mechanics are kept unchanged (`ThemeProvider`, `useThemePreference`,
  `FixedDarkTheme`, light-default resolution) — only `palette.ts` and `themes.ts` contents
  change. The provider file's behaviour is already tested; do not rewrite it.
- Borderless rule already binding; the mockup enforces the same (`border:none !important`).
- Decision entries for this step live in `docs/decisions/mobile-client.md` under
  "The Ideal Swing design system is the app's one visual language".

## Files & Areas Touched
- `apps/mobile/src/theme/palette.ts` — full rewrite: navy/cobalt/aqua/lavender ramps,
  semantic green/red, light + dark surface sets. Hex values copied exactly from the mockup.
- `apps/mobile/src/theme/themes.ts` — new `Theme` interface: `bg`, `bgElevated`, `surface`,
  `surface2`, `surface3`, `surfaceBlue`, `text`, `textSoft`, `muted`, `muted2`, `heroStart`,
  `heroMid`, `heroEnd`, `glass`, `cobalt`, `cobaltPressed`, `aqua`, `aquaSoft`, `lavender`,
  `good`, `bad`, `onDark`, plus shadow style objects (`shadowSm/Md/Lg/Cobalt/Aqua` as
  ready-to-spread RN styles: iOS shadow* + Android elevation approximations).
- `apps/mobile/src/theme/legacy.ts` (new, temporary) — the OLD token names (`panel`, `well`,
  `accent`, `violet`, …) re-exported as aliases onto the new palette so every existing screen
  compiles and renders in the new colours without being touched yet. Deleted in step 09.
- `apps/mobile/src/design/system/typography.ts` (new) — font family constants + the type
  scale from the mockup (§03): Display/32/900/-3.5%, Title/24/800/-3%, Heading/18/800,
  Label/14/800, Eyebrow/11/900/+8%/uppercase, Meta/10/700 (body face). Letter-spacing in RN
  is absolute px: convert em values against the size (e.g. 32 × -0.035 ≈ -1.12).
- `apps/mobile/src/design/system/brand.ts` (new) — `export const BRAND = "SwingSage"`
  (settled 2026-08-14 by the real logo, whose wordmark reads *Swingsage* — every
  "Ideal Swing" string in the mockups renders as SwingSage).
- `apps/mobile/package.json` — add `expo-font`, `expo-linear-gradient`,
  `@expo-google-fonts/barlow-semi-condensed` (700/800/900), `@expo-google-fonts/inter`
  (400/600/700). All Expo-SDK modules; one dev-client rebuild covers them.
- `apps/mobile/App.tsx` — load fonts before first frame (splash holds until loaded).

## Steps
1. Write `palette.ts` from the mockup token blocks — every hex verbatim, grouped as in the
   mockup (brand ramps, light surfaces, dark surfaces, semantic).
2. Write the new `Theme` interface + `LIGHT`/`DARK` objects. Both themes must fill every
   token (compiler enforces). Shadows become per-theme style objects using the mockup's
   rgba/navy shadow colours.
3. Write `legacy.ts` mapping old names → nearest new token (`accent`→cobalt, `accentSoft`→
   cobalt 12%, `violet`→lavender, `panel`→surface, `well`→surface2, `danger`→bad, etc.) and
   splice it into the exported `Theme` type so untouched screens keep compiling.
4. Add the font packages, load in `App.tsx` via `useFonts`, name families in
   `typography.ts` (`FONT_DISPLAY`, `FONT_BODY`).
5. `npx expo prebuild -p android --clean` then `expo run:android` on the emulator
   (native modules changed — a stale `android/` silently omits them).
6. Update jest setup if font loading needs a mock (jest-expo usually covers expo-font).

## Quality Standards
- No component file changes in this step beyond `App.tsx` — the alias layer absorbs the churn.
- Zero hex literals outside `palette.ts` get *added* (existing ones are step 09's sweep).
- Every mockup token in the §13 table exists in `themes.ts` under a name traceable to it.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- App boots on the emulator in the new palette (`adb -s emulator-5554 exec-out screencap`),
  both themes: toggle dark in Settings, screenshot both, confirm bg `#F2F5FB` / `#07101F`.
- Display font renders (Barlow Semi Condensed visibly condensed vs system default).

## Definition of Done
- [ ] typecheck + full jest suite green
- [ ] Both theme screenshots taken and colours match the mockup token blocks
- [ ] `docs/decisions/mobile-client.md` entry updated (fonts, palette source)
- [ ] Dev-client rebuild noted in the existing S25+ reinstall HANDOFF row

## Notes
Bahnschrift cannot ship (Windows license) — Barlow Semi Condensed is the closest OFL
DIN-family face; the deviation is named in `_PROGRESS.md` and the decision register.
