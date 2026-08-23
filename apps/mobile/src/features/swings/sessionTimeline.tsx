import type { SwingSummary } from "@swingsage/schema/contract";

import { Tag, type SwingTimelineItem } from "../../design/system";

import type { PendingImport } from "./pendingImports";
import { ANGLE_LABEL, createdAtMs, swingAngle, type SwingSession } from "./sessions";
import {
  SwingThumb,
  SwingThumbFailed,
  SwingThumbGhost,
  SwingThumbLocal,
} from "./SwingThumb";

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
  /** Omit where the surface offers no destructive action — the featured card and the log rows
   *  pass it, and nothing else does. */
  onDeleteSwing?: (swing: SwingSummary, number: number) => void,
  /** The swing on its way out — it stays in the list, animating, until the delete resolves. */
  removingId?: string | null,
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
      const angle = swingAngle(swing);
      /**
       * A swing is a DOOR only once its analysis has finished (Taylor, 2026-08-22).
       *
       * Everything before that — uploaded, queued, analyzing — opens a report with no artifact
       * behind it: an empty player, no markers, no score, and a golfer left wondering what they
       * broke. So a swing that is not `ready` renders in the same waiting state an arriving
       * import does, and a swing that FAILED renders as the failure, both untappable.
       */
      const ready = swing.status === "ready";
      const failed = swing.status === "failed";
      return {
        key: swing.id,
        title: `Swing ${number}`,
        // The swing's own picture — ten rows of the same date differ only in this. A failed swing
        // has no frame to show and never will, so it carries the error mark instead.
        leading: failed ? <SwingThumbFailed /> : <SwingThumb swing={swing} />,
        // How it was FILMED leads the line, because it is what decides what the numbers below
        // can mean (Taylor, 2026-08-22 — moved off the session header, where a day holding both
        // angles could only report a list).
        subtitlePrefix: angle ? (
          <Tag
            label={ANGLE_LABEL[angle]}
            variant={angle === "dual" ? "best" : "neutral"}
            compact
          />
        ) : undefined,
        subtitle: failed
          ? "This swing couldn't be analysed."
          : typeof swing.overallScore === "number"
            ? stamp
            : `${stamp} · Not scored`,
        // The stage the SERVER reports, mapped onto the same five segments an import walks, so a
        // swing that is still working looks the same wherever it came from.
        progress: !ready && !failed ? serverStage(swing.status) : undefined,
        pending: !ready,
        failed,
        score:
          ready && typeof swing.overallScore === "number"
            ? Math.round(swing.overallScore)
            : undefined,
        onPress: ready ? () => onOpenSwing(swing.id) : undefined,
        onDelete: onDeleteSwing ? () => onDeleteSwing(swing, number) : undefined,
        removing: swing.id === removingId,
        testID: `swing-card-${swing.id}`,
      };
    });
}

/** The server's view status, as one of the five stages the log draws. */
function serverStage(status: string): { stage: string; stageIndex: number } {
  switch (status) {
    case "queued":
      return { stage: "Queued", stageIndex: 1 };
    case "analyzing":
      return { stage: "Analyzing", stageIndex: 2 };
    default:
      // `uploaded` — the bytes are in, nothing has picked the job up yet.
      return { stage: "Uploaded", stageIndex: 1 };
  }
}

/**
 * Imports still on their way, as timeline rows above the session's real swings.
 *
 * Numbered as the balls they will BE — the next ones after everything already in the session —
 * so the row does not renumber the moment it lands. While it is running the subtitle is the
 * pipeline's own stage rather than a time: "Uploading", "Queued", "Analyzing pose" is what a
 * golfer wants from a row that has not finished, and the timestamp it will eventually carry says
 * nothing yet.
 *
 * **Never tappable.** There is no swing to open until the analysis has actually finished, and a
 * row that navigates to a half-made swing is how a golfer ends up staring at an empty player
 * wondering what they did wrong. `onPress` is therefore never set here; the row only becomes a
 * door once it is a real swing in `sessionSwingItems`.
 *
 * A run that FAILS leaves this list entirely rather than turning red in it (Taylor, 2026-08-22):
 * the session list is where a golfer looks at their practice, not where they debug an upload.
 * The toast and the inbox carry the failure instead.
 */
export function pendingSwingItems(
  session: Pick<SwingSession, "swings">,
  pending: readonly PendingImport[],
): SwingTimelineItem[] {
  return [...pending].reverse().map((run, i) => ({
    key: run.localId,
    title: `Swing ${session.swings.length + pending.length - i}`,
    // A frame of the golfer's own clip as soon as one can be pulled out of it, and the breathing
    // ghost for the few hundred ms before that. Same box either way, so nothing on the line jumps
    // sideways when the picture arrives.
    leading: run.thumbPath ? <SwingThumbLocal path={run.thumbPath} /> : <SwingThumbGhost />,
    // The staged track says where it is up to; a subtitle repeating the stage name under it
    // would be the same fact twice.
    progress: { stage: run.stage, stageIndex: run.stageIndex },
    pending: true,
    testID: `swing-pending-${run.localId}`,
  }));
}
