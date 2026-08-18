import { useCallback, useMemo, useRef } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import {
  ArrowDownToLine,
  ArrowLeft,
  Star,
  Trash2,
} from "lucide-react-native";

import { SessionPillNav, Skeleton } from "../design/system";
import { ReportSheet } from "../features/report/ReportSheet";
import { ReportVideoLayer } from "../features/report/VideoLayer";
import { buildReportViewModel } from "../features/report/selectors";
import { useReport } from "../features/player/useReport";
import { createdAtMs } from "../features/swings/sessions";
import { useStarred } from "../features/swings/useStarred";
import { deleteSwing, useSwing, useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { COLORS, useTheme } from "../theme";

/**
 * One swing, ONE shape (Taylor 2026-08-17: the legacy `SwingPlayer` surface is deleted — two
 * player types was tech debt): the Ideal Swing report — the sheet from the reference mockup
 * over the LIVE frame-accurate player (`ReportVideoLayer`). Scrolling the sheet away enters
 * the mockup's video-open state: pill nav out, full player controls in. Every door (log row,
 * Home's focus cards, Coach's scorecard link) lands here.
 */

export interface SwingDetailScreenProps {
  id: string;
}

export function SwingDetailScreen({ id }: SwingDetailScreenProps) {
  const { state, swing } = useSwing(id);
  const navigation = useAppNavigation();

  const onDelete = useCallback(async () => {
    await deleteSwing(id);
    if (navigation.canGoBack()) navigation.goBack();
  }, [id, navigation]);

  if (state.kind === "loading") {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={COLORS.muted} />
      </View>
    );
  }

  if (!swing) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>Swing not found</Text>
        <Text style={styles.detail}>
          {state.kind === "ok"
            ? "It may have been deleted from another device."
            : "This device could not reach SwingSage, so it cannot tell you about this swing."}
        </Text>
      </View>
    );
  }

  return <ReportScreen swing={swing} onDelete={onDelete} />;
}

/** The review shape: the report sheet over the live player layer (the mockup's video-open). */
function ReportScreen({
  swing,
  onDelete,
}: {
  swing: NonNullable<ReturnType<typeof useSwing>["swing"]>;
  onDelete: () => Promise<void>;
}) {
  const navigation = useAppNavigation();
  const t = useTheme();
  const report = useReport(swing.id, null, true);
  const { starred, toggle } = useStarred(swing.id);
  const { state: listState } = useSwings();
  const scrollRef = useRef<{ scrollTo: (opts: { y: number; animated?: boolean }) => void }>(
    null,
  );

  const newestId = useMemo(() => {
    if (listState.kind !== "ok" || !listState.swings.length) return null;
    return [...listState.swings].sort((a, b) => createdAtMs(b) - createdAtMs(a))[0].id;
  }, [listState]);

  const vm = useMemo(
    () => (report.kind === "ok" ? buildReportViewModel(report.report, swing) : null),
    [report, swing],
  );

  const confirmDelete = useCallback(() => {
    Alert.alert("Delete this swing?", "Removes the video and its analysis, permanently.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void onDelete() },
    ]);
  }, [onDelete]);

  /** The analysed frame's shape off the LIST, so the stage is right on the first paint. */
  const sized =
    swing.views.find((v) => v.id === swing.primaryViewId && v.width && v.height) ??
    swing.views.find((v) => v.width && v.height);
  const aspectRatio = sized?.width && sized?.height ? sized.width / sized.height : null;

  const primaryView =
    swing.views.find((v) => v.id === swing.primaryViewId) ?? swing.views[0] ?? null;
  const viewPill = primaryView ? `${viewName(primaryView)} · ${swing.label}` : swing.label;

  /**
   * The sheet and the pill nav as stable elements: the video layer under them re-renders per
   * presented frame, and React must bail on this whole subtree by identity — a report screen
   * reconciling its scorecard at frame rate is exactly the churn the player rules forbid.
   */
  const stickyFooter = useMemo(
    () => (
      <SessionPillNav
        onNew={() => navigation.navigate("Record")}
        items={[
          {
            key: "back",
            label: "Back",
            tone: "end",
            onPress: () => navigation.goBack(),
            icon: (c) => <ArrowLeft size={18} color={c} strokeWidth={1.9} />,
          },
          {
            key: "delete",
            label: "Delete",
            tone: "danger",
            onPress: confirmDelete,
            testID: "report-delete",
            icon: (c) => <Trash2 size={18} color={c} strokeWidth={1.9} />,
          },
          {
            key: "favorite",
            label: "Favorite",
            active: starred,
            onPress: toggle,
            testID: "report-favorite",
            icon: (c) => (
              <Star size={18} color={c} strokeWidth={1.9} fill={starred ? c : "none"} />
            ),
          },
          {
            key: "latest",
            label: "Latest",
            tone: "latest",
            active: newestId === swing.id,
            onPress: () => {
              if (newestId && newestId !== swing.id) {
                navigation.navigate("SwingDetail", { id: newestId });
              }
            },
            icon: (c) => <ArrowDownToLine size={18} color={c} strokeWidth={1.9} />,
          },
        ]}
      />
    ),
    [navigation, confirmDelete, starred, toggle, newestId, swing.id],
  );

  const sheetContent = useMemo(
    () => (
      <View style={{ paddingBottom: 140 }}>
        {report.kind === "loading" || report.kind === "idle" ? (
          <ReportSkeleton />
        ) : null}
        {report.kind === "unreachable" ? (
          <View style={styles.sheetCentre}>
            <Text style={[styles.title, { color: t.text }]}>Cannot reach SwingSage</Text>
            <Text style={[styles.detail, { color: t.muted }]}>
              The report is safe — this device just could not connect.
            </Text>
          </View>
        ) : null}
        {report.kind === "not-scored" ? (
          <View style={styles.sheetCentre}>
            <Text style={[styles.title, { color: t.text }]}>Not scored</Text>
            <Text style={[styles.detail, { color: t.muted }]}>
              This swing was analysed without scoring, so there is no report to show — the
              picture above is still real.
            </Text>
          </View>
        ) : null}
        {vm != null && (
          <ReportSheet
            vm={vm}
            swingId={swing.id}
            onShowVideo={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          />
        )}
      </View>
    ),
    [report.kind, vm, swing.id, navigation, t],
  );

  return (
    <ReportVideoLayer
      testID="report"
      swingId={swing.id}
      frameCount={swing.frameCount}
      fps={swing.fps}
      aspectRatio={aspectRatio}
      score={typeof swing.overallScore === "number" ? swing.overallScore : null}
      tempoRatio={swing.tempoRatio}
      viewPill={viewPill}
      onBack={() => navigation.goBack()}
      sheetPresented={report.kind !== "loading" && report.kind !== "idle"}
      scrollRef={scrollRef}
      sheetStyle={{ backgroundColor: t.bgElevated }}
      stickyFooter={stickyFooter}
    >
      {sheetContent}
    </ReportVideoLayer>
  );
}

/**
 * The report's shape before the report: the header, indicator and focus rows as breathing
 * blocks, so the waiting card promises the layout it will keep. Shown in the sheet's peek
 * while it waits low, and never beside a spinner — one loading language per surface.
 */
function ReportSkeleton() {
  return (
    <View testID="report-skeleton" style={styles.skeleton}>
      <Skeleton style={{ width: 84, height: 10 }} />
      <Skeleton style={{ width: 190, height: 26, marginTop: 10 }} />
      <Skeleton style={{ width: 140, height: 12, marginTop: 8 }} />
      <Skeleton style={{ width: 220, height: 34, borderRadius: 17, marginTop: 16 }} />
      <View style={styles.skeletonRow}>
        <Skeleton style={{ width: 108, height: 128, borderRadius: 18 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton style={{ width: "58%", height: 10 }} />
          <Skeleton style={{ width: "100%", height: 16 }} />
          <Skeleton style={{ width: "92%", height: 16 }} />
          <Skeleton style={{ width: "70%", height: 16 }} />
        </View>
      </View>
      <Skeleton style={{ width: 210, height: 210, borderRadius: 105, alignSelf: "center", marginTop: 26 }} />
    </View>
  );
}

function viewName(v: { view: string }): string {
  return v.view === "face_on" ? "Face-on" : "Down the line";
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  sheetCentre: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 220 },
  skeleton: { paddingHorizontal: 16, paddingTop: 6 },
  skeletonRow: { flexDirection: "row", gap: 14, marginTop: 22 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
});
