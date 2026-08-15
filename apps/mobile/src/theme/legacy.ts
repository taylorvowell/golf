import { LEGACY_AMBER } from "./palette";
import type { IdealTokens } from "./themes";

/**
 * TEMPORARY — deleted in design-system step 09.
 *
 * The pre-Ideal-Swing token names, aliased onto the new palette so every untouched screen
 * compiles and renders in the new colours without being edited. Nothing NEW may read these
 * names: a screen being rebuilt reads `IdealTokens` names only, and once the last legacy
 * consumer is rebuilt this file and the aliases it splices into `Theme` disappear.
 */
export interface LegacyTokens {
  /** → `surface`. */
  panel: string;
  /** → `surface2`. */
  well: string;
  /** → `muted2`. */
  dim: string;
  /** → `cobalt`. The brand accent is no longer green. */
  accent: string;
  /** → `onDark`. */
  onAccent: string;
  /** → `cobaltPressed`. */
  accentPressed: string;
  /** Cobalt at 12/16% — the old "whisper of accent". */
  accentSoft: string;
  /** Cobalt at 35/45% — the on-position switch track. */
  accentTrack: string;
  /** → `lavender`. */
  violet: string;
  /** Lavender at 12/16%. */
  violetSoft: string;
  /** No Ideal Swing equivalent — kept literal until step 09 retires the last consumer. */
  amber: string;
  /** → `bad`. */
  danger: string;
  /** → `onDark`. */
  onDanger: string;
}

/** Builds the alias block for one theme; spread after the base so names never drift apart. */
export function legacyAliases(base: IdealTokens): LegacyTokens {
  const dark = base.mode === "dark";
  return {
    panel: base.surface,
    well: base.surface2,
    dim: base.muted2,
    accent: base.cobalt,
    onAccent: base.onDark,
    accentPressed: base.cobaltPressed,
    // The old theme expressed soft/track as alpha over the accent; these are the same
    // mixes over the new cobalt (dark uses the dark theme's lighter cobalt, #3F57DA).
    accentSoft: dark ? "rgba(63,87,218,0.16)" : "rgba(47,70,207,0.12)",
    accentTrack: dark ? "rgba(63,87,218,0.45)" : "rgba(47,70,207,0.35)",
    violet: base.lavender,
    violetSoft: dark ? "rgba(133,141,194,0.16)" : "rgba(133,141,194,0.12)",
    amber: dark ? LEGACY_AMBER.dark : LEGACY_AMBER.light,
    danger: base.bad,
    onDanger: base.onDark,
  };
}
