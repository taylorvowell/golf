import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { Star, Trash2 } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { TAB_LABELS, tabIcon } from "../design/TabBar";
import { APP_HEADER_BAR, AppHeader, WaveNav, type WaveNavItem } from "../design/system";
import { CornerOrb } from "../features/report/VideoLayer";
import { SwingPage } from "../features/report/SwingPage";
import { SwingDeleteSheet } from "../features/session/sheets/SwingDeleteSheet";
import { useStarred } from "../features/swings/useStarred";
import { deleteSwing, useSwing } from "../features/swings/useSwings";
import { useAppNavigation, type TabParamList } from "../navigation";
import { AppTheme, COLORS, FixedDarkTheme } from "../theme";

/**
 * One swing, ONE page (Taylor 2026-08-17 killed the second player surface; 2026-08-19 killed the
 * second swing PAGE): outside a session, this route renders the SAME `SwingPage` the post-swing
 * screen shows. The differences are chrome only (Taylor, 2026-08-19): the bar is the MAIN menu —
 * no session controls, no "record new swing" of its own beyond the menu's standing Record door —
 * and star/delete ride the video's top-right orb stack instead of a bar. Every door (log row,
 * Home's focus cards, Coach's scorecard link) lands here.
 *
 * The page is pinned DARK (Taylor, 2026-08-19) so the analysis card that slides over the video
 * is the same surface as the after-swing one — one page reading as two was the whole complaint.
 * The main menu escapes the pin the way every bar in the app does (`AppTheme`).
 */

export interface SwingDetailScreenProps {
  id: string;
}

export function SwingDetailScreen({ id }: SwingDetailScreenProps) {
  const { state, swing } = useSwing(id);

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

  return <StandaloneSwingPage swing={swing} />;
}

const MAIN_TABS: (keyof TabParamList)[] = ["Home", "SwingLog", "Progress", "Coach"];

/** The shared page dressed as an INTERIOR page (Taylor, 2026-08-19): the app's main menu worn
 * statically at the bottom (no scroll-hide — it must read as the same bar as every other page),
 * and the standard header — logo + hamburger — overlaying the top, since navigating off a swing
 * is fine outside a session. This route sits ABOVE the tab navigator, so the real tab bar is
 * covered by construction; the same `WaveNav` is worn here directly and a tab press navigates
 * back down into the shell. No back orb — the menu and header ARE the navigation. */
function StandaloneSwingPage({ swing }: { swing: SwingSummary }) {
  const navigation = useAppNavigation();
  const { starred, toggle } = useStarred(swing.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Frozen at 0: the header never slides here — the page's scroll belongs to the sheet, and
  // chrome that stays put is the whole point of dressing this as an interior page.
  const headerPin = useRef(new Animated.Value(0)).current;

  const onDelete = useCallback(async () => {
    setDeleteOpen(false);
    await deleteSwing(swing.id);
    if (navigation.canGoBack()) navigation.goBack();
  }, [swing.id, navigation]);

  // None active: the golfer is on a swing, not on a tab — an active glyph would claim a place
  // this screen does not hold.
  const tabs = useMemo<WaveNavItem[]>(
    () =>
      MAIN_TABS.map((name) => ({
        key: name,
        label: TAB_LABELS[name],
        icon: tabIcon(name),
        testID: `swing-tab-${name}`,
        onPress: () => navigation.navigate("Tabs", { screen: name }),
      })),
    [navigation],
  );

  const page = (
    <SwingPage
      swing={swing}
      testID="report"
      // Static on purpose — `hidden` from the page's scroll latch is ignored: this is the main
      // menu, and the main menu does not leave (Taylor, 2026-08-19).
      menu={() => (
        // Out of the dark pin: every bar in the app is the same bar, so the main menu keeps
        // the app's surface exactly as `SessionNav` does on the capture screen.
        <AppTheme>
          <WaveNav
            items={tabs}
            recordTestID="swing-tab-record"
            onRecord={() => navigation.navigate("Record")}
          />
        </AppTheme>
      )}
      chromeTopInset={APP_HEADER_BAR}
      // The tab is there at page load, no slide-in — the entrance theatre belongs to the
      // after-swing screen, where the card arriving is the analysis finishing.
      staticSheet
      topRight={
        <>
          <CornerOrb
            label={starred ? "Remove from favorites" : "Add to favorites"}
            active={starred}
            onPress={toggle}
            testID="report-favorite"
          >
            <Star
              size={19}
              color={starred ? COLORS.aqua : "#FFFFFF"}
              strokeWidth={2.2}
              fill={starred ? COLORS.aqua : "none"}
            />
          </CornerOrb>
          <CornerOrb
            label="Delete this swing"
            onPress={() => setDeleteOpen(true)}
            testID="report-delete"
          >
            <Trash2 size={19} color="#FFFFFF" strokeWidth={2} />
          </CornerOrb>
        </>
      }
      extras={
        <>
          {/* The interior-page header, over the picture — hero ink (white) on the fixed dark
              player ground, exactly as on Swing Log's dark hero. */}
          <AppHeader
            hero
            chromePx={headerPin}
            onProfile={() => navigation.navigate("Profile")}
            profileTestID="swing-profile"
          />
          <SwingDeleteSheet
            visible={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            isOnlySwing={false}
            onDelete={() => void onDelete()}
          />
        </>
      }
    />
  );
  return <FixedDarkTheme>{page}</FixedDarkTheme>;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
});
