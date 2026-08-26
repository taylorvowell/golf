import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ChevronUp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingSummary } from "@swingsage/schema/contract";

import { Skeleton, navBarBottomInset } from "../../design/system";
import { SwingProfile } from "../../design/system/SwingProfile";
import { useReport } from "../player/useReport";
import { SESSION_NAV_CLEARANCE } from "../session/SessionNav";
import { useTheme } from "../../theme";
import { ReportSheet } from "./ReportSheet";
import { ReportVideoLayer } from "./VideoLayer";
import { buildReportViewModel } from "./selectors";

/**
 * THE swing page — one swing, one page, everywhere (D61, extended 2026-08-19: the standalone
 * swing screen and the session's post-recording screen are the SAME component; the menu bar is
 * the only thing a host changes). The swing loops under the standard transport, the scorecard
 * peeks over the bar until the golfer has been in once, and the score circle is the door.
 *
 * Hosts supply the bar through `menu` and any surface-specific chrome through `extras`. Two
 * placement rules learned in step-03 iteration (Taylor): the bar renders as a SIBLING over the
 * layer, not through the scaffold's `stickyFooter` slot — it must stay put when the report sheet
 * opens — and anything floating over the video (the analyzing bar) floats OVER the layer too,
 * because content inside the low-held sheet sits behind the bar and was invisible.
 */

export interface SwingPageProps {
  swing: SwingSummary;
  /** False while the session's pipeline still runs — the sheet waits low as a skeleton and the
   * score chrome holds back until the report is real. Outside a session a swing is ready. */
  analyzed?: boolean;
  /** True while the session's completion moment plays over the page: the sheet and the score
   * door hold back so the overlay owns the screen for its 1.6 s. */
  celebrating?: boolean;
  /** Omit for a host with no "back" (the standalone page navigates by menu and header) — the
   * floating back orb only exists when there is somewhere specific to go. */
  onBack?: () => void;
  /**
   * The page's bar, handed the scroll-direction hidden state so every host's bar behaves like
   * the tab bar — a run of 15% of the window in one direction flips it.
   */
  menu: (hidden: boolean) => ReactNode;
  /** Host actions for the video-open top-right orb stack (`CornerOrb`s — star/delete on the
   * standalone page). */
  topRight?: ReactNode;
  /** Pushes the corner chrome below a header the host overlays on the picture. */
  chromeTopInset?: number;
  /**
   * The sheet is simply THERE from the first frame — no slide-up entrance when the report
   * arrives (Taylor, 2026-08-19: the standalone swing view; the after-swing keeps the
   * entrance, where the card arriving IS the analysis finishing).
   */
  staticSheet?: boolean;
  /**
   * The score circle over the picture's top-right corner.
   *
   * OFF on the standalone swing page (Taylor, 2026-08-22): the scorecard is already sitting on
   * the screen there, so a second copy of the number floating in the corner is chrome nobody
   * asked for. It stays on the after-swing screen, where the score ARRIVING is the analysis
   * finishing.
   */
  scoreDoor?: boolean;
  /** Host chrome over everything — sheets, the analyzing bar, the completion overlay. */
  extras?: ReactNode;
  /**
   * Play this LOCAL file instead of the server stream — the just-saved import whose upload is
   * still in flight (see `ReportVideoLayer.localSource`). The page is otherwise itself: the
   * standard transport scrubs on the container's own facts, the sheet waits as a skeleton.
   */
  localVideo?: { path: string; speed?: number } | null;
  /**
   * Host chrome belonging to the PICTURE — it rides inside the video-open shell and fades out
   * with the transport as the scorecard comes up (the standalone page's swing heading).
   */
  pictureChrome?: ReactNode;
  /**
   * The raw scroll offset, out to a host that drives its OWN chrome from it — the standalone
   * page's app header and main menu, which live outside this component and must follow scroll
   * exactly as every other screen's do.
   */
  onScrollY?: (y: number) => void;
  /** Crossings into and out of video-open, for host chrome that only belongs over the picture
   * (the standalone page gates its sideways swipe on it — a page that slides away under an open
   * scorecard is not what a sideways drag over a report means). */
  onVideoOpenChange?: (open: boolean) => void;
  /** The player's first real frame reached the glass — the swipe cover's release signal. */
  onFirstFrame?: () => void;
  testID?: string;
}

/** The analysed frame's shape off the swing LIST, so the stage is right on the first paint. */
export function swingAspectRatio(swing: SwingSummary): number | null {
  const sized =
    swing.views.find((v) => v.id === swing.primaryViewId && v.width && v.height) ??
    swing.views.find((v) => v.width && v.height);
  return sized?.width && sized?.height ? sized.width / sized.height : null;
}

export function SwingPage({
  swing,
  analyzed = true,
  celebrating = false,
  onBack,
  menu,
  topRight,
  chromeTopInset,
  staticSheet = false,
  scoreDoor = true,
  extras,
  localVideo = null,
  pictureChrome,
  onScrollY: onHostScrollY,
  onVideoOpenChange,
  onFirstFrame,
  testID,
}: SwingPageProps) {
  const t = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * The scroll seam. The page lands in video-open (the swing looping under the transport —
   * watching comes first), so the scorecard has to be reachable without a drag: the score
   * circle over the picture scrolls TO THE SWING-PROFILE BOARD, not just "up" (Taylor,
   * 2026-08-19 — a fixed 55% of the window stopped short of the section it promised).
   *
   * The target composes: the scroll content is [video spacer = window height] then the card
   * (top overlapping by `SHEET_REST_OVERLAP`), the card's handle strip, the content pull-up,
   * then the board's measured y within the sheet — minus room at the top so the board lands
   * below the screen edge rather than kissing it.
   */
  const scroll = useRef<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>(null);
  const boardY = useRef(0);
  const onBoardLayout = useCallback((y: number) => {
    boardY.current = y;
  }, []);
  const openStats = useCallback(() => {
    const contentY =
      windowHeight - SHEET_REST_OVERLAP + CONTENT_TOP_IN_CARD + boardY.current;
    scroll.current?.scrollTo({
      y: Math.max(0, Math.round(contentY - insets.top - BOARD_TOP_ROOM)),
      animated: true,
    });
  }, [windowHeight, insets.top]);
  /** The tab's chevron: the sheet to its open rest — the analysis from the top, not the board. */
  const openAnalysis = useCallback(() => {
    scroll.current?.scrollTo({ y: Math.round(windowHeight * 0.55), animated: true });
  }, [windowHeight]);
  const showVideo = useCallback(() => {
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, []);

  /**
   * The score ARRIVES. It is the payoff of the twelve seconds the golfer just waited through,
   * and something that valuable snapping into existence between two frames reads as a rendering
   * bug. Native driver, one value, and it never runs again for this swing.
   */
  const scoreIn = useRef(new Animated.Value(0)).current;

  const aspectRatio = useMemo(() => swingAspectRatio(swing), [swing]);
  const report = useReport(swing.id, null, true);

  /**
   * The golfer has been into the analysis at least once on this swing — retires the score door
   * (the completion moment's chrome). One-way while the swing is open.
   */
  const [seenAnalysis, setSeenAnalysis] = useState(false);

  /**
   * The bar follows scroll DIRECTION, exactly as the tab bar does — a run of 15% of the window
   * height in one direction flips it, so it comes back the moment the golfer scrolls up
   * anywhere, not only at the very top. Position alone (`videoOpen`) meant the bar stayed gone
   * until they reached the top, which is not how the rest of the app behaves.
   */
  const [barHidden, setBarHidden] = useState(false);
  const scrollRun = useRef({ last: 0, run: 0 });
  const onScrollY = useCallback(
    (y: number) => {
      onHostScrollY?.(y);
      const state = scrollRun.current;
      const delta = y - state.last;
      state.last = y;
      // A reversal restarts the run — the latch measures intent, not the total distance.
      const sameWay = (state.run > 0) === (delta > 0);
      state.run = sameWay ? state.run + delta : delta;
      const threshold = windowHeight * 0.15;
      if (state.run > threshold) setBarHidden(true);
      else if (state.run < -threshold || y <= 0) setBarHidden(false);
    },
    [windowHeight, onHostScrollY],
  );

  const vm = useMemo(
    () => (report.kind === "ok" ? buildReportViewModel(report.report, swing) : null),
    [report, swing],
  );

  const sheetContent = useMemo(
    () => (
      <View style={{ paddingBottom: 140 }}>
        {analyzed && vm != null ? (
          // The tab is just the handle bar plus its one control (Taylor, 2026-08-19 — the
          // title and seam came and went in iteration): an up chevron in a subtle disc,
          // top-right in the handle strip, that opens the analysis in full. NEGATIVE top: it
          // sits beside the drag handle, above where content begins, moving no content.
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the analysis"
              onPress={openAnalysis}
              hitSlop={12}
              style={({ pressed }) => [
                styles.cardChevron,
                { backgroundColor: t.surface },
                pressed && styles.pressed,
              ]}
              testID="swing-tab-open"
            >
              <ChevronUp size={18} color={t.cobalt} strokeWidth={2.4} />
            </Pressable>
            {/* Pulled up under the handle: its own top margin (16) plus the handle's bottom
                margin (14) read as a dead band (Taylor, 2026-08-19) — this leaves ~12px. */}
            <View style={{ marginTop: -18 }}>
              <ReportSheet
                vm={vm}
                swingId={swing.id}
                onShowVideo={showVideo}
                hideHeader
                onBoardLayout={onBoardLayout}
              />
            </View>
          </>
        ) : report.kind === "unreachable" ? (
          <View style={styles.sheetCentre}>
            <Text style={[styles.stateTitle, { color: t.text }]}>Cannot reach SwingSage</Text>
            <Text style={[styles.stateDetail, { color: t.muted }]}>
              The report is safe — this device just could not connect.
            </Text>
          </View>
        ) : analyzed && report.kind === "not-scored" ? (
          <View style={styles.sheetCentre}>
            <Text style={[styles.stateTitle, { color: t.text }]}>Not scored</Text>
            <Text style={[styles.stateDetail, { color: t.muted }]}>
              This swing was analysed without scoring, so there is no report to show — the
              picture above is still real.
            </Text>
          </View>
        ) : (
          <SheetSkeleton />
        )}
      </View>
    ),
    [analyzed, vm, swing.id, report.kind, showVideo, openAnalysis, onBoardLayout, t],
  );

  return (
    <View style={styles.fill}>
      <ReportVideoLayer
        testID={testID}
        swingId={swing.id}
        frameCount={swing.frameCount}
        fps={swing.fps}
        // An unanalysed swing plays its uploaded original the moment it lands — the analyzer is
        // not a gate on watching the swing that was just hit (Taylor, 2026-08-23).
        videoReady={swing.status === "ready"}
        localSource={localVideo}
        aspectRatio={aspectRatio}
        score={analyzed && typeof swing.overallScore === "number" ? swing.overallScore : null}
        tempoRatio={analyzed ? swing.tempoRatio : null}
        onBack={onBack}
        // Arrive watching, not reading (Taylor, step-03 iteration).
        startOpen
        scrollRef={scroll}
        // The sheet's tab stays on screen instead of the report's full hide — the golfer has
        // to know the stats are down there to go looking for them. NEGATIVE because the bar
        // renders OVER this layer: the tab has to clear the bar itself and the gesture inset,
        // or it is drawn behind both and there is nothing to see. The scaffold already shows
        // `SHEET_REST_OVERLAP` of card at rest, so that comes off the lift — without the
        // subtraction the "tab" was ~120px of scorecard, not a tip (Taylor, 2026-08-19).
        // ALWAYS, not only while the hint teaches: the tab is the sheet's FLOOR — scrolled all
        // the way to the top the card never sinks below it (Taylor, 2026-08-19; only the
        // swipe-up words retire).
        openSheetDrop={
          -(
            SESSION_NAV_CLEARANCE +
            navBarBottomInset(insets.bottom) +
            TIP_ABOVE_BAR -
            SHEET_REST_OVERLAP
          )
        }
        // The score circle IS the door to the sheet, so it only exists once there is a score.
        cornerOverlay={
          scoreDoor &&
          analyzed &&
          typeof swing.overallScore === "number" &&
          !celebrating &&
          // The completion moment only. Once the golfer has been into the analysis they have
          // seen the score, and a circle parked over the video is chrome they did not ask for.
          !seenAnalysis ? (
            <Animated.View
              style={{
                // `SwingProfile` has a fixed height and NO intrinsic width, so any parent that
                // sizes to content (a flex-end row) collapses it to nothing. Say the width.
                width: 116,
                opacity: scoreIn,
                transform: [
                  { scale: scoreIn.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
                ],
              }}
              onLayout={() => {
                Animated.timing(scoreIn, {
                  toValue: 1,
                  duration: 420,
                  easing: Easing.out(Easing.back(1.4)),
                  useNativeDriver: true,
                }).start();
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Swing score ${Math.round(swing.overallScore)} — open the stats`}
                onPress={openStats}
                style={({ pressed }) => [styles.scoreDoor, pressed && styles.pressed]}
                testID="swing-score-door"
              >
                <SwingProfile score={swing.overallScore} compact />
              </Pressable>
            </Animated.View>
          ) : null
        }
        onScrollY={onScrollY}
        onVideoOpenChange={(open) => {
          if (!open) setSeenAnalysis(true);
          onVideoOpenChange?.(open);
        }}
        onFirstFrame={onFirstFrame}
        topRightExtras={topRight}
        topChromeInset={chromeTopInset}
        pictureChrome={pictureChrome}
        // With an entrance, it waits for the CONTENT, not just the analysis flag (Taylor,
        // 2026-08-19): the report request can take seconds, and a card that slides up to show
        // skeletons promises something it does not have. Content arriving IS the entrance —
        // `SheetOverBackdrop`'s own contract. `staticSheet` skips the theatre entirely.
        sheetPresented={
          staticSheet ||
          (analyzed && !celebrating && report.kind !== "loading" && report.kind !== "idle")
        }
        sheetStyle={{ backgroundColor: t.bgElevated }}
        // While analysing the transport sits above the analyzing pill (ANALYZING_INSET); once
        // the tab arrives the controls sit above IT — permanently, because the tab is the
        // sheet's floor and never leaves.
        controlsBottomInset={analyzed ? ANALYZING_INSET + TIP_PUSH : ANALYZING_INSET}
      >
        {sheetContent}
      </ReportVideoLayer>

      {menu(barHidden)}

      {extras}
    </View>
  );
}

/**
 * How much of the sheet shows above the bar in video-open — the drag handle's block (12+6+14)
 * plus the first sliver of the scorecard, so the tab overlays the video enough to read as a
 * card and not a stripe (Taylor, 2026-08-19). This is also the sheet's FLOOR: the card never
 * sits below it. Lowered from 96 (Taylor, 2026-08-22) — the card starts further down, so more
 * of the swing is uncovered before the golfer asks for the stats.
 */
const TIP_ABOVE_BAR = 70;
/**
 * `ReportVideoLayer` passes `overlap={92}` to the scaffold, so 92px of card is on screen at
 * scroll-0 BEFORE any drop. The tab's lift must count it, or the "tip" arrives 92px too tall.
 * Stated here because the drop is computed here; change the layer's overlap and this together.
 */
const SHEET_REST_OVERLAP = 92;
/** How far the tab pushes the transport up while it shows — visibly, or it reads as nothing
 * moving at all (Taylor). Trimmed with `TIP_ABOVE_BAR` (Taylor, 2026-08-22: less space below
 * the scrubber) — the card sits lower now, so the transport has less to clear. */
const TIP_PUSH = 14;

/** Clear of the bar, the record button's rise, and the analyzing pill beside it. */
const ANALYZING_INSET = 118;

/** Where sheet content begins below the card's top: the handle block (32) minus the content
 * pull-up (-18) — both are this file's own numbers. */
const CONTENT_TOP_IN_CARD = 14;
/** Air above the board when the score door lands on it. */
const BOARD_TOP_ROOM = 84;

/** The report's shape before the report — the promise the sheet keeps once the analysis lands. */
function SheetSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton style={{ width: 84, height: 10 }} />
      <Skeleton style={{ width: 190, height: 26, marginTop: 10 }} />
      <Skeleton style={{ width: 140, height: 12, marginTop: 8 }} />
      <Skeleton style={{ width: 220, height: 34, borderRadius: 17, marginTop: 16 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  skeleton: { paddingHorizontal: 16, paddingTop: 6 },
  sheetCentre: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    minHeight: 220,
  },
  stateTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  stateDetail: { fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  /** A whisper in the card's corner — 4px in from the card's top and right edges (Taylor,
   * 2026-08-19). Content begins 32px below the card top (the handle block), so -28 here lands
   * the label 4px from the edge without moving anything. */
  // The board caption's own voice (`SwingProfile`'s 6px FONT_BODY.bold), one step larger.
  // 20 in from the edge, not 4 — the card's 30px corner radius eats the true corner. Content
  // begins 32px below the card top (the handle block), so -24 = 8px from the card's top edge.
  /** The tab's one control: a quiet disc off the surface ramp, riding the handle strip. */
  cardChevron: {
    position: "absolute",
    top: -30,
    right: 16,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreDoor: { borderRadius: 999, overflow: "hidden" },
  pressed: { opacity: 0.7 },
});
