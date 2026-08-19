import { useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { ChevronRight, Film, ScanLine } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  APP_HEADER_BAR,
  AppHeader,
  BrandIcon,
  Button,
  HERO_PARALLAX,
  HERO_SHEET_GAP,
  HeroBackdrop,
  Panel,
  PanelHead,
  SheetOverBackdrop,
  StanceStage,
  StickThumb,
  Tag,
  formFigureFor,
  useChromeScroll,
  WAVE_NAV_CLEARANCE,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import {
  COACH_DRILLS,
  COACH_FOCUS_AREAS,
  COACH_TIP,
  type CoachFocusArea,
} from "../features/coach/coachStubs";
import { InstructorBubble } from "../features/instructor/InstructorBubble";
import { createdAtMs } from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * Coach — the AI coach's page ("Coach" means the AI; the human is the Instructor —
 * `docs/decisions/mobile-client.md`). The split with Progress is the design: Coach is
 * act-now (the top tip, what to focus on, drills to do); Progress is keeping score over
 * time. Content comes from the flagged stub view-model (`coachStubs.ts`) until the
 * priority/drill engines fill that seam — coach-surface step 01.
 */
export function CoachScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { state } = useSwings();
  const t = useTheme();
  const styles = useStyles();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  const [heroHeight, setHeroHeight] = useState<number | null>(null);
  const backdropHeight =
    heroHeight === null ? 300 + insets.top : heroHeight + 92 + HERO_SHEET_GAP;

  // The tip's "see it on your swing" door — the newest scored swing, a real destination.
  const latestScored = useMemo(() => {
    if (state.kind !== "ok") return null;
    const scored = state.swings.filter(
      (s) => s.status === "ready" && typeof s.overallScore === "number",
    );
    if (!scored.length) return null;
    return scored.reduce((a, b) => (createdAtMs(a) >= createdAtMs(b) ? a : b));
  }, [state]);

  const hero = (
    <HeroBackdrop overscan={HERO_PARALLAX.cap}>
      <View
        style={[styles.heroContent, { paddingTop: insets.top + APP_HEADER_BAR }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeroHeight((prev) => (prev === h ? prev : h));
        }}
      >
        <View style={styles.heroTitleRow}>
          <View style={styles.heroIconBed}>
            <BrandIcon name="coach" size={26} color={t.onDark} />
          </View>
          <Text style={styles.heroTitle}>Coach</Text>
        </View>
        <Text style={styles.heroEyebrow}>Your AI coach</Text>
        {/* The coach's one-line read — the persona voice, updated with the priorities. */}
        <Text style={styles.heroHeadline}>Setup first — it unlocks everything after it.</Text>
        <Text style={styles.heroCopy}>
          Focus areas and drills refresh after every analysed swing.
        </Text>
      </View>
    </HeroBackdrop>
  );

  // The featured area's stage width: sheet padding 14 + panel padding 15, both sides.
  const stageWidth = width - 2 * 14 - 2 * 15;

  return (
    <View style={{ flex: 1 }}>
      <SheetOverBackdrop
        testID="coach"
        backdrop={hero}
        backdropHeight={backdropHeight}
        parallax={HERO_PARALLAX}
        initialOffset={0}
        overlap={92}
        onScrollY={onChromeScroll}
      >
        <View
          style={[
            styles.sheetContent,
            { paddingBottom: 108 + WAVE_NAV_CLEARANCE + insets.bottom },
          ]}
        >
          {/* Top tip — the "next up". */}
          <Panel radius="feature">
            <PanelHead label="Top tip" meta="Next up" />
            <View style={styles.tipHead}>
              {/* The tip's form thumbnail — every coach statement shows the correct form for
                  the thing it names (Taylor, 2026-08-19). */}
              <StickThumb figure={formFigureFor(`${COACH_TIP.title} ${COACH_TIP.copy}`)} size={48} />
              <View style={styles.tipBody}>
                <Text style={styles.tipTitle}>{COACH_TIP.title}</Text>
                <Text style={styles.tipCopy}>{COACH_TIP.copy}</Text>
              </View>
            </View>
            {/* The tip's drill — the one to do first, worn as part of the tip. */}
            <View style={styles.tipDrill}>
              <Text style={styles.tipDrillLabel}>Top drill</Text>
              <Text style={styles.tipDrillTitle}>
                {COACH_TIP.drill.title}
                <Text style={styles.tipDrillDose}> · {COACH_TIP.drill.dose}</Text>
              </Text>
            </View>
            {latestScored ? (
              <Button
                variant="primary"
                label="See it on your swing"
                testID="coach-see-it"
                onPress={() => navigation.navigate("SwingDetail", { id: latestScored.id })}
                style={styles.tipCta}
              />
            ) : null}
          </Panel>

          {/* The deep swing analysis door — the coach walks the whole motion, above the
              stance card (Taylor, 2026-08-19: two guided-session cards, deep on top). */}
          <Pressable
            testID="coach-deep"
            accessibilityRole="button"
            accessibilityLabel="Start your deep swing analysis"
            onPress={() => navigation.navigate("DeepAnalysis")}
            style={({ pressed }) => [styles.stanceCard, pressed && styles.pressed]}
          >
            <View style={styles.stanceIcon}>
              <Film size={22} color={t.onDark} strokeWidth={2.1} />
            </View>
            <View style={styles.tipBody}>
              <Text style={styles.stanceEyebrow}>Guided session</Text>
              <Text style={styles.tipTitle}>Deep swing analysis</Text>
              <Text style={styles.tipCopy}>
                Your coach plays your swing, pausing at the moments that matter — drawn on
                your own video.
              </Text>
            </View>
            <ChevronRight size={16} color={t.muted2} strokeWidth={2.5} />
          </Pressable>

          {/* The guided stance analysis door — the first session with the coach. */}
          <Pressable
            testID="coach-stance"
            accessibilityRole="button"
            accessibilityLabel="Start your guided stance analysis"
            onPress={() => navigation.navigate("StanceAnalysis")}
            style={({ pressed }) => [styles.stanceCard, pressed && styles.pressed]}
          >
            <View style={styles.stanceIcon}>
              <ScanLine size={22} color={t.onDark} strokeWidth={2.1} />
            </View>
            <View style={styles.tipBody}>
              <Text style={styles.stanceEyebrow}>Guided session</Text>
              <Text style={styles.tipTitle}>Stance analysis</Text>
              <Text style={styles.tipCopy}>
                A two-minute guided look at your setup, drawn over your own address.
              </Text>
            </View>
            <ChevronRight size={16} color={t.muted2} strokeWidth={2.5} />
          </Pressable>

          {/* Focus areas, ranked by impact. */}
          <Panel radius="feature" style={styles.block}>
            <PanelHead label="Focus areas" meta="Ranked by impact" />
            <View style={styles.focusList}>
              {COACH_FOCUS_AREAS.map((area) => (
                <FocusAreaRow key={area.category} area={area} stageWidth={stageWidth} />
              ))}
            </View>
          </Panel>

          {/* Drills, matched to the focus areas. */}
          <Panel radius="feature" style={styles.block}>
            <PanelHead label="Drills for you" meta="Matched to your focus" />
            <View style={styles.focusList}>
              {COACH_DRILLS.map((drill) => (
                <View key={drill.key} style={styles.drillRow}>
                  <StickThumb
                    figure={formFigureFor(`${drill.area} ${drill.title} ${drill.copy}`)}
                    size={48}
                  />
                  <View style={styles.tipBody}>
                    <Text style={styles.drillTitle}>{drill.title}</Text>
                    <Text style={styles.tipCopy}>{drill.copy}</Text>
                  </View>
                  <View style={styles.drillMeta}>
                    <Tag label={drill.area} variant="best" compact />
                    <Text style={styles.drillDose}>{drill.dose}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Panel>
        </View>
      </SheetOverBackdrop>

      <AppHeader
        hero
        chromePx={chromePx}
        onProfile={() => navigation.navigate("Profile")}
        profileTestID="coach-profile"
      />
      {/* Only when an instructor is connected — the store decides. */}
      <InstructorBubble />
    </View>
  );
}

/**
 * One ranked focus area: pose tile, rank + name + cue, the personal score with its priority
 * pill — and, on the featured area, the stance stage standing in for the golfer's own
 * screen-grab with the area's overlay drawn on (the wired version swaps the art for a
 * `frame?checkpoint=` grab under the same annotation layer).
 */
function FocusAreaRow({ area, stageWidth }: { area: CoachFocusArea; stageWidth: number }) {
  const t = useTheme();
  const styles = useStyles();
  const pill =
    area.level === "high"
      ? { bg: "rgba(229,87,100,0.14)", fg: t.bad }
      : area.level === "med"
        ? { bg: t.mode === "dark" ? "rgba(63,87,218,0.20)" : "rgba(47,70,207,0.12)", fg: t.cobalt }
        : { bg: "rgba(40,168,107,0.14)", fg: t.good };

  return (
    <View style={styles.areaRow}>
      <View style={styles.areaMain}>
        <StickThumb figure={area.figure} size={48} />
        <View style={styles.tipBody}>
          <Text style={styles.areaOrdinal}>{area.ordinal}</Text>
          <Text style={styles.areaTitle}>{area.title}</Text>
          <Text style={styles.tipCopy}>{area.copy}</Text>
        </View>
        <View style={styles.areaScoreCol}>
          <Text style={styles.areaScore}>{area.score}</Text>
          <View style={[styles.areaPill, { backgroundColor: pill.bg }]}>
            <Text style={[styles.areaPillText, { color: pill.fg }]}>{area.levelLabel}</Text>
          </View>
        </View>
      </View>
      {area.featured ? (
        <View style={styles.areaStage}>
          <StanceStage
            view={area.featured.view}
            width={stageWidth - 2 * 12}
            height={150}
            annotations={area.featured.annotations}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  heroContent: { paddingHorizontal: 18 },
  heroTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  /* White-tint bed over the hero gradient — the hero's own voice, like its soft text tints. */
  heroIconBed: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroTitle: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 31,
    lineHeight: 31,
    letterSpacing: -0.62,
  },
  heroEyebrow: {
    marginTop: 18,
    color: "rgba(255,255,255,0.74)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.62,
    textTransform: "uppercase",
  },
  heroHeadline: {
    marginTop: 8,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 24,
    lineHeight: 26,
    letterSpacing: -0.48,
    maxWidth: 300,
  },
  heroCopy: {
    marginTop: 8,
    color: "rgba(255,255,255,0.66)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 14.5,
  },

  sheetContent: { paddingHorizontal: 14, paddingTop: 12 },
  block: { marginTop: 12 },
  focusList: { gap: 10 },
  pressed: { opacity: 0.75 },

  /* Top tip */
  tipHead: { flexDirection: "row", gap: 12 },
  tipIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.mode === "dark" ? "rgba(67,205,208,0.14)" : "rgba(67,205,208,0.12)",
  },
  tipBody: { flex: 1, minWidth: 0 },
  tipTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    lineHeight: 18,
  },
  tipCopy: {
    marginTop: 4,
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 15,
  },
  /* The tip's drill line — an aqua-tinted bed, the coach accent. */
  tipDrill: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.mode === "dark" ? "rgba(67,205,208,0.10)" : "rgba(67,205,208,0.09)",
  },
  tipDrillLabel: {
    color: t.mode === "dark" ? t.aqua : "#1D7E86",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
  },
  tipDrillTitle: {
    marginTop: 4,
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 13,
  },
  tipDrillDose: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
  tipCta: { marginTop: 12, alignSelf: "flex-start" },

  /* Stance analysis door */
  stanceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    padding: 15,
    borderRadius: 14,
    backgroundColor: t.mode === "dark" ? "rgba(67,205,208,0.10)" : "rgba(67,205,208,0.09)",
  },
  stanceIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.aqua,
  },
  stanceEyebrow: {
    color: t.mode === "dark" ? t.aqua : "#1D7E86",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  /* Focus areas */
  areaRow: { padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 10 },
  areaMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  areaOrdinal: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  areaTitle: {
    marginTop: 4,
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
  },
  areaScoreCol: { alignItems: "flex-end", gap: 6 },
  /* The personal score — bare 900 number, the design system's score voice. */
  areaScore: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 22,
    lineHeight: 22,
    letterSpacing: -0.44,
    fontVariant: ["tabular-nums"],
  },
  areaPill: {
    minHeight: 22,
    paddingHorizontal: 9,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  areaPillText: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.56,
    textTransform: "uppercase",
  },
  /* The featured area's stage — a darker well so the ink reads (stance imagery is dark). */
  areaStage: {
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0B1528",
  },

  /* Drills */
  drillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: t.surface2,
  },
  drillTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 13,
    lineHeight: 16,
  },
  drillMeta: { alignItems: "flex-end", gap: 6 },
  drillDose: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
}));
