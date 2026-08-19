import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Skeleton } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { ReportSheet } from "../report/ReportSheet";
import { ReportVideoLayer } from "../report/VideoLayer";
import { buildReportViewModel } from "../report/selectors";
import { useReport } from "../player/useReport";
import { createdAtMs } from "../swings/sessions";
import { useStarred } from "../swings/useStarred";
import { useSwings } from "../swings/useSwings";
import { COLORS, useTheme } from "../../theme";
import { AnalysisCompleteOverlay } from "./AnalysisCompleteOverlay";
import { AnalyzingBar } from "./AnalyzingBar";
import { SessionSwingDock } from "./SessionSwingDock";
import type { SessionAction, SessionState, SessionSwing } from "./sessionState";
import { SessionSwingListSheet } from "./sheets/SessionSwingListSheet";

/**
 * The post-recording screen (§9.6, D61): the one-shape report player wearing session
 * chrome — the swing looping under the standard transport, the analyzing bar while the
 * pipeline runs, and the session bar whose centre is the next recording.
 *
 * UI phase: the recorded clip does not exist yet, so the newest REAL swing stands in for
 * playback and the report (`__DEV__`-grade stubbing — the wiring swaps who mints the swing
 * id and nothing about this screen moves).
 *
 * Two placement rules learned in step-03 iteration (Taylor): the session bar renders as a
 * SIBLING over the layer, not through the `stickyFooter` slot — it must stay put when the
 * report sheet opens — and the analyzing bar FLOATS over the video above the session bar,
 * because content inside the low-held sheet sits behind the bar and was invisible.
 */

export interface PostSwingViewProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
  swing: SessionSwing;
  onEndSession: () => void;
}

export function PostSwingView({ state, dispatch, swing, onEndSession }: PostSwingViewProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { state: listState } = useSwings();
  const [listOpen, setListOpen] = useState(false);
  const { starred, toggle } = useStarred(swing.id);

  /** The newest real swing plays the recorded clip's part until capture wiring lands. */
  const standIn = useMemo(() => {
    if (listState.kind !== "ok" || listState.swings.length === 0) return null;
    return [...listState.swings].sort((a, b) => createdAtMs(b) - createdAtMs(a))[0];
  }, [listState]);

  const report = useReport(standIn?.id, null, standIn != null);
  /** One shared poster stands in for per-swing thumbnails until capture media exists. */
  const thumb = useAuthenticatedImage(standIn ? `swings/${standIn.id}/thumb?poster=1` : null);

  // The completion moment shows only on the analyzing → ready transition, and only while
  // the golfer is still here — arriving at an already-ready swing must not replay it.
  const [celebrating, setCelebrating] = useState(false);
  const lastStatus = useRef(swing.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = swing.status;
    if (was === "analyzing" && swing.status === "ready") {
      setCelebrating(true);
      const done = setTimeout(() => setCelebrating(false), 1600);
      return () => clearTimeout(done);
    }
    return undefined;
  }, [swing.status]);

  const confirmDelete = useCallback(() => {
    Alert.alert("Delete this swing?", "Removes the video and its analysis, permanently.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => dispatch({ type: "delete-swing", swingId: swing.id }),
      },
    ]);
  }, [dispatch, swing.id]);

  const analyzed = swing.status === "ready";

  const dock = (
    <SessionSwingDock
      starred={starred}
      onEndSession={onEndSession}
      onSwingList={() => setListOpen(true)}
      onRecordNew={() => dispatch({ type: "back-to-capture" })}
      onDelete={confirmDelete}
      onToggleFavorite={toggle}
    />
  );

  const swingListSheet = (
    <SessionSwingListSheet
      visible={listOpen}
      onClose={() => setListOpen(false)}
      swings={state.swings}
      currentId={swing.id}
      thumb={thumb}
      onView={(swingId) => {
        setListOpen(false);
        dispatch({ type: "review", swingId });
      }}
      onDelete={(swingId) => dispatch({ type: "delete-swing", swingId })}
    />
  );

  const vm = useMemo(
    () =>
      report.kind === "ok" && standIn != null
        ? buildReportViewModel(report.report, standIn)
        : null,
    [report, standIn],
  );

  const sheetContent = useMemo(
    () => (
      <View style={{ paddingBottom: 140 }}>
        {analyzed && vm != null && standIn != null ? (
          <ReportSheet vm={vm} swingId={standIn.id} onShowVideo={() => {}} />
        ) : (
          <SheetSkeleton />
        )}
      </View>
    ),
    [analyzed, vm, standIn],
  );

  if (standIn == null) {
    // No real swing exists to stand in (fresh install / unreachable): the loop must still
    // work, so the bar renders over a quiet stage instead of the player.
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>{`Swing ${swing.number} saved`}</Text>
        <Text style={styles.fallbackDetail}>
          Playback lands with the capture wiring — recording flow continues.
        </Text>
        {!analyzed ? (
          <View style={[styles.floatingBar, { bottom: insets.bottom + 128 }]}>
            <AnalyzingBar recordedAt={swing.recordedAt} />
          </View>
        ) : null}
        {dock}
        {celebrating ? <AnalysisCompleteOverlay /> : null}
        {swingListSheet}
      </View>
    );
  }

  const sized =
    standIn.views.find((v) => v.id === standIn.primaryViewId && v.width && v.height) ??
    standIn.views.find((v) => v.width && v.height);
  const aspectRatio = sized?.width && sized?.height ? sized.width / sized.height : null;

  return (
    <View style={styles.fill}>
      <ReportVideoLayer
        testID="post-swing"
        swingId={standIn.id}
        frameCount={standIn.frameCount}
        fps={standIn.fps}
        aspectRatio={aspectRatio}
        score={analyzed && typeof standIn.overallScore === "number" ? standIn.overallScore : null}
        tempoRatio={analyzed ? standIn.tempoRatio : null}
        viewPill={`Swing ${swing.number} · ${state.title}`}
        onBack={() => dispatch({ type: "back-to-capture" })}
        sheetPresented={analyzed && !celebrating}
        sheetStyle={{ backgroundColor: t.bgElevated }}
        // The session bar renders over this layer; the video-open scrub + player bar must
        // clear it AND the raised record button (bar 67 + button rise ~31 + breathing room).
        controlsBottomInset={104}
      >
        {sheetContent}
      </ReportVideoLayer>

      {/* Floats over the video, just above the session bar, while analysis runs. */}
      {!analyzed ? (
        <View style={[styles.floatingBar, { bottom: insets.bottom + 128 }]} pointerEvents="none">
          <AnalyzingBar recordedAt={swing.recordedAt} />
        </View>
      ) : null}

      {dock}

      {celebrating ? <AnalysisCompleteOverlay /> : null}

      {swingListSheet}
    </View>
  );
}

/** The report's shape before the report — the same promise the swing screen's skeleton makes. */
function SheetSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton style={{ width: 84, height: 10 }} />
      <Skeleton style={{ width: 190, height: 26, marginTop: 10 }} />
      <Skeleton style={{ width: 140, height: 12, marginTop: 8 }} />
      <Skeleton style={{ width: 220, height: 34, borderRadius: 17, marginTop: 16 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  floatingBar: { position: "absolute", left: 16, right: 16 },
  skeleton: { paddingHorizontal: 16, paddingTop: 6 },
  fallback: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", padding: 24, gap: 8 },
  fallbackTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 20,
    textAlign: "center",
  },
  fallbackDetail: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
