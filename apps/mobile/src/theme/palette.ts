/**
 * The raw colour ramps — the only file where a hex value may be born.
 *
 * Components read **semantic** tokens (`useTheme()` → `themes.ts`), never this file; the only
 * imports from outside `src/theme/` are `src/design/deck/` reading its own video-surface
 * constants (`DECK_SHADES`, `BLACK`) — Deck is a fixed-dark control system with no theme to
 * read through. This file is just the paint on the shelf, so that swapping a ramp (a rebrand,
 * a contrast fix) is one edit that cannot miss a screen.
 *
 * **This file carries the four-anchor blue** (Taylor, 2026-08-23): `#2DF0FB` highlight, `#0D94DB`
 * middle, `#164B7E` dark, `#172B4E` darkest. Every ramp below is one of those four plus the steps
 * between them, so the whole app is one hue family rather than a navy and an unrelated aqua.
 *
 * `#172B4E` is the floor: nothing in the app is darker, so the dark theme's ground IS that anchor
 * and its surface ramp climbs out of it rather than down toward black.
 *
 * Which anchor a ramp takes is decided by what sits ON it. `COBALT` carries white text, so it runs
 * from the middle down into the dark. `AQUA` never has white on it, so it keeps the highlight.
 *
 * It replaces the Ideal Swing reference palette (`.claude/ideal-swing-design-system.html`), whose
 * values are what to restore if this scheme is rejected. Ramp NAMES are unchanged on purpose —
 * `COBALT` means "the primary-action ramp" and `AQUA` means "the highlight ramp"; renaming them
 * would touch 175 call sites for no change in behaviour.
 */

/** The brand navy ramp — text on light, grounds and heroes on dark. */
export const NAVY = {
  950: "#172B4E",
  900: "#1B3560",
  800: "#164B7E",
  700: "#1E5F9E",
} as const;

/**
 * The primary-action ramp — primary actions and selected states. Runs from the palette's MIDDLE
 * anchor down into its DARK one, because white text sits on these: the highlight is too light to
 * carry it, which is the whole reason the scheme has three anchors and not one.
 */
export const COBALT = {
  700: "#164B7E",
  600: "#0D94DB",
  500: "#1FA9EF",
} as const;

/**
 * Aqua — action, trajectory, motion, improvement. 300/600 extend the mockup's ramp for the
 * deck's lit-from-above primary cap (top edge lighter, pushed-in darker) — same hue, no new
 * colour identity.
 */
export const AQUA = {
  600: "#0D94DB",
  500: "#2DF0FB",
  400: "#5CF4FC",
  300: "#8AF7FD",
  100: "#D5FDFE",
} as const;

/** The secondary voice — coach glyphs, quiet emphasis. */
export const LAVENDER = {
  500: "#7E93A8",
} as const;

/** Semantic outcome colours — identical in both themes. */
export const SEMANTIC = {
  good: "#28A86B",
  bad: "#E55764",
} as const;

/** Text/glyphs painted over a cobalt, hero or dark-photo fill — white in both themes. */
export const ON_DARK = "#FFFFFF";

/**
 * Ink — the near-black ramp for surfaces that are dark in BOTH themes.
 *
 * Distinct from `DARK_SURFACES`, which is one theme's ground: these are for the pinned-dark
 * cards (the Pro card) that must read the same on a white page and a navy one. Cooled toward
 * the brand navy rather than neutral grey, so a black card sits in the same family as the hero
 * gradient instead of looking like a different product.
 */
export const INK = {
  900: "#101F3A",
  800: "#142544",
  700: "#172B4E",
} as const;

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
  raisedTop: "#25395F",
  raisedBottom: "#152648",
  sunkTop: "#101E39",
  sunkBottom: "#1A2C50",
} as const;

/** The light theme's surfaces and text, verbatim from the mockup `:root`. */
export const LIGHT_SURFACES = {
  bg: "#F1F6FB",
  bgElevated: "#F7FAFE",
  surface: "#FFFFFF",
  surface2: "#EFF5FA",
  surface3: "#E3EDF5",
  surfaceBlue: "#E6F5FD",
  text: "#172B4E",
  textSoft: "#4F6478",
  muted: "#7C90A3",
  muted2: "#A3B3C1",
  // Darkest anchor climbing to the middle one — white reads on every stop.
  heroStart: "#172B4E",
  heroMid: "#164B7E",
  heroEnd: "#0D94DB",
  glass: "rgba(255,255,255,0.88)",
} as const;

/**
 * INSTRUCTOR MODE's surfaces (the instructor-platform architecture §5, accepted 2026-08-26):
 * near-black charcoal instead of the navy family — Taylor's spec, verbatim: "dark
 * black/charcoals instead of the blues, still using the blue accents." Neutral with a whisper
 * of cool so the aqua/cobalt accents carry ALL the colour; the same 14-key shape as the two
 * surface sets above, so the `Theme` type accepts it unchanged. The hero ramp climbs out of
 * the charcoal ground into the middle blue anchor — the accent stays the brand's.
 */
export const CHARCOAL_SURFACES = {
  bg: "#0E1114",
  bgElevated: "#14181D",
  surface: "#1A1F25",
  surface2: "#21272E",
  surface3: "#293037",
  surfaceBlue: "#152430",
  text: "#F4F7F9",
  textSoft: "#C3CBD2",
  muted: "#8D979F",
  muted2: "#636D75",
  heroStart: "#0E1114",
  heroMid: "#16202B",
  heroEnd: "#0D94DB",
  glass: "rgba(20,24,29,0.9)",
} as const;

/** The dark theme's surfaces and text, verbatim from `html[data-theme="dark"]`. */
export const DARK_SURFACES = {
  // The ground IS the darkest anchor, and the ramp climbs out of it — see the header note.
  bg: "#172B4E",
  bgElevated: "#1B3157",
  surface: "#203961",
  surface2: "#26426D",
  surface3: "#2D4C7A",
  surfaceBlue: "#1B4576",
  text: "#F2F9FF",
  textSoft: "#C0D2E0",
  muted: "#93A8C0",
  muted2: "#70859E",
  heroStart: "#172B4E",
  heroMid: "#164B7E",
  heroEnd: "#1FA9EF",
  glass: "rgba(32,57,97,0.88)",
} as const;
