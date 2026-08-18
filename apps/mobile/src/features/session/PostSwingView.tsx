import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Skeleton } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
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
import {
  previousSwing,
  type SessionAction,
  type SessionState,
  type SessionSwing,
} from "./sessionState";
import { SessionSwingListSheet } from "./sheets/SessionSwingListSheet";

/**
 * The post-recording screen (§9.6, D61): the one-shape report player wearing session
 * chrome — the swing looping under the standard transport, the analyzing bar while the
 * pipeline runs, and the session dock whose centre is the next recording.
 *
 * UI phase: the recorded clip does not exist yet, so the newest REAL swing stands in for
 * playback and the report (`__DEV__`-grade stubbing — the wiring swaps who mints the swing
 * id and nothing about this screen moves). The analyzing progression is the stub driver's;
 * completion fires the overlay and then the report sheet's own `presented` entrance.
 */

export interface PostSwingViewProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
  swing: SessionSwing;
  onOpenSettings: () => void;
  onEndSession: () => void;
}

export function PostSwingView({
  state,
  dispatch,
  swing,
  onOpenSettings,
  onEndSession,
}: PostSwingViewProps) {
  const t = useTheme();
  const { state: listState } = useSwings();
  const [listOpen, setListOpen] = useState(false);
  const { starred, toggle } = useStarred(swing.id);

  /** The newest real swing plays the recorded clip's part until capture wiring lands. */
  const standIn = useMemo(() => {
    if (listState.kind !== "ok" || listState.swings.length === 0) return null;
    return [...listState.swings].sort((a, b) => createdAtMs(b) - createdAtMs(a))[0];
  }, [listState]);

  const report = useReport(standIn?.id, null, standIn != null);

  // The completion moment shows only on the transition, and only while the golfer is still
  // here — arriving at an already-ready swing must not replay the flourish.
  const [celebrating, setCelebrating] = useState(false);
  const lastStatus = useRef(swing.status);
  useEffect(() => {
    if (lastStatus.current === "analyzing" && swing.status === "ready") {
      setCelebrating(true);
      const done = setTimeout(() => setCelebrating(false), 1500);
      return () => clearTimeout(done);
    }
    lastStatus.current = swing.status;
    return undefined;
  }, [swing.status]);
  useEffect(() => {
    lastStatus.current = swing.status;
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

  const prev = previousSwing(state, swing.id);

  const stickyFooter = useMemo(
    () => (
      <SessionSwingDock
        hasPrevious={prev != null}
        starred={starred}
        onPrevious={() => prev && dispatch({ type: "review", swingId: prev.id })}
        onEndSession={onEndSession}
        onSwingList={() => setListOpen(true)}
        onRecordNew={() => dispatch({ type: "back-to-capture" })}
        onDelete={confirmDelete}
        onToggleFavorite={toggle}
        onOpenSettings={onOpenSettings}
      />
    ),
    [prev, starred, dispatch, onEndSession, confirmDelete, toggle, onOpenSettings],
  );

  const vm = useMemo(
    () =>
      report.kind === "ok" && standIn != null
        ? buildReportViewModel(report.report, standIn)
        : null,
    [report, standIn],
  );

  const analyzed = swing.status === "ready";

  const sheetContent = useMemo(
    () => (
      <View style={{ paddingBottom: 140 }}>
        {!analyzed ? (
          <View style={styles.analyzingSlot}>
            <AnalyzingBar recordedAt={swing.recordedAt} />
            <SheetSkeleton />
          </View>
        ) : vm != null && standIn != null ? (
          <ReportSheet vm={vm} swingId={standIn.id} onShowVideo={() => {}} />
        ) : (
          <SheetSkeleton />
        )}
      </View>
    ),
    [analyzed, swing.recordedAt, vm, standIn],
  );

  if (standIn == null) {
    // No real swing exists to stand in (fresh install / unreachable): the loop must still
    // work, so the dock renders over a quiet stage instead of the player.
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>{`Swing ${swing.number} saved`}</Text>
        <Text style={styles.fallbackDetail}>
          Playback lands with the capture wiring — recording flow continues.
        </Text>
        <View style={styles.fallbackDock}>{stickyFooter}</View>
        <SessionSwingListSheet
          visible={listOpen}
          onClose={() => setListOpen(false)}
          swings={state.swings}
          currentId={swing.id}
          onView={(swingId) => {
            setListOpen(false);
            dispatch({ type: "review", swingId });
          }}
          onDelete={(swingId) => dispatch({ type: "delete-swing", swingId })}
        />
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
        stickyFooter={stickyFooter}
      >
        {sheetContent}
      </ReportVideoLayer>

      {celebrating ? <AnalysisCompleteOverlay /> : null}

      <SessionSwingListSheet
        visible={listOpen}
        onClose={() => setListOpen(false)}
        swings={state.swings}
        currentId={swing.id}
        onView={(swingId) => {
          setListOpen(false);
          dispatch({ type: "review", swingId });
        }}
        onDelete={(swingId) => dispatch({ type: "delete-swing", swingId })}
      />
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
  analyzingSlot: { paddingHorizontal: 16, paddingTop: 10, gap: 18 },
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
  fallbackDock: { position: "absolute", left: 0, right: 0, bottom: 40 },
});
