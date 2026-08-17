/**
 * The raw colour ramps — the only file where a hex value may be born.
 *
 * Components read **semantic** tokens (`useTheme()` → `themes.ts`), never this file; the only
 * imports from outside `src/theme/` are `src/design/deck/` reading its own video-surface
 * constants (`DECK_SHADES`, `BLACK`) — Deck is a fixed-dark control system with no theme to
 * read through. This file is just the paint on the shelf, so that swapping a ramp (a rebrand,
 * a contrast fix) is one edit that cannot miss a screen.
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

/**
 * Aqua — action, trajectory, motion, improvement. 300/600 extend the mockup's ramp for the
 * deck's lit-from-above primary cap (top edge lighter, pushed-in darker) — same hue, no new
 * colour identity.
 */
export const AQUA = {
  600: "#2FA8AB",
  500: "#43CDD0",
  400: "#57D7D8",
  300: "#7CE0E2",
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
 * The video-surface attention amber ("analysing…", frame-sync warnings). The Ideal Swing
 * mockup has no amber — this survives only on the fixed-dark video surfaces (player, report
 * video layer), where an in-progress state needs a voice that is neither good nor bad. It is
 * absorbed when in-app-capture rebuilds those surfaces.
 */
export const VIDEO_AMBER = "#F59E0B";

/**
 * Deck's lit-from-above neutral faces (video-surface control shading). Lighting, not brand —
 * blue-cast greys whose only job is the top-lighter-than-bottom read that keeps the player's
 * controls legible in sunlight. Born here so every hex in the app has one home.
 */
export const DECK_SHADES = {
  raisedTop: "#232B35",
  raisedBottom: "#151B23",
  sunkTop: "#0E131A",
  sunkBottom: "#161D26",
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
