import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type RefreshControlProps,
} from "react-native";

import { useTheme } from "../../theme";
import { SheetHandle } from "./SheetHandle";

/**
 * The screen-level scaffold behind Swing Log, Swing Report and Progress: a fixed full-bleed
 * backdrop with a rounded sheet scrolling up over it. The mockup's JS is the spec, mapped 1:1:
 *
 * - Parallax: backdrop translateY = min(scrollY × factor, cap) — downward, so the backdrop
 *   sinks slowly under the rising sheet (Log .22/72, Report .18/64).
 * - "Open" when scrollY < threshold (60): the host's `backdropOverlay` fades/slides in
 *   (opacity 0→1, translateY 24→0, 280ms) and the sticky footer slides away. Hysteresis of
 *   12px on the way closed so the boundary never flickers.
 * - The overlay lives INSIDE the scroll surface, before the sheet card, counter-translated by
 *   the scroll offset so it stays screen-fixed. That is what makes the mockup's stacking
 *   (video < controls shell < sheet) hold at every scroll position — the card always paints
 *   over the chrome, including mid-drag — while the controls stay tappable, because children
 *   of the scroll content take touches where a sibling under the scroll view never could.
 * - `initialOffset` lands the first paint with the sheet riding partway up (Log 170,
 *   Report 520).
 * - `presented={false}` parks the card low with the scroll gesture off until the host's
 *   content is real; flipping it true is the card's slide-up entrance.
 * - `onBackdropTap` makes the backdrop a tap target while closed — the report's
 *   tap-the-video-to-open door.
 *
 * One Animated.Value drives everything through native-driver interpolations; the scroll
 * listener only flips React state on threshold CROSSINGS, never per frame — cold code, but
 * the player's discipline anyway.
 */
/** The hero screens' parallax, in one place — the backdrop's `overscan` must match its `cap`,
 *  and two screens copying both numbers is how those two drift apart. */
export const HERO_PARALLAX = { factor: 0.22, cap: 72 } as const;

/**
 * The breathing room between the bottom of a hero's content and the top edge of the sheet that
 * rises over it.
 *
 * Declared, not tuned. `backdropHeight` used to be a hand-picked constant per screen (330 on the
 * log, 424 on Progress) with no relationship to what the hero actually contained, so the gap was
 * whatever fell out of two numbers chosen independently — and it fell out different (Taylor,
 * 2026-08-18). Screens now MEASURE their hero and set
 * `backdropHeight = heroHeight + overlap + HERO_SHEET_GAP`, which makes the sheet's top edge land
 * exactly this far below the content on every screen, and keeps doing so when the content
 * changes.
 */
export const HERO_SHEET_GAP = 20;

export function SheetOverBackdrop({
  backdrop,
  overscan,
  backdropHeight,
  parallax = HERO_PARALLAX,
  openThreshold = 60,
  initialOffset = 0,
  overlap = 74,
  onOpenChange,
  openSheetDrop = 0,
  presented = true,
  presentDrop,
  onBackdropTap,
  backdropTapLabel = "Show the video",
  children,
  stickyFooter,
  backdropOverlay,
  sheetStyle,
  refreshControl,
  scrollRef,
  onScrollY,
  testID,
}: {
  /** The fixed layer (a `HeroBackdrop`, the report's video). Fills the screen. */
  backdrop: ReactNode;
  /** What to paint in the strip the parallax uncovers above the backdrop. Defaults to the hero
   *  gradient's first stop, which is right for every `HeroBackdrop`; a backdrop that is not one
   *  (the report's video layer) passes its own ground. */
  overscan?: string;
  /** How much of the backdrop shows above the sheet's resting edge (the spacer height). */
  backdropHeight: number;
  parallax?: { factor: number; cap: number };
  openThreshold?: number;
  initialOffset?: number;
  /** How far the sheet's rounded top rides over the backdrop (Log 74, Report 92). */
  overlap?: number;
  onOpenChange?: (open: boolean) => void;
  /**
   * How far the sheet body drops while open (the report's `.video-open .report-v2-sheet`
   * +132px), so its resting peek clears the screen's bottom edge and the backdrop is truly
   * full-bleed. 0 (the default, the Log's behaviour) leaves the sheet where the scroll put it.
   */
  openSheetDrop?: number;
  /**
   * False while the sheet's content is not ready to show: the card waits low over the
   * backdrop (a peek showing its skeletons) with the scroll gesture off, then slides up to
   * its resting offset when this flips true — content arriving IS the card's entrance.
   */
  presented?: boolean;
  /** How far below rest the card waits while not presented. Defaults to `initialOffset`
   *  (the card's scroll-0 peek at the screen's bottom edge). */
  presentDrop?: number;
  /** Makes the backdrop area a tap target while closed (e.g. tap the video → scroll open).
   *  The tap is the host's to interpret; drags still scroll. */
  onBackdropTap?: () => void;
  backdropTapLabel?: string;
  children: ReactNode;
  /** Floats at the screen's bottom edge over the sheet; slides away while open. */
  stickyFooter?: ReactNode;
  /** Interactive chrome shown over the backdrop only while open (the report's controls). */
  backdropOverlay?: ReactNode;
  sheetStyle?: object;
  /** A RefreshControl for the sheet's scroll (pull-to-refresh stays a host concern). */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Imperative seam: the host scrolls (e.g. a "show video" tap → top = backdrop open). */
  scrollRef?: React.RefObject<{ scrollTo: (opts: { y: number; animated?: boolean }) => void } | null>;
  /** Raw offset out to the host — the chrome-visibility hook's feed (`useChromeScroll`). */
  onScrollY?: (y: number) => void;
  testID?: string;
}) {
  const t = useTheme();
  const scrollY = useRef(new Animated.Value(initialOffset)).current;
  const [open, setOpen] = useState(initialOffset < openThreshold);
  const openRef = useRef(open);

  // 280ms fade/slide for overlay + footer, mirroring the mockup's transition timings.
  const openAnim = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(openAnim, {
      toValue: open ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
    onOpenChange?.(open);
  }, [open, openAnim, onOpenChange]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      onScrollY?.(y);
      // Hysteresis: open crossing down through the threshold, close only 12px past it, so
      // a finger resting exactly on the line never strobes the chrome.
      if (!openRef.current && y < openThreshold) {
        openRef.current = true;
        setOpen(true);
      } else if (openRef.current && y > openThreshold + 12) {
        openRef.current = false;
        setOpen(false);
      }
    },
    [openThreshold, onScrollY],
  );

  /**
   * The animated plumbing is hoisted so it survives re-renders of the HOST. The report screen
   * hosts this scaffold from the component that owns the video transport, which re-renders per
   * presented frame — an `Animated.event` or interpolation built inline in JSX would be a new
   * node 60×/s, each one re-attached to the native driver. Hoisted, a host render reconciles
   * the same nodes and attaches nothing.
   */
  const onScrollEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: onScroll,
      }),
    [scrollY, onScroll],
  );
  const parallaxY = useMemo(
    () =>
      // cap 0 = a FIXED backdrop (the swing page's video). Guarded here, not by the caller,
      // because cap/factor is 0/0 → NaN in the interpolation's input range.
      parallax.cap > 0
        ? scrollY.interpolate({
            inputRange: [0, parallax.cap / parallax.factor],
            outputRange: [0, parallax.cap],
            extrapolate: "clamp",
          })
        : new Animated.Value(0),
    [scrollY, parallax.cap, parallax.factor],
  );
  // The overlay's translateY: the counter-scroll that pins it to the viewport (it lives in
  // the scroll content), plus the mockup's 24→0 entrance slide.
  const overlayY = useMemo(
    () =>
      Animated.add(
        scrollY,
        openAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
      ),
    [scrollY, openAnim],
  );
  const footerFade = useMemo(
    () => openAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    [openAnim],
  );
  const footerSlide = useMemo(
    () => openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 118] }),
    [openAnim],
  );
  // The sheet's own drop rides a separate clock: the mockup gives it .32s against the
  // chrome's .28s, and that 40ms is visible — the sheet settles just after the controls land.
  const sheetDrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(sheetDrop, {
      toValue: open ? openSheetDrop : 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [open, openSheetDrop, sheetDrop]);
  // The entrance: not-presented parks the card `presentDrop` below rest; presenting slides it
  // up. Additive with the open drop — they answer different questions and must not fight.
  const presentAnim = useRef(new Animated.Value(presented ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(presentAnim, {
      toValue: presented ? 0 : 1,
      duration: 340,
      useNativeDriver: true,
    }).start();
  }, [presented, presentAnim]);
  const sheetY = useMemo(
    () =>
      Animated.add(
        sheetDrop,
        presentAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.max(0, presentDrop ?? initialOffset)],
        }),
      ),
    [sheetDrop, presentAnim, presentDrop, initialOffset],
  );

  return (
    <View style={{ flex: 1 }} testID={testID}>
      {/* The fixed backdrop, sinking under the sheet at the parallax rate.
          The layer is `parallax.cap` TALLER THAN THE SCREEN, extending above it, because
          sinking is exactly what uncovers its own top edge: at full parallax the old
          `absoluteFill` had translated `cap` px down and the screen's own ground showed as a
          bar across the top. The overscan strip is painted rather than filled with the
          backdrop itself so the backdrop's children keep their original position — the
          gradient's first stop is this colour, so the join is invisible. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: -parallax.cap,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: overscan ?? t.heroStart,
          transform: [{ translateY: parallaxY }],
        }}
      >
        <View style={{ height: parallax.cap }} pointerEvents="none" />
        <View style={{ flex: 1 }}>{backdrop}</View>
      </Animated.View>

      <Animated.ScrollView
        ref={scrollRef as never}
        testID={testID ? `${testID}-scroll` : undefined}
        // Lets the gallery host an instance inside its own scroll; no effect full-screen.
        nestedScrollEnabled
        // The gesture waits with the content: a card that is not presented yet must not be
        // draggable into a half-loaded state. Programmatic scrolls (backdrop tap) still work.
        scrollEnabled={presented}
        refreshControl={refreshControl}
        contentOffset={{ x: 0, y: initialOffset }}
        onScroll={onScrollEvent}
        scrollEventThrottle={16}
        // The parallax cap must never be visually exceeded — no rubber-banding above 0.
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {/* Transparent spacer — the backdrop shows through. With `onBackdropTap` it is the
            backdrop's tap target (drags still belong to the scroll, which wins the responder
            on movement); without, touches here only scroll. It sits BEFORE the overlay so the
            overlay's controls hit-test first — a tappable spacer after them would eat their
            touches. */}
        {onBackdropTap != null ? (
          <Pressable
            testID={testID ? `${testID}-backdrop-tap` : undefined}
            accessibilityRole="button"
            accessibilityLabel={backdropTapLabel}
            disabled={open}
            onPress={onBackdropTap}
            style={{ height: backdropHeight }}
          />
        ) : (
          <View style={{ height: backdropHeight }} pointerEvents="none" />
        )}
        {/* Backdrop chrome: present only while open; 0→1 / 24→0 like `.video-open`'s shell.
            BEFORE the sheet card on purpose — the card paints over it at every scroll
            position (the mockup's video < controls < sheet stacking). The counter-translate
            in `overlayY` keeps it screen-fixed on the scroll's own native clock; `box-none`
            while open lets its controls take touches and the gaps fall through, so
            swipe-to-close keeps working. */}
        {backdropOverlay != null && (
          <Animated.View
            testID={testID ? `${testID}-overlay` : undefined}
            pointerEvents={open ? "box-none" : "none"}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: backdropHeight,
              opacity: openAnim,
              transform: [{ translateY: overlayY }],
            }}
          >
            {backdropOverlay}
          </Animated.View>
        )}
        <Animated.View
          style={[
            {
              flexGrow: 1,
              marginTop: -overlap,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              backgroundColor: t.bgElevated,
              transform: [{ translateY: sheetY }],
            },
            sheetStyle,
          ]}
        >
          <SheetHandle />
          {children}
        </Animated.View>
      </Animated.ScrollView>

      {/* The floating footer (a SessionPillNav): slides away while the backdrop is open. */}
      {stickyFooter != null && (
        <Animated.View
          testID={testID ? `${testID}-footer` : undefined}
          pointerEvents={open ? "none" : "box-none"}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 12,
            opacity: footerFade,
            transform: [{ translateY: footerSlide }],
          }}
        >
          {stickyFooter}
        </Animated.View>
      )}
    </View>
  );
}
