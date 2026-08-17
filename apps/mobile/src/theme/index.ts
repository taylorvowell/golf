/**
 * The app's colour system, in three layers:
 *
 *   `palette.ts`  — raw ramps. Only this folder imports it.
 *   `themes.ts`   — semantic tokens (`Theme`), with a LIGHT and a DARK binding.
 *   `ThemeProvider` / `useTheme` / `themedStyles` — how components read them.
 *
 * **Light is the default.** Dark renders only when the golfer picks it in Settings or runs
 * their phone in dark mode. Themed surfaces never import a palette value directly — they call
 * `useTheme()` (inline colours) or `themedStyles()` (sheets).
 *
 * `COLORS` below is the exception, and it is deliberate: the player, capture and after-swing
 * surfaces sit over video and are **fixed dark in both themes** — a control surface over
 * footage keeps its own light (see `docs/decisions/mobile-client.md`). Those files, and the
 * deck system layered on them, keep importing `COLORS`; nothing themed may.
 */
export { AQUA, COBALT, LAVENDER, NAVY, SEMANTIC } from "./palette";
export { DARK, LIGHT, type ShadowStyle, type Theme } from "./themes";
import { AQUA, DARK_SURFACES, LAVENDER, NAVY, SEMANTIC, VIDEO_AMBER } from "./palette";
export {
  FixedDarkTheme,
  ThemeProvider,
  clearThemePreferenceCache,
  useTheme,
  useThemePreference,
  type ThemePreference,
} from "./ThemeProvider";
export { themedStyles } from "./themedStyles";

/**
 * The fixed dark palette of the video-facing surfaces (player, capture, deck) — since step 09
 * every value derives from `palette.ts`'s Ideal Swing ramps, so the app has ONE colour source.
 * The keys are the video surfaces' own vocabulary (`aqua` is the action accent the old system
 * called acid); `amber` is the one value with no mockup equivalent (see `VIDEO_AMBER`).
 */
export const COLORS = {
  bg: DARK_SURFACES.bg,
  panel: DARK_SURFACES.surface,
  border: DARK_SURFACES.surface3,
  text: DARK_SURFACES.text,
  muted: DARK_SURFACES.muted,
  dim: DARK_SURFACES.muted2,
  aqua: AQUA[500],
  lavender: LAVENDER[500],
  amber: VIDEO_AMBER,
  red: SEMANTIC.bad,
  /** Text on top of an `aqua` fill — the palette's only inverted pairing. */
  onAqua: NAVY[900],
} as const;
