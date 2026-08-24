import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingSummary } from "@swingsage/schema/contract";

import { APP_HEADER_BAR, AppHeader, Button, Chip, Delta, formFigureFor, HERO_PARALLAX, HERO_SHEET_GAP, HeroBackdrop, PerformanceCard, ScoreRing, SCROLL_PRESS_DELAY_MS, SheetOverBackdrop, StickThumb, SwingLoader, useChromeScroll, WAVE_NAV_CLEARANCE } from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { useAuth } from "../features/auth/AuthProvider";
import {
  aggregateFocus,
  latestDrill,
  latestSessionStats,
  type DrillPick,
  type FocusItem,
  type SessionStats,
} from "../features/home/homeModel";
import { useSessionReports } from "../features/home/useSessionReports";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { SpotlightRail } from "../features/spotlights/SpotlightRail";
import { createdAtMs, sessionize } from "../features/swings/sessions";
import { useSessions } from "../features/swings/useSessions";
import { useSwings } from "../features/swings/useSwings";
import { useAuthenticatedImage } from "../platform/useAuthenticatedImage";
import { useAppNavigation, type Navigation } from "../navigation";
import { COLORS, themedStyles, useTheme } from "../theme";

/**
 * Home — a coach talking to the golfer, not a dashboard.
 *
 * Built on the same hero-screen scaffold as the Swing Log, Progress and Coach
 * (`SheetOverBackdrop`): a gradient hero carrying the greeting and the last session's figures,
 * with the sheet of cards scrolling up over it.
 *
 * The screen's single dominant card (§07) is the `PerformanceCard`: the recommendation that
 * recurred across the last session, with one promise of a button — **see it on your swing** —
 * which opens the exemplar swing's report. The golfer's
 * own footage stays on the screen where it answers a question: the you-vs-pro compare strip
 * frozen at the coaching position, and the last session as a slider of swing photographs,
 * because "which one was the good one" is a question about pictures, not a table.
 *
 * Same honesty rules as ever: every number is measured, a section with no data is absent, and a
 * request that never reached the server renders as "cannot reach", never as an empty home.
 */

const NO_SWINGS: never[] = [];

export function HomeScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { firstName } = useAuth();
  const { state, refreshing, refresh } = useSwings();
  const t = useTheme();
  const styles = useStyles();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  // Measured once the hero lays out; until then a hand-tuned height keeps the first frame in
  // the right place, so nothing jumps.
  const [heroHeight, setHeroHeight] = useState<number | null>(null);
  const backdropHeight =
    heroHeight === null ? 300 + insets.top : heroHeight + 74 + HERO_SHEET_GAP;

  const { sessions: sessionRows } = useSessions();
  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings, sessionRows) : []),
    [state, sessionRows],
  );
  const stats = useMemo(() => latestSessionStats(sessions, Date.now()), [sessions]);

  const reports = useSessionReports(stats?.session.swings ?? NO_SWINGS);
  const focus = useMemo(
    () => (reports.kind === "ok" ? aggregateFocus(reports.reports) : []),
    [reports],
  );
  const drill = useMemo(
    () => (reports.kind === "ok" ? latestDrill(reports.reports) : null),
    [reports],
  );
  const lead: FocusItem | undefined = focus[0];
  const rail = focus.slice(1, 4);

  // The newest bundled reference swing — the "pro" half of the compare strip. Ready only: a
  // reference mid-analysis has no artifact to freeze a frame from.
  const pro = useMemo(() => {
    if (state.kind !== "ok") return null;
    const refs = state.swings.filter((s) => s.referenceLabel && s.status === "ready");
    if (!refs.length) return null;
    return refs.reduce((a, b) => (createdAtMs(a) >= createdAtMs(b) ? a : b));
  }, [state]);

  const count = stats?.session.swings.length ?? 0;

  /**
   * The hero: who the golfer is, and how the session that just happened went. The figures live
   * up here rather than under the session rail below — one place for the numbers, and the rail
   * stays a row of pictures.
   */
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
        <Text style={styles.heroGreeting}>{firstName ? `Hey ${firstName}` : "Welcome back"}</Text>
        {state.kind === "ok" && stats !== null ? (
          <>
            <Text style={styles.heroEyebrow}>{stats.live ? "Today, so far" : "Last session"}</Text>
            <View style={styles.heroSummary}>
              <View style={styles.statRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{count}</Text>
                  <Text style={styles.statLabel}>{count === 1 ? "swing" : "swings"}</Text>
                </View>
                {stats.best !== null ? (
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{Math.round(stats.best)}</Text>
                    <Text style={styles.statLabel}>best</Text>
                  </View>
                ) : null}
              </View>
              {stats.average !== null ? (
                <ScoreRing score={Math.round(stats.average)} label="Average" size={88} />
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </HeroBackdrop>
  );

  return (
    <View style={styles.root}>
      <SheetOverBackdrop
        testID="home"
        backdrop={hero}
        backdropHeight={backdropHeight}
        parallax={HERO_PARALLAX}
        initialOffset={0}
        overlap={74}
        onScrollY={onChromeScroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={t.muted}
            colors={[t.cobalt]}
          />
        }
      >
        <View
          style={[
            styles.sheetContent,
            { paddingBottom: 28 + WAVE_NAV_CLEARANCE + insets.bottom },
          ]}
        >
          {state.kind === "loading" ? (
            <View style={styles.centre} testID="home-loading">
              <SwingLoader size={40} />
            </View>
          ) : null}

          {state.kind === "signed-out" ? (
            <StatusMessage
              title="Your session has expired"
              detail="Sign out and sign back in to continue."
              onRetry={refresh}
              retryTestID="home-retry"
            />
          ) : null}

          {state.kind === "unreachable" ? (
            <StatusMessage
              title="Cannot reach SwingSage"
              detail="Your swings are safe — this device just could not connect. Check your network."
              onRetry={refresh}
              retryTestID="home-retry"
            />
          ) : null}

          {state.kind === "ok" && stats === null ? (
            <View style={styles.empty} testID="home-empty">
              <Text style={styles.emptyTitle}>No swings yet</Text>
              <Text style={styles.emptyDetail}>
                Record a swing, or upload one you have already filmed — it will appear here once
                it has been analysed.
              </Text>
            </View>
          ) : null}

          {state.kind === "ok" && stats !== null ? (
            <>
              {/* The hero deck — dismissable feature/promo spotlights, first slot on purpose.
                  Replaces the stacked deep/stance intro cards, which live in it now. */}
              <SpotlightRail navigation={navigation} />
              {lead ? <FocusHero lead={lead} drill={drill} live={stats.live} navigation={navigation} /> : null}
              {lead && lead.checkpoint && pro && pro.id !== lead.exemplarId ? (
                <CompareStrip lead={lead} proId={pro.id} navigation={navigation} />
              ) : null}
              {rail.length > 0 ? <FocusRail items={rail} navigation={navigation} /> : null}
              <SessionBlock stats={stats} navigation={navigation} />
            </>
          ) : null}
        </View>
      </SheetOverBackdrop>

      <AppHeader
        hero
        chromePx={chromePx}
        bell={<NotificationBell hero onPress={() => navigation.navigate("Notifications")} />}
        onProfile={() => navigation.navigate("Profile")}
        profileTestID="home-profile"
      />
    </View>
  );
}

/** The deep link every focus door shares: the exemplar swing's report (the one player).
 *  Parking at the priority's checkpoint is deferred until the report player learns it —
 *  see the mobile-client decisions entry (2026-08-17). */
function openOnSwing(navigation: Navigation, item: FocusItem): void {
  navigation.navigate("SwingDetail", { id: item.exemplarId });
}

/** §07's dominant card: the recommendation as the screen's one performance card. */
function FocusHero({
  lead,
  drill,
  live,
  navigation,
}: {
  lead: FocusItem;
  drill: DrillPick | null;
  live: boolean;
  navigation: Navigation;
}) {
  // The golfer's name is the hero's greeting now — repeating it on the card was the same
  // sentence twice on one screen.
  const greeting = live ? "Focus right now" : "Next time out";
  const styles = useStyles();

  return (
    <View testID="home-focus" style={styles.heroCardWrap}>
      {/* Title and cue render beside the topic's form thumbnail — every coach statement
          shows the correct form for the thing it names (Taylor, 2026-08-19). */}
      <PerformanceCard eyebrow={greeting}>
        <View style={styles.heroFocusRow}>
          <StickThumb
            figure={formFigureFor(`${lead.key} ${lead.label} ${lead.cue}`)}
            size={56}
            style={styles.heroThumb}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroFocusTitle}>{lead.label}</Text>
            {lead.cue ? <Text style={styles.heroFocusCue}>{lead.cue}</Text> : null}
          </View>
        </View>
        {lead.reportCount >= 2 && lead.seenIn >= 2 ? (
          <Text style={styles.heroSeen}>
            Seen in {lead.seenIn} of {lead.reportCount} scored swings
          </Text>
        ) : null}
        <View style={styles.heroActions}>
          <Button
            variant="performance"
            label="See it on your swing"
            testID="home-see-it"
            onPress={() => openOnSwing(navigation, lead)}
          />
          {drill ? (
            <Chip
              translucent
              label={`✦ ${drill.title}${drill.dose ? ` · ${drill.dose}` : ""}`}
              style={styles.drillChip}
            />
          ) : null}
        </View>
      </PerformanceCard>
    </View>
  );
}

/**
 * You vs pro, frozen at the same coaching position — the moment the top tip is about.
 *
 * Both halves come from the `/frame` route resolved through each artifact's own `checkpoints`
 * table, so "the top" is P4 in both clips regardless of length or frame rate — the same
 * compare-by-position rule the player's compare panel lives by (never by frame, never by time).
 * If either still cannot load (a swing analysed before the route existed, no reference artifact)
 * the strip removes itself: half a comparison is not a comparison.
 */
function CompareStrip({
  lead,
  proId,
  navigation,
}: {
  lead: FocusItem;
  proId: string;
  navigation: Navigation;
}) {
  const cp = encodeURIComponent(lead.checkpoint as string);
  const you = useAuthenticatedImage(`swings/${lead.exemplarId}/frame?checkpoint=${cp}`);
  const proImg = useAuthenticatedImage(`swings/${proId}/frame?checkpoint=${cp}`);
  const [broken, setBroken] = useState(false);
  const styles = useStyles();
  if (broken) return null;

  const at = lead.checkpointLabel ? ` at ${lead.checkpointLabel.toLowerCase()}` : "";
  return (
    <Pressable
      testID="home-compare"
      accessibilityRole="button"
      accessibilityLabel={`You versus pro${at}. ${lead.cue}`}
      onPress={() => openOnSwing(navigation, lead)}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      style={({ pressed }) => [styles.compare, pressed && styles.pressed]}
    >
      <View style={overPhoto.compareRow}>
        <View style={overPhoto.compareHalf}>
          {you ? (
            <Image
              source={you}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              onError={() => setBroken(true)}
            />
          ) : null}
          <View style={overPhoto.compareChip}>
            <Text style={overPhoto.compareChipText}>You</Text>
          </View>
        </View>
        <View style={overPhoto.compareDivider} />
        <View style={overPhoto.compareHalf}>
          {proImg ? (
            <Image
              source={proImg}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              onError={() => setBroken(true)}
            />
          ) : null}
          <View style={[overPhoto.compareChip, overPhoto.compareChipPro]}>
            <Text style={overPhoto.compareChipTextPro}>Pro</Text>
          </View>
        </View>
      </View>
      <View style={styles.compareBar}>
        <Text style={styles.compareTag}>
          You vs pro{at}
        </Text>
        {lead.cue ? (
          <Text style={styles.compareCue} numberOfLines={2}>
            {lead.cue}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The rest of what recurred, as swipeable cards — each with the same on-your-swing door. */
function FocusRail({ items, navigation }: { items: FocusItem[]; navigation: Navigation }) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      testID="home-tips"
    >
      {items.map((item, i) => (
        <Pressable
          key={item.key}
          testID={`home-tip-${item.key}`}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}. ${item.cue}`}
          onPress={() => openOnSwing(navigation, item)}
          unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
          style={({ pressed }) => [styles.tipCard, pressed && styles.pressed]}
        >
          <View style={styles.tipHead}>
            <StickThumb figure={formFigureFor(`${item.key} ${item.label} ${item.cue}`)} size={48} />
            <Text style={styles.tipRank}>{i + 2}</Text>
          </View>
          <Text style={styles.tipTitle} numberOfLines={2}>
            {item.label}
          </Text>
          {item.cue ? (
            <Text style={styles.tipCue} numberOfLines={3}>
              {item.cue}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** The last session: its facts in one line, its swings as a slider of pictures. */
function SessionBlock({ stats, navigation }: { stats: SessionStats; navigation: Navigation }) {
  const styles = useStyles();
  const { session, best, deltaVsPrevious, analysing } = stats;

  return (
    <View testID="home-session">
      <View style={styles.sessionHead}>
        <View style={styles.sessionHeadBody}>
          {/* The date and what is still coming. Swings, best and average are the hero's —
              repeating them here was the same three numbers a scroll apart. */}
          <Text style={styles.sessionDate}>{dateOf(session.start)}</Text>
          {analysing > 0 ? (
            <Text style={styles.sessionMeta}>
              {analysing} still analysing
            </Text>
          ) : null}
        </View>
        {deltaVsPrevious !== null && deltaVsPrevious !== 0 ? (
          <View style={styles.deltaCol}>
            <Delta
              value={`${deltaVsPrevious > 0 ? "+" : "−"}${Math.abs(deltaVsPrevious)}`}
              direction={deltaVsPrevious > 0 ? "up" : "down"}
            />
            <Text style={styles.deltaCaption}>vs last time</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.slider}
        testID="home-session-rail"
      >
        {session.swings.map((swing, i) => (
          <SwingSlide
            key={swing.id}
            swing={swing}
            number={i + 1}
            isBest={
              best !== null &&
              typeof swing.overallScore === "number" &&
              Math.round(swing.overallScore) === Math.round(best)
            }
            onPress={() => navigation.navigate("SwingDetail", { id: swing.id })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function SwingSlide({
  swing,
  number,
  isBest,
  onPress,
}: {
  swing: SwingSummary;
  number: number;
  isBest: boolean;
  onPress: () => void;
}) {
  const thumb = useAuthenticatedImage(`swings/${swing.id}/thumb?poster=1`);
  const scored = swing.status === "ready" && typeof swing.overallScore === "number";
  const styles = useStyles();
  return (
    <Pressable
      testID={`home-swing-${swing.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Swing ${number}${
        scored ? `, scored ${Math.round(swing.overallScore as number)}` : ", not scored"
      }${isBest ? ", best of the session" : ""}`}
      onPress={onPress}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      style={({ pressed }) => [styles.slide, pressed && styles.pressed]}
    >
      {thumb ? (
        <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
      ) : null}
      <View style={overPhoto.slideScrim} />
      <Text style={overPhoto.slideNumber}>#{number}</Text>
      <View style={overPhoto.slideFoot}>
        {swing.status !== "ready" ? (
          <Text style={overPhoto.slidePending}>
            {swing.status === "failed" ? "analysis failed" : "analysing…"}
          </Text>
        ) : scored ? (
          <>
            <Text style={[overPhoto.slideScore, isBest && overPhoto.slideScoreBest]}>
              {Math.round(swing.overallScore as number)}
            </Text>
            {swing.band ? <Text style={overPhoto.slideBand}>{swing.band}</Text> : null}
          </>
        ) : (
          <Text style={overPhoto.slideUnscored}>not scored</Text>
        )}
      </View>
    </Pressable>
  );
}

function dateOf(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The photo scrim's ink — the dark theme's ground, so photos sit in the same world. */
const PHOTO_SCRIM = "rgba(6,19,31,";

/** The screen's chrome — everything drawn on the theme's own ground. */
const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  centre: { alignItems: "center", justifyContent: "center", padding: 24, minHeight: 220 },
  /* The sheet keeps NO horizontal padding — the cards carry their own 16, and the two
     horizontal rails have to reach the sheet's edges. */
  sheetContent: { paddingTop: 12, gap: 16 },
  pressed: { opacity: 0.75 },

  /* The hero — the same gradient ground as the log, Progress and Coach. */
  heroContent: { paddingHorizontal: 18 },
  heroGreeting: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 30,
    lineHeight: displayLine(30),
    letterSpacing: -0.6,
  },
  heroEyebrow: {
    marginTop: 18,
    color: "rgba(255,255,255,0.74)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.62,
    textTransform: "uppercase",
  },
  heroSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 12,
  },
  statRow: { flex: 1, minWidth: 0, flexDirection: "row", gap: 10 },
  /* Hero glass square — the log's white-10 tile, so the two heroes are one material. */
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

  empty: { alignItems: "center", gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    textAlign: "center",
  },
  emptyDetail: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },

  heroCardWrap: { marginHorizontal: 16 },
  /* The focus row inside the performance card — the topic's form thumb beside the words.
     Type mirrors the card's own title/body scale, one step down to fit beside the thumb. */
  heroFocusRow: { flexDirection: "row", gap: 14, marginTop: 12, alignItems: "flex-start" },
  heroThumb: { marginTop: 2 },
  heroFocusTitle: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 24,
    lineHeight: displayLine(24),
    letterSpacing: -0.48,
  },
  heroFocusCue: {
    marginTop: 8,
    color: "rgba(255,255,255,0.65)",
    fontFamily: FONT_BODY.regular,
    fontSize: 12,
    lineHeight: 19,
  },
  heroSeen: {
    marginTop: 10,
    color: "rgba(255,255,255,0.55)",
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
  },
  heroActions: { gap: 10, marginTop: 18, alignItems: "flex-start" },
  drillChip: { maxWidth: "100%" },

  compare: {
    marginHorizontal: 16,
    borderRadius: 11,
    backgroundColor: t.surface,
    overflow: "hidden",
  },
  compareBar: { paddingHorizontal: 14, paddingVertical: 11, gap: 3 },
  compareTag: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.26,
    textTransform: "uppercase",
  },
  compareCue: {
    color: t.text,
    fontFamily: FONT_BODY.semiBold,
    fontSize: 12.5,
    lineHeight: 18,
  },

  rail: { paddingHorizontal: 16, gap: 10 },
  tipCard: {
    width: 236,
    borderRadius: 11,
    backgroundColor: t.surface,
    padding: 16,
    gap: 5,
  },
  tipHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  tipRank: { color: t.lavender, fontFamily: FONT_DISPLAY.black, fontSize: 13 },
  tipTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    lineHeight: displayLine(15),
  },
  tipCue: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 16.5 },

  sessionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sessionHeadBody: { flex: 1, gap: 3 },
  sessionDate: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    lineHeight: displayLine(24),
    letterSpacing: -0.48,
  },
  sessionMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  deltaCol: { alignItems: "flex-end", gap: 3 },
  deltaCaption: {
    color: t.muted2,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.84,
    textTransform: "uppercase",
  },

  slider: { paddingHorizontal: 16, gap: 10 },
  slide: {
    width: 150,
    height: 200,
    borderRadius: 12,
    backgroundColor: t.surface,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
}));

/**
 * Everything drawn OVER a photograph. A photo is its own dark surface in both themes — the
 * same rule that keeps the player dark — so these use the fixed dark palette (`COLORS`),
 * never theme tokens.
 */
const overPhoto = StyleSheet.create({
  compareRow: { flexDirection: "row", height: 190 },
  compareHalf: { flex: 1, backgroundColor: COLORS.bg },
  compareDivider: { width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.2)" },
  compareChip: {
    position: "absolute",
    top: 10,
    left: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: `${PHOTO_SCRIM}0.72)`,
  },
  compareChipPro: {
    backgroundColor: "rgba(45,240,251,0.16)",
  },
  compareChipText: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.08,
    textTransform: "uppercase",
  },
  compareChipTextPro: {
    color: COLORS.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.08,
    textTransform: "uppercase",
  },

  slideScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    backgroundColor: `${PHOTO_SCRIM}0.62)`,
  },
  slideNumber: {
    position: "absolute",
    top: 10,
    left: 12,
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
  },
  slideFoot: { padding: 12, gap: 0 },
  slideScore: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    letterSpacing: -0.52,
    fontVariant: ["tabular-nums"],
  },
  slideScoreBest: { color: COLORS.aqua },
  slideBand: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    textTransform: "capitalize",
  },
  slideUnscored: { color: COLORS.dim, fontFamily: FONT_BODY.regular, fontSize: 11 },
  slidePending: { color: COLORS.amber, fontFamily: FONT_BODY.regular, fontSize: 11 },
});
