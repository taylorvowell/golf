import type { SwingTimelineItem } from "../../design/system";

import { createdAtMs, type SwingSession } from "./sessions";

/**
 * A session's swings as timeline rows — newest first, numbered the way they were HIT.
 *
 * Shared by the featured card and the log's expandable session rows so a swing is called
 * "Swing 3" in both places; numbering it per-view would renumber the same ball twice.
 * Golfers do not type titles, so `swing.label` never carried one worth showing.
 */
export function sessionSwingItems(
  session: SwingSession,
  onOpenSwing: (id: string) => void,
): SwingTimelineItem[] {
  return [...session.swings]
    .map((swing, i) => ({ swing, number: i + 1 }))
    .reverse()
    .map(({ swing, number }) => {
      const at = new Date(createdAtMs(swing));
      const stamp = `${at.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })} · ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
      return {
        key: swing.id,
        title: `Swing ${number}`,
        subtitle: typeof swing.overallScore === "number" ? stamp : `${stamp} · Not scored`,
        score:
          typeof swing.overallScore === "number" ? Math.round(swing.overallScore) : undefined,
        onPress: () => onOpenSwing(swing.id),
        testID: `swing-card-${swing.id}`,
      };
    });
}
