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
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingSummary } from "@swingsage/schema/contract";

import { APP_HEADER_BAR, AppHeader, BrandIcon, Button, Chip, Delta, FORM_FIGURES, formFigureFor, HERO_PARALLAX, HERO_SHEET_GAP, HeroBackdrop, PerformanceCard, ScoreRing, SCROLL_PRESS_DELAY_MS, SheetOverBackdrop, StickThumb, SwingLoader, useChromeScroll, WAVE_NAV_CLEARANCE } from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { useAuth } from "../features/auth/AuthProvider";
import { Avatar } from "../features/profile/Avatar";
import { personaHasNoSwings, usePersona } from "../features/debug/persona";
import {
  aggregateFocus,
  latestDrill,
  latestSessionStats,
  type DrillPick,
  type FocusItem,
  type SessionStats,
} from "../features/home/homeModel";
import { isMockSwing, MOCK_DRILL_REEL, type DrillReelItem } from "../features/home/mockHome";
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

/** The get-started door's art: a swing looping behind the ask — the product doing the thing
 *  the card asks for, in motion. Bundled: this card exists precisely when there is no network
 *  history to lean on, so it must render instantly and offline. 720×720 — the card takes the
 *  clip's own square aspect so the whole picture shows, never a crop. */
const RECORD_SWING_CLIP = require("../../assets/videos/record-swing-video.mp4");

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
  const realStats = useMemo(() => latestSessionStats(sessions, Date.now()), [sessions]);

  // The debug persona is a REAL signed-in seeded account (features/debug/persona.tsx) — the
  // screen renders its data like any other user's. The one persona-aware surface left is the
  // drills reel below, which stays filler while the drill library is architected.
  const persona = usePersona();
  const stats = realStats;

  const reports = useSessionReports(realStats?.session.swings ?? NO_SWINGS);
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
  const proId = pro?.id ?? null;

  // The HERO always renders from REAL data — the mock feeds only the sheet's main content
  // below it (Taylor, 2026-08-24: the mockup must never touch the hero section).
  const heroStats = realStats;
  const count = heroStats?.session.swings.length ?? 0;

  /**
   * The hero: who the golfer is, the spotlight deck, and how the session that just happened
   * went. The gradient stays in the `backdrop` layer; ALL of the hero's content lives in
   * `backdropChrome` — the scaffold's rule for anything touchable up here, because content in
   * the backdrop layer is visible but the scroll view swallows its touches (the swing log's
   * dead Record door). The carousel would render and never swipe.
   */
  const hero = <HeroBackdrop overscan={HERO_PARALLAX.cap} />;
  const heroChrome = (
    <View
      style={[styles.heroContent, { paddingTop: insets.top + APP_HEADER_BAR + 14 }]}
      // The sheet's resting edge is derived from this, so the gap below the hero is the same
      // on every hero screen instead of falling out of a hand-tuned backdrop height.
      onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height);
        setHeroHeight((prev) => (prev === h ? prev : h));
      }}
    >
      <Text style={styles.heroGreeting}>
        {firstName ? `Hey ${firstName}, welcome back!` : "Welcome back!"}
      </Text>
      {/* The spotlight deck — under the greeting, per Taylor. Full-bleed against the hero's
          padding; on the EMPTY home too, deliberately (a golfer with no swings is exactly who
          the showcase cards are for). */}
      {state.kind === "ok" ? (
        <View style={styles.heroRail}>
          <SpotlightRail navigation={navigation} />
        </View>
      ) : null}
      {state.kind === "ok" && heroStats !== null ? (
        <>
          <Text style={styles.heroEyebrow}>{heroStats.live ? "Today, so far" : "Last session"}</Text>
          <View style={styles.heroSummary}>
            <View style={styles.statRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{count}</Text>
                <Text style={styles.statLabel}>{count === 1 ? "swing" : "swings"}</Text>
              </View>
              {heroStats.best !== null ? (
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{Math.round(heroStats.best)}</Text>
                  <Text style={styles.statLabel}>best</Text>
                </View>
              ) : null}
            </View>
            {heroStats.average !== null ? (
              <ScoreRing score={Math.round(heroStats.average)} label="Average" size={88} />
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <SheetOverBackdrop
        testID="home"
        backdrop={hero}
        backdropChrome={heroChrome}
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
              <GetStartedCard navigation={navigation} />
              <Text style={styles.emptyDetail}>
                Or upload a swing you have already filmed — it appears here once it has been
                analysed.
              </Text>
            </View>
          ) : null}

          {state.kind === "ok" && stats !== null ? (
            <>
              {lead ? <FocusHero lead={lead} drill={drill} live={stats.live} navigation={navigation} /> : null}
              {lead && lead.checkpoint && proId && proId !== lead.exemplarId ? (
                <CompareStrip lead={lead} proId={proId} navigation={navigation} />
              ) : null}
              {/* Mock-only while the drill library is architected — the section renders from
                  filler until real drill videos exist to feed it. */}
              {/* Also on account-backed populated personas: the drill library is still being
                  architected, so this section stays filler even over real swings. */}
              {persona !== null && !personaHasNoSwings(persona) ? (
                <DrillsRail items={MOCK_DRILL_REEL} />
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
        avatar={<Avatar size={26} />}
        onProfile={() => navigation.navigate("Profile")}
        profileTestID="home-profile"
      />
    </View>
  );
}

/**
 * The first-load door: shows only while the golfer has never recorded a swing. The full-bleed
 * footage is the product doing the thing — a swing looping behind the ask — with the ask
 * written over it and a REC-styled chip echoing the capture screen's own button. A styling
 * element, not a player: muted, endless, no controls. One tap, one destination: Record.
 */
function GetStartedCard({ navigation }: { navigation: Navigation }) {
  const styles = useStyles();
  const player = useVideoPlayer(RECORD_SWING_CLIP, (p) => {
    p.muted = true;
    p.loop = true;
    p.play();
  });
  return (
    <Pressable
      testID="home-get-started"
      accessibilityRole="button"
      accessibilityLabel="Get started — record your first swing"
      onPress={() => navigation.navigate("Record")}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      style={({ pressed }) => [styles.getStarted, pressed && styles.pressed]}
    >
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="cover"
        // The standing rule: every video rides a textureView, or the card's rounding and the
        // scroll's transforms never reach it.
        surfaceType="textureView"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {/* Legibility fade only over the words — the photograph stays the card. */}
      <LinearGradient
        colors={["transparent", `${PHOTO_SCRIM}0.55)`, `${PHOTO_SCRIM}0.88)`]}
        style={overPhoto.getStartedScrim}
      />
      <View style={overPhoto.getStartedBody}>
        <Text style={overPhoto.getStartedEyebrow}>Get started</Text>
        <Text style={overPhoto.getStartedTitle}>Record your{"\n"}first swing</Text>
        <View style={overPhoto.getStartedCta}>
          <View style={overPhoto.getStartedRecDot} />
          <Text style={overPhoto.getStartedCtaText}>Record</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** The deep link every focus door shares: the exemplar swing's report (the one player).
 *  Parking at the priority's checkpoint is deferred until the report player learns it —
 *  see the mobile-client decisions entry (2026-08-17). */
function openOnSwing(navigation: Navigation, item: FocusItem): void {
  // Mock filler has no report behind it — the tap lands (pressed state) and goes nowhere,
  // rather than opening a swing that does not exist.
  if (isMockSwing(item.exemplarId)) return;
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
  // Mock filler skips the network entirely — the halves draw their stick-figure placeholders,
  // which is also what a real half shows while its frame resolves.
  const mock = isMockSwing(lead.exemplarId);
  const you = useAuthenticatedImage(mock ? null : `swings/${lead.exemplarId}/frame?checkpoint=${cp}`);
  const proImg = useAuthenticatedImage(mock ? null : `swings/${proId}/frame?checkpoint=${cp}`);
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
          ) : (
            <View style={overPhoto.photoStandIn}>
              <StickThumb figure={FORM_FIGURES.posture} size={64} />
            </View>
          )}
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
          ) : (
            <View style={overPhoto.photoStandIn}>
              <StickThumb figure={FORM_FIGURES.impact} size={64} />
            </View>
          )}
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

/**
 * Drills — a swipeable reel of short vertical drill videos, one per fault the session
 * surfaced. Styled apart from every other card on the screen on purpose: portrait 9:16
 * video tiles in the photo world with a centred play badge, so the section reads as
 * "watch this", where the tip cards read as "read this". Tapping opens the drill video
 * (mock filler opens nothing, same rule as every mock door).
 */
function DrillsRail({ items }: { items: DrillReelItem[] }) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <View testID="home-drills">
      <View style={styles.drillsHead}>
        <View style={styles.drillsTitleRow}>
          {/* The AI coach's mark — these picks are the coach speaking, and the icon says so
              the same way it does on the Coach tab. */}
          <BrandIcon name="coach" size={20} color={t.cobalt} />
          <Text style={styles.drillsTitle}>Your Suggested Drills</Text>
        </View>
        <Text style={styles.drillsSub}>Short videos for what you're working on</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.slider}
        testID="home-drills-rail"
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            testID={`home-drill-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.duration} drill video for ${item.area}`}
            onPress={() => {
              if (isMockSwing(item.id)) return;
            }}
            unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
            style={({ pressed }) => [overPhoto.drillCard, pressed && styles.pressed]}
          >
            {/* The video poster's slot — stick-figure stand-in until real drill videos exist. */}
            <View style={overPhoto.photoStandIn}>
              <StickThumb figure={formFigureFor(`${item.title} ${item.area}`)} size={64} />
            </View>
            <View style={overPhoto.drillPlay}>
              <View style={overPhoto.drillPlayGlyph} />
            </View>
            <View style={overPhoto.drillDuration}>
              <Text style={overPhoto.drillDurationText}>{item.duration}</Text>
            </View>
            <View style={overPhoto.drillScrim} />
            <View style={overPhoto.drillFoot}>
              <Text style={overPhoto.drillArea}>{item.area}</Text>
              <Text style={overPhoto.drillTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
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
            onPress={() => {
              // Same rule as `openOnSwing` — filler slides answer the press and open nothing.
              if (isMockSwing(swing.id)) return;
              navigation.navigate("SwingDetail", { id: swing.id });
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** The slides' stand-in art, cycled so a photo-less rail still reads as different swings. */
const SLIDE_FIGURES = [
  FORM_FIGURES.setup,
  FORM_FIGURES.tempo,
  FORM_FIGURES.impact,
  FORM_FIGURES.posture,
  FORM_FIGURES.strike,
];

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
  const thumb = useAuthenticatedImage(
    isMockSwing(swing.id) ? null : `swings/${swing.id}/thumb?poster=1`,
  );
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
      ) : (
        <View style={overPhoto.photoStandIn}>
          <StickThumb figure={SLIDE_FIGURES[(number - 1) % SLIDE_FIGURES.length]} size={72} />
        </View>
      )}
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
  /* The spotlight deck's slot: full-bleed against the hero's own padding, with clear air
     under the greeting so the header reads before the deck does. */
  heroRail: { marginHorizontal: -18, marginTop: 24 },
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

  empty: { alignItems: "center", gap: 14, paddingVertical: 8 },
  emptyDetail: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },

  /* The first-load door — looping footage with the ask written on it. The card takes the
     clip's own aspect (720×720) so the entire picture shows, never a crop. */
  getStarted: {
    alignSelf: "stretch",
    marginHorizontal: 16,
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: t.surface,
    overflow: "hidden",
    justifyContent: "flex-end",
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

  /* Drills — the reel section's chrome. Same header scale as the session block so the
     screen keeps one rhythm; the cards underneath are what set the section apart. */
  drillsHead: { paddingHorizontal: 16, marginBottom: 10, gap: 3 },
  drillsTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  drillsTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    lineHeight: displayLine(24),
    letterSpacing: -0.48,
  },
  drillsSub: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },

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
  /** Where a photograph has not arrived (resolving, missing, or mock filler): the design
   *  system's stick-figure art on the photo ground, dimmed so it reads as a stand-in. */
  photoStandIn: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.45,
  },
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

  /* The get-started door's words and chrome, all over the photograph. */
  getStartedScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
  },
  getStartedBody: { padding: 18, gap: 4 },
  getStartedEyebrow: {
    color: COLORS.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.62,
    textTransform: "uppercase",
  },
  getStartedTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 27,
    lineHeight: displayLine(27),
    letterSpacing: -0.54,
  },
  /* The REC echo: the capture screen's red button, shrunk to a chip-side dot. */
  getStartedCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  getStartedRecDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.red,
  },
  getStartedCtaText: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.55,
    textTransform: "uppercase",
  },

  /* Drill reels — portrait 9:16 video tiles, the section's own shape on the screen. */
  drillCard: {
    width: 138,
    height: 245,
    borderRadius: 14,
    backgroundColor: COLORS.bg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  /* Centred play badge: glass circle + a View-drawn triangle (shape-drawing borders are the
     sanctioned exception to the no-borders rule). */
  drillPlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -19,
    marginLeft: -19,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  drillPlayGlyph: {
    marginLeft: 3,
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: COLORS.text,
  },
  drillDuration: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: `${PHOTO_SCRIM}0.72)`,
  },
  drillDurationText: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.45,
    fontVariant: ["tabular-nums"],
  },
  drillScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "42%",
    backgroundColor: `${PHOTO_SCRIM}0.62)`,
  },
  drillFoot: { padding: 12, gap: 3 },
  drillArea: {
    color: COLORS.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.96,
    textTransform: "uppercase",
  },
  drillTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: displayLine(14),
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
