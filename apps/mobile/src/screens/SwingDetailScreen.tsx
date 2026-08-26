import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Star } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_LABELS, tabIcon } from "../design/TabBar";
import { APP_HEADER_BAR, AppHeader, SwingLoader, WaveNav, type WaveNavItem } from "../design/system";
import { Avatar } from "../features/profile/Avatar";
import { CornerOrb } from "../features/report/VideoLayer";
import { SwingHeading } from "../features/report/SwingHeading";
import { SwingPage } from "../features/report/SwingPage";
import { SwingPeek } from "../features/report/SwingPeek";
import { SwingSwipe } from "../features/report/SwingSwipe";
import { swingOrder, type SwingEntry } from "../features/swings/sessions";
import { useSessions } from "../features/swings/useSessions";
import { useStarred } from "../features/swings/useStarred";
import { useSwings } from "../features/swings/useSwings";
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
 * **The route parameter is where the golfer ARRIVED, not where they are** (Taylor, 2026-08-22).
 * A sideways swipe moves through the log without a navigation push — pushing a route per swing
 * would build a back stack ten deep out of what is, to the golfer, one screen they are moving
 * sideways through. The id is state seeded from the param and re-seeded whenever the param
 * changes, so arriving here again from anywhere still lands where it was asked to.
 *
 * The page is pinned DARK (Taylor, 2026-08-19) so the analysis card that slides over the video
 * is the same surface as the after-swing one — one page reading as two was the whole complaint.
 * The main menu escapes the pin the way every bar in the app does (`AppTheme`).
 */

export interface SwingDetailScreenProps {
  id: string;
}

export function SwingDetailScreen({ id }: SwingDetailScreenProps) {
  const { state } = useSwings();
  const { sessions: sessionRows } = useSessions();

  const [currentId, setCurrentId] = useState(id);
  useEffect(() => setCurrentId(id), [id]);

  /** The log's own order, so a swipe moves the way the list the golfer tapped moves. */
  const order = useMemo(
    () => (state.kind === "ok" ? swingOrder(state.swings, sessionRows) : []),
    [state, sessionRows],
  );
  const index = order.findIndex((e) => e.swing.id === currentId);

  if (state.kind === "loading") {
    return (
      <View style={styles.centre}>
        <SwingLoader size={40} ground="dark" />
      </View>
    );
  }

  if (index < 0) {
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

  return (
    <StandaloneSwingPage
      entry={order[index]}
      prev={index > 0 ? order[index - 1] : null}
      next={index < order.length - 1 ? order[index + 1] : null}
      onGo={setCurrentId}
    />
  );
}

const MAIN_TABS: (keyof TabParamList)[] = ["Home", "SwingLog", "Progress", "Coach"];

/**
 * The shared page dressed as an INTERIOR page (Taylor, 2026-08-19): the app's main menu at the
 * bottom and the standard header — logo + hamburger — overlaying the top, since navigating off a
 * swing is fine outside a session. This route sits ABOVE the tab navigator, so the real tab bar is
 * covered by construction; the same `WaveNav` is worn here directly and a tab press navigates
 * back down into the shell. No back orb — the menu and header ARE the navigation.
 *
 * **The HEADER follows scroll; the MENU never does** (Taylor, 2026-08-22). Reading the scorecard
 * is when the golfer wants the screen to itself, so the header slides out as the card comes up and
 * returns on the way back — but the main menu stays put, because it is the app's one way off this
 * page and a swing is not a page anyone should have to scroll to escape. The header's offset is
 * kept LOCAL rather than taken from `useChromeScroll`: that hook also latches the shell-wide
 * tab-bar flag, and this screen must not move a bar it is not showing.
 *
 * The menu and the header sit OUTSIDE the swipe (Taylor, 2026-08-22): they are the app's frame,
 * identical on every swing, and a frame that slides off and comes back reads as the whole app
 * moving rather than the swing changing. Everything belonging to THIS swing — picture, heading,
 * transport, scorecard — travels with the finger.
 */
export function StandaloneSwingPage({
  entry,
  prev,
  next,
  onGo,
  analyzed = true,
  extras,
  localVideo = null,
}: {
  entry: SwingEntry;
  prev: SwingEntry | null;
  next: SwingEntry | null;
  onGo: (id: string) => void;
  /** False while the pipeline still runs — the pending import page wears this chrome too. */
  analyzed?: boolean;
  /** Host chrome over the page (the pending page's analyzing bar). */
  extras?: ReactNode;
  /** The just-saved import's trimmed file, until the server has anything to stream. */
  localVideo?: { path: string; speed?: number } | null;
}) {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const swing = entry.swing;
  const { starred, toggle } = useStarred(swing.id);
  // Reading the analysis, not watching the swing — the sideways drag stands down while the card
  // is up, so scrolling a scorecard with a slightly diagonal finger cannot change swing.
  const [videoOpen, setVideoOpen] = useState(true);
  /** Which swing's player has painted a real frame — the swipe cover holds until it is this one. */
  const [paintedId, setPaintedId] = useState<string | null>(null);
  // The header's channel only — see the note above. Absolute offset, so it unwinds solely by
  // scrolling back toward the top, exactly as `useChromeScroll` feeds every other screen's header.
  const chromePx = useRef(new Animated.Value(0)).current;
  const onChromeScroll = useCallback(
    (y: number) => chromePx.setValue(Math.max(0, y)),
    [chromePx],
  );

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
      // Keyed by swing: the player, the report request and the scroll position all belong to ONE
      // swing, and carrying a warmed decoder across to a different clip is how a page ends up
      // drawing one swing's overlay over another's picture.
      key={swing.id}
      swing={swing}
      analyzed={analyzed}
      extras={extras}
      localVideo={localVideo}
      testID="report"
      // The main menu is worn outside the swipe — see the note above. Nothing goes in this slot.
      menu={() => null}
      // The header bar plus air (Taylor, 2026-08-22): flush under the bar put the orb column
      // right against the profile door, and two round controls that close together read as one
      // stack rather than as app chrome and swing chrome.
      chromeTopInset={APP_HEADER_BAR + ORB_DROP}
      // The tab is there at page load, no slide-in — the entrance theatre belongs to the
      // after-swing screen, where the card arriving is the analysis finishing.
      staticSheet
      // The scorecard is already on screen here — a second copy of the number floating in the
      // corner is chrome nobody asked for (Taylor, 2026-08-22).
      scoreDoor={false}
      onVideoOpenChange={setVideoOpen}
      onFirstFrame={() => setPaintedId(swing.id)}
      // The page's scroll drives this screen's header, which lives outside `SwingPage` — so the
      // offset has to come back out.
      onScrollY={onChromeScroll}
      // Which ball of which session — under the header bar, over the picture, and INSIDE the
      // video-open shell (Taylor, 2026-08-22) so it fades with the transport the moment the
      // scorecard comes up. The page is edge-to-edge, so the inset is read here — and it has to
      // be the SAME arithmetic `SwingPeek` uses, or the heading jumps by a status bar's height
      // at the moment a slide lands.
      pictureChrome={
        <View style={[styles.heading, { top: insets.top + APP_HEADER_BAR }]} pointerEvents="none">
          <SwingHeading entry={entry} />
        </View>
      }
      // Favourite only. Delete left the corner (Taylor, 2026-08-22) — it is a destructive action
      // parked one mis-tap from the play button, and the swing log already owns it.
      topRight={
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
      }
    />
  );

  return (
    <FixedDarkTheme>
      <View style={styles.fill}>
        <SwingSwipe
          // The commit signal — the swipe holds its slid position until this changes.
          currentKey={swing.id}
          enabled={videoOpen}
          prev={prev ? <SwingPeek entry={prev} /> : null}
          next={next ? <SwingPeek entry={next} /> : null}
          // The same still, for the swing being moved TO — it covers the swap and fades into the
          // identical poster the page paints under its own video.
          cover={<SwingPeek entry={entry} />}
          coverReadyKey={paintedId}
          onGo={(step) => {
            const to = step === 1 ? next : prev;
            if (to) onGo(to.swing.id);
          }}
        >
          {page}
        </SwingSwipe>

        {/* Out of the dark pin: every bar in the app is the same bar, so the main menu keeps
            the app's surface exactly as `SessionNav` does on the capture screen. */}
        <AppTheme>
          <WaveNav
            items={tabs}
            recordTestID="swing-tab-record"
            onRecord={() => navigation.navigate("Record")}
          />
        </AppTheme>

        {/* The interior-page header, over the picture — hero ink (white) on the fixed dark
            player ground, exactly as on Swing Log's dark hero. */}
        <AppHeader
          hero
          chromePx={chromePx}
          avatar={<Avatar size={26} />}
          onProfile={() => navigation.navigate("Profile")}
          profileTestID="swing-profile"
        />
      </View>
    </FixedDarkTheme>
  );
}

/** Air between the app header's profile door and the top of the swing's own orb column. */
const ORB_DROP = 24;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Left-aligned under the header bar, clear of the corner orb column on the right.
  heading: { position: "absolute", left: 16, right: 68 },
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
