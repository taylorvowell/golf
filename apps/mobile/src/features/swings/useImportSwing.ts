import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileVideo, VideoOff } from "lucide-react-native";
import type { SessionSummary } from "@swingsage/schema/contract";

import { getProcessing, subscribeProcessing } from "../session/processing";
import type { CaptureView } from "../session/sessionState";
import { useHandedness } from "../profile/useProfile";
import { useToast } from "../toast/ToastProvider";
import { importSwing, pickSwingVideo, type PickedClip } from "./importSwing";
import { refreshSwings } from "./useSwings";

/**
 * The Upload door on the swing log: pick a clip, name its angle, and let it run.
 *
 * **The golfer is not held while it uploads.** An import takes as long as an analysis does, and a
 * blocking spinner over the log for two minutes would be the wrong trade for a screen whose whole
 * job is browsing. So the run reports through the app toaster and the swing appears in the list
 * when it is real — the same "confirmed response, never optimistic" rule the rest of the log
 * follows.
 *
 * Each state gets one toast with a stable id, so the queue replaces rather than stacks: a golfer
 * importing three clips sees three swings' worth of progress, not fifteen notifications.
 */

export interface ImportHook {
  /** Open the picker. Resolves once the sheet is up, or the attempt has been reported. */
  begin: () => void;
  /** The clip awaiting its angle, or null. */
  pending: PickedClip | null;
  /** Confirm the angle and start the run. */
  confirm: (view: CaptureView) => void;
  cancel: () => void;
}

export function useImportSwing(sessions: readonly SessionSummary[]): ImportHook {
  const toast = useToast();
  const handedness = useHandedness();
  const [pending, setPending] = useState<PickedClip | null>(null);

  /** The sessions list changes as imports mint into it; the run reads the latest, not a capture. */
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /** Every run this screen started, so the subscriptions are released when it goes. */
  const watching = useRef<Array<() => void>>([]);
  useEffect(() => {
    const subs = watching.current;
    return () => {
      for (const off of subs) off();
      subs.length = 0;
    };
  }, []);

  const begin = useCallback(() => {
    void (async () => {
      const outcome = await pickSwingVideo();
      if (outcome.kind === "picked") {
        setPending(outcome.clip);
        return;
      }
      if (outcome.kind === "cancelled") return;
      toast({
        id: `import-${outcome.kind}`,
        title: outcome.kind === "denied" ? "No access to your videos" : "Couldn't open your videos",
        detail:
          outcome.kind === "denied"
            ? "Allow photo and video access in Settings to bring a swing in."
            : outcome.reason,
        icon: VideoOff,
      });
    })();
  }, [toast]);

  /**
   * Start a run and watch it. Split out of `confirm` so a failure's Retry can call exactly the
   * same thing — a retry that took a different path would be a second import flow to keep right.
   */
  const run = useCallback(
    (clip: PickedClip, view: CaptureView) => {
      void (async () => {
        let localId: string;
        try {
          localId = await importSwing({
            clip,
            view,
            handedness: handedness === "left" ? "left" : "right",
            sessions: sessionsRef.current,
          });
        } catch (err) {
          toast({
            id: "import-failed-start",
            title: "Couldn't add that swing",
            detail: `${err instanceof Error ? err.message : String(err)} — tap to try again.`,
            icon: VideoOff,
            onPress: () => run(clip, view),
          });
          return;
        }

        toast({
          id: `${localId}-progress`,
          title: "Adding your swing",
          detail: "Uploading — it'll appear in your log when it's analysed.",
          icon: FileVideo,
        });

        let done = false;
        const off = subscribeProcessing(localId, () => {
          const state = getProcessing(localId);
          if (!state || done) return;
          if (state.phase === "done") {
            done = true;
            // The list is refreshed BEFORE the toast, so tapping it lands on a log that already
            // has the swing rather than on one that is about to.
            void refreshSwings().then(() => {
              toast({
                id: `${localId}-done`,
                title: "Swing added",
                detail: "It's in today's session.",
                icon: CheckCircle2,
              });
            });
          }
          if (state.phase === "failed") {
            done = true;
            toast({
              id: `${localId}-failed`,
              title: "That swing didn't analyse",
              // The pipeline's own sentence: "we couldn't find a swing in this clip" and "the
              // upload was refused" need different actions from the golfer. The whole card is
              // the retry — a toast carries its deep link and nothing else (mobile-client),
              // and here the useful destination is another attempt.
              detail: `${state.message ?? "The analysis didn't finish."} Tap to try again.`,
              icon: VideoOff,
              onPress: () => run(clip, view),
            });
            // The placeholder has already left the log and any empty swing behind it is being
            // cleaned up; refresh so the list agrees.
            void refreshSwings();
          }
        });
        watching.current.push(off);
      })();
    },
    [handedness, toast],
  );

  const confirm = useCallback(
    (view: CaptureView) => {
      const clip = pending;
      setPending(null);
      if (clip) run(clip, view);
    },
    [pending, run],
  );

  const cancel = useCallback(() => setPending(null), []);

  return { begin, pending, confirm, cancel };
}
