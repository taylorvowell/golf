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
export { BLUE, GREEN, INK } from "./palette";
export { DARK, LIGHT, type Theme } from "./themes";
export {
  FixedDarkTheme,
  ThemeProvider,
  clearThemePreferenceCache,
  useTheme,
  useThemePreference,
  type ThemePreference,
} from "./ThemeProvider";
export { themedStyles } from "./themedStyles";

/** The fixed dark palette of the video-facing surfaces (player, capture, deck). */
export const COLORS = {
  bg: "#080a0d",
  panel: "#12161c",
  border: "#232a33",
  text: "#f7f8f5",
  muted: "#7e8691",
  dim: "#5b636e",
  acid: "#a3e635",
  violet: "#8b7bff",
  amber: "#f59e0b",
  red: "#e5484d",
  /** Text on top of an `acid` fill — the palette's only inverted pairing. */
  onAcid: "#0b0f14",
} as const;
