import { useMemo } from "react";
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
  SheetOverBackdrop,
  TrendRing,
  useChromeScroll,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { CoachFocusRow } from "../features/progress/CoachFocusRow";
import { CompareThenNow } from "../features/progress/CompareThenNow";
import { MiniTrendTile } from "../features/progress/MiniTrendTile";
import {
  PLACEHOLDER_COACH_NOTE,
  PLACEHOLDER_PRIORITIES,
  PLACEHOLDER_TRENDS,
  progressViewModel,
} from "../features/progress/viewModel";
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
 * The mockup's "Coach confidence rising" chip is deliberately absent: a canned trust
 * statement fails the honesty bar, and no measured confidence aggregate exists yet.
 */
export function ProgressScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { state, refreshing, refresh } = useSwings();
  const t = useTheme();
  const styles = useStyles();
  const onChromeScroll = useChromeScroll();

  const vm = useMemo(
    () => (state.kind === "ok" ? progressViewModel(state.swings, Date.now()) : null),
    [state],
  );

  const hero = (
    <HeroBackdrop>
      <View style={[styles.heroContent, { paddingTop: insets.top + APP_HEADER_BAR }]}>
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
                {vm.window.best !== null && (
                  <Text style={styles.heroCopy}>
                    Best score {vm.window.best} across{" "}
                    {vm.window.scoredSessions === 1
                      ? "one scored session"
                      : `${vm.window.scoredSessions} scored sessions`}
                    .
                  </Text>
                )}
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
      backdropHeight={424 + insets.top}
      parallax={{ factor: 0.22, cap: 72 }}
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
      <View style={[styles.sheetContent, { paddingBottom: 108 + insets.bottom }]}>
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
    lineHeight: 31,
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
    lineHeight: 27,
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
