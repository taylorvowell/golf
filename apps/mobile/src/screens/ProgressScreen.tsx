import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  APP_HEADER_BAR,
  AppHeader,
  Chip,
  HeroBackdrop,
  Panel,
  PanelHead,
  HERO_PARALLAX,
  HERO_SHEET_GAP,
  SheetOverBackdrop,
  TrendRing,
  useChromeScroll,
  WAVE_NAV_CLEARANCE,
} from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { CoachFocusRow } from "../features/progress/CoachFocusRow";
import { CompareThenNow } from "../features/progress/CompareThenNow";
import { MiniTrendTile } from "../features/progress/MiniTrendTile";
import {
  PLACEHOLDER_COACH_NOTE,
  PLACEHOLDER_CONFIDENCE_CHIP,
  PLACEHOLDER_HERO_DESCRIPTION,
  PLACEHOLDER_PRIORITIES,
  PLACEHOLDER_TRENDS,
  progressViewModel,
} from "../features/progress/viewModel";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { useSessions } from "../features/swings/useSessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * Progress, rebuilt to the Ideal Swing reference (`.progress-*`): the hero carries the
 * 30-day story — deterministic headline, the net-gain trend ring, real count chips — and the
 * sheet carries the coaching roadmap: AI coach priorities, category trends, the coach note,
 * and the then-vs-now compare. Real aggregates are real; coaching content is the flagged
 * placeholder block in `viewModel.ts` until priority-engine/goal-progression fill the seam.
 *
 * Followed EXACTLY to `.claude/SAMPLE-progress-page.html` (Taylor, 2026-08-19) — including
 * the coach-voice description, the confidence chip, and the Before/Now numbers, all canned
 * placeholders at the view-model seam during the UI-stub phase (see the mobile-client
 * decisions entry); real aggregates stay real.
 */
export function ProgressScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { state, refreshing, refresh } = useSwings();
  const t = useTheme();
  const styles = useStyles();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  // Measured once the hero lays out; until then the previous hand-tuned height keeps the first
  // frame in the right place, so nothing jumps.
  const [heroHeight, setHeroHeight] = useState<number | null>(null);
  const backdropHeight =
    heroHeight === null ? 424 + insets.top : heroHeight + 92 + HERO_SHEET_GAP;

  const { sessions: sessionRows } = useSessions();
  const vm = useMemo(
    () => (state.kind === "ok" ? progressViewModel(state.swings, Date.now(), sessionRows) : null),
    [state, sessionRows],
  );

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
            only the screen's own title. */}
        <Text style={styles.heroTitle}>Progress</Text>
        {/* .progress-meta-row — the 30-day story left, the trend ring right. */}
        {vm != null && vm.kind !== "empty" ? (
          <>
            <View style={styles.heroMeta}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.heroEyebrow}>Last 30 days</Text>
                <Text style={styles.heroHeadline}>{vm.headline}</Text>
                {/* .progress-description — the sample's coach-voice line (canned at the seam;
                    best-score lives in the chips, so nothing repeats). */}
                <Text style={styles.heroCopy}>{PLACEHOLDER_HERO_DESCRIPTION}</Text>
              </View>
              <TrendRing
                value={
                  vm.window.netGain === null
                    ? "—"
                    : `${vm.window.netGain >= 0 ? "+" : ""}${vm.window.netGain}`
                }
                caption="Net gain"
                // The sweep is the latest session average — a real level; the number is the
                // real delta. Track-only until either exists.
                fraction={vm.window.latestAvg === null ? null : vm.window.latestAvg / 100}
              />
            </View>
            {/* .progress-chip-row — real counts only (no canned confidence chip). */}
            <View style={styles.heroChips} testID="progress-chips">
              <Chip
                translucent
                label={`${vm.window.sessions} ${vm.window.sessions === 1 ? "session" : "sessions"}`}
              />
              <Chip
                translucent
                label={`${vm.window.swings} ${vm.window.swings === 1 ? "swing" : "swings"}`}
              />
              {vm.window.best !== null && (
                <Chip translucent label={`Best score ${vm.window.best}`} />
              )}
              {/* .progress-chip — the sample's fourth chip (canned at the seam). */}
              <Chip translucent label={PLACEHOLDER_CONFIDENCE_CHIP} />
            </View>
          </>
        ) : null}
      </View>
    </HeroBackdrop>
  );

  return (
    <View style={{ flex: 1 }}>
    <SheetOverBackdrop
      testID="progress"
      backdrop={hero}
      backdropHeight={backdropHeight}
      parallax={HERO_PARALLAX}
      initialOffset={0}
      overlap={92}
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
      <View style={[styles.sheetContent, { paddingBottom: 108 + WAVE_NAV_CLEARANCE + insets.bottom }]}>
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
            retryTestID="progress-retry"
          />
        ) : null}

        {state.kind === "unreachable" ? (
          <StatusMessage
            title="Cannot reach SwingSage"
            detail="Your swings are safe — this device just could not connect. Check your network."
            onRetry={refresh}
            retryTestID="progress-retry"
          />
        ) : null}

        {vm != null && vm.kind === "empty" ? (
          <View style={styles.centre} testID="progress-empty">
            <Text style={styles.emptyTitle}>Nothing to chart yet</Text>
            <Text style={styles.emptyDetail}>
              Your last 30 days have no swings. Records and trends build themselves as you
              practise.
            </Text>
          </View>
        ) : null}

        {vm != null && vm.kind !== "empty" ? (
          <>
            {/* .progress-block — AI coach priorities. */}
            <Panel radius="feature">
              <PanelHead label="AI coach priorities" meta="Ordered by impact" />
              <View style={styles.focusList}>
                {PLACEHOLDER_PRIORITIES.map((priority) => (
                  <CoachFocusRow key={priority.category} priority={priority} />
                ))}
              </View>
            </Panel>

            {/* .progress-block — category trends + the coach note. */}
            <Panel radius="feature" style={styles.block}>
              <PanelHead label="Where you improved" meta="Category trend" />
              {vm.kind === "low-data" ? (
                <Text style={styles.lowData} testID="progress-low-data">
                  Keep practising to unlock trends — two scored sessions make one.
                </Text>
              ) : (
                <View style={styles.trendGrid}>
                  {PLACEHOLDER_TRENDS.map((trend) => (
                    <MiniTrendTile key={trend.category} trend={trend} />
                  ))}
                </View>
              )}
              {/* .coach-note — aqua→cobalt tint bed. Canned narrative, flagged in the model. */}
              <LinearGradient
                colors={[
                  "rgba(67,205,208,0.16)",
                  t.mode === "dark" ? "rgba(63,87,218,0.14)" : "rgba(47,70,207,0.10)",
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.coachNote}
              >
                <Text style={styles.coachNoteLabel}>Coach note</Text>
                <Text style={styles.coachNoteText}>{PLACEHOLDER_COACH_NOTE}</Text>
              </LinearGradient>
            </Panel>

            {/* .progress-block — compare then vs now (real swings, real scores). */}
            <Panel radius="feature" style={styles.block}>
              <PanelHead label="Compare then vs now" meta="Old swing vs new swing" />
              {vm.compare != null ? (
                <CompareThenNow then={vm.compare.then} now={vm.compare.now} />
              ) : (
                <Text style={styles.lowData} testID="progress-no-compare">
                  Two scored swings in the window make a comparison — this fills in as you
                  practise.
                </Text>
              )}
            </Panel>
          </>
        ) : null}
      </View>
    </SheetOverBackdrop>

    <AppHeader
      hero
      chromePx={chromePx}
      bell={<NotificationBell hero onPress={() => navigation.navigate("Notifications")} />}
      onProfile={() => navigation.navigate("Profile")}
      profileTestID="progress-profile"
    />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  heroContent: { paddingHorizontal: 18 },
  /* .progress-top h3 — 31/900/-5% */
  heroTitle: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 31,
    lineHeight: displayLine(31),
    letterSpacing: -0.62,
  },
  /* .progress-meta-row — align-items flex-end in the mockup. */
  heroMeta: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 18,
  },
  heroEyebrow: {
    color: "rgba(255,255,255,0.74)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.62,
    textTransform: "uppercase",
  },
  /* .progress-meta-row h4 — 26/900/1.03 */
  heroHeadline: {
    marginTop: 8,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    lineHeight: displayLine(26),
  },
  heroCopy: {
    marginTop: 8,
    color: "rgba(255,255,255,0.66)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 14.5,
  },
  /* .progress-chip-row (the chips themselves are the system `Chip translucent`). */
  heroChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },

  /* .progress-sheet — padding 12 14, blocks stacked 12 apart. */
  sheetContent: { paddingHorizontal: 14, paddingTop: 12 },
  block: { marginTop: 12 },
  focusList: { gap: 10 },
  trendGrid: { flexDirection: "row", gap: 10 },
  lowData: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  /* .coach-note */
  coachNote: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
  coachNoteLabel: {
    marginBottom: 4,
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.64,
    textTransform: "uppercase",
  },
  coachNoteText: {
    color: t.text,
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 15.5,
  },

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
