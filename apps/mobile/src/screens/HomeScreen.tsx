import { useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { Button, Chip, Delta, PerformanceCard, ScreenHeader } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
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
import { createdAtMs, sessionize } from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { useAuthenticatedImage } from "../platform/useAuthenticatedImage";
import { useAppNavigation, type Navigation } from "../navigation";
import { COLORS, themedStyles, useTheme } from "../theme";

/**
 * Home — a coach talking to the golfer, not a dashboard.
 *
 * The screen's single dominant card (§07) is the `PerformanceCard`: the recommendation that
 * recurred across the last session, with one promise of a button — **see it on your swing** —
 * which opens the player parked at the exact checkpoint the priority is about. The golfer's
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

  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings) : []),
    [state],
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

  return (
    <View style={styles.root}>
      <ScreenHeader brand onProfile={() => navigation.navigate("Profile")} />

      {state.kind === "loading" ? (
        <View style={styles.centre} testID="home-loading">
          <ActivityIndicator color={t.muted} />
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

      {state.kind === "ok" ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 28 + insets.bottom }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={t.muted}
              colors={[t.cobalt]}
            />
          }
        >
          {stats === null ? (
            <View style={styles.hero} testID="home-empty">
              <Text style={styles.heroTitle}>No swings yet</Text>
              <Text style={styles.heroDetail}>
                Recording and upload arrive with the capture release. Swings you add will appear
                here.
              </Text>
            </View>
          ) : (
            <>
              {lead ? (
                <FocusHero
                  lead={lead}
                  drill={drill}
                  live={stats.live}
                  firstName={firstName}
                  navigation={navigation}
                />
              ) : null}
              {lead && lead.checkpoint && pro && pro.id !== lead.exemplarId ? (
                <CompareStrip lead={lead} proId={pro.id} navigation={navigation} />
              ) : null}
              {rail.length > 0 ? <FocusRail items={rail} navigation={navigation} /> : null}
              <SessionBlock stats={stats} navigation={navigation} />
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** The deep link every focus door shares: the player, parked where the fault is visible. */
function openOnSwing(navigation: Navigation, item: FocusItem): void {
  navigation.navigate("SwingDetail", {
    id: item.exemplarId,
    afterSwing: true,
    ...(item.checkpoint ? { checkpoint: item.checkpoint } : {}),
  });
}

/** §07's dominant card: the recommendation as the screen's one performance card. */
function FocusHero({
  lead,
  drill,
  live,
  firstName,
  navigation,
}: {
  lead: FocusItem;
  drill: DrillPick | null;
  live: boolean;
  firstName: string | null;
  navigation: Navigation;
}) {
  const greeting = live
    ? firstName
      ? `${firstName} — focus right now`
      : "Focus right now"
    : firstName
      ? `Hey ${firstName} — next time out`
      : "Next time out";
  const styles = useStyles();

  return (
    <View testID="home-focus" style={styles.heroCardWrap}>
      <PerformanceCard eyebrow={greeting} title={lead.label} body={lead.cue || undefined}>
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
          style={({ pressed }) => [styles.tipCard, pressed && styles.pressed]}
        >
          <Text style={styles.tipRank}>{i + 2}</Text>
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
  const { session, live, best, average, deltaVsPrevious, analysing } = stats;
  const count = session.swings.length;
  const meta = [
    `${count} ${count === 1 ? "swing" : "swings"}`,
    best !== null ? `Best ${Math.round(best)}` : null,
    average !== null ? `Avg ${Math.round(average)}` : null,
    analysing > 0 ? `${analysing} analysing` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View testID="home-session">
      <View style={styles.sessionHead}>
        <View style={styles.sessionHeadBody}>
          <Text style={styles.tag}>{live ? "Today, so far" : "Last session"}</Text>
          <Text style={styles.sessionDate}>{dateOf(session.start)}</Text>
          <Text style={styles.sessionMeta}>{meta}</Text>
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
const PHOTO_SCRIM = "rgba(7,16,31,";

/** The screen's chrome — everything drawn on the theme's own ground. */
const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingTop: 4, gap: 16 },
  pressed: { opacity: 0.75 },
  tag: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  hero: { alignItems: "center", gap: 10, paddingVertical: 64, paddingHorizontal: 24 },
  heroTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    textAlign: "center",
  },
  heroDetail: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },

  heroCardWrap: { marginHorizontal: 16 },
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
    ...t.shadowSm,
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
    ...t.shadowSm,
  },
  tipRank: { color: t.lavender, fontFamily: FONT_DISPLAY.black, fontSize: 13 },
  tipTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    lineHeight: 18,
  },
  tipCue: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 16.5 },

  sessionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sessionHeadBody: { flex: 1, gap: 3 },
  sessionDate: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    lineHeight: 25,
    letterSpacing: -0.72,
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
    ...t.shadowSm,
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
    backgroundColor: "rgba(67,205,208,0.16)",
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
    letterSpacing: -0.91,
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
