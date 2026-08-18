import type { TextStyle } from "react-native";

/**
 * The Ideal Swing type system (`.claude/ideal-swing-design-system.html` §03).
 *
 * Two faces: a display face for titles, scores and labels, and a body face for coaching copy
 * and metadata. The display face is Sora — geometric, wide-set and legible at weight
 * (Taylor 2026-08-17: the condensed Barlow Black read as bulky and hard to scan, so every
 * FONT_DISPLAY key maps one weight LIGHTER than its name and tracking sits near -2% instead
 * of the condensed system's -3.5…-5%). Inter is the body face. Both load in `App.tsx` before
 * the first frame.
 *
 * RN names a font per weight (the loaded asset's key), so the family constants are weight
 * maps, not a single string. Letter-spacing in RN is absolute px against each size
 * (e.g. 32 × -0.02 ≈ -0.64).
 */

/** Display face — titles, scores, labels, eyebrows. Keys keep the old weight names so call
 *  sites did not need a sweep; each maps one step lighter on purpose (see above). */
export const FONT_DISPLAY = {
  bold: "Sora_600SemiBold",
  extraBold: "Sora_700Bold",
  black: "Sora_800ExtraBold",
} as const;

/** Body face — coaching copy, descriptions, metadata. */
export const FONT_BODY = {
  regular: "Inter_400Regular",
  semiBold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

/**
 * The six-step scale — the mockup's sizes (`.t32`…`.t10`) with Sora's looser tracking.
 * Spread into a style and add colour; never restate sizes inline.
 */
export const TYPE = {
  /** Page titles, major scores. 32 / -2%. */
  display: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -0.64,
  },
  /** Session headers, card heroes. 24 / -2%. */
  title: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: -0.48,
  },
  /** Section and finding headings. 18 / 800. */
  heading: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    lineHeight: 20,
  },
  /** Control and row labels. 14 / 800. */
  label: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: 17,
  },
  /** Uppercase kickers above content. 11 / 900 / +8%. */
  eyebrow: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    lineHeight: 11,
    letterSpacing: 0.88,
    textTransform: "uppercase",
  },
  /** Timestamps, view names, footnotes — the body face's job. 10 / 700. */
  meta: {
    fontFamily: FONT_BODY.bold,
    fontSize: 10,
    lineHeight: 14,
  },
} as const satisfies Record<string, TextStyle>;
