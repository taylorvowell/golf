import type { ComponentType } from "react";

/**
 * The app-wide toaster's model — pure data, no owner. Celebrations, notification alerts, and
 * anything else that needs a transient top-of-screen moment all speak this shape; the systems
 * differ only in what they put in it (achievements add confetti, a notification adds an
 * `onPress` deep link). Semantics live with the callers — this module only keeps the order
 * honest when several arrive at once.
 */

/** The glyph slot — any `lucide-react-native` icon component satisfies this. */
export type ToastIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export interface AppToast {
  /**
   * Stable per underlying event (an achievement id, a notification id). A second enqueue of
   * an id already waiting is dropped — replay-until-acked delivery means the same event can
   * arrive twice, and nobody should sit through the same toast twice in a row.
   */
  id: string;
  title: string;
  /** The kicker line above the title ("Achievement unlocked", "Coach"). */
  eyebrow?: string;
  detail?: string;
  icon: ToastIcon;
  /** Right-side chip text ("+50 XP"). Omitted = no chip. */
  chip?: string;
  /** Play a confetti burst behind the card — the celebration voice. */
  confetti?: boolean;
  /** Auto-dismiss override; the provider's default otherwise. */
  durationMs?: number;
  /** What a tap does BEYOND dismissing (a notification's deep link). */
  onPress?: () => void;
}

/** Append unless that id is already waiting (or currently showing — the head is index 0). */
export function enqueueToast(queue: AppToast[], next: AppToast): AppToast[] {
  if (queue.some((t) => t.id === next.id)) return queue;
  return [...queue, next];
}

/** Drop the head — the toast that just dismissed. The next item (if any) plays after. */
export function advanceToast(queue: AppToast[]): AppToast[] {
  return queue.slice(1);
}
