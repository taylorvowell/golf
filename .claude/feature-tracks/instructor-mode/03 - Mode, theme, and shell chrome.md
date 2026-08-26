# 03 - Mode, theme, and shell chrome

**Phase:** Instructor Mode
**Status:** complete
**Estimated effort:** 1 day

## Overview

The switchable second surface: `ModeProvider` (device-local, role-gated), the AppHeader
mode dropdown, the charcoal `INSTRUCTOR` theme binding, and the instructor shell —
tab navigator, wave nav with Broadcast in the center slot, instructor menu drawer — with
placeholder screens step 04 then fills. Golfers see none of this.

## Dependencies

- Step 02 complete (the entitlement shape the shell reads).

## Architectural Context

Plan §4 (mode is presentation, never authorization; device-local; eligibility = the
`instructor` role) and §5 (third theme binding; `useAppTheme` converts to context).
`.claude/rules/react-native.md` binds throughout — flat surfaces, no borders/shadows,
tap states, semantic tokens only, module-level screen components.

## Files & Areas Touched

- `apps/mobile/src/features/mode/` (new): `ModeProvider.tsx`, `useAppMode`, AsyncStorage
  key `swingsage.app-mode.v1`, `useRoles()` (reads `GET /api/v1/instructor`-era
  `/api/v1/roles` via the ApiClient, cached, abortable), debug toggle to force eligibility
- `apps/mobile/src/theme/palette.ts` (`CHARCOAL` ramp), `themes.ts` (`INSTRUCTOR`
  binding, `mode: "dark"`), `ThemeProvider.tsx` (resolve from app mode; `useAppTheme` via
  context), `ThemeProvider.test.tsx`
- `apps/mobile/src/design/system/AppHeader.tsx` (mode dropdown slot next to the Menu
  glyph, with the cross-mode unread dot)
- `apps/mobile/src/features/instructor/shell/` (new): `InstructorTabs`, instructor
  `TabBar`/WaveNav items (Home, Students, center **Broadcast**, Inbox, Profile door),
  instructor menu drawer, placeholder screens
- `apps/mobile/App.tsx` (provider order: ModeProvider above ThemeProvider; the
  `mode === "instructor" ? <InstructorTabs/> : <Tabs/>` swap at the `Tabs` seam)
- `apps/mobile/src/navigation.ts` (instructor param lists)

## Steps

1. `ModeProvider`: state + AsyncStorage persistence, `setMode`, reset-to-personal on
   sign-out and on eligibility loss. Mount above `ThemeProvider` in `App.tsx`.
2. `useRoles()`: fetch once per session from `/api/v1/roles`, discriminated-union state
   (signed-out / loading / roles), `instructorEligible` derived; a debug toggle
   ("Force instructor role") in the debug sheet for dev without a role row.
3. Theme: `CHARCOAL` ramp in `palette.ts` (near-black bg → stepped charcoal surfaces,
   existing `COBALT`/`AQUA` accents untouched); `INSTRUCTOR: Theme` in `themes.ts` — every
   `IdealTokens` token valued; `ThemeProvider` resolves
   `appMode === "instructor" ? INSTRUCTOR : LIGHT`; convert `useAppTheme()` to context
   (15 call sites, API unchanged); extend the provider test to the third binding.
4. AppHeader: `modeSwitch` slot — compact dropdown (Personal / Instructor), rendered only
   when eligible, with the unread dot; identical placement in both shells.
5. Instructor shell: `InstructorTabs` + wave nav items + menu drawer (identity +
   membership row, Edit directory listing, Drill library, Broadcast history, Settings,
   Switch to personal) + one placeholder screen per tab (AppHeader + empty state on
   tokens). The center Broadcast slot opens a placeholder sheet.
6. Deep-link note: notification routing is not built yet anywhere; leave a named seam —
   the mode router function (`routeForNotification(kind) → {mode, screen}`) lives in
   `features/mode/` with a TODO tied to the notifications track.
7. Register edit in place: `mobile-client.md` gains the mode + instructor-theme entries
   (device-local mode, role eligibility, third binding, pinned-dark surfaces unaffected).

## Quality Standards

- No screen file imports `INSTRUCTOR`/`LIGHT`/`DARK` directly — everything reads
  `useTheme()`/`useAppTheme()`; grep proves it (theme files and tests exempt).
- Mode switch is instant with no remount flash of the NavigationContainer — the swap is
  inside it, at the Tabs seam.
- `themedStyles` cache stays identity-keyed on the three module constants — no theme
  object is constructed per render.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Manual (emulator, allowed — this is a major navigation/theme change): switch modes both
  directions, kill + relaunch to confirm persistence, sign out to confirm reset, confirm
  golfer personas never see the dropdown.

## Definition of Done

- [ ] Instructor-eligible account: dropdown present, both modes reachable, mode survives
      relaunch, personal is default
- [ ] Non-eligible account: no dropdown, no instructor route reachable
- [ ] Instructor mode renders charcoal via tokens; personal mode pixel-identical to before
      (provider test pins LIGHT's values)
- [ ] Pinned-dark surfaces (player/capture/stance/deep) byte-identical in both modes
- [ ] `mobile-client.md` entries added
