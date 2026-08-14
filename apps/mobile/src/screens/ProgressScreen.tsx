import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChevronGlyph } from "../design/deck";
import { TrendLine } from "../design/gauges";
import { StatusMessage } from "../design/StatusMessage";
import { TopBar } from "../design/TopBar";
import { progressStats, sessionAverages } from "../features/progress/progressModel";
import { sessionize } from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * Progress — the long view. Home answers "what next"; this answers "is it working": all-time
 * records as tiles, then session averages across visits as the trend. Every number is from the
 * swing list; when there is not enough scored history for a claim, the section says so instead
 * of drawing a chart through two points of noise.
 */
export function ProgressScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { state, refreshing, refresh } = useSwings();
  const t = useTheme();
  const styles = useStyles();

  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings) : []),
    [state],
  );
  const stats = useMemo(
    () => (state.kind === "ok" ? progressStats(state.swings, sessions.length) : null),
    [state, sessions],
  );
  const series = useMemo(() => sessionAverages(sessions), [sessions]);

  return (
    <View style={styles.root}>
      <TopBar title="Progress" />

      {state.kind === "loading" ? (
        <View style={styles.centre}>
          <ActivityIndicator color={t.muted} />
        </View>
      ) : null}
      {state.kind === "signed-out" ? (
        <StatusMessage
          title="Your session has expired"
          detail="Sign out and sign back in to continue."
          onRetry={refresh}
        />
      ) : null}
      {state.kind === "unreachable" ? (
        <StatusMessage
          title="Cannot reach SwingSage"
          detail="Your swings are safe — this device just could not connect. Check your network."
          onRetry={refresh}
        />
      ) : null}

      {state.kind === "ok" && stats ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={t.muted}
              colors={[t.accent]}
            />
          }
        >
          {stats.totalSwings === 0 ? (
            <View style={styles.card} testID="progress-empty">
              <Text style={styles.emptyTitle}>Nothing to chart yet</Text>
              <Text style={styles.copy}>
                Your records and trends build themselves as you swing.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.tiles} testID="progress-tiles">
                <Tile
                  value={stats.best ? String(Math.round(stats.best.score)) : "—"}
                  label="All-time best"
                  accent
                />
                <Tile
                  value={stats.medianTempo ? `${stats.medianTempo.toFixed(1)}:1` : "—"}
                  label="Typical tempo"
                />
                <Tile value={String(stats.totalSwings)} label="Swings" />
                <Tile value={String(stats.totalSessions)} label="Sessions" />
              </View>

              <View style={styles.card}>
                <Text style={styles.tag}>Session averages</Text>
                {series.length >= 2 ? (
                  <>
                    <TrendLine
                      history={series.map((p) => p.average)}
                      height={64}
                      style={styles.trend}
                      accessibilityLabel={`Average score across your last ${series.length} sessions`}
                    />
                    <View style={styles.axisRow}>
                      <Text style={styles.axisLabel}>{dateOf(series[0].start)}</Text>
                      <Text style={styles.axisLabel}>{dateOf(series[series.length - 1].start)}</Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.copy} testID="progress-no-trend">
                    Two scored sessions make a trend — one more visit and this draws itself.
                  </Text>
                )}
              </View>

              {stats.best ? (
                <Pressable
                  testID="progress-watch-best"
                  accessibilityRole="button"
                  accessibilityLabel={`Watch your all-time best swing, scored ${Math.round(stats.best.score)}`}
                  onPress={() =>
                    navigation.navigate("SwingDetail", { id: (stats.best as { swingId: string }).swingId })
                  }
                  style={({ pressed }) => [styles.bestRow, pressed && styles.pressed]}
                >
                  <View style={styles.bestBody}>
                    <Text style={styles.bestTitle}>Watch your all-time best</Text>
                    <Text style={styles.bestMeta}>
                      {Math.round(stats.best.score)} · {dateOf(stats.best.at)}
                    </Text>
                  </View>
                  <ChevronGlyph size={9} color={t.accent} direction="right" weight={1.8} />
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Tile({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, accent && styles.tileAccent]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function dateOf(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 12 },
  pressed: { opacity: 0.6 },
  copy: { color: t.muted, fontSize: 13.5, lineHeight: 19 },
  tag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    borderRadius: 18,
    backgroundColor: t.panel,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 2,
  },
  tileValue: {
    color: t.text,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -1.2,
    fontVariant: ["tabular-nums"],
  },
  tileAccent: { color: t.accent },
  tileLabel: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  card: {
    borderRadius: 22,
    backgroundColor: t.panel,
    padding: 18,
    gap: 10,
  },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: "600" },
  trend: { marginHorizontal: 4, opacity: 0.9, marginTop: 4 },
  axisRow: { flexDirection: "row", justifyContent: "space-between" },
  axisLabel: { color: t.dim, fontSize: 10 },

  bestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: t.panel,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bestBody: { flex: 1, gap: 2 },
  bestTitle: { color: t.accent, fontSize: 14, fontWeight: "700" },
  bestMeta: { color: t.muted, fontSize: 12 },
}));
