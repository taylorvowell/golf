import { useEffect, useRef, useSyncExternalStore } from "react";

import { refreshSwings } from "../swings/useSwings";
import {
  getProcessing,
  retryProcessing,
  startProcessing,
  subscribeProcessing,
  type ProcessingInput,
  type ProcessingState,
} from "./processing";
import type { SessionAction, SessionState } from "./sessionState";

/**
 * The bridge between the session reducer and the upload/analysis pipeline.
 *
 * The pipeline itself is module-level (`processing.ts`) so it survives every screen the golfer
 * moves through. This hook is the part that has to live in React: it starts a run for each newly
 * saved swing, and folds the run's terminal answers back into the reducer so the rest of the
 * session — the dock, the swing list, the previous-swing thumb — reads one status.
 *
 * **Only terminal answers reach the reducer.** Per-stage progress stays in the store and is read
 * by the one component that draws it; routing it through the reducer would re-render the whole
 * session, including a live camera preview, several times a second for a label nobody is looking
 * at on the capture screen.
 */
export function useSessionPipeline(
  state: SessionState,
  dispatch: (action: SessionAction) => void,
  handedness: "right" | "left",
): void {
  /**
   * The reducer's own values, read from a ref inside the effect.
   *
   * The session id and type are stamped onto the run when it STARTS. Reading them as effect
   * dependencies would restart nothing (the store is idempotent per swing) but would re-run this
   * on every rename; reading them from a ref keeps the effect keyed on what actually matters —
   * which swings exist.
   */
  const latest = useRef({ state, handedness });
  useEffect(() => {
    latest.current = { state, handedness };
  }, [state, handedness]);

  useEffect(() => {
    const unsubscribes: Array<() => void> = [];

    for (const swing of state.swings) {
      if (!swing.clip) continue;

      const input: ProcessingInput = {
        clip: swing.clip,
        view: swing.view,
        handedness: latest.current.handedness,
        sessionId: latest.current.state.sessionId,
        // Video-only means the golfer asked for a recording, not a measurement — the clip is
        // still uploaded (skipping that would leave the only copy in a cache the app sweeps),
        // and no analyzer job is enqueued. AI off is the same decision, per swing.
        analyze:
          latest.current.state.sessionType !== "video_only" &&
          latest.current.state.settings.aiAnalysis,
      };
      startProcessing(swing.id, input);

      const apply = () => {
        const run = getProcessing(swing.id);
        if (!run) return;
        if (run.swingId && !swing.serverId) {
          dispatch({ type: "swing-linked", swingId: swing.id, serverId: run.swingId });
        }
        if (run.phase === "done" && swing.status !== "ready") {
          // The list is what the post-swing screen reads the analysed swing back out of, so the
          // refresh is part of finishing — not a nicety a screen might or might not do.
          refreshSwings();
          dispatch({ type: "swing-ready", swingId: swing.id });
        }
        if (run.phase === "failed" && swing.status !== "failed") {
          dispatch({
            type: "swing-failed",
            swingId: swing.id,
            reason: run.message ?? "The analysis didn't finish.",
          });
        }
      };
      // Once immediately: a run that finished while this screen was unmounted has already
      // emitted its last state, and waiting for another would leave the swing analysing forever.
      apply();
      unsubscribes.push(subscribeProcessing(swing.id, apply));
    }

    return () => {
      for (const off of unsubscribes) off();
    };
    // Keyed on the swings themselves — a rename or a zoom change must not re-run this.
  }, [dispatch, state.swings]);
}

/** One swing's live pipeline state, for the component that draws it. */
export function useProcessingState(localId: string): ProcessingState | null {
  return useSyncExternalStore(
    (onChange) => subscribeProcessing(localId, onChange),
    () => getProcessing(localId),
    () => getProcessing(localId),
  );
}

/** Re-run a swing that failed, from wherever it got to. */
export function retrySwing(
  localId: string,
  input: ProcessingInput,
  dispatch: (action: SessionAction) => void,
): void {
  // Back to analysing in the same tick the retry starts, so the failure notice and its button
  // are gone before the first request has even opened its socket.
  dispatch({ type: "swing-retrying", swingId: localId });
  retryProcessing(localId, input);
}
