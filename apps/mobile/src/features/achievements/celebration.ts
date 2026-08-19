import type { ComponentType } from "react";

/**
 * The celebration model and its queue — pure data, no awarding logic.
 *
 * Nothing on the phone decides that something was EARNED (that is the server's evaluator,
 * track steps 02–03); this module only describes a moment the UI has been told to play and
 * keeps the order honest when several arrive at once.
 */

/** The glyph slot — any `lucide-react-native` icon component satisfies this. */
export type CelebrationIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export type CelebrationKind = "badge" | "rank" | "record";

export interface Celebration {
  /**
   * Stable per award (the achievement id, once real data feeds this). A second enqueue of an
   * id already waiting is dropped — the replay-until-acked delivery model means the same award
   * can arrive twice, and a golfer must never sit through the same toast twice in a row.
   */
  id: string;
  kind: CelebrationKind;
  title: string;
  detail?: string;
  icon: CelebrationIcon;
  /** XP granted — shown as a chip when present, omitted when the moment isn't about points. */
  points?: number;
}

/** The kicker line above the title, fixed per kind so wording cannot drift per call site. */
export const KIND_EYEBROW: Record<CelebrationKind, string> = {
  badge: "Achievement unlocked",
  rank: "Rank up",
  record: "Personal best",
};

/** Append unless that id is already waiting (or currently showing — the head is index 0). */
export function enqueueCelebration(queue: Celebration[], next: Celebration): Celebration[] {
  if (queue.some((c) => c.id === next.id)) return queue;
  return [...queue, next];
}

/** Drop the head — the toast that just dismissed. The next item (if any) plays after. */
export function advanceCelebration(queue: Celebration[]): Celebration[] {
  return queue.slice(1);
}
