import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingBack, navBarBottomInset } from "../design/system";
import { AnalyzingBar } from "../features/session/AnalyzingBar";
import { AnalysisFailedNotice } from "../features/session/AnalysisFailedNotice";
import { LocalClipPlayer } from "../features/session/LocalClipPlayer";
import { retryProcessing } from "../features/session/processing";
import { useProcessingState } from "../features/session/useSessionPipeline";
import type { CaptureView } from "../features/session/sessionState";
import { dismissImport, trackImport, usePendingImports } from "../features/swings/pendingImports";
import { swingOrder } from "../features/swings/sessions";
import { useSessions } from "../features/swings/useSessions";
import { refreshSwings, useSwings } from "../features/swings/useSwings";
import { useHandedness } from "../features/profile/useProfile";
import { useAppNavigation } from "../navigation";
import { FixedDarkTheme } from "../theme";
import { StandaloneSwingPage } from "./SwingDetailScreen";

/**
 * The swing the golfer just saved, before the analysis exists — and it is the STANDARD single
 * swing view, not a screen of its own design (Taylor, 2026-08-26, twice: first "the same screen
 * as the record flow", then, on seeing a bespoke local-player page, "not the same swing view —
 * it doesn't even have a menu overlay"). So this renders `StandaloneSwingPage` — the exact
 * component behind `SwingDetail`, main menu and header included — for the row ingest just
 * minted, with two pending-state differences: the video is the TRIMMED LOCAL FILE (the server
 * stream 404s until the upload lands, and the player never retries), and the pipeline's
 * `AnalyzingBar` floats over the page. The transport scrubs on the container's own facts — the
 * standard page already supports an unmeasured swing.
 *
 * When analysis lands the route replaces itself with the real `SwingDetail`, which re-prepares
 * onto the served, artifact-backed clip. A failure degrades to the same notice the session
 * shows, over a swing that keeps playing.
 */

export interface PendingSwingScreenProps {
  /** The pipeline run to watch — `SavedImport.localId` from the import flow. */
  localId: string;
  /** The server's swing row, minted before navigation. Null only if ingest was slow to answer. */
  swingId: string | null;
  /** The TRIMMED clip, as the cutter wrote it: bare absolute path, no `file://`. */
  path: string;
  fps: number;
  durationMs: number;
  /** File seconds per real second — 8 for a phone slow-mo clip. The page plays at real speed. */
  slowMoFactor?: number;
  view: CaptureView;
}

export function PendingSwingScreen({
  localId,
  swingId: mintedSwingId,
  path,
  fps,
  durationMs,
  slowMoFactor,
  view,
}: PendingSwingScreenProps) {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const run = useProcessingState(localId);
  const handedness = useHandedness();
  const { state } = useSwings();
  const { sessions: sessionRows } = useSessions();

  /** The saving loader waited for the id; the run's own state covers the slow-ingest fallback. */
  const swingId = mintedSwingId ?? run?.swingId ?? null;

  /**
   * The list normally already carries the row (saveReview refreshes before navigating). If this
   * mounted on the fallback — ingest answered after the loader's patience ran out — pull the
   * list once when the id finally arrives, so the standard page can take over.
   */
  const refreshed = useRef(false);
  useEffect(() => {
    if (!swingId || refreshed.current) return;
    refreshed.current = true;
    if (state.kind === "ok" && state.swings.some((s) => s.id === swingId)) return;
    void refreshSwings();
  }, [swingId, state]);

  /** The standard page's own shape for this swing — the same entry the log would open. */
  const entry = useMemo(() => {
    if (!swingId || state.kind !== "ok") return null;
    return swingOrder(state.swings, sessionRows).find((e) => e.swing.id === swingId) ?? null;
  }, [swingId, state, sessionRows]);

  /**
   * The swap this page exists to make: analysis landed, so the real report takes this route's
   * place — `replace`, not `navigate`, so Back from the report returns to where the import
   * started rather than to a pending page for a swing that is no longer pending.
   */
  const swapped = useRef(false);
  useEffect(() => {
    if (swapped.current || run?.phase !== "done" || !run.swingId) return;
    swapped.current = true;
    const id = run.swingId;
    // The list must carry the READY row when the report route reads it — refresh, then swap.
    void refreshSwings().then(() => navigation.replace("SwingDetail", { id }));
  }, [run, navigation]);

  /** The failed run's session, for the retry — the log row (pendingImports) still carries it. */
  const pendingRows = usePendingImports();
  const retry = useCallback(() => {
    const sessionId = pendingRows.find((r) => r.localId === localId)?.sessionId ?? null;
    // Clear the failed row (and its orphaned empty swing, if the bytes never landed) before the
    // rerun re-registers it — the same lifecycle a fresh import walks through.
    dismissImport(localId);
    retryProcessing(localId, {
      // fps 0, like importSwing: ingest never reads it and the analyzer probes the real rate.
      // slowMoFactor rides along so the retry's poster samples real seconds too.
      clip: { path, fps: 0, durationMs, slowMoFactor },
      view,
      handedness: handedness === "left" ? "left" : "right",
      sessionId,
      analyze: true,
    });
    if (sessionId) trackImport(localId, sessionId, Date.now(), path);
  }, [durationMs, handedness, localId, path, pendingRows, slowMoFactor, view]);

  /** One slot, two states — the same rule the after-swing screen keeps, so the notice and the
   * progress track can never draw over each other. */
  const progress =
    run?.phase === "failed" ? (
      <AnalysisFailedNotice
        reason={run.message ?? "The analysis didn't finish."}
        onRetry={retry}
      />
    ) : run?.phase !== "done" ? (
      <AnalyzingBar
        stage={run?.stage ?? "Uploading"}
        stageIndex={run?.stageIndex ?? 0}
        progressPct={run?.progressPct}
        detail={run?.detail}
      />
    ) : null;

  if (entry) {
    return (
      <StandaloneSwingPage
        entry={entry}
        // No sideways swipe while pending: the neighbours belong to the log's order, and this
        // page replaces itself with the real report the moment there is one to swipe from.
        prev={null}
        next={null}
        onGo={() => {}}
        analyzed={false}
        localVideo={{ path, speed: slowMoFactor }}
        extras={
          progress ? (
            <View
              style={[
                styles.progressSlot,
                { bottom: navBarBottomInset(insets.bottom) + 74 },
              ]}
              pointerEvents="box-none"
            >
              {progress}
            </View>
          ) : null
        }
      />
    );
  }

  // Ingest has not answered with a row yet (rare — the saving loader waits for it): the clip
  // full-bleed with the status, exactly the record flow's analyzing shape, until it does.
  return (
    <FixedDarkTheme>
      <View style={styles.fallbackRoot} testID="pending-swing-fallback">
        <LocalClipPlayer clip={{ path, fps, durationMs, slowMoFactor }} />
        <FloatingBack
          onPress={() => navigation.goBack()}
          style={[styles.back, { top: insets.top + 8 }]}
          testID="pending-swing-back"
        />
        {progress ? (
          <View style={[styles.progressSlot, { bottom: insets.bottom + 24 }]}>{progress}</View>
        ) : null}
      </View>
    </FixedDarkTheme>
  );
}

const styles = StyleSheet.create({
  fallbackRoot: { flex: 1, backgroundColor: "#000" },
  back: { position: "absolute", left: 16 },
  // Bottom-left and narrow, exactly where the after-swing screen carries it — progress is
  // secondary to the picture, and the right side stays clear of the transport's controls.
  progressSlot: { position: "absolute", left: 12, right: "55%" },
});
