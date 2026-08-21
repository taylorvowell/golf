import type { AppToast, ToastIcon } from "../toast/toast";

/**
 * The celebration model — the achievements layer's voice on the app-wide toaster.
 *
 * Nothing on the phone decides that something was EARNED (that is the server's evaluator,
 * track steps 02–03); this module only describes a moment and translates it into the generic
 * toast the `toast` feature plays. What makes a toast a CELEBRATION is fixed here in one
 * place: confetti on, kind-fixed eyebrow, points as the chip.
 */

export type CelebrationKind = "badge" | "rank" | "record";

export interface Celebration {
  /** Stable per award (the achievement id once real data feeds this) — the toast queue
   *  dedupes on it, which is what makes replay-until-acked delivery safe to point here. */
  id: string;
  kind: CelebrationKind;
  title: string;
  detail?: string;
  icon: ToastIcon;
  /** XP granted — shown as a chip when present, omitted when the moment isn't about points. */
  points?: number;
}

/** The kicker line above the title, fixed per kind so wording cannot drift per call site. */
export const KIND_EYEBROW: Record<CelebrationKind, string> = {
  badge: "Achievement unlocked",
  rank: "Rank up",
  record: "Personal best",
};

/** A celebration IS a toast with the celebration voice applied. */
export function celebrationToast(c: Celebration): AppToast {
  return {
    id: c.id,
    eyebrow: KIND_EYEBROW[c.kind],
    title: c.title,
    detail: c.detail,
    icon: c.icon,
    chip: c.points != null ? `+${c.points} XP` : undefined,
    confetti: true,
  };
}
