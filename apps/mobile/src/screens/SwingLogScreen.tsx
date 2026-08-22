import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { Plus, Upload } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CountUp } from "../features/session/CountUp";
import { SessionArrivalCard } from "../features/session/SessionArrivalCard";
import { takeSessionArrival } from "../features/session/sessionArrival";

import {
  APP_HEADER_BAR,
  AppHeader,
  HeroBackdrop,
  ScoreRing,
  HERO_PARALLAX,
  HERO_SHEET_GAP,
  SheetOverBackdrop,
  useChromeScroll,
  WAVE_NAV_CLEARANCE,
} from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { LatestSessionCard } from "../features/swings/LatestSessionCard";
import { SessionRow } from "../features/swings/SessionRow";
import { logStats, sessionStats, sessionize } from "../features/swings/sessions";
import { useSessions } from "../features/swings/useSessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * §21's swing log, built on the Ideal Swing hero-screen scaffold (`log-v2-*`): the
 * performance hero — the whole log's stat tiles and all-swings average — rides behind a
 * sheet carrying the LATEST session card and the older-session list. (Taylor 2026-08-17
 * declutter: the mockup's week strip and "This week" head row are gone — the session dates
 * below already tell the when.) Every value on screen is real.
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
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  // Measured once the hero lays out; until then the previous hand-tuned height keeps the first
  // frame in the right place, so nothing jumps.
  const [heroHeight, setHeroHeight] = useState<number | null>(null);
  const backdropHeight =
    heroHeight === null ? 330 + insets.top : heroHeight + 74 + HERO_SHEET_GAP;

  const { sessions: sessionRows } = useSessions();
  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings, sessionRows) : []),
    [state, sessionRows],
  );
  const older = sessions.slice(1);
  /**
   * The import door's seam. Picking clips, confirming view/handedness and minting the session
   * they land in are session-mode step 06 — this holds the shape so the button's placement is
   * settled before the flow behind it exists.
   */
  const onImport = () => {};
  const log = useMemo(() => logStats(sessions), [sessions]);

  // A session just ended (D61): play the arrival — a saving beat, then the card springs in
  // and the counts roll up. Consumed once from the staging seam; an ordinary visit has none.
  // UI phase: the counts and card are the arrival's own numbers layered over the real stats
  // until the session rows persist (session-mode step 05).
  const [arrival] = useState(takeSessionArrival);
  /**
   * The mode of the session just ended, onto the newest row.
   *
   * It is the ONE session whose mode is known — the golfer picked it minutes ago and it came
   * through the arrival seam. Every older session stays null rather than being assigned a
   * plausible default, which would be a made-up claim about their own practice.
   */
  const latest = useMemo(
    () =>
      sessions[0] && arrival
        ? { ...sessions[0], sessionType: arrival.sessionType }
        : sessions[0],
    [arrival, sessions],
  );
  const [arrivalPhase, setArrivalPhase] = useState<"saving" | "landed" | null>(
    arrival ? "saving" : null,
  );
  useEffect(() => {
    if (arrivalPhase !== "saving") return;
    const settle = setTimeout(() => setArrivalPhase("landed"), 1100);
    return () => clearTimeout(settle);
  }, [arrivalPhase]);
  const landed = arrivalPhase === "landed";
  const shownSessions = log.sessions + (landed ? 1 : 0);
  const shownSwings = log.swings + (landed && arrival ? arrival.swings : 0);

  const hero = (
    <HeroBackdrop overscan={HERO_PARALLAX.cap}>
      <View
        style={[styles.heroContent, { paddingTop: insets.top + APP_HEADER_BAR }]}
        // The sheet's resting edge is derived from this, so the gap below the hero is the same
        // on every hero screen instead of falling out of a hand-tuned backdrop height.
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeroHeight((prev) => (prev === h ? prev : h));
        }}
      >
        {/* The brand + profile door live in the floating AppHeader above; the hero keeps
            the screen's own title and the log's two capture doors (Taylor 2026-08-20).
            They sit on the TITLE row rather than in the header because they belong to this
            screen, not to the app chrome — and because the log is where a golfer arrives
            holding clips they have not put anywhere yet. */}
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroTitle}>Swings</Text>
          <View style={styles.heroActions}>
            <HeroAction
              testID="swing-log-record"
              label="Record"
              icon={(c) => <Plus size={15} color={c} strokeWidth={2.6} />}
              onPress={() => navigation.navigate("Record")}
            />
            <HeroAction
              testID="swing-log-upload"
              label="Upload"
              icon={(c) => <Upload size={14} color={c} strokeWidth={2.4} />}
              onPress={onImport}
            />
          </View>
        </View>
        {/* .log-v2-summary — the whole log's story (Taylor 2026-08-17): session + swing
            counts left, the all-swings average in the ring. The latest session's own numbers
            live in the card below; repeating them here was the repetition rule's case. */}
        {latest ? (
          <View style={styles.heroSummary}>
            {/* Counts as STAT TILES (Taylor 2026-08-17) — the number in a glass square with
                its label beneath, so the row reads as figures rather than a title. */}
            <View style={styles.statRow}>
              <View style={styles.statBox}>
                <CountUp value={shownSessions} style={styles.statValue} />
                <Text style={styles.statLabel}>
                  {shownSessions === 1 ? "session" : "sessions"}
                </Text>
              </View>
              <View style={styles.statBox}>
                <CountUp value={shownSwings} style={styles.statValue} />
                <Text style={styles.statLabel}>{shownSwings === 1 ? "swing" : "swings"}</Text>
              </View>
            </View>
            {log.avg !== null && <ScoreRing score={log.avg} label="Average" size={88} />}
          </View>
        ) : null}
        {/* .log-v2-track */}
        {log.avg != null && log.best != null && log.best > 0 ? (
          <View style={styles.heroTrack}>
            <View
              style={[
                styles.heroTrackFill,
                { width: `${Math.min(100, Math.round((log.avg / log.best) * 100))}%` },
              ]}
            />
          </View>
        ) : null}
      </View>
    </HeroBackdrop>
  );

  return (
    <View style={{ flex: 1 }}>
    <SheetOverBackdrop
      testID="swing-log"
      backdrop={hero}
      backdropHeight={backdropHeight}
      parallax={HERO_PARALLAX}
      // 0 = the sheet rests at the backdrop's edge on first paint. The mockup's 170 rode the
      // card halfway up the hero, which read as the sheet covering the screen (Taylor 2026-08-17).
      initialOffset={0}
      overlap={74}
      onScrollY={onChromeScroll}
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
      <View style={[styles.sheetContent, { paddingBottom: 120 + WAVE_NAV_CLEARANCE + insets.bottom }]}>
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

        {state.kind === "ok" && arrivalPhase != null && arrival ? (
          <SessionArrivalCard
            phase={arrivalPhase}
            title={arrival.title}
            swings={arrival.swings}
          />
        ) : null}

        {state.kind === "ok" && sessions.length === 0 && arrivalPhase == null ? (
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
            <LatestSessionCard
              session={latest}
              onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
            />
            {/* .log-v2-session-list — every row expands to the swings inside it. */}
            {older.length > 0 && (
              <View style={styles.olderList}>
                {older.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}
      </View>
    </SheetOverBackdrop>

    <AppHeader
      hero
      chromePx={chromePx}
      bell={<NotificationBell hero onPress={() => navigation.navigate("Notifications")} />}
      onProfile={() => navigation.navigate("Profile")}
      profileTestID="swing-log-profile"
    />
    </View>
  );
}

/**
 * A hero glass pill — the log's capture doors, in the stat tiles' white-10 glass so the title
 * row reads as one material. Icon AND word: two adjacent doors that both add a swing are only
 * distinguishable if each says which one it is, and a bare "+" beside a bare arrow does not.
 */
function HeroAction({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: (color: string) => ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.heroAction, pressed && styles.heroActionPressed]}
    >
      {icon(t.onDark)}
      <Text style={styles.heroActionLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  heroContent: { paddingHorizontal: 18 },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  /* .log-v2-top h3 — 30 at Sora's -2% */
  heroTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 30,
    lineHeight: displayLine(30),
    letterSpacing: -0.6,
  },
  heroActions: { flexDirection: "row", gap: 7 },
  heroAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 31,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  heroActionPressed: { backgroundColor: "rgba(255,255,255,0.18)" },
  heroActionLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    // Taller than the size on purpose — Android clips descenders to the line box (SessionNav).
    lineHeight: 14,
    letterSpacing: 0.1,
  },
  /* .log-v2-summary */
  heroSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 22,
  },
  statRow: { flex: 1, minWidth: 0, flexDirection: "row", gap: 10 },
  /* Hero glass square — the white-10 tile the mockup's hero chips use. */
  statBox: {
    minWidth: 68,
    height: 68,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  statValue: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    lineHeight: 27,
    letterSpacing: -0.52,
  },
  statLabel: {
    color: "rgba(180,235,238,1)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.84,
    textTransform: "uppercase",
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

  /* .log-v2-session rows */
  olderList: { marginTop: 14, gap: 10 },

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
}));
