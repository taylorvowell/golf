/**
 * The raw colour ramps — the only file where a hex value may be born.
 *
 * Nothing outside `src/theme/` imports from here. Components read **semantic** tokens
 * (`useTheme()` → `themes.ts`); this file is just the paint on the shelf, so that swapping a
 * ramp (a rebrand, a contrast fix) is one edit that cannot miss a screen.
 *
 * Every hex below is copied verbatim from the Ideal Swing reference
 * (`.claude/ideal-swing-design-system.html`, `:root` / `html[data-theme="dark"]` blocks).
 * If a value here disagrees with the mockup, the mockup wins.
 */

/** The brand navy ramp — text on light, grounds and heroes on dark. */
export const NAVY = {
  950: "#0B1633",
  900: "#10204A",
  800: "#14244F",
  700: "#1E3881",
} as const;

/** Cobalt — primary actions and selected states. */
export const COBALT = {
  700: "#243ABB",
  600: "#2F46CF",
  500: "#3F57DA",
} as const;

/** Aqua — action, trajectory, motion, improvement. */
export const AQUA = {
  500: "#43CDD0",
  400: "#57D7D8",
  100: "#DDF7F5",
} as const;

/** The secondary voice — coach glyphs, quiet emphasis. */
export const LAVENDER = {
  500: "#858DC2",
} as const;

/** Semantic outcome colours — identical in both themes. */
export const SEMANTIC = {
  good: "#28A86B",
  bad: "#E55764",
} as const;

/** Text/glyphs painted over a cobalt, hero or dark-photo fill — white in both themes. */
export const ON_DARK = "#FFFFFF";

/** The dark theme's shadow ink (the mockup's dark shadows are pure black rgba). */
export const BLACK = "#000000";

/**
 * The attention/in-progress amber the old theme carried ("analysing…"). The mockup has no
 * amber; these survive only for untouched screens via `legacy.ts` and die with it in step 09.
 */
export const LEGACY_AMBER = {
  light: "#B45309",
  dark: "#F59E0B",
} as const;

/** The light theme's surfaces and text, verbatim from the mockup `:root`. */
export const LIGHT_SURFACES = {
  bg: "#F2F5FB",
  bgElevated: "#F8FAFE",
  surface: "#FFFFFF",
  surface2: "#F1F4FA",
  surface3: "#E7ECF4",
  surfaceBlue: "#ECF3FF",
  text: "#14244F",
  textSoft: "#5F6980",
  muted: "#8790A2",
  muted2: "#A4ABBA",
  heroStart: "#162753",
  heroMid: "#1E3881",
  heroEnd: "#2F46CF",
  glass: "rgba(255,255,255,0.88)",
} as const;

/** The dark theme's surfaces and text, verbatim from `html[data-theme="dark"]`. */
export const DARK_SURFACES = {
  bg: "#07101F",
  bgElevated: "#0B1528",
  surface: "#101C32",
  surface2: "#15223A",
  surface3: "#1B2A44",
  surfaceBlue: "#13234A",
  text: "#F6F9FF",
  textSoft: "#C4CBDA",
  muted: "#929CB0",
  muted2: "#6E7A91",
  heroStart: "#0E1D42",
  heroMid: "#173375",
  heroEnd: "#334FD2",
  glass: "rgba(16,28,50,0.88)",
} as const;
