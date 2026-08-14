/**
 * The raw colour ramps — the only file where a hex value may be born.
 *
 * Nothing outside `src/theme/` imports from here. Components read **semantic** tokens
 * (`useTheme()` → `themes.ts`); this file is just the paint on the shelf, so that swapping a
 * ramp (a rebrand, a contrast fix) is one edit that cannot miss a screen.
 */

/** Taylor's blue ramp (2026-08-14), lightest → darkest, keyed like a Tailwind scale. */
export const BLUE = {
  50: "#F0F3FA",
  100: "#D5DEEF",
  200: "#B1C9EF",
  300: "#8AAEE0",
  500: "#628ECB",
  700: "#395886",
  /** Derived from the ramp's hue — #395886 is a heading colour, not a body-text black. */
  900: "#1E2E4F",
} as const;

/** The brand green. One accent, two exposures: deep on light surfaces, acid on dark ones. */
export const GREEN = {
  /** Light-surface accent — deep enough for white text on a filled control (≈5:1). */
  600: "#2A7F4F",
  /** The pressed state of a 600 fill. */
  700: "#236B43",
  /** The acid accent the dark surfaces have always carried. */
  acid: "#A3E635",
  /** The pressed state of an acid fill. */
  acidPressed: "#B8F052",
} as const;

/** The dark ground the original theme was built from. */
export const INK = {
  bg: "#080a0d",
  panel: "#12161c",
  well: "#232a33",
  text: "#f7f8f5",
  muted: "#7e8691",
  dim: "#5b636e",
  /** Text on top of an acid fill — the dark palette's one inverted pairing. */
  onAcid: "#0b0f14",
} as const;
