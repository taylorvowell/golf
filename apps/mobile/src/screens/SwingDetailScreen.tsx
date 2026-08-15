import { useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import {
  ArrowDownToLine,
  ArrowLeft,
  Play,
  Star,
  Trash2,
} from "lucide-react-native";

import { SessionPillNav, SheetOverBackdrop } from "../design/system";
import { ReportSheet } from "../features/report/ReportSheet";
import { buildReportViewModel } from "../features/report/selectors";
import { SwingPlayer } from "../features/player/SwingPlayer";
import { useReport } from "../features/player/useReport";
import { createdAtMs } from "../features/swings/sessions";
import { useStarred } from "../features/swings/useStarred";
import { deleteSwing, useSwing, useSwings } from "../features/swings/useSwings";
import { useAuthenticatedImage } from "../platform/useAuthenticatedImage";
import { useAppNavigation } from "../navigation";
import { COLORS, useTheme } from "../theme";

/**
 * One swing, two shapes:
 *
 * - **Review** (from the log): the Ideal Swing report — the sheet from the reference mockup
 *   riding over a full-bleed picture layer. This step the layer is the swing's still frame;
 *   step 07 replaces it with the live frame-accurate player (the mockup's video-open state).
 * - **After-swing / checkpoint** (`afterSwing`, `checkpoint`): the existing `SwingPlayer`
 *   surface unchanged — the just-recorded flow and Home's "see it on your swing" both need
 *   the parked picture, which stays the player's job until step 07 joins the two.
 */

export interface SwingDetailScreenProps {
  id: string;
  afterSwing?: boolean;
  checkpoint?: string | null;
}

export function SwingDetailScreen({
  id,
  afterSwing = false,
  checkpoint = null,
}: SwingDetailScreenProps) {
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

  if (afterSwing || checkpoint) {
    return (
      <AfterSwingPlayer
        swing={swing}
        afterSwing={afterSwing}
        checkpoint={checkpoint}
        history={
          state.kind === "ok"
            ? state.swings
                .filter(
                  (s) =>
                    typeof s.overallScore === "number" && s.createdAt <= swing.createdAt,
                )
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((s) => s.overallScore as number)
                .slice(-5)
            : undefined
        }
        onDelete={onDelete}
      />
    );
  }

  return <ReportScreen swing={swing} onDelete={onDelete} />;
}

/** The review shape: the report sheet over the (for now, still) picture layer. */
function ReportScreen({
  swing,
  onDelete,
}: {
  swing: NonNullable<ReturnType<typeof useSwing>["swing"]>;
  onDelete: () => Promise<void>;
}) {
  const navigation = useAppNavigation();
  const t = useTheme();
  const { height } = useWindowDimensions();
  const report = useReport(swing.id, null, true);
  const { starred, toggle } = useStarred(swing.id);
  const { state: listState } = useSwings();
  const backdropImage = useAuthenticatedImage(`swings/${swing.id}/thumb?poster=1`);
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

  // The full-bleed picture layer — the mockup's video canvas, still until step 07.
  const backdrop = (
    <View style={{ flex: 1, backgroundColor: "#081426" }}>
      {backdropImage ? (
        <Image
          source={backdropImage}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : null}
      {/* A quiet scrim so the still never fights the sheet's edge. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(8,20,38,0.25)" }]} />
      {/* .report-v2-center-play — inert until the live player lands behind it. */}
      <View
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          marginLeft: -36,
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Play size={26} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
      </View>
    </View>
  );

  return (
    <SheetOverBackdrop
      testID="report"
      backdrop={backdrop}
      backdropHeight={height}
      parallax={{ factor: 0.18, cap: 64 }}
      initialOffset={Math.round(height * 0.55)}
      overlap={92}
      scrollRef={scrollRef}
      sheetStyle={{ backgroundColor: t.bgElevated }}
      stickyFooter={
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
                <Star
                  size={18}
                  color={c}
                  strokeWidth={1.9}
                  fill={starred ? c : "none"}
                />
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
      }
    >
      <View style={{ paddingBottom: 140 }}>
        {report.kind === "loading" || report.kind === "idle" ? (
          <View style={styles.sheetCentre}>
            <ActivityIndicator color={t.muted} />
          </View>
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
            onBack={() => navigation.goBack()}
            onShowVideo={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          />
        )}
      </View>
    </SheetOverBackdrop>
  );
}

/** The just-recorded / parked-checkpoint shape — the existing player surface, unchanged. */
function AfterSwingPlayer({
  swing,
  afterSwing,
  checkpoint,
  history,
  onDelete,
}: {
  swing: NonNullable<ReturnType<typeof useSwing>["swing"]>;
  afterSwing: boolean;
  checkpoint: string | null;
  history: number[] | undefined;
  onDelete: () => Promise<void>;
}) {
  const navigation = useAppNavigation();
  const scored = typeof swing.overallScore === "number";
  const sized =
    swing.views.find((v) => v.id === swing.primaryViewId && v.width && v.height) ??
    swing.views.find((v) => v.width && v.height);
  const aspectRatio = sized?.width && sized?.height ? sized.width / sized.height : null;

  return (
    <SwingPlayer
      swingId={swing.id}
      frameCount={swing.frameCount}
      fps={swing.fps}
      title={swing.label}
      subtitle={formatDate(swing.createdAt)}
      score={scored ? (swing.overallScore as number) : null}
      tempoRatio={swing.tempoRatio}
      aspectRatio={aspectRatio}
      onBack={navigation.canGoBack() ? navigation.goBack : undefined}
      mode={afterSwing ? "session" : "review"}
      initialCheckpoint={checkpoint}
      band={swing.band}
      history={history}
      onDelete={onDelete}
    >
      <View testID="swing-detail" style={styles.panel}>
        <Row
          label="Score"
          value={
            scored
              ? `${Math.round(swing.overallScore as number)}${swing.band ? ` · ${swing.band}` : ""}`
              : "Not scored"
          }
        />
        <Row label="Angles" value={swing.views.map(viewName).join(", ") || "—"} />
        <Row label="Frames" value={`${swing.frameCount} at ${swing.fps} fps`} />
        <Row label="Pose coverage" value={`${Math.round(swing.poseCoverage * 100)}%`} />
        <Row label="Club trace" value={swing.traceEnabled ? "Available" : "Not available"} />
        {swing.tempoRatio ? (
          <Row label="Tempo" value={`${swing.tempoRatio.toFixed(1)} : 1`} />
        ) : null}
      </View>
    </SwingPlayer>
  );
}

function formatDate(epoch: number): string {
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function viewName(v: { view: string }): string {
  return v.view === "face_on" ? "Face-on" : "Down the line";
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  sheetCentre: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 220 },
  panel: { paddingVertical: 2 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 9,
  },
  rowLabel: { color: COLORS.muted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
});
