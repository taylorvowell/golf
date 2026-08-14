/**
 * The app's colour tokens.
 *
 * These lived in `src/spike/styles.ts` until the spike harness was deleted, which meant the one
 * canonical copy of the palette sat in a directory the plan called throwaway — and every screen
 * outside it had quietly hardcoded the same hex values rather than importing from a spike.
 *
 * This is tokens only, deliberately. The design system proper — type scale, spacing, components,
 * and §41's bright-sunlight contrast bar — is the `mobile-app-shell` track. Pre-empting it here
 * would be the second copy this file exists to prevent.
 */
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
