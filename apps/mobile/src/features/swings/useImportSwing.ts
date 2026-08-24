import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileVideo, VideoOff } from "lucide-react-native";
import type { SessionSummary } from "@swingsage/schema/contract";

import { SAVE_PAD_S } from "../session/captureConstants";
import { getProcessing, subscribeProcessing } from "../session/processing";
import type { CaptureView } from "../session/sessionState";
import type { SwingTake } from "../session/SwingReview";
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
  /** Confirm the angle and move to the review pass. */
  confirm: (view: CaptureView) => void;
  cancel: () => void;
  /**
   * The clip on the mark-impact review screen, or null. An import is a recording that happened
   * somewhere else (importSwing.ts), so it earns the SAME verification pass a recorded take
   * gets: nothing becomes a swing until the golfer has seen the window and said save
   * (capture spec §01.5). Skipping it was the one place the two paths diverged — and it
   * uploaded whole multi-minute camera-roll clips (Taylor, 2026-08-23).
   */
  reviewing: { take: SwingTake; view: CaptureView } | null;
  /** Save on the review screen: trim to the window, then upload the cut. */
  saveReview: (window: { startSec: number; endSec: number }) => void;
  /** Bin it. Nothing exists server-side yet, so this costs nothing. */
  discardReview: () => void;
  savingReview: boolean;
}

/**
 * `onSaved` fires once the golfer has saved an upload's window and the run is on its way — the
 * hook's caller decides where that leaves them. The swing log needs nothing (they are already
 * looking at the list the swing will land in); session mode uses it to take them there, because
 * an uploaded clip is not part of the session they are standing in the middle of.
 */
export function useImportSwing(
  sessions: readonly SessionSummary[],
  onSaved?: () => void,
): ImportHook {
  const toast = useToast();
  const handedness = useHandedness();
  const [pending, setPending] = useState<PickedClip | null>(null);
  const [reviewing, setReviewing] = useState<{ take: SwingTake; view: CaptureView; clip: PickedClip } | null>(null);
  const [savingReview, setSavingReview] = useState(false);

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
      if (!clip) return;
      void (async () => {
        // The native detector and cutter open the file themselves — they want a bare path,
        // not a file:// URI (the recorder has always handed them one).
        const path = clip.uri.replace(/^file:\/\//, "");
        // What the clip actually is, from its own container: a phone slow-mo is captured at
        // 240 and WRITTEN at 30, and every second of its timeline is 1/8th of a real second.
        // Without this the review's before/after window is 8× too generous and the analyzer
        // is handed a swing that appears to take twenty seconds (Taylor, 2026-08-23).
        let fps = 30;
        let slowMoFactor: number | undefined;
        let durationMs = clip.durationMs ?? 0;
        try {
          const { default: HighSpeedCamera } = await import("../../../modules/high-speed-camera/src");
          const probe = await HighSpeedCamera.probeClip(path);
          if (probe.durationMs > 0) durationMs = probe.durationMs;
          if (probe.videoFps > 0) fps = probe.videoFps;
          if (probe.captureFps > probe.videoFps && probe.videoFps > 0) {
            fps = probe.captureFps;
            slowMoFactor = probe.captureFps / probe.videoFps;
          }
        } catch {
          // A clip the probe cannot read still reviews on the picker's numbers.
        }
        if (!durationMs || durationMs <= 0) {
          // A clip whose length nothing could read cannot drive a scrubber. Rare; the
          // whole-clip upload is the honest fallback, and the analyzer still finds the swing.
          run(clip, view);
          return;
        }
        setReviewing({
          take: { path, fps, durationMs, slowMoFactor },
          view,
          clip,
        });
      })();
    },
    [pending, run],
  );

  const saveReview = useCallback(
    (window: { startSec: number; endSec: number }) => {
      const current = reviewing;
      if (!current || savingReview) return;
      setSavingReview(true);
      void (async () => {
        const { take, view, clip } = current;
        try {
          // Lazy: the native module throws where it does not exist (jest), and this screen only
          // needs the cutter at the moment of save.
          const { default: HighSpeedCamera } = await import("../../../modules/high-speed-camera/src");
          // Same slack the recorded path gives (SessionScreen.saveTake): the box on screen is
          // the promise, the pad protects the takeaway from a finger that stopped a hair early.
          const startSec = Math.max(0, window.startSec - SAVE_PAD_S);
          const endSec = Math.min(take.durationMs / 1000, window.endSec + SAVE_PAD_S);
          const { path } = await HighSpeedCamera.trimClip(take.path, startSec, endSec);
          run(
            { ...clip, uri: path, durationMs: Math.round((endSec - startSec) * 1000) },
            view,
          );
          // Only once the run is actually away — a trim that threw lands in the catch below,
          // where nothing was uploaded and moving the golfer somewhere else would be a lie.
          onSaved?.();
        } catch (err) {
          // Trim failed: the picked clip is still in the golfer's library, so nothing is lost —
          // but silently uploading minutes of footage they just cut down to five seconds is not
          // the fallback they asked for. Say it and let them retry.
          //
          // The native reason is CARRIED, not swallowed: "Couldn't trim that clip" alone named
          // no cause and left the only copy of the truth in a logcat nobody was reading
          // (2026-08-23). MediaMuxer's complaints are specific — an unsupported track, a
          // missing file, an empty window — and each wants a different response.
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`trimClip failed for ${current.take.path}:`, err);
          toast({
            id: "import-trim-failed",
            title: "Couldn't trim that clip",
            detail: `${reason} — nothing was uploaded.`,
            icon: VideoOff,
          });
        } finally {
          setSavingReview(false);
          setReviewing(null);
        }
      })();
    },
    [onSaved, reviewing, run, savingReview, toast],
  );

  const discardReview = useCallback(() => setReviewing(null), []);

  const cancel = useCallback(() => setPending(null), []);

  return {
    begin,
    pending,
    confirm,
    cancel,
    reviewing: reviewing ? { take: reviewing.take, view: reviewing.view } : null,
    saveReview,
    discardReview,
    savingReview,
  };
}
