import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BRAND,
  HeroBackdrop,
  ScoreRing,
  SheetOverBackdrop,
  WeekStrip,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { LatestSessionCard } from "../features/swings/LatestSessionCard";
import {
  heroHeadline,
  sessionStats,
  sessionTitle,
  sessionize,
  weekMap,
} from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * §21's swing log, rebuilt as the Ideal Swing reference's hero screen (`log-v2-*`): the
 * performance hero rides behind a sheet that carries the week strip, the LATEST session card
 * and the older-session list. The mockup's layout is law; every value on screen is real.
 *
 * The invariant that survives every rewrite: a request that never reached the server renders
 * as "cannot reach SwingSage", **never** as an empty log — now inside the sheet, same test.
 */
export function SwingLogScreen() {
  const navigation = useAppNavigation();
  const { state, refreshing, refresh } = useSwings();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();

  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings) : []),
    [state],
  );
  const latest = sessions[0];
  const older = sessions.slice(1);
  const now = Date.now();
  const week = useMemo(() => weekMap(sessions, now), [sessions, now]);
  const latestStats = latest ? sessionStats(latest) : null;
  const weekSwings = useMemo(() => {
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return sessions
      .filter((s) => s.end >= weekAgo)
      .reduce((sum, s) => sum + s.swings.length, 0);
  }, [sessions, now]);

  const hero = (
    <HeroBackdrop>
      <View style={[styles.heroContent, { paddingTop: insets.top + 12 }]}>
        {/* .log-v2-top — brand + title left, the more-circle (the profile door) right. */}
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroBrand}>{BRAND}</Text>
            <Text style={styles.heroTitle}>Swing Log</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => navigation.navigate("Profile")}
            hitSlop={8}
            style={({ pressed }) => [styles.heroMore, pressed && styles.pressed]}
          >
            <View style={styles.heroMoreDots}>
              <View style={styles.heroMoreDot} />
              <View style={styles.heroMoreDot} />
              <View style={styles.heroMoreDot} />
            </View>
          </Pressable>
        </View>
        {/* .log-v2-summary */}
        {latest && latestStats ? (
          <View style={styles.heroSummary}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroEyebrow}>
                {new Date(latest.start).toLocaleDateString(undefined, { weekday: "long" })}{" "}
                · {latest.swings.length}{" "}
                {latest.swings.length === 1 ? "swing" : "swings"}
              </Text>
              <Text style={styles.heroHeadline}>{heroHeadline(sessions, now)}</Text>
              {latestStats.avg !== null && (
                <Text style={styles.heroMeta}>
                  Average {latestStats.avg}
                  {latestStats.improvement !== null
                    ? ` · ${latestStats.improvement >= 0 ? "+" : ""}${latestStats.improvement} improvement`
                    : ""}
                  {latestStats.best !== null ? ` · ${latestStats.best} best` : ""}
                </Text>
              )}
            </View>
            {latestStats.avg !== null && (
              <ScoreRing score={latestStats.avg} label="Average" size={88} />
            )}
          </View>
        ) : null}
        {/* .log-v2-track */}
        {latestStats?.avg != null && latestStats.best != null && latestStats.best > 0 ? (
          <View style={styles.heroTrack}>
            <View
              style={[
                styles.heroTrackFill,
                {
                  width: `${Math.min(100, Math.round((latestStats.avg / latestStats.best) * 100))}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    </HeroBackdrop>
  );

  return (
    <SheetOverBackdrop
      testID="swing-log"
      backdrop={hero}
      backdropHeight={340 + insets.top}
      parallax={{ factor: 0.22, cap: 72 }}
      initialOffset={170}
      overlap={74}
      refreshControl={
        <RefreshControl
          testID="swing-log-refresh"
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={t.muted}
          colors={[t.cobalt]}
        />
      }
    >
      <View style={[styles.sheetContent, { paddingBottom: 120 + insets.bottom }]}>
        {state.kind === "loading" ? (
          <View style={styles.centre} testID="swing-log-loading">
            <ActivityIndicator color={t.muted} />
          </View>
        ) : null}

        {state.kind === "signed-out" ? (
          <StatusMessage
            title="Your session has expired"
            detail="Sign out and sign back in to continue."
            onRetry={refresh}
            retryTestID="swing-log-retry"
          />
        ) : null}

        {state.kind === "unreachable" ? (
          <StatusMessage
            title="Cannot reach SwingSage"
            detail="Your swings are safe — this device just could not connect. Check your network."
            onRetry={refresh}
            retryTestID="swing-log-retry"
          />
        ) : null}

        {state.kind === "ok" && sessions.length === 0 ? (
          <View style={styles.centre}>
            <Text style={styles.emptyTitle}>No swings yet</Text>
            <Text style={styles.emptyDetail}>
              Recording and upload arrive with the capture release. Swings you add will
              appear here.
            </Text>
          </View>
        ) : null}

        {state.kind === "ok" && latest ? (
          <>
            {/* .log-v2-sheet-head */}
            <View style={styles.sheetHead}>
              <Text style={styles.sheetHeadLabel}>This week</Text>
              <Text style={styles.sheetHeadMeta}>
                {weekSwings} {weekSwings === 1 ? "swing" : "swings"}
              </Text>
            </View>
            <WeekStrip days={week} style={{ marginTop: 12 }} />
            <LatestSessionCard
              session={latest}
              onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
            />
            {/* .log-v2-session-list */}
            {older.length > 0 && (
              <View style={styles.olderList}>
                {older.map((session) => {
                  const stats = sessionStats(session);
                  const openId = session.swings[session.swings.length - 1].id;
                  return (
                    <Pressable
                      key={session.id}
                      testID={`session-${session.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${sessionTitle(session)}, ${session.swings.length} swings${
                        stats.avg !== null ? `, average ${stats.avg}` : ""
                      }`}
                      onPress={() => navigation.navigate("SwingDetail", { id: openId })}
                      style={({ pressed }) => [styles.olderRow, pressed && styles.pressed]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.olderDate}>
                          {new Date(session.start).toLocaleDateString(undefined, {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                        <Text style={styles.olderTitle}>{sessionTitle(session)}</Text>
                        <Text style={styles.olderMeta}>
                          {session.swings.length}{" "}
                          {session.swings.length === 1 ? "swing" : "swings"}
                          {stats.improvement !== null
                            ? ` · ${stats.improvement >= 0 ? "+" : ""}${stats.improvement} overall`
                            : ""}
                        </Text>
                      </View>
                      {stats.avg !== null ? (
                        <View style={styles.olderAvgBox}>
                          <Text style={styles.olderAvgValue}>{stats.avg}</Text>
                          <Text style={styles.olderAvgLabel}>Avg</Text>
                        </View>
                      ) : (
                        <Text style={styles.olderNotScored}>Not scored</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {/* Dev door into the after-swing screen until capture navigates there itself. */}
            {__DEV__ && (
              <Pressable
                testID="open-after-swing"
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate("SwingDetail", {
                    id: latest.swings[latest.swings.length - 1].id,
                    afterSwing: true,
                  })
                }
                style={({ pressed }) => [styles.afterSwingLink, pressed && styles.pressed]}
              >
                <Text style={styles.afterSwingLinkText}>Preview the after-swing screen</Text>
              </Pressable>
            )}
          </>
        ) : null}
      </View>
    </SheetOverBackdrop>
  );
}

const useStyles = themedStyles((t) => ({
  heroContent: { paddingHorizontal: 18 },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  /* .log-v2-more — 42px cobalt circle, three dots. */
  heroMore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
    ...t.shadowCobalt,
  },
  heroMoreDots: { flexDirection: "row", gap: 3.5 },
  heroMoreDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: t.onDark,
  },
  /* .log-v2-brand */
  heroBrand: {
    color: "rgba(180,235,238,1)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.62,
    textTransform: "uppercase",
  },
  /* .log-v2-top h3 — 30/900/-5% */
  heroTitle: {
    marginTop: 6,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 30,
    lineHeight: 30,
    letterSpacing: -1.5,
  },
  /* .log-v2-summary */
  heroSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 22,
  },
  heroEyebrow: {
    color: "rgba(180,235,238,1)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
  },
  heroHeadline: {
    marginTop: 8,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 24,
    lineHeight: 24.5,
  },
  heroMeta: {
    marginTop: 9,
    color: "rgba(255,255,255,0.62)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 14,
  },
  /* .log-v2-track — fixed white-alpha on the hero, like the ScoreRing's track. */
  heroTrack: {
    height: 4,
    marginTop: 18,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  heroTrackFill: { height: "100%", backgroundColor: t.aqua },

  sheetContent: { paddingHorizontal: 16 },
  /* .log-v2-sheet-head */
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetHeadLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 12,
    letterSpacing: 0.96,
    textTransform: "uppercase",
  },
  sheetHeadMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 9 },

  /* .log-v2-session rows */
  olderList: { marginTop: 12, gap: 8 },
  olderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: t.surface,
    ...t.shadowSm,
  },
  olderDate: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  olderTitle: {
    marginTop: 5,
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
  },
  olderMeta: {
    marginTop: 4,
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 8,
  },
  olderAvgBox: {
    minWidth: 50,
    padding: 7,
    borderRadius: 5,
    backgroundColor: t.surface2,
    alignItems: "center",
  },
  olderAvgValue: {
    color: t.cobalt,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    lineHeight: 16,
  },
  olderAvgLabel: {
    marginTop: 3,
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 6,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  olderNotScored: { color: t.muted2, fontFamily: FONT_BODY.bold, fontSize: 9 },

  centre: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 260 },
  emptyTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 17,
    textAlign: "center",
  },
  emptyDetail: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 300,
  },
  pressed: { opacity: 0.6 },
  afterSwingLink: {
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: t.surface2,
    borderRadius: 12,
    marginTop: 14,
  },
  afterSwingLinkText: { color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 12 },
}));
