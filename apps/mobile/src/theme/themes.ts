import { BLUE, GREEN, INK } from "./palette";

/**
 * The semantic layer — what a colour is *for*, not what it looks like.
 *
 * Every themed surface reads these tokens through `useTheme()`; no component may reach into
 * `palette.ts` or hand-mix an rgba beside a token that nearly matches (the standing deck rule,
 * app-wide). Adding a colour means adding a token here with a name that says its job, then
 * giving it a value in BOTH themes — the compiler enforces the "both" via the `Theme` type.
 *
 * Light is the product's default face. Dark reuses the original palette unchanged, so the
 * player's fixed dark control surfaces (`COLORS`) and the dark theme stay one family.
 */
export interface Theme {
  mode: "light" | "dark";

  /** The screen's ground. */
  bg: string;
  /** A card / list group / sheet sitting on the ground. */
  panel: string;
  /** A recessed fill on a panel — an empty thumbnail, an off switch track, a well. */
  well: string;

  /** Primary reading text. */
  text: string;
  /** Secondary text — subtitles, section tags, body copy. */
  muted: string;
  /** The faintest legible text — axis labels, footnotes. */
  dim: string;

  /** The brand green: every primary action, selection, and "this one is good". */
  accent: string;
  /** Text/glyphs on top of an `accent` fill. */
  onAccent: string;
  /** An `accent` fill while pressed. */
  accentPressed: string;
  /** A whisper of accent — selected-row tint, soft chips. */
  accentSoft: string;
  /** A switch track in the on position. */
  accentTrack: string;

  /** The secondary voice — tempo, coach glyphs, the trend line. */
  violet: string;
  /** A whisper of violet — the avatar disc, icon beds. */
  violetSoft: string;
  /** In-progress / attention — "analysing…". */
  amber: string;
  /** Destructive and negative — delete, "analysis failed", a score drop. */
  danger: string;
  /** Text on top of a `danger` fill. */
  onDanger: string;
}

export const LIGHT: Theme = {
  mode: "light",
  bg: BLUE[50],
  panel: "#ffffff",
  well: BLUE[100],
  text: BLUE[900],
  muted: BLUE[700],
  dim: BLUE[500],
  accent: GREEN[600],
  onAccent: "#ffffff",
  accentPressed: GREEN[700],
  accentSoft: "rgba(42,127,79,0.12)",
  accentTrack: "rgba(42,127,79,0.35)",
  violet: "#5F4FD8",
  violetSoft: "rgba(95,79,216,0.12)",
  amber: "#B45309",
  danger: "#C13543",
  onDanger: "#ffffff",
};

export const DARK: Theme = {
  mode: "dark",
  bg: INK.bg,
  panel: INK.panel,
  well: INK.well,
  text: INK.text,
  muted: INK.muted,
  dim: INK.dim,
  accent: GREEN.acid,
  onAccent: INK.onAcid,
  accentPressed: GREEN.acidPressed,
  accentSoft: "rgba(163,230,53,0.16)",
  accentTrack: "rgba(163,230,53,0.45)",
  violet: "#8b7bff",
  violetSoft: "rgba(139,123,255,0.16)",
  amber: "#f59e0b",
  danger: "#e5484d",
  onDanger: INK.text,
};
